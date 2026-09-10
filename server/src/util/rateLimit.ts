/** 极简内存限速器:单进程够用;多实例部署需换 Redis 计数 */
export interface RateLimiter {
  tryTake(key: string): boolean
}

export function createRateLimiter({ windowMs, max }: { windowMs: number; max: number }): RateLimiter {
  const hits = new Map<string, { start: number; count: number }>()
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of hits) {
      if (now - entry.start > windowMs) hits.delete(key)
    }
  }, windowMs)
  sweep.unref()

  return {
    tryTake(key: string): boolean {
      const now = Date.now()
      const entry = hits.get(key)
      if (!entry || now - entry.start > windowMs) {
        hits.set(key, { start: now, count: 1 })
        return true
      }
      entry.count += 1
      return entry.count <= max
    },
  }
}
