import type { Redis } from 'ioredis'

/**
 * 限速器:Redis 计数(多进程共享,INCR 固定窗口)+ 内存降级。
 * Redis 不可用或命令失败时自动落回进程内计数(单进程语义不变,限速不因缓存故障而放行所有请求之外的额外伤害)。
 */
export interface RateLimiter {
  tryTake(key: string): Promise<boolean>
}

/** 进程内固定窗口计数(原实现;同时充当降级后备) */
export class MemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, { start: number; count: number }>()
  private sweep: NodeJS.Timeout

  constructor(private readonly windowMs: number, private readonly max: number) {
    this.sweep = setInterval(() => {
      const now = Date.now()
      for (const [key, entry] of this.hits) {
        if (now - entry.start > windowMs) this.hits.delete(key)
      }
    }, windowMs)
    this.sweep.unref()
  }

  tryTake(key: string): Promise<boolean> {
    const now = Date.now()
    const entry = this.hits.get(key)
    if (!entry || now - entry.start > this.windowMs) {
      this.hits.set(key, { start: now, count: 1 })
      return Promise.resolve(true)
    }
    entry.count += 1
    return Promise.resolve(entry.count <= this.max)
  }
}

/** Redis 固定窗口计数:INCR + 首次 EXPIRE;key 需自带 limiter 前缀 */
export class RedisRateLimiter implements RateLimiter {
  private fallback: MemoryRateLimiter

  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
    private readonly windowMs: number,
    private readonly max: number,
  ) {
    this.fallback = new MemoryRateLimiter(windowMs, max)
  }

  async tryTake(key: string): Promise<boolean> {
    // 仅在连接就绪时走 Redis;其余情况直接降级,避免离线排队/重连等待拖慢请求路径
    if (this.redis.status !== 'ready') return this.fallback.tryTake(key)
    const rkey = `ratelimit:${this.prefix}:${key}`
    try {
      const count = await this.redis.incr(rkey)
      if (count === 1) await this.redis.pexpire(rkey, this.windowMs)
      return count <= this.max
    } catch {
      return this.fallback.tryTake(key)
    }
  }
}

/** 工厂:Redis 就绪时用共享计数,否则纯内存(与旧版行为一致) */
export function createRateLimiter({
  windowMs,
  max,
  prefix,
  redis,
}: {
  windowMs: number
  max: number
  prefix: string
  redis: Redis
}): RateLimiter {
  return new RedisRateLimiter(redis, prefix, windowMs, max)
}
