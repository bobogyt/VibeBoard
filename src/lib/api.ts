import { getToken, clearToken } from './session'
import type {
  AutomationInfo,
  AutomationRunInfo,
  BoardStats,
  BoardState,
  GithubLink,
  NotificationItem,
  Project,
  ProjectInput,
  Task,
} from '../types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export class UnauthorizedError extends ApiError {
  constructor() {
    super(401, '登录已过期,请重新登录')
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  const hadToken = token !== null
  if (token) headers.Authorization = `Bearer ${token}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
  } catch {
    throw new ApiError(0, '无法连接服务器,请检查后端是否运行')
  }

  // 已登录请求的 401 = 会话失效;登录/注册的 401 只是凭据错误,要透出服务端原始信息
  if (res.status === 401 && hadToken) {
    clearToken()
    throw new UnauthorizedError()
  }

  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : `请求失败(${res.status})`
    throw new ApiError(res.status, message)
  }
  return data as T
}

export interface AuthResult {
  token: string
  username: string
}

export interface AgentAction {
  step: number
  tool: string
  ok: boolean
}

export interface AgentRunResult {
  sessionId: string
  status: 'COMPLETED' | 'FAILED' | 'MAX_STEPS_REACHED'
  finalAnswer: string
  currentStep: number
  actions: AgentAction[]
}

/** /agent/run/stream 的执行过程事件:label 为服务端生成的中文摘要,不含推理内容与原始参数 */
export interface ApprovalTaskPreview {
  id?: string
  title: string
  status: 'todo' | 'doing' | 'done' | null
  /** createTasks 预览(目标拆解):新建任务的优先级 */
  priority?: string | null
}

export interface AgentStepEvent {
  type: 'started' | 'tool' | 'approval' | 'final'
  /** started:生效的模型标识(provider/model) */
  model?: string
  step?: number
  name?: string
  ok?: boolean
  label?: string
  durationMs?: number
  error?: string
  /** type === 'approval':待确认的高危操作 */
  requestId?: string
  tasks?: ApprovalTaskPreview[]
  /** type === 'final' 时携带完整公共运行结果 */
  sessionId?: string
  status?: AgentRunResult['status']
  finalAnswer?: string | null
  currentStep?: number
  actions?: AgentAction[]
}

export type AgentStepListener = (event: AgentStepEvent) => void

export interface ModelProviderInfo {
  id: string
  label: string
  models: string[]
}

export interface AgentModelsInfo {
  providers: ModelProviderInfo[]
  /** 已存密钥的供应商:keyHint 为掩码,明文永不回传 */
  configured: Record<string, { keyHint: string; activeModel: string }>
  active: { provider: string; model: string; source: 'user' | 'env' } | null
}

export interface Memory {
  id: string
  content: string
  updatedAt: number
}

/* ---------- GitHub 集成 ---------- */

export interface GithubConfigInfo {
  configured: boolean
  tokenHint: string | null
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

export interface GithubIssueItem {
  number: number
  title: string
  state: 'open' | 'closed'
  htmlUrl: string
  author: string
  updatedAt: number
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

export interface GithubCommitItem {
  sha: string
  message: string
  author: string
  date: number
  htmlUrl: string
}

export interface GithubBranchItem {
  name: string
  sha: string
  protected: boolean
}

export const api = {
  register: (username: string, password: string) =>
    request<AuthResult>('/auth/register', { method: 'POST', body: { username, password } }),

  login: (username: string, password: string) =>
    request<AuthResult>('/auth/login', { method: 'POST', body: { username, password } }),

  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

  me: () => request<AuthResult>('/auth/me'),

  fetchBoard: () => request<{ columns: BoardState }>('/board'),

  saveBoard: (columns: BoardState) => request<{ ok: true }>('/board', { method: 'PUT', body: { columns } }),

  listProjects: () => request<{ projects: Project[] }>('/projects'),

  createProject: (input: ProjectInput) =>
    request<{ project: Project }>('/projects', { method: 'POST', body: toServerProject(input) }),

  updateProject: (id: string, input: ProjectInput) =>
    request<{ project: Project }>(`/projects/${id}`, { method: 'PUT', body: toServerProject(input) }),

  deleteProject: (id: string) => request<{ ok: true }>(`/projects/${id}`, { method: 'DELETE' }),

  agentRun: (message: string) =>
    request<AgentRunResult>('/agent/run', { method: 'POST', body: { message } }),

  /** 高危操作人工确认:仅会话属主;不在等待中时服务端返回 409 */
  approveAgentRun: (sessionId: string, requestId: string, approved: boolean) =>
    request<{ ok: true }>(`/agent/sessions/${sessionId}/approval`, {
      method: 'POST',
      body: { requestId, approved },
    }),

  getArchivedTasks: () => request<{ tasks: Task[] }>('/tasks/archived'),

  restoreTasks: (taskIds: string[]) =>
    request<{ changed: number; tasks: Task[] }>('/tasks/restore', { method: 'POST', body: { taskIds } }),

  purgeTasks: (taskIds: string[]) =>
    request<{ deleted: number }>('/tasks/purge', { method: 'POST', body: { taskIds } }),

  getMemories: () => request<{ memories: Memory[] }>('/memories'),

  addMemory: (content: string) =>
    request<{ memory: Memory }>('/memories', { method: 'POST', body: { content } }),

  deleteMemory: (id: string) => request<{ ok: true }>(`/memories/${id}`, { method: 'DELETE' }),

  getStats: () => request<BoardStats>('/stats'),

  getAutomations: () => request<{ automations: AutomationInfo[] }>('/automations'),

  setAutomationEnabled: (id: string, enabled: boolean) =>
    request<{ ok: true; enabled: boolean }>(`/automations/${id}`, { method: 'PUT', body: { enabled } }),

  runAutomation: (id: string) =>
    request<{ status: string; summary: string | null; error: string | null; createdAt: number }>(`/automations/${id}/run`, {
      method: 'POST',
    }),

  getAutomationRuns: (automationId?: string, limit = 20) =>
    request<{ runs: AutomationRunInfo[] }>(
      `/automations/runs?limit=${limit}${automationId ? `&automationId=${encodeURIComponent(automationId)}` : ''}`,
    ),

  getNotifications: (limit = 30) => request<{ unread: number; items: NotificationItem[] }>(`/automations/notifications?limit=${limit}`),

  markNotificationsRead: () => request<{ updated: number }>('/automations/notifications/read', { method: 'POST' }),

  /** 流式执行 Agent:SSE 逐工具步骤回调 onEvent,返回最终完整结果 */
  agentRunStream: async (message: string, onEvent: AgentStepListener): Promise<AgentRunResult> => {
    const token = getToken()
    let res: Response
    try {
      res = await fetch('/api/agent/run/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message }),
      })
    } catch {
      throw new ApiError(0, '无法连接服务器,请检查后端是否运行')
    }

    // 流开始前的错误(未配置模型 503、运行中 409、限流 429 等)仍是普通 JSON 响应
    if (!res.ok) {
      const data: unknown = await res.json().catch(() => null)
      if (res.status === 401 && token) {
        clearToken()
        throw new UnauthorizedError()
      }
      const msg =
        typeof data === 'object' && data !== null && 'error' in data
          ? String((data as { error: unknown }).error)
          : `请求失败(${res.status})`
      throw new ApiError(res.status, msg)
    }
    if (!res.body) throw new ApiError(0, '服务器不支持流式响应')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let final: AgentRunResult | null = null
    const handleFrame = (frame: string) => {
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue
        try {
          const event = JSON.parse(line.slice(5).trim()) as AgentStepEvent
          if (event.type === 'final' && event.sessionId) {
            final = {
              sessionId: event.sessionId,
              status: event.status ?? 'FAILED',
              finalAnswer: event.finalAnswer ?? '',
              currentStep: event.currentStep ?? 0,
              actions: event.actions ?? [],
            }
          }
          onEvent(event)
        } catch {
          /* 忽略无法解析的帧 */
        }
      }
    }
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let sep = buffer.indexOf('\n\n')
      while (sep !== -1) {
        handleFrame(buffer.slice(0, sep))
        buffer = buffer.slice(sep + 2)
        sep = buffer.indexOf('\n\n')
      }
    }
    if (!final) throw new ApiError(0, '连接中断,未收到完整结果')
    return final
  },

  getAgentModels: () => request<AgentModelsInfo>('/agent/models'),

  saveAgentModel: (body: { provider: string; model: string; apiKey?: string }) =>
    request<AgentModelsInfo>('/agent/models', { method: 'PUT', body }),

  deleteAgentModel: (provider: string) =>
    request<AgentModelsInfo>(`/agent/models/${provider}`, { method: 'DELETE' }),

  /* ---------- GitHub 集成 ---------- */

  getGithubConfig: () => request<GithubConfigInfo>('/github/config'),

  saveGithubToken: (token: string) =>
    request<GithubConfigInfo>('/github/config', { method: 'PUT', body: { token } }),

  deleteGithubToken: () => request<{ ok: true }>('/github/config', { method: 'DELETE' }),

  listGithubLinks: () => request<{ links: GithubLink[] }>('/github/links'),

  linkGithub: (body: { taskId: string; owner: string; repo: string; type: 'issue' | 'pr'; number: number }) =>
    request<{ link: GithubLink; taskMovedToDone: boolean }>('/github/links', { method: 'POST', body }),

  unlinkGithub: (id: string) => request<{ ok: true }>(`/github/links/${id}`, { method: 'DELETE' }),

  getGithubRepoInfo: (owner: string, repo: string) =>
    request<GithubRepoInfo>(`/github/repos/${owner}/${repo}/info`),

  getGithubIssues: (owner: string, repo: string, state: 'open' | 'closed' | 'all', page: number) =>
    request<{ issues: GithubIssueItem[]; page: number; hasMore: boolean }>(
      `/github/repos/${owner}/${repo}/issues?state=${state}&page=${page}`,
    ),

  getGithubPulls: (owner: string, repo: string, state: 'open' | 'closed' | 'all', page: number) =>
    request<{ pulls: GithubPullItem[]; page: number; hasMore: boolean }>(
      `/github/repos/${owner}/${repo}/pulls?state=${state}&page=${page}`,
    ),

  getGithubCommits: (owner: string, repo: string, branch: string | null, page: number) =>
    request<{ commits: GithubCommitItem[]; page: number; hasMore: boolean }>(
      `/github/repos/${owner}/${repo}/commits?page=${page}${branch ? `&branch=${encodeURIComponent(branch)}` : ''}`,
    ),

  getGithubBranches: (owner: string, repo: string) =>
    request<{ branches: GithubBranchItem[] }>(`/github/repos/${owner}/${repo}/branches`),

  importGithubIssue: (body: { owner: string; repo: string; number: number; projectId?: string | null }) =>
    request<{ task: { id: string; title: string }; link: GithubLink }>('/github/import-issue', {
      method: 'POST',
      body,
    }),
}

function toServerProject(input: ProjectInput) {
  return {
    name: input.name,
    description: input.description,
    status: input.status,
    repo_url: input.repoUrl || null,
    tech_stack: input.techStack,
    start_date: input.startDate,
    due_date: input.dueDate,
  }
}
