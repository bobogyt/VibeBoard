import { randomUUID } from 'node:crypto'
import { pool } from '../db'
import { httpError } from '../http/http-error'
import { decryptSecret, encryptSecret } from '../util/secretBox'
import { createTask, moveTask } from './taskService'
import { getProject } from './projectService'

/**
 * GitHub 集成服务:仓库浏览(Issue/PR/Commit/Branch)、任务关联、Issue 转任务、PR 合并同步。
 * 设计约束:
 * - API 基址固定(GITHUB_API_BASE 环境变量仅用于测试/代理),owner/repo 白名单校验,无 SSRF 面
 * - PAT 复用模型密钥的 AES-256-GCM 静态加密,接口只回掩码
 * - 关联存独立表,不碰 tasks 列(saveBoard 是整表替换);悬空关联靠 JOIN 过滤 + 同步时清理
 */

const GITHUB_API_BASE = process.env.GITHUB_API_BASE || 'https://api.github.com'
const FETCH_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 60_000
const CACHE_MAX_ENTRIES = 300
const PER_PAGE = 20

// GitHub owner:字母数字与连字符,1-39 字符,首尾不为连字符;repo:字母数字._-,≤100
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}$/

/* ---------- URL 解析与校验 ---------- */

export interface RepoRef {
  owner: string
  repo: string
}

/** 解析 github.com 仓库地址;非 GitHub 地址或格式非法返回 null */
export function parseRepoUrl(url: unknown): RepoRef | null {
  if (typeof url !== 'string') return null
  const m = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim())
  if (!m) return null
  const [, owner, repo] = m
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) return null
  return { owner, repo }
}

function assertRepoRef(owner: string, repo: string): RepoRef {
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) throw httpError(400, '无效的仓库标识')
  return { owner, repo }
}

function assertNumber(value: unknown): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000_000) throw httpError(400, '无效的 Issue/PR 编号')
  return n
}

/* ---------- Token 配置(加密存储,复用模型密钥方案) ---------- */

function maskToken(token: string): string {
  return token.length > 8 ? `${token.slice(0, 4)}***${token.slice(-4)}` : '***'
}

/** 解析用户 PAT(明文只在本服务内使用);未配置返回 null(公开仓库匿名访问) */
export async function getGithubToken(userId: string): Promise<string | null> {
  const [rows] = await pool.execute('SELECT token FROM user_github_configs WHERE user_id = ?', [userId])
  const stored = (rows as unknown as Array<{ token: string }>)[0]?.token
  if (!stored) return null
  // 解密失败(密钥轮换)按未配置处理,提示用户重新保存
  return decryptSecret(stored)
}

export async function getGithubConfigInfo(userId: string): Promise<{ configured: boolean; tokenHint: string | null }> {
  const token = await getGithubToken(userId)
  return token ? { configured: true, tokenHint: maskToken(token) } : { configured: false, tokenHint: null }
}

export async function saveGithubToken(userId: string, token: unknown): Promise<void> {
  const trimmed = typeof token === 'string' ? token.trim() : ''
  if (trimmed.length < 8 || trimmed.length > 200) throw httpError(400, 'GitHub Token 长度需在 8-200 之间')
  if (!/^[A-Za-z0-9_]+$/.test(trimmed)) throw httpError(400, 'GitHub Token 格式无效')
  const now = Date.now()
  await pool.execute(
    `INSERT INTO user_github_configs (user_id, token, created_at, updated_at) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE token = VALUES(token), updated_at = VALUES(updated_at)`,
    [userId, encryptSecret(trimmed), now, now],
  )
}

export async function deleteGithubToken(userId: string): Promise<{ ok: boolean }> {
  await pool.execute('DELETE FROM user_github_configs WHERE user_id = ?', [userId])
  return { ok: true }
}

/* ---------- GitHub API 客户端(纯 fetch + 60s 内存缓存) ---------- */

interface CacheEntry {
  expiresAt: number
  data: unknown
}

const responseCache = new Map<string, CacheEntry>()

async function githubFetch<T>(userId: string, path: string): Promise<T> {
  const token = await getGithubToken(userId)
  const cacheKey = `${userId}|${token ? 'auth' : 'anon'}|${path}`
  const cached = responseCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.data as T

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${GITHUB_API_BASE}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'vibeboard',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw httpError(502, 'GitHub API 请求超时')
    throw httpError(502, 'GitHub API 无法访问')
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    if (res.status === 401) throw httpError(400, 'GitHub Token 无效或已过期')
    if (res.status === 403) throw httpError(429, 'GitHub API 请求过于频繁(限速),请稍后再试')
    if (res.status === 404) throw httpError(404, '仓库不存在或无访问权限(私有仓库需配置 Token)')
    throw httpError(502, `GitHub API 请求失败(${res.status})`)
  }
  const data = (await res.json()) as T
  if (responseCache.size >= CACHE_MAX_ENTRIES) responseCache.clear()
  responseCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data })
  return data
}

function pageQuery(page: unknown, extra: Record<string, string> = {}): string {
  const p = Math.max(1, Math.min(50, Number(page) || 1))
  const params = new URLSearchParams({ page: String(p), per_page: String(PER_PAGE), ...extra })
  return `?${params.toString()}`
}

/** 清空响应缓存(测试注入,以及需要强制刷新远端状态时使用) */
export function clearGithubResponseCache(): void {
  responseCache.clear()
}

/* ---------- 仓库数据(原始对象 → 精简 DTO) ---------- */

interface RawRepo {
  description: string | null
  default_branch: string
  stargazers_count: number
  open_issues_count: number
  html_url: string
}

export interface GithubRepoInfo {
  owner: string
  repo: string
  description: string | null
  defaultBranch: string
  stars: number
  openIssuesCount: number
  htmlUrl: string
}

export async function fetchRepoInfo(userId: string, owner: string, repo: string): Promise<GithubRepoInfo> {
  assertRepoRef(owner, repo)
  const raw = await githubFetch<RawRepo>(userId, `/repos/${owner}/${repo}`)
  return {
    owner,
    repo,
    description: raw.description,
    defaultBranch: raw.default_branch,
    stars: Number(raw.stargazers_count) || 0,
    openIssuesCount: Number(raw.open_issues_count) || 0,
    htmlUrl: raw.html_url,
  }
}

interface RawIssue {
  number: number
  title: string
  state: string
  html_url: string
  body: string | null
  user: { login: string } | null
  updated_at: string
  pull_request?: unknown
}

export interface GithubIssueItem {
  number: number
  title: string
  state: 'open' | 'closed'
  htmlUrl: string
  author: string
  updatedAt: number
}

export async function fetchIssues(
  userId: string,
  owner: string,
  repo: string,
  { state = 'open', page }: { state?: unknown; page?: unknown } = {},
): Promise<{ issues: GithubIssueItem[]; page: number; hasMore: boolean }> {
  assertRepoRef(owner, repo)
  const stateValue = state === 'closed' || state === 'all' ? String(state) : 'open'
  const pageNo = Math.max(1, Math.min(50, Number(page) || 1))
  const raw = await githubFetch<RawIssue[]>(
    userId,
    `/repos/${owner}/${repo}/issues${pageQuery(pageNo, { state: stateValue })}`,
  )
  // issues 端点会混入 PR,过滤掉
  const issues = raw
    .filter((it) => !it.pull_request)
    .map((it) => ({
      number: it.number,
      title: it.title,
      state: it.state === 'closed' ? ('closed' as const) : ('open' as const),
      htmlUrl: it.html_url,
      author: it.user?.login ?? '',
      updatedAt: Date.parse(it.updated_at) || 0,
    }))
  return { issues, page: pageNo, hasMore: raw.length === PER_PAGE }
}

interface RawPull {
  number: number
  title: string
  state: string
  merged: boolean
  merged_at: string | null
  html_url: string
  user: { login: string } | null
  updated_at: string
}

export interface GithubPullItem {
  number: number
  title: string
  state: 'open' | 'closed'
  merged: boolean
  mergedAt: number | null
  htmlUrl: string
  author: string
  updatedAt: number
}

export async function fetchPulls(
  userId: string,
  owner: string,
  repo: string,
  { state = 'open', page }: { state?: unknown; page?: unknown } = {},
): Promise<{ pulls: GithubPullItem[]; page: number; hasMore: boolean }> {
  assertRepoRef(owner, repo)
  const stateValue = state === 'closed' || state === 'all' ? String(state) : 'open'
  const pageNo = Math.max(1, Math.min(50, Number(page) || 1))
  const raw = await githubFetch<RawPull[]>(
    userId,
    `/repos/${owner}/${repo}/pulls${pageQuery(pageNo, { state: stateValue })}`,
  )
  const pulls = raw.map((it) => ({
    number: it.number,
    title: it.title,
    state: it.state === 'closed' ? ('closed' as const) : ('open' as const),
    merged: it.merged === true,
    mergedAt: it.merged_at ? Date.parse(it.merged_at) || null : null,
    htmlUrl: it.html_url,
    author: it.user?.login ?? '',
    updatedAt: Date.parse(it.updated_at) || 0,
  }))
  return { pulls, page: pageNo, hasMore: raw.length === PER_PAGE }
}

interface RawCommit {
  sha: string
  html_url: string
  commit: { message: string; author: { name: string; date: string } | null }
}

export interface GithubCommitItem {
  sha: string
  message: string
  author: string
  date: number
  htmlUrl: string
}

export async function fetchCommits(
  userId: string,
  owner: string,
  repo: string,
  { branch, page }: { branch?: unknown; page?: unknown } = {},
): Promise<{ commits: GithubCommitItem[]; page: number; hasMore: boolean }> {
  assertRepoRef(owner, repo)
  const pageNo = Math.max(1, Math.min(50, Number(page) || 1))
  // 分支名进入查询参数(URLSearchParams 负责编码),不拼进路径
  const extra: Record<string, string> = typeof branch === 'string' && branch.trim() ? { sha: branch.trim() } : {}
  const raw = await githubFetch<RawCommit[]>(userId, `/repos/${owner}/${repo}/commits${pageQuery(pageNo, extra)}`)
  const commits = raw.map((it) => ({
    sha: it.sha.slice(0, 7),
    message: it.commit.message.split('\n')[0],
    author: it.commit.author?.name ?? '',
    date: it.commit.author ? Date.parse(it.commit.author.date) || 0 : 0,
    htmlUrl: it.html_url,
  }))
  return { commits, page: pageNo, hasMore: raw.length === PER_PAGE }
}

interface RawBranch {
  name: string
  commit: { sha: string }
  protected: boolean
}

export interface GithubBranchItem {
  name: string
  sha: string
  protected: boolean
}

export async function fetchBranches(
  userId: string,
  owner: string,
  repo: string,
): Promise<{ branches: GithubBranchItem[] }> {
  assertRepoRef(owner, repo)
  const raw = await githubFetch<RawBranch[]>(userId, `/repos/${owner}/${repo}/branches${pageQuery(1)}`)
  const branches = raw.map((it) => ({
    name: it.name,
    sha: it.commit?.sha?.slice(0, 7) ?? '',
    protected: it.protected === true,
  }))
  return { branches }
}

/* ---------- 任务关联(task_github_links) ---------- */

export interface GithubLink {
  id: string
  taskId: string
  owner: string
  repo: string
  type: 'issue' | 'pr'
  number: number
  title: string | null
  url: string | null
  state: string | null
  merged: boolean
  mergedAt: number | null
  createdAt: number
}

interface LinkRow {
  id: string
  task_id: string
  owner: string
  repo: string
  link_type: string
  number: number
  title: string | null
  url: string | null
  state: string | null
  merged: number
  merged_at: number | null
  created_at: number
}

function rowToLink(row: LinkRow): GithubLink {
  return {
    id: row.id,
    taskId: row.task_id,
    owner: row.owner,
    repo: row.repo,
    type: row.link_type === 'pr' ? 'pr' : 'issue',
    number: Number(row.number),
    title: row.title,
    url: row.url,
    state: row.state,
    merged: row.merged === 1,
    mergedAt: row.merged_at === null ? null : Number(row.merged_at),
    createdAt: Number(row.created_at),
  }
}

/** 单个 Issue/PR 的元数据(建关联时校验存在并回填) */
interface ItemMeta {
  type: 'issue' | 'pr'
  title: string
  url: string
  state: string
  merged: boolean
  mergedAt: number | null
  body: string
  author: string
}

async function fetchItemMeta(
  userId: string,
  owner: string,
  repo: string,
  type: 'issue' | 'pr',
  number: number,
): Promise<ItemMeta> {
  if (type === 'pr') {
    const it = await githubFetch<RawPull>(userId, `/repos/${owner}/${repo}/pulls/${number}`)
    return {
      type: 'pr',
      title: it.title,
      url: it.html_url,
      state: it.state,
      merged: it.merged === true,
      mergedAt: it.merged_at ? Date.parse(it.merged_at) || null : null,
      body: '',
      author: it.user?.login ?? '',
    }
  }
  const it = await githubFetch<RawIssue>(userId, `/repos/${owner}/${repo}/issues/${number}`)
  // 用户可能把 PR 编号当 Issue 关联:issues 端点对 PR 返回带 pull_request 的对象,自动纠正类型
  if (it.pull_request) return fetchItemMeta(userId, owner, repo, 'pr', number)
  return {
    type: 'issue',
    title: it.title,
    url: it.html_url,
    state: it.state,
    merged: false,
    mergedAt: null,
    body: it.body ?? '',
    author: it.user?.login ?? '',
  }
}

async function insertLink(
  userId: string,
  taskId: string,
  owner: string,
  repo: string,
  number: number,
  meta: ItemMeta,
): Promise<GithubLink> {
  const id = randomUUID()
  const now = Date.now()
  try {
    await pool.execute(
      `INSERT INTO task_github_links
         (id, user_id, task_id, owner, repo, link_type, number, title, url, state, merged, merged_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        taskId,
        owner,
        repo,
        meta.type,
        number,
        meta.title.slice(0, 400),
        meta.url.slice(0, 500),
        meta.state,
        meta.merged ? 1 : 0,
        meta.mergedAt,
        now,
      ],
    )
  } catch (err) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      throw httpError(409, '该任务已关联此 Issue/PR')
    }
    throw err
  }
  return {
    id,
    taskId,
    owner,
    repo,
    type: meta.type,
    number,
    title: meta.title.slice(0, 400),
    url: meta.url,
    state: meta.state,
    merged: meta.merged,
    mergedAt: meta.mergedAt,
    createdAt: now,
  }
}

/** 把任务与某仓库的 Issue/PR 建立关联(服务端拉取校验存在,回填标题/状态);关联已合并 PR 时任务直接移至 Done */
export async function linkTaskToGithub(
  userId: string,
  taskId: unknown,
  input: { owner?: unknown; repo?: unknown; type?: unknown; number?: unknown } = {},
): Promise<{ link: GithubLink; taskMovedToDone: boolean }> {
  if (typeof taskId !== 'string' || taskId.length === 0) throw httpError(400, 'taskId 必填')
  const { owner, repo } = assertRepoRef(String(input.owner ?? ''), String(input.repo ?? ''))
  const type = input.type === 'pr' ? 'pr' : input.type === 'issue' ? 'issue' : null
  if (!type) throw httpError(400, 'type 需为 issue 或 pr')
  const number = assertNumber(input.number)

  const [rows] = await pool.execute('SELECT id, status FROM tasks WHERE id = ? AND board_id = ? AND archived = 0', [
    taskId,
    userId,
  ])
  const taskRow = (rows as unknown as Array<{ id: string; status: string }>)[0]
  if (!taskRow) throw httpError(404, '任务不存在')

  const meta = await fetchItemMeta(userId, owner, repo, type, number)
  const link = await insertLink(userId, taskId, owner, repo, number, meta)
  let taskMovedToDone = false
  if (type === 'pr' && meta.merged && taskRow.status !== 'done') {
    await moveTask(userId, taskId, 'done')
    taskMovedToDone = true
  }
  return { link, taskMovedToDone }
}

export async function unlinkGithub(userId: string, linkId: unknown): Promise<{ ok: boolean }> {
  if (typeof linkId !== 'string' || linkId.length === 0) throw httpError(400, '无效的关联 id')
  await pool.execute('DELETE FROM task_github_links WHERE id = ? AND user_id = ?', [linkId, userId])
  return { ok: true }
}

/** 当前用户全部有效关联(JOIN tasks 过滤悬空;归档任务行仍在,关联保留) */
export async function listGithubLinks(userId: string): Promise<GithubLink[]> {
  const [rows] = await pool.execute(
    `SELECT l.* FROM task_github_links l
     JOIN tasks t ON t.id = l.task_id AND t.board_id = ?
     WHERE l.user_id = ? ORDER BY l.created_at DESC`,
    [userId, userId],
  )
  return (rows as unknown as LinkRow[]).map(rowToLink)
}

/** 清理任务已不存在的悬空关联(任务删除是行级删除,关联不会自动跟随) */
export async function cleanupDanglingLinks(userId: string): Promise<number> {
  const [result] = await pool.execute(
    `DELETE l FROM task_github_links l
     LEFT JOIN tasks t ON t.id = l.task_id
     WHERE l.user_id = ? AND t.id IS NULL`,
    [userId],
  )
  return Number((result as { affectedRows?: number }).affectedRows) || 0
}

/* ---------- Issue 转任务 ---------- */

export async function importIssueAsTask(
  userId: string,
  input: { owner?: unknown; repo?: unknown; number?: unknown; projectId?: unknown } = {},
): Promise<{ task: { id: string; title: string }; link: GithubLink }> {
  const { owner, repo } = assertRepoRef(String(input.owner ?? ''), String(input.repo ?? ''))
  const number = assertNumber(input.number)

  let projectId: string | null = null
  if (input.projectId !== undefined && input.projectId !== null) {
    if (typeof input.projectId !== 'string') throw httpError(400, 'projectId 需为字符串')
    await getProject(userId, input.projectId) // 校验归属,不存在/非本人抛 404
    projectId = input.projectId
  }

  const meta = await fetchItemMeta(userId, owner, repo, 'issue', number)
  const title = `#${number} ${meta.title}`.slice(0, 200)
  const attribution = [`— 来源:[GitHub Issue #${number}](${meta.url})`]
  if (meta.author) attribution.push(`创建者:${meta.author}`)
  const description = `${meta.body.slice(0, 4500)}\n\n${attribution.join('\n')}`.trim()
  const task = await createTask(userId, { title, description, projectId })
  const link = await insertLink(userId, task.id, owner, repo, number, meta)
  return { task: { id: task.id, title: task.title }, link }
}

/* ---------- PR 合并同步(自动化 github-pr-sync 的执行体) ---------- */

export interface GithubPrSyncResult {
  checked: number
  moved: number
  updated: number
  cleaned: number
  errors: string[]
  movedLines: string[]
}

/** 检查未合并 PR 关联的最新状态:已合并 → 更新关联 + 任务移至 Done(写入走 moveTask,自带用户级写锁) */
export async function syncGithubPrs(userId: string): Promise<GithubPrSyncResult> {
  const cleaned = await cleanupDanglingLinks(userId)
  const [rows] = await pool.execute(
    `SELECT l.id AS link_id, l.task_id, l.owner, l.repo, l.number, t.title AS task_title, t.status AS task_status
     FROM task_github_links l
     JOIN tasks t ON t.id = l.task_id AND t.board_id = ?
     WHERE l.user_id = ? AND l.link_type = 'pr' AND l.merged = 0`,
    [userId, userId],
  )
  const pending = rows as unknown as Array<{
    link_id: string
    task_id: string
    owner: string
    repo: string
    number: number
    task_title: string
    task_status: string
  }>

  const result: GithubPrSyncResult = { checked: pending.length, moved: 0, updated: 0, cleaned, errors: [], movedLines: [] }
  for (const row of pending) {
    try {
      const meta = await fetchItemMeta(userId, row.owner, row.repo, 'pr', row.number)
      if (meta.merged) {
        await pool.execute(
          'UPDATE task_github_links SET state = ?, merged = 1, merged_at = ?, title = ? WHERE id = ?',
          [meta.state, meta.mergedAt ?? Date.now(), meta.title.slice(0, 400), row.link_id],
        )
        result.updated += 1
        if (row.task_status !== 'done') {
          await moveTask(userId, row.task_id, 'done')
          result.moved += 1
          result.movedLines.push(`PR ${row.owner}/${row.repo}#${row.number} 已合并 →「${row.task_title}」移至 Done`)
        }
      } else if (meta.state !== 'closed') {
        // open 状态有变化(如标题修改)时轻量刷新;closed 未合并只记录状态
        await pool.execute('UPDATE task_github_links SET state = ?, title = ? WHERE id = ?', [
          meta.state,
          meta.title.slice(0, 400),
          row.link_id,
        ])
        result.updated += 1
      }
    } catch (err) {
      // 单条失败(如 Token 失效/仓库删除)不阻塞其余检查,汇总进 errors
      result.errors.push(`#${row.number}(${row.owner}/${row.repo}):${(err as Error).message}`)
    }
  }
  return result
}
