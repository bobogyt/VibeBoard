/**
 * 人工确认(Human Approval):HIGH_RISK 工具执行前挂起 runAgent,
 * 等待 HTTP 审批或超时自动拒绝。
 * 多进程安全:等待状态以 Redis 标记(agent:approval:{sessionId})对外可见,
 * 审批请求落在其他 worker 时经 pub/sub 频道(agent:approval)投递回持有会话的 worker。
 * Redis 不可用时退化为纯进程内(单进程部署语义不变)。
 */
import type { Redis } from 'ioredis'
import { redis, getApprovalSubscriber } from '../cache'

interface Waiter {
  requestId: string
  resolve: (decision: { approved: boolean; reason: string }) => void
  timer: NodeJS.Timeout
}

export const APPROVAL_CHANNEL = 'agent:approval'

/** 审批路由:本地 waiter 优先,跨 worker 经 Redis 标记 + pub/sub 投递;client 可注入便于测试 */
export class ApprovalRouter {
  private readonly waiters = new Map<string, Waiter>()
  private subscribed = false

  constructor(
    private readonly client: Redis,
    private readonly getSubscriber: () => Redis | null,
  ) {}

  /** 常驻订阅审批频道:收到即尝试 resolve 本地 waiter(非持有者收到后自然忽略) */
  private ensureSubscription(): void {
    if (this.subscribed) return
    const sub = this.getSubscriber()
    if (!sub) return
    this.subscribed = true
    const subscribe = () => {
      sub.subscribe(APPROVAL_CHANNEL).catch((err: { message?: string }) => {
        console.warn('[redis] approval subscribe failed:', err.message)
      })
    }
    if (sub.status === 'ready') subscribe()
    sub.on('ready', subscribe)
    sub.on('message', (_channel: string, raw: string) => {
      try {
        const { sessionId, requestId, approved } = JSON.parse(raw) as {
          sessionId: string
          requestId: string
          approved: boolean
        }
        this.resolveLocal(sessionId, requestId, approved)
      } catch {
        /* 忽略无法解析的消息 */
      }
    })
  }

  /** 仅尝试本地 waiter;命中则清理标记并 resolve */
  private resolveLocal(sessionId: string, requestId: string, approved: boolean): boolean {
    const waiter = this.waiters.get(sessionId)
    if (!waiter || waiter.requestId !== requestId) return false
    clearTimeout(waiter.timer)
    this.waiters.delete(sessionId)
    this.client.del(markKeyOf(sessionId)).catch(() => {})
    waiter.resolve({ approved, reason: approved ? 'approved' : 'rejected' })
    return true
  }

  /** 挂起等待审批;超时自动按拒绝返回,Promise 永不 reject */
  requestApproval(sessionId: string, requestId: string, timeoutMs: number): Promise<{ approved: boolean; reason: string }> {
    this.ensureSubscription()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const waiter = this.waiters.get(sessionId)
        if (waiter && waiter.requestId === requestId) {
          this.waiters.delete(sessionId)
          this.client.del(markKeyOf(sessionId)).catch(() => {})
          resolve({ approved: false, reason: 'timeout' })
        }
      }, timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
      this.waiters.set(sessionId, { requestId, resolve, timer })
      // 跨进程可见的等待标记:TTL 与超时一致,进程崩溃后自动消失
      if (this.client.status === 'ready') {
        this.client.set(markKeyOf(sessionId), requestId, 'PX', timeoutMs, 'NX').catch(() => {})
      }
    })
  }

  /** 审批落点(HTTP 路由调用);返回 false 表示该请求不在等待中(已处理/已超时/非本人)。
   * 本地命中直接 resolve;否则检查 Redis 等待标记并 pub/sub 投递给持有 worker。 */
  async resolveApproval(sessionId: string, requestId: string, approved: boolean): Promise<boolean> {
    if (this.resolveLocal(sessionId, requestId, approved)) return true
    if (this.client.status !== 'ready') return false
    try {
      const mark = await this.client.get(markKeyOf(sessionId))
      if (mark !== requestId) return false
      await this.client.publish(APPROVAL_CHANNEL, JSON.stringify({ sessionId, requestId, approved }))
      return true
    } catch {
      return false
    }
  }
}

const markKeyOf = (sessionId: string) => `agent:approval:${sessionId}`

export const approvalRouter = new ApprovalRouter(redis, getApprovalSubscriber)

export function requestApproval(sessionId: string, requestId: string, timeoutMs: number): Promise<{ approved: boolean; reason: string }> {
  return approvalRouter.requestApproval(sessionId, requestId, timeoutMs)
}

export async function resolveApproval(sessionId: string, requestId: string, approved: boolean): Promise<boolean> {
  return approvalRouter.resolveApproval(sessionId, requestId, approved)
}
