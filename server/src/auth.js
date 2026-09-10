import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { pool } from './db.js'
import { setSession, getSession, delSession } from './cache.js'
import { createRateLimiter } from './util/rateLimit.js'

const USERNAME_RE = /^[\w.-]{3,32}$/

// 用户不存在时也执行一次等价 scrypt 运算,抹平与「密码错误」路径的响应时间差,防止按时序枚举用户名
const DUMMY_HASH = hashPassword('vibeboard-timing-equalizer')

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

function validateCredentials(username, password) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return '用户名需为 3-32 位字母、数字、_ . -'
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return '密码长度需在 8-128 位之间'
  }
  return null
}

async function createUser(username, password) {
  const id = randomUUID()
  await pool.execute('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)', [
    id,
    username,
    hashPassword(password),
    Date.now(),
  ])
  return id
}

async function findUserByUsername(username) {
  const [rows] = await pool.execute('SELECT id, username, password_hash FROM users WHERE username = ?', [username])
  return rows[0] ?? null
}

async function issueSession(res, userId) {
  const token = randomBytes(32).toString('hex')
  await setSession(token, userId)
  res.locals.token = token
}

/** 注册成功即登录。用户名重复返回 409 */
export async function register(req, res) {
  const { username, password } = req.body ?? {}
  const invalid = validateCredentials(username, password)
  if (invalid) return res.status(400).json({ error: invalid })

  try {
    const id = await createUser(username, password)
    await issueSession(res, id)
    res.json({ token: res.locals.token, username })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: '用户名已存在' })
    }
    throw err
  }
}

export async function login(req, res) {
  const { username, password } = req.body ?? {}
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: '请输入用户名和密码' })
  }
  const user = await findUserByUsername(username)
  if (!user) {
    verifyPassword(password, DUMMY_HASH)
    return res.status(401).json({ error: '用户名或密码错误' })
  }
  if (!verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' })
  }
  await issueSession(res, user.id)
  res.json({ token: res.locals.token, username: user.username })
}

export async function logout(req, res) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (token) await delSession(token)
  res.json({ ok: true })
}

/** 恢复登录态:token 有效时返回用户名 */
export async function me(req, res) {
  const [rows] = await pool.execute('SELECT username FROM users WHERE id = ?', [req.userId])
  const user = rows[0]
  if (!user) return res.status(401).json({ error: '登录已过期' })
  res.json({ token: req.token, username: user.username })
}

/** Express 中间件:校验 Bearer token,通过后挂 req.userId */
export async function requireAuth(req, res, next) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: '未登录' })
  const userId = await getSession(token)
  if (!userId) return res.status(401).json({ error: '登录已过期' })
  req.userId = userId
  req.token = token
  next()
}

/* ---------- 认证接口限速(防暴力破解) ---------- */

// 登录:同 IP+用户名 10 分钟 8 次,同 IP 10 分钟 40 次(防换用户名绕过);注册:同 IP 每小时 10 次
const LOGIN_WINDOW_MS = 10 * 60_000
export const loginKeyLimiter = createRateLimiter({
  windowMs: LOGIN_WINDOW_MS,
  max: 8,
  keyOf: (req) => `${req.ip}|${String(req.body?.username ?? '').toLowerCase()}`,
})
export const loginIpLimiter = createRateLimiter({
  windowMs: LOGIN_WINDOW_MS,
  max: 40,
  keyOf: (req) => String(req.ip),
})
export const registerLimiter = createRateLimiter({
  windowMs: 60 * 60_000,
  max: 10,
  keyOf: (req) => String(req.ip),
})
