import { randomUUID } from 'node:crypto'
import { redis } from '../cache'
import { agentConfig } from './config'

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

/* ---------- 单用户单运行会话锁(多进程安全) ---------- */
// Redis NX 原子占位:RUNNING 与 WAITING_APPROVAL 阶段都持锁;TTL 兜底进程崩溃后的悬挂锁
import type { Redis } from 'ioredis'

const runningKeyOf = (userId: string) => `agent:running:${userId}`
const RUN_TTL_MS =
  agentConfig.maxSteps * agentConfig.timeoutMs + agentConfig.approvalTimeoutMs + 60_000

/** 运行席位存储:Redis 就绪走跨进程互斥(NX),否则退回进程内 Set;client 可注入便于测试 */
export class RunSlotStore {
  private readonly memory = new Set<string>()

  constructor(
    private readonly client: Redis,
    private readonly ttlMs: number,
  ) {}

  /** 获取运行席位;已被占用(Running 中/等待审批中)返回 false */
  async acquire(userId: string): Promise<boolean> {
    if (this.client.status === 'ready') {
      try {
        const ok = await this.client.set(runningKeyOf(userId), '1', 'PX', this.ttlMs, 'NX')
        return ok === 'OK'
      } catch {
        // 落入进程内降级
      }
    }
    if (this.memory.has(userId)) return false
    this.memory.add(userId)
    return true
  }

  /** 释放运行席位(run 结束的 finally 必调) */
  async release(userId: string): Promise<void> {
    this.memory.delete(userId)
    if (this.client.status !== 'ready') return
    await this.client.del(runningKeyOf(userId)).catch(() => {})
  }
}

export const runSlotStore = new RunSlotStore(redis, RUN_TTL_MS)

export function acquireRunSlot(userId: string): Promise<boolean> {
  return runSlotStore.acquire(userId)
}

export function releaseRunSlot(userId: string): Promise<void> {
  return runSlotStore.release(userId)
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
