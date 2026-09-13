import { randomUUID } from 'node:crypto'
import { pool } from '../db'
import { setBoardCache } from '../cache'
import { getBoard, saveBoard, withBoardLock, rowToTask, MAX_DEPENDS_PER_TASK } from '../board'
import { httpError } from '../http/http-error'
import { COLUMN_IDS, PRIORITIES, type BoardState, type ColumnId, type Priority, type Task } from '../types'

export const MAX_BATCH = 50
const LIST_DESCRIPTION_MAX = 200

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw httpError(400, message)
}

function normalizePriority(priority: unknown): Priority | null {
  if (priority === undefined || priority === null || priority === '') return null
  assert(PRIORITIES.includes(priority as Priority), '优先级需为 P0/P1/P2/P3')
  return priority as Priority
}

function normalizeDueDate(dueDate: unknown): number | null {
  if (dueDate === undefined || dueDate === null || dueDate === '') return null
  assert(typeof dueDate === 'number' && Number.isFinite(dueDate), '截止时间需为毫秒时间戳')
  return dueDate as number
}

interface TaskLocation {
  task: Task
  col: ColumnId
  index: number
}

function findTask(state: BoardState, taskId: string): TaskLocation | null {
  for (const col of COLUMN_IDS) {
    const index = state[col].findIndex((t) => t.id === taskId)
    if (index !== -1) return { task: state[col][index], col, index }
  }
  return null
}

function requireTask(state: BoardState, taskId: string): TaskLocation {
  const found = findTask(state, taskId)
  if (!found) throw httpError(404, `任务 ${taskId} 不存在`)
  return found
}

/** 依赖校验与赋值:前置必须存在(404 原子)、不可自引用、沿依赖链不得回到自身(环) */
function applyDependencies(state: BoardState, taskId: string, dependsOn: unknown): void {
  assert(Array.isArray(dependsOn), 'dependsOn 需为字符串数组')
  const ids = [...new Set(dependsOn as unknown[])]
  assert(ids.length <= MAX_DEPENDS_PER_TASK, `前置任务数量不能超过 ${MAX_DEPENDS_PER_TASK} 个`)
  assert(ids.every((id) => typeof id === 'string' && id.length > 0), 'dependsOn 需为非空字符串数组')
  assert(!ids.includes(taskId), '前置任务不能包含自身')

  const byId = new Map<string, Task>()
  for (const col of COLUMN_IDS) for (const t of state[col]) byId.set(t.id, t)
  for (const id of ids as string[]) {
    if (!byId.has(id)) throw httpError(404, `前置任务 ${id} 不存在`)
  }
  // 环检测:从每个前置沿依赖链出发,若能回到 taskId 则成环
  for (const id of ids as string[]) {
    const visited = new Set<string>()
    const stack = [id]
    while (stack.length > 0) {
      const current = stack.pop() as string
      if (current === taskId) throw httpError(400, '存在循环依赖')
      if (visited.has(current)) continue
      visited.add(current)
      for (const next of byId.get(current)?.dependsOn ?? []) stack.push(next)
    }
  }
  byId.get(taskId)!.dependsOn = ids as string[]
}

/** 从看板剩余任务的 dependsOn 中剔除指定 id(删除/归档后的悬挂引用清理);返回被清理的任务以便落库 */
function stripDependencies(state: BoardState, removedIds: Set<string>): Task[] {
  const stripped: Task[] = []
  for (const col of COLUMN_IDS) {
    for (const t of state[col]) {
      if (t.dependsOn?.some((id) => removedIds.has(id))) {
        t.dependsOn = t.dependsOn.filter((id) => !removedIds.has(id))
        stripped.push(t)
      }
    }
  }
  return stripped
}

export interface TaskFilter {
  status?: unknown
  projectId?: unknown
  priority?: unknown
}

/** 全量任务列表(带 status 字段);可按状态/项目/优先级过滤;列表场景描述截断 */
export async function getTasks(userId: string, filter: TaskFilter = {}): Promise<Task[]> {
  const { state } = await getBoard(userId)
  if (filter.status !== undefined) assert(COLUMN_IDS.includes(filter.status as ColumnId), 'status 需为 todo/doing/done')
  if (filter.priority !== undefined && filter.priority !== null) {
    assert(PRIORITIES.includes(filter.priority as Priority), '优先级需为 P0/P1/P2/P3')
  }

  const tasks: Task[] = []
  for (const col of COLUMN_IDS) {
    for (const task of state[col]) {
      if (filter.status && task.status !== filter.status) continue
      if (filter.projectId && task.projectId !== filter.projectId) continue
      if (filter.priority && (task.priority ?? null) !== filter.priority) continue
      tasks.push(task)
    }
  }
  return tasks.map((t) => ({
    ...t,
    description:
      t.description.length > LIST_DESCRIPTION_MAX
        ? `${t.description.slice(0, LIST_DESCRIPTION_MAX)}…`
        : t.description,
  }))
}

export async function getTask(userId: string, taskId: unknown): Promise<Task> {
  assert(typeof taskId === 'string' && taskId.length > 0, 'taskId 必填')
  const { state } = await getBoard(userId)
  return requireTask(state, taskId as string).task
}

/** 创建任务:默认进 todo 列末尾 */
export async function createTask(userId: string, input: Record<string, unknown> = {}): Promise<Task> {
  assert(typeof input.title === 'string' && input.title.trim().length > 0, '任务标题必填')
  assert((input.title as string).trim().length <= 200, '任务标题不能超过 200 字')
  const description = input.description ?? ''
  assert(typeof description === 'string' && description.length <= 5000, '任务描述不能超过 5000 字')
  const status = (input.status ?? 'todo') as ColumnId
  assert(COLUMN_IDS.includes(status), 'status 需为 todo/doing/done')
  const priority = normalizePriority(input.priority)
  const dueDate = normalizeDueDate(input.dueDate)

  return withBoardLock(userId, async () => {
    const { state } = await getBoard(userId)
    const now = Date.now()
    const task: Task = {
      id: randomUUID(),
      title: (input.title as string).trim(),
      description: description as string,
      status,
      projectId: (input.projectId as string | null) ?? null,
      priority,
      dueDate,
      dependsOn: [],
      createdAt: now,
      updatedAt: now,
    }
    state[status].push(task)
    await saveBoard(userId, state)
    return task
  })
}

/** 部分更新:title/description/projectId/priority/dueDate */
export async function updateTask(userId: string, taskId: unknown, patch: Record<string, unknown> = {}): Promise<Task> {
  assert(typeof taskId === 'string' && taskId.length > 0, 'taskId 必填')
  return withBoardLock(userId, async () => {
    const { state } = await getBoard(userId)
    const { task } = requireTask(state, taskId as string)

    if (patch.title !== undefined) {
      assert(typeof patch.title === 'string' && patch.title.trim().length > 0, '任务标题不能为空')
      assert((patch.title as string).trim().length <= 200, '任务标题不能超过 200 字')
      task.title = (patch.title as string).trim()
    }
    if (patch.description !== undefined) {
      assert(typeof patch.description === 'string' && patch.description.length <= 5000, '任务描述不能超过 5000 字')
      task.description = patch.description as string
    }
    if (patch.projectId !== undefined) {
      assert(patch.projectId === null || typeof patch.projectId === 'string', 'projectId 需为字符串或 null')
      task.projectId = patch.projectId as string | null
    }
    if (patch.priority !== undefined) task.priority = normalizePriority(patch.priority)
    if (patch.dueDate !== undefined) task.dueDate = normalizeDueDate(patch.dueDate)
    if (patch.dependsOn !== undefined) applyDependencies(state, taskId as string, patch.dependsOn)

    task.updatedAt = Date.now()
    await saveBoard(userId, state)
    return task
  })
}

/** 跨列/列内移动:toPosition 缺省时追加到目标列末尾 */
export async function moveTask(userId: string, taskId: unknown, toStatus: unknown, toPosition?: unknown): Promise<Task> {
  assert(typeof taskId === 'string' && taskId.length > 0, 'taskId 必填')
  assert(COLUMN_IDS.includes(toStatus as ColumnId), '目标状态需为 todo/doing/done')
  if (toPosition !== undefined && toPosition !== null) {
    assert(Number.isInteger(toPosition) && (toPosition as number) >= 0, 'toPosition 需为非负整数')
  }

  return withBoardLock(userId, async () => {
    const { state } = await getBoard(userId)
    const { task, col, index } = requireTask(state, taskId as string)

    state[col].splice(index, 1)
    const moved: Task = { ...task, status: toStatus as string, updatedAt: Date.now() }
    if (toPosition === undefined || toPosition === null || (toPosition as number) >= state[toStatus as ColumnId].length) {
      state[toStatus as ColumnId].push(moved)
    } else {
      state[toStatus as ColumnId].splice(toPosition as number, 0, moved)
    }
    await saveBoard(userId, state)
    return moved
  })
}

export async function updateTaskPriority(userId: string, taskId: unknown, priority: unknown): Promise<Task> {
  assert(typeof taskId === 'string' && taskId.length > 0, 'taskId 必填')
  const normalized = normalizePriority(priority)
  assert(normalized !== null, '优先级必填,需为 P0/P1/P2/P3')

  return withBoardLock(userId, async () => {
    const { state } = await getBoard(userId)
    const { task } = requireTask(state, taskId as string)
    task.priority = normalized
    task.updatedAt = Date.now()
    await saveBoard(userId, state)
    return task
  })
}

/* ---------- 批量与高危操作(经 Agent 调用时需人工确认) ---------- */

/** 归一化 taskIds:去重;必须是 1..MAX_BATCH 个非空字符串 */
function normalizeTaskIds(taskIds: unknown): string[] {
  assert(Array.isArray(taskIds), 'taskIds 需为字符串数组')
  const ids = [...new Set(taskIds as unknown[])]
  assert(ids.length > 0, 'taskIds 不能为空')
  assert(ids.length <= MAX_BATCH, `单次最多操作 ${MAX_BATCH} 个任务`)
  assert(ids.every((id) => typeof id === 'string' && id.length > 0), 'taskIds 需为非空字符串')
  return ids as string[]
}

/** 从看板状态中按 id 移除任务(调用前需已 requireTask 全部命中);返回被移除的任务 */
function removeAllFromState(state: BoardState, found: TaskLocation[]): Task[] {
  const byCol = new Map<ColumnId, number[]>()
  for (const f of found) {
    if (!byCol.has(f.col)) byCol.set(f.col, [])
    byCol.get(f.col)!.push(f.index)
  }
  for (const [col, indexes] of byCol) {
    for (const index of [...indexes].sort((a, b) => b - a)) state[col].splice(index, 1)
  }
  return found.map((f) => f.task)
}

/** 永久删除看板任务(单个/批量);任一任务不存在则整批失败(原子) */
export async function deleteTasks(userId: string, taskIds: unknown): Promise<{ deleted: number; tasks: Array<{ id: string; title: string }> }> {
  const ids = normalizeTaskIds(taskIds)

  return withBoardLock(userId, async () => {
    const { state } = await getBoard(userId)
    const found = ids.map((id) => requireTask(state, id))
    const removed = removeAllFromState(state, found)
    stripDependencies(state, new Set(ids))
    await saveBoard(userId, state)
    return { deleted: removed.length, tasks: removed.map((t) => ({ id: t.id, title: t.title })) }
  })
}

/** 批量修改:patch 至少含 status/priority/projectId 一项;status 变更 = 移动到目标列末尾;任一任务不存在则整批失败 */
export async function batchUpdateTasks(
  userId: string,
  taskIds: unknown,
  patch: Record<string, unknown> = {},
): Promise<{ updated: number; tasks: Task[] }> {
  const ids = normalizeTaskIds(taskIds)
  const hasStatus = patch.status !== undefined
  const hasPriority = patch.priority !== undefined
  const hasProjectId = patch.projectId !== undefined
  assert(hasStatus || hasPriority || hasProjectId, 'patch 至少包含 status/priority/projectId 一项')
  if (hasStatus) assert(COLUMN_IDS.includes(patch.status as ColumnId), 'status 需为 todo/doing/done')
  if (hasPriority) normalizePriority(patch.priority)
  if (hasProjectId) assert(patch.projectId === null || typeof patch.projectId === 'string', 'projectId 需为字符串或 null')

  return withBoardLock(userId, async () => {
    const { state } = await getBoard(userId)
    const now = Date.now()
    const found = ids.map((id) => requireTask(state, id))

    for (const { task } of found) {
      if (hasProjectId) task.projectId = patch.projectId as string | null
      if (hasPriority) task.priority = normalizePriority(patch.priority)
      task.updatedAt = now
    }
    if (hasStatus) {
      for (const { task } of found) {
        const f = requireTask(state, task.id)
        state[f.col].splice(f.index, 1)
        state[patch.status as ColumnId].push({ ...task, status: patch.status as string })
      }
    }
    await saveBoard(userId, state)
    return { updated: found.length, tasks: found.map((f) => f.task) }
  })
}

/** 批量创建(目标拆解):数组顺序 = 各列内创建顺序(即执行顺序);经 Agent 调用时需人工确认 */
const MAX_CREATE_BATCH = 20

interface CreateTaskInput {
  title?: unknown
  description?: unknown
  status?: unknown
  projectId?: unknown
  priority?: unknown
  dueDate?: unknown
  dependsOn?: unknown
}

export async function createTasksBatch(userId: string, inputs: unknown): Promise<{ created: number; tasks: Task[] }> {
  assert(Array.isArray(inputs), 'tasks 需为对象数组')
  assert(inputs.length > 0, 'tasks 不能为空')
  assert(inputs.length <= MAX_CREATE_BATCH, `单次最多创建 ${MAX_CREATE_BATCH} 个任务`)

  const normalized = (inputs as CreateTaskInput[]).map((input) => {
    assert(typeof input === 'object' && input !== null && !Array.isArray(input), 'tasks 每项需为对象')
    assert(typeof input.title === 'string' && input.title.trim().length > 0, '每个任务都需要非空标题')
    assert((input.title as string).trim().length <= 200, '任务标题不能超过 200 字')
    const description = input.description ?? ''
    assert(typeof description === 'string' && description.length <= 5000, '任务描述不能超过 5000 字')
    const status = (input.status ?? 'todo') as ColumnId
    assert(COLUMN_IDS.includes(status), 'status 需为 todo/doing/done')
    assert(input.projectId === undefined || input.projectId === null || typeof input.projectId === 'string', 'projectId 需为字符串或 null')
    return {
      title: (input.title as string).trim(),
      description: description as string,
      status,
      projectId: (input.projectId as string | null) ?? null,
      priority: normalizePriority(input.priority),
      dueDate: normalizeDueDate(input.dueDate),
      dependsOn: input.dependsOn,
    }
  })

  return withBoardLock(userId, async () => {
    const { state } = await getBoard(userId)
    const now = Date.now()
    const tasks = normalized.map((item) => {
      // dependsOn 置空在展开之后:声明的依赖统一在下方按下标解析为真实 id 再覆盖
      const task = { id: randomUUID(), ...item, dependsOn: [] as string[], createdAt: now, updatedAt: now } as Task
      state[item.status].push(task)
      return task
    })
    // 解析下标依赖为真实 id:只能指向数组中更早的项,天然无环;校验失败则整体不落库
    normalized.forEach((item, index) => {
      if (item.dependsOn !== undefined) {
        assert(Array.isArray(item.dependsOn), 'dependsOn 需为下标数组')
        tasks[index].dependsOn = (item.dependsOn as unknown[]).map((ref) => {
          assert(Number.isInteger(ref) && (ref as number) >= 0 && (ref as number) < index, 'dependsOn 下标需指向数组中更早的任务')
          return tasks[ref as number].id
        })
      }
    })
    await saveBoard(userId, state)
    return { created: tasks.length, tasks }
  })
}

/** 设置任务前置依赖(只标识、不重排);经 Agent 调用时需人工确认 */
export async function setTaskDependencies(userId: string, taskId: unknown, dependsOn: unknown): Promise<Task> {
  assert(typeof taskId === 'string' && taskId.length > 0, 'taskId 必填')

  return withBoardLock(userId, async () => {
    const { state } = await getBoard(userId)
    const { task } = requireTask(state, taskId as string)
    applyDependencies(state, taskId as string, dependsOn)
    task.updatedAt = Date.now()
    await saveBoard(userId, state)
    return task
  })
}

/** 归档(true,移出看板;行保留)或恢复(false,回原列原位置附近) */
export async function setTasksArchived(userId: string, taskIds: unknown, archived: unknown): Promise<{ changed: number; tasks: Task[] }> {
  assert(typeof archived === 'boolean', 'archived 需为布尔值')
  const ids = normalizeTaskIds(taskIds)

  return withBoardLock(userId, async () => {
    if (archived as boolean) {
      const { state } = await getBoard(userId)
      const found = ids.map((id) => requireTask(state, id))
      const removed = removeAllFromState(state, found)
      // 悬挂清理必须显式落库:Redis 不可用时 setBoardCache 是软失败,只改内存会丢
      const stripped = stripDependencies(state, new Set(ids))
      await pool.execute(
        `UPDATE tasks SET archived = 1 WHERE board_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
        [userId, ...ids],
      )
      for (const t of stripped) {
        await pool.execute('UPDATE tasks SET depends_on = ? WHERE board_id = ? AND id = ?', [
          JSON.stringify(t.dependsOn ?? []),
          userId,
          t.id,
        ])
      }
      await setBoardCache(userId, state)
      return { changed: removed.length, tasks: removed }
    }

    const placeholders = ids.map(() => '?').join(',')
    const [rows] = await pool.execute(
      `SELECT id, title, description, status, position, project_id, priority, due_date, created_at, updated_at FROM tasks WHERE board_id = ? AND archived = 1 AND id IN (${placeholders})`,
      [userId, ...ids],
    )
    const archivedRows = rows as unknown as Array<{ position: number | null } & Parameters<typeof rowToTask>[0]>
    if (archivedRows.length !== ids.length) throw httpError(404, '部分任务不在归档中,未执行恢复')
    await pool.execute(
      `UPDATE tasks SET archived = 0 WHERE board_id = ? AND archived = 1 AND id IN (${placeholders})`,
      [userId, ...ids],
    )
    // 恢复后重写看板缓存:归档任务不在缓存状态里,按原列原位置插回
    const { state } = await getBoard(userId)
    const onBoardIds = new Set(COLUMN_IDS.flatMap((col) => state[col]).map((t) => t.id))
    const restored: Task[] = []
    for (const row of archivedRows) {
      const task = rowToTask(row)
      // 归档期间前置可能已被删除,恢复时剔除悬挂引用
      task.dependsOn = (task.dependsOn ?? []).filter((id) => onBoardIds.has(id))
      const list = state[task.status as ColumnId] ?? state.todo
      const position = Number.isFinite(row.position) ? (row.position as number) : list.length
      list.splice(Math.min(Math.max(position, 0), list.length), 0, task)
      restored.push(task)
    }
    await setBoardCache(userId, state)
    return { changed: restored.length, tasks: restored }
  })
}

/** 恢复归档任务(供归档页) */
export async function restoreTasks(userId: string, taskIds: unknown): Promise<{ changed: number; tasks: Task[] }> {
  return setTasksArchived(userId, taskIds, false)
}

/** 归档任务列表(不经看板缓存) */
export async function getArchivedTasks(userId: string): Promise<Task[]> {
  const [rows] = await pool.execute(
    'SELECT id, title, description, status, position, project_id, priority, due_date, created_at, updated_at FROM tasks WHERE board_id = ? AND archived = 1 ORDER BY updated_at DESC',
    [userId],
  )
  return (rows as unknown as Parameters<typeof rowToTask>[0][]).map(rowToTask)
}

/** 彻底删除已归档任务(不可恢复);任一不存在或未归档则整批失败 */
export async function purgeTasks(userId: string, taskIds: unknown): Promise<{ deleted: number }> {
  const ids = normalizeTaskIds(taskIds)
  const [result] = await pool.execute(
    `DELETE FROM tasks WHERE board_id = ? AND archived = 1 AND id IN (${ids.map(() => '?').join(',')})`,
    [userId, ...ids],
  )
  const affected = (result as { affectedRows?: number }).affectedRows ?? 0
  if (affected !== ids.length) throw httpError(404, '部分任务不在归档中,未执行删除')
  return { deleted: affected }
}
