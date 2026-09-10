/** 极简内存限速器:单进程够用;多实例部署需换 Redis 计数 */
export function createRateLimiter({ windowMs, max, keyOf }) {
  const hits = new Map()
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of hits) {
      if (now - entry.start > windowMs) hits.delete(key)
    }
  }, windowMs)
  sweep.unref()

  return (req, res, next) => {
    const key = keyOf(req)
    const now = Date.now()
    const entry = hits.get(key)
    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 })
      return next()
    }
    entry.count += 1
    if (entry.count > max) {
      return res.status(429).json({ error: '尝试过于频繁,请稍后再试' })
    }
    next()
  }
}
