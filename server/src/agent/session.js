import { randomUUID } from 'node:crypto'

export const AgentStatus = {
  RUNNING: 'RUNNING',
  WAITING_APPROVAL: 'WAITING_APPROVAL',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  MAX_STEPS_REACHED: 'MAX_STEPS_REACHED',
}

const sessions = new Map()
const MAX_RETAINED = 50

export function createSession(userId, userMessage) {
  const now = Date.now()
  const session = {
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

export function getSession(sessionId) {
  return sessions.get(sessionId) ?? null
}

export function hasRunningSession(userId) {
  for (const s of sessions.values()) {
    if (s.userId !== userId) continue
    if (s.status === AgentStatus.RUNNING || s.status === AgentStatus.WAITING_APPROVAL) return true
  }
  return false
}

export function touch(session) {
  session.updatedAt = Date.now()
}

/** 只保留最近 MAX_RETAINED 个会话,优先淘汰已结束的旧会话 */
function evictIfNeeded() {
  if (sessions.size <= MAX_RETAINED) return
  const ordered = [...sessions.values()].sort((a, b) => a.updatedAt - b.updatedAt)
  const finished = ordered.find((s) => s.status !== AgentStatus.RUNNING) ?? ordered[0]
  if (finished) sessions.delete(finished.sessionId)
}
