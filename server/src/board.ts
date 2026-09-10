import { pool } from './db'
import { getBoardCache, setBoardCache } from './cache'
import { httpError } from './http/http-error'
import { COLUMN_IDS, type BoardState, type ColumnId, type Task } from './types'

/** 与前端 types.ts 对应的结构校验;非法返回 null */
function parseBoardState(input: unknown): BoardState | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  const source = input as Record<string, unknown>
  const columns = (source.columns ?? source) as Record<string, unknown>
  const state: BoardState = { todo: [], doing: [], done: [] }
  for (const col of COLUMN_IDS) {
    const list = columns[col]
    if (!Array.isArray(list)) return null
    const normalized: Task[] = []
    for (const item of list) {
      const t = item as Task
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
      if (priority !== null && !['P0', 'P1', 'P2', 'P3'].includes(priority)) return null
      const dueDate = t.dueDate ?? null
      if (dueDate !== null && (typeof dueDate !== 'number' || !Number.isFinite(dueDate))) return null
      const dependsOn = Array.isArray(t.dependsOn)
        ? [...new Set((t.dependsOn as unknown[]).filter((id): id is string => typeof id === 'string' && id.length > 0 && id !== t.id))]
        : []
      normalized.push({ ...t, priority, dueDate, dependsOn })
    }
    state[col] = normalized
  }
  return state
}

export interface TaskRow {
  id: string
  title: string
  description: string | null
  status: string
  position: number
  project_id: string | null
  priority: string | null
  due_date: number | string | null
  depends_on: string | null
  created_at: number | string
  updated_at: number | string
}

export function rowToTask(row: TaskRow): Task {
  let dependsOn: string[] = []
  try {
    const parsed = row.depends_on ? JSON.parse(row.depends_on) : []
    if (Array.isArray(parsed)) dependsOn = parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    dependsOn = []
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    status: row.status,
    projectId: row.project_id ?? null,
    priority: (row.priority as Task['priority']) ?? null,
    dueDate: row.due_date === null || row.due_date === undefined ? null : Number(row.due_date),
    dependsOn,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

/** 读:缓存命中直接返回;未命中查 MySQL 并回填。cacheHit 供日志观察 */
export async function getBoard(userId: string): Promise<{ state: BoardState; cacheHit: boolean }> {
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
  const state: BoardState = { todo: [], doing: [], done: [] }
  for (const row of rows as unknown as TaskRow[]) {
    const col = row.status as ColumnId
    if (state[col]) state[col].push(rowToTask(row))
  }
  const ok = await setBoardCache(userId, state)
  console.log(`[board] cache MISS user=${userId} redisWrite=${ok}`)
  return { state, cacheHit: false }
}

/** 依赖完整性兜底:剔除指向不存在任务的前置引用,并拒绝循环依赖(客户端全量保存路径的唯一校验点) */
function sanitizeDependencies(state: BoardState): void {
  const byId = new Map<string, Task>()
  for (const col of COLUMN_IDS) for (const t of state[col]) byId.set(t.id, t)
  for (const col of COLUMN_IDS) {
    for (const t of state[col]) {
      if (t.dependsOn?.length) t.dependsOn = t.dependsOn.filter((id) => byId.has(id))
    }
  }
  const visiting = new Set<string>()
  const done = new Set<string>()
  const visit = (id: string): void => {
    if (done.has(id)) return
    if (visiting.has(id)) throw httpError(400, '存在循环依赖')
    visiting.add(id)
    for (const next of byId.get(id)?.dependsOn ?? []) visit(next)
    done.add(id)
  }
  for (const t of byId.values()) visit(t.id)
}

/** 写:事务内整表替换该用户任务,成功后写穿透更新缓存 */
export async function saveBoard(userId: string, input: unknown): Promise<{ ok: boolean }> {
  const state = parseBoardState(input)
  if (!state) throw httpError(400, '看板数据格式非法')
  sanitizeDependencies(state)

  // 过滤指向已删除项目的引用(防止陈旧保存复活悬空 project_id)
  const referenced = new Set(
    COLUMN_IDS.flatMap((col) => state[col]).map((t) => t.projectId).filter((id): id is string => Boolean(id)),
  )
  const validProjectIds = new Set<string>()
  if (referenced.size > 0) {
    const [rows] = await pool.query(
      `SELECT id FROM projects WHERE owner_id = ? AND id IN (${[...referenced].map(() => '?').join(',')})`,
      [userId, ...referenced],
    )
    for (const row of rows as Array<{ id: string }>) validProjectIds.add(row.id)
  }

  const conn = await pool.getConnection()
  // 过滤后的状态:缓存必须写它,否则悬空 project_id 会经缓存复活
  const sanitized: BoardState = { todo: [], doing: [], done: [] }
  try {
    await conn.beginTransaction()
    // 完成时间跟踪:整表替换前先读旧状态,本保存内 done 状态发生迁移的任务刷新 completed_at
    const [prevRows] = await conn.execute(
      'SELECT id, status, completed_at FROM tasks WHERE board_id = ? AND archived = 0',
      [userId],
    )
    const prevById = new Map<string, { status: string; completedAt: number | null }>()
    for (const row of prevRows as unknown as Array<{ id: string; status: string; completed_at: number | string | null }>) {
      prevById.set(row.id, {
        status: row.status,
        completedAt: row.completed_at === null || row.completed_at === undefined ? null : Number(row.completed_at),
      })
    }
    const now = Date.now()
    // 只替换未归档任务:归档行不参与整表替换,任何保存都不得清掉归档数据
    await conn.execute('DELETE FROM tasks WHERE board_id = ? AND archived = 0', [userId])
    const values: string[] = []
    const params: Array<string | number | null> = []
    for (const col of COLUMN_IDS) {
      state[col].forEach((task, index) => {
        const projectId = task.projectId && validProjectIds.has(task.projectId) ? task.projectId : null
        sanitized[col].push({ ...task, projectId })
        values.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        // 完成时间:已在 done 列则沿用旧值(首次完成时刻),新完成记 now,移出 done 清空
        const prev = prevById.get(task.id)
        const completedAt =
          col === 'done' ? (prev && prev.status === 'done' && prev.completedAt !== null ? prev.completedAt : now) : null
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
          completedAt,
        )
      })
    }
    if (values.length > 0) {
      await conn.execute(
        `INSERT INTO tasks (id, board_id, title, description, status, position, project_id, priority, due_date, depends_on, created_at, updated_at, completed_at) VALUES ${values.join(',')}`,
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

const boardLocks = new Map<string, Promise<unknown>>()

/** 同一用户的看板写操作串行化:Agent 的读-改-写与前端全量保存共用此锁,防止互相覆盖 */
export function withBoardLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const tail = boardLocks.get(userId) ?? Promise.resolve()
  const next = tail.then(fn, fn)
  boardLocks.set(userId, next.catch(() => {}))
  return next
}
