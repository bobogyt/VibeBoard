/** GitHub 仓库地址解析(与后端 githubService.parseRepoUrl 同源规则,展示层判定绑定用) */

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}$/

export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  if (typeof url !== 'string') return null
  const m = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim())
  if (!m) return null
  const [, owner, repo] = m
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) return null
  return { owner, repo }
}
