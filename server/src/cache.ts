import Redis from 'ioredis'
import type { BoardState } from './types'

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

redis.on('error', (err: { code?: string; message?: string }) => {
  console.warn('[redis] unreachable:', err.code || err.message)
})

const sessionKey = (token: string) => `session:${token}`
const boardKey = (userId: string) => `board:${userId}`

/* ---------- 会话 ---------- */

export async function setSession(token: string, userId: string): Promise<void> {
  await redis.set(sessionKey(token), userId, 'EX', SESSION_TTL)
}

/** 返回 userId;token 无效/Redis 不可用时返回 null(会话校验安全优先,不降级) */
export async function getSession(token: string): Promise<string | null> {
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

export async function delSession(token: string): Promise<void> {
  await redis.del(sessionKey(token)).catch(() => {})
}

/* ---------- 看板缓存(cache-aside + 写穿透) ---------- */

export async function getBoardCache(userId: string): Promise<BoardState | null> {
  try {
    const raw = await redis.get(boardKey(userId))
    return raw ? (JSON.parse(raw) as BoardState) : null
  } catch {
    return null // 缓存不可用 → 调用方直读 MySQL
  }
}

export async function setBoardCache(userId: string, state: BoardState): Promise<boolean> {
  try {
    await redis.set(boardKey(userId), JSON.stringify(state), 'EX', BOARD_TTL)
    return true
  } catch {
    return false
  }
}

export function redisStatus(): string {
  return redis.status
}

/* ---------- 审批跨进程投递(pub/sub 专用订阅连接) ---------- */
// ioredis 进入订阅模式后不能再执行普通命令,必须用独立连接
let approvalSubscriber: Redis | null = null

/** 返回审批频道的订阅连接(Redis 未就绪时返回 null,调用方退回纯进程内) */
export function getApprovalSubscriber(): Redis | null {
  if (redis.status !== 'ready') return null
  if (!approvalSubscriber) {
    approvalSubscriber = redis.duplicate()
    approvalSubscriber.on('error', (err: { code?: string; message?: string }) => {
      console.warn('[redis] approval subscriber error:', err.code || err.message)
    })
  }
  return approvalSubscriber
}
