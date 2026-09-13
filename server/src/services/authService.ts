import { randomBytes, scryptSync, timingSafeEqual, randomUUID, scrypt } from 'node:crypto'
import { promisify } from 'node:util'
import { pool } from '../db'
import { setSession, getSession, delSession } from '../cache'
import { httpError } from '../http/http-error'

const USERNAME_RE = /^[\w.-]{3,32}$/

const scryptAsync = promisify(scrypt)

/**
 * 异步 scrypt:公网环境下登录/注册的哈希运算绝不能同步阻塞事件循环
 * (同步版会被并发登录串行化整个服务,构成 DoS 面)。格式与历史数据完全兼容。
 */

// 用户不存在时也执行一次等价 scrypt 运算,抹平与「密码错误」路径的响应时间差,防止按时序枚举用户名
let dummyHashPromise: Promise<string> | null = null
function getDummyHash(): Promise<string> {
  return (dummyHashPromise ??= hashPassword('vibeboard-timing-equalizer'))
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hash = ((await scryptAsync(password, salt, 64)) as Buffer).toString('hex')
  return `${salt}:${hash}`
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = (await scryptAsync(password, salt, 64)) as Buffer
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

function validateCredentials(username: unknown, password: unknown): string | null {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return '用户名需为 3-32 位字母、数字、_ . -'
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return '密码长度需在 8-128 位之间'
  }
  return null
}

async function createUser(username: string, password: string): Promise<string> {
  const id = randomUUID()
  await pool.execute('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)', [
    id,
    username,
    await hashPassword(password),
    Date.now(),
  ])
  return id
}

interface UserRow {
  id: string
  username: string
  password_hash: string
}

async function findUserByUsername(username: string): Promise<UserRow | null> {
  const [rows] = await pool.execute('SELECT id, username, password_hash FROM users WHERE username = ?', [username])
  return (rows as unknown as UserRow[])[0] ?? null
}

async function issueSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  await setSession(token, userId)
  return token
}

export interface AuthResult {
  token: string
  username: string
}

/** 注册成功即登录。用户名重复返回 409 */
export async function register(username: unknown, password: unknown): Promise<AuthResult> {
  const invalid = validateCredentials(username, password)
  if (invalid) throw httpError(400, invalid)

  try {
    const id = await createUser(username as string, password as string)
    const token = await issueSession(id)
    return { token, username: username as string }
  } catch (err) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      throw httpError(409, '用户名已存在')
    }
    throw err
  }
}

export async function login(username: unknown, password: unknown): Promise<AuthResult> {
  if (typeof username !== 'string' || typeof password !== 'string') {
    throw httpError(400, '请输入用户名和密码')
  }
  const user = await findUserByUsername(username)
  if (!user) {
    verifyPassword(password, await getDummyHash())
    throw httpError(401, '用户名或密码错误')
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    throw httpError(401, '用户名或密码错误')
  }
  const token = await issueSession(user.id)
  return { token, username: user.username }
}

export async function logout(token: string | undefined): Promise<{ ok: boolean }> {
  if (token) await delSession(token)
  return { ok: true }
}

/** 恢复登录态:token 有效时返回用户名 */
export async function me(userId: string, token: string): Promise<AuthResult> {
  const [rows] = await pool.execute('SELECT username FROM users WHERE id = ?', [userId])
  const user = (rows as unknown as Array<{ username: string }>)[0]
  if (!user) throw httpError(401, '登录已过期')
  return { token, username: user.username }
}

/** 校验 Bearer token,通过后返回 userId(供 AuthGuard 调用) */
export async function requireAuthToken(authorization: string | undefined): Promise<{ token: string; userId: string }> {
  const token = authorization?.replace(/^Bearer\s+/i, '')
  if (!token) throw httpError(401, '未登录')
  const userId = await getSession(token)
  if (!userId) throw httpError(401, '登录已过期')
  return { token, userId }
}
