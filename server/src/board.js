import { pool } from './db.js'
import { getBoardCache, setBoardCache } from './cache.js'

const COLUMN_IDS = ['todo', 'doing', 'done']
const PRIORITIES = ['P0', 'P1', 'P2', 'P3']

/** 与前端 types.ts 对应的结构校验;非法返回 null */
function parseBoardState(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  const columns = input.columns ?? input
  const state = { todo: [], doing: [], done: [] }
  for (const col of COLUMN_IDS) {
    const list = columns[col]
    if (!Array.isArray(list)) return null
    const normalized = []
    for (const t of list) {
      if (
        typeof t !== 'object' ||
        t === null ||
        typeof t.id !== 'string' ||
        t.id.length === 0 ||
        typeof t.title !== 'string' ||
        t.title.length === 0 ||
        t.title.length > 200 ||
        typeof t.description !== 'string' ||
        t.description.length > 5000 ||
        (t.projectId !== null && t.projectId !== undefined && typeof t.projectId !== 'string') ||
        typeof t.createdAt !== 'number' ||
        typeof t.updatedAt !== 'number'
      ) {
        return null
      }
      const priority = t.priority ?? null
      if (priority !== null && !PRIORITIES.includes(priority)) return null
      const dueDate = t.dueDate ?? null
      if (dueDate !== null && (typeof dueDate !== 'number' || !Number.isFinite(dueDate))) return null
      const dependsOn = Array.isArray(t.dependsOn)
        ? [...new Set(t.dependsOn.filter((id) => typeof id === 'string' && id.length > 0 && id !== t.id))]
        : []
      normalized.push({ ...t, priority, dueDate, dependsOn })
    }
    state[col] = normalized
  }
  return state
}

function rowToTask(row) {
  let dependsOn = []
  try {
    const parsed = row.depends_on ? JSON.parse(row.depends_on) : []
    if (Array.isArray(parsed)) dependsOn = parsed.filter((id) => typeof id === 'string')
  } catch {
    dependsOn = []
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    status: row.status,
    projectId: row.project_id ?? null,
    priority: row.priority ?? null,
    dueDate: row.due_date === null || row.due_date === undefined ? null : Number(row.due_date),
    dependsOn,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export { rowToTask }

/** 读:缓存命中直接返回;未命中查 MySQL 并回填。cacheHit 供日志观察 */
export async function getBoard(userId) {
  if (userId === undefined) {
    console.error('[board] getBoard called with undefined userId, stack:')
    console.error(new Error('trace').stack)
  }
  const cached = await getBoardCache(userId)
  if (cached) {
    return { state: cached, cacheHit: true }
  }

  const [rows] = await pool.execute(
    'SELECT id, title, description, status, position, project_id, priority, due_date, depends_on, created_at, updated_at FROM tasks WHERE board_id = ? AND archived = 0 ORDER BY position',
    [userId],
  )
  const state = { todo: [], doing: [], done: [] }
  for (const row of rows) {
    if (state[row.status]) state[row.status].push(rowToTask(row))
  }
  const ok = await setBoardCache(userId, state)
  console.log(`[board] cache MISS user=${userId} redisWrite=${ok}`)
  return { state, cacheHit: false }
}

/** 依赖完整性兜底:剔除指向不存在任务的前置引用,并拒绝循环依赖(客户端全量保存路径的唯一校验点) */
function sanitizeDependencies(state) {
  const byId = new Map()
  for (const col of COLUMN_IDS) for (const t of state[col]) byId.set(t.id, t)
  for (const col of COLUMN_IDS) {
    for (const t of state[col]) {
      if (t.dependsOn?.length) t.dependsOn = t.dependsOn.filter((id) => byId.has(id))
    }
  }
  const visiting = new Set()
  const done = new Set()
  const visit = (id) => {
    if (done.has(id)) return
    if (visiting.has(id)) throw Object.assign(new Error('存在循环依赖'), { status: 400 })
    visiting.add(id)
    for (const next of byId.get(id)?.dependsOn ?? []) visit(next)
    done.add(id)
  }
  for (const t of byId.values()) visit(t.id)
}

/** 写:事务内整表替换该用户任务,成功后写穿透更新缓存 */
export async function saveBoard(userId, input) {
  const state = parseBoardState(input)
  if (!state) throw Object.assign(new Error('看板数据格式非法'), { status: 400 })
  sanitizeDependencies(state)

  // 过滤指向已删除项目的引用(防止陈旧保存复活悬空 project_id)
  const referenced = new Set(
    COLUMN_IDS.flatMap((col) => state[col]).map((t) => t.projectId).filter(Boolean),
  )
  const validProjectIds = new Set()
  if (referenced.size > 0) {
    const [rows] = await pool.query(
      `SELECT id FROM projects WHERE owner_id = ? AND id IN (${[...referenced].map(() => '?').join(',')})`,
      [userId, ...referenced],
    )
    for (const row of rows) validProjectIds.add(row.id)
  }

  const conn = await pool.getConnection()
  // 过滤后的状态:缓存必须写它,否则悬空 project_id 会经缓存复活
  const sanitized = { todo: [], doing: [], done: [] }
  try {
    await conn.beginTransaction()
    // 只替换未归档任务:归档行不参与整表替换,任何保存都不得清掉归档数据
    await conn.execute('DELETE FROM tasks WHERE board_id = ? AND archived = 0', [userId])
    const values = []
    const params = []
    for (const col of COLUMN_IDS) {
      state[col].forEach((task, index) => {
        const projectId = task.projectId && validProjectIds.has(task.projectId) ? task.projectId : null
        sanitized[col].push({ ...task, projectId })
        values.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        params.push(
          task.id,
          userId,
          task.title,
          task.description,
          col,
          index,
          projectId,
          task.priority,
          task.dueDate,
          JSON.stringify(task.dependsOn ?? []),
          task.createdAt,
          task.updatedAt,
        )
      })
    }
    if (values.length > 0) {
      await conn.execute(
        `INSERT INTO tasks (id, board_id, title, description, status, position, project_id, priority, due_date, depends_on, created_at, updated_at) VALUES ${values.join(',')}`,
        params,
      )
    }
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }

  // 缓存必须写入过滤后的状态,否则悬空 project_id 会经缓存复活
  await setBoardCache(userId, sanitized)
  return { ok: true }
}

/* ---------- 用户级看板写锁 ---------- */

const boardLocks = new Map()

/** 同一用户的看板写操作串行化:Agent 的读-改-写与前端全量保存共用此锁,防止互相覆盖 */
export function withBoardLock(userId, fn) {
  const tail = boardLocks.get(userId) ?? Promise.resolve()
  const next = tail.then(fn, fn)
  boardLocks.set(userId, next.catch(() => {}))
  return next
}
