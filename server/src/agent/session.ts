import { randomUUID } from 'node:crypto'

export const AgentStatus = {
  RUNNING: 'RUNNING',
  WAITING_APPROVAL: 'WAITING_APPROVAL',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  MAX_STEPS_REACHED: 'MAX_STEPS_REACHED',
} as const

export type AgentStatusValue = (typeof AgentStatus)[keyof typeof AgentStatus]

/** 可视化/审批事件(label 级,不含推理内容与原始参数) */
export interface AgentEvent {
  type: 'started' | 'tool' | 'approval' | 'final'
  [key: string]: unknown
}

export interface PendingApproval {
  requestId: string
  tool: string
  label: string
  tasks: unknown
}

export interface AgentSession {
  sessionId: string
  userId: string
  userMessage: string
  messages: Array<Record<string, unknown>>
  model?: string
  currentStep: number
  toolCalls: Array<{ step: number; name: string; args: unknown }>
  toolResults: Array<{ step: number; name: string; ok: boolean; result?: unknown; error?: unknown }>
  steps: Array<Record<string, unknown>>
  finalAnswer: string | null
  status: AgentStatusValue
  pendingApproval: PendingApproval | null
  error: string | null
  createdAt: number
  updatedAt: number
  emit?: (event: AgentEvent) => void
}

const sessions = new Map<string, AgentSession>()
const MAX_RETAINED = 50

export function createSession(userId: string, userMessage: string): AgentSession {
  const now = Date.now()
  const session: AgentSession = {
    sessionId: randomUUID(),
    userId,
    userMessage,
    messages: [],
    currentStep: 0,
    toolCalls: [],
    toolResults: [],
    steps: [],
    finalAnswer: null,
    status: AgentStatus.RUNNING,
    pendingApproval: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  }
  sessions.set(session.sessionId, session)
  evictIfNeeded()
  return session
}

export function getSession(sessionId: string): AgentSession | null {
  return sessions.get(sessionId) ?? null
}

export function hasRunningSession(userId: string): boolean {
  for (const s of sessions.values()) {
    if (s.userId !== userId) continue
    if (s.status === AgentStatus.RUNNING || s.status === AgentStatus.WAITING_APPROVAL) return true
  }
  return false
}

export function touch(session: AgentSession): void {
  session.updatedAt = Date.now()
}

/** 只保留最近 MAX_RETAINED 个会话,优先淘汰已结束的旧会话 */
function evictIfNeeded(): void {
  if (sessions.size <= MAX_RETAINED) return
  const ordered = [...sessions.values()].sort((a, b) => a.updatedAt - b.updatedAt)
  const finished = ordered.find((s) => s.status !== AgentStatus.RUNNING) ?? ordered[0]
  if (finished) sessions.delete(finished.sessionId)
}
