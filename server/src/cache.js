import Redis from 'ioredis'

const {
  REDIS_HOST = '127.0.0.1',
  REDIS_PORT = '6379',
  REDIS_USERNAME,
  REDIS_PASSWORD,
  SESSION_TTL_SECONDS = '604800',
  BOARD_CACHE_TTL_SECONDS = '3600',
} = process.env

const SESSION_TTL = Number(SESSION_TTL_SECONDS)
const BOARD_TTL = Number(BOARD_CACHE_TTL_SECONDS)

export const redis = new Redis({
  host: REDIS_HOST,
  port: Number(REDIS_PORT),
  username: REDIS_USERNAME || undefined,
  password: REDIS_PASSWORD || undefined,
  // 离线时快速失败而不是排队等重连,由调用方降级直读 MySQL
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => Math.min(times * 1000, 5000),
})

redis.on('error', (err) => {
  console.warn('[redis] unreachable:', err.code || err.message)
})

const sessionKey = (token) => `session:${token}`
const boardKey = (userId) => `board:${userId}`

/* ---------- 会话 ---------- */

export async function setSession(token, userId) {
  await redis.set(sessionKey(token), userId, 'EX', SESSION_TTL)
}

/** 返回 userId;token 无效/Redis 不可用时返回 null(会话校验安全优先,不降级) */
export async function getSession(token) {
  try {
    const userId = await redis.get(sessionKey(token))
    if (!userId) return null
    // 滑动续期
    await redis.expire(sessionKey(token), SESSION_TTL)
    return userId
  } catch {
    return null
  }
}

export async function delSession(token) {
  await redis.del(sessionKey(token)).catch(() => {})
}

/* ---------- 看板缓存(cache-aside + 写穿透) ---------- */

export async function getBoardCache(userId) {
  try {
    const raw = await redis.get(boardKey(userId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null // 缓存不可用 → 调用方直读 MySQL
  }
}

export async function setBoardCache(userId, state) {
  try {
    await redis.set(boardKey(userId), JSON.stringify(state), 'EX', BOARD_TTL)
    return true
  } catch {
    return false
  }
}

export function redisStatus() {
  return redis.status
}
