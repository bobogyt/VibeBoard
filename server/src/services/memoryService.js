import { randomUUID } from 'node:crypto'
import { pool } from '../db.js'

const MAX_MEMORIES = 50
const CONTENT_MAX = 300

function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}

/** 长期偏好记忆列表(新→旧),最多返回 MAX_MEMORIES 条 */
export async function listMemories(userId) {
  const [rows] = await pool.execute(
    'SELECT id, content, updated_at FROM user_memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50',
    [userId],
  )
  return rows.map((row) => ({ id: row.id, content: row.content, updatedAt: Number(row.updated_at) }))
}

/** 新增记忆:同内容幂等;超过上限淘汰最旧一条 */
export async function addMemory(userId, content) {
  const trimmed = typeof content === 'string' ? content.trim() : ''
  if (!trimmed) throw httpError(400, '记忆内容必填')
  if (trimmed.length > CONTENT_MAX) throw httpError(400, `记忆内容不能超过 ${CONTENT_MAX} 字`)

  const [existing] = await pool.execute('SELECT id, content, updated_at FROM user_memories WHERE user_id = ? AND content = ?', [
    userId,
    trimmed,
  ])
  if (existing.length > 0) {
    return { id: existing[0].id, content: existing[0].content, updatedAt: Number(existing[0].updated_at) }
  }

  const now = Date.now()
  const id = randomUUID()
  await pool.execute('INSERT INTO user_memories (id, user_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
    id,
    userId,
    trimmed,
    now,
    now,
  ])
  await evictOldestIfNeeded(userId)
  return { id, content: trimmed, updatedAt: now }
}

/** 删除记忆:不存在或非本人返回 404 */
export async function deleteMemory(userId, id) {
  const [result] = await pool.execute('DELETE FROM user_memories WHERE user_id = ? AND id = ?', [userId, id])
  if (result.affectedRows === 0) throw httpError(404, '记忆不存在')
  return { ok: true }
}

async function evictOldestIfNeeded(userId) {
  const [rows] = await pool.execute(
    'SELECT id FROM user_memories WHERE user_id = ? ORDER BY updated_at ASC LIMIT ?',
    [userId, 1],
  )
  const [countRows] = await pool.execute('SELECT COUNT(*) AS c FROM user_memories WHERE user_id = ?', [userId])
  if (countRows[0].c > MAX_MEMORIES && rows.length > 0) {
    await pool.execute('DELETE FROM user_memories WHERE id = ?', [rows[0].id])
  }
}
