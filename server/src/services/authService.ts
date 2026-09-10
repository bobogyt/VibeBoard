import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto'
import { pool } from '../db'
import { setSession, getSession, delSession } from '../cache'
import { httpError } from '../http/http-error'

const USERNAME_RE = /^[\w.-]{3,32}$/

// 用户不存在时也执行一次等价 scrypt 运算,抹平与「密码错误」路径的响应时间差,防止按时序枚举用户名
const DUMMY_HASH = hashPassword('vibeboard-timing-equalizer')

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
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
    hashPassword(password),
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
    verifyPassword(password, DUMMY_HASH)
    throw httpError(401, '用户名或密码错误')
  }
  if (!verifyPassword(password, user.password_hash)) {
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
