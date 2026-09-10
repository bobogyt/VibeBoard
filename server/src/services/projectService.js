import { randomUUID } from 'node:crypto'
import { pool } from '../db.js'

export const PROJECT_STATUSES = ['planning', 'developing', 'testing', 'released', 'maintaining', 'paused', 'archived']

function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}

/** 校验并规整项目字段;非法返回错误文案 */
function validateProject(body, { partial = false } = {}) {
  const { name, description, status, repo_url, tech_stack, start_date, due_date } = body ?? {}

  if (!partial || name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 100) {
      return '项目名必填且不超过 100 字'
    }
  }
  if (status !== undefined) {
    if (typeof status !== 'string' || !PROJECT_STATUSES.includes(status)) {
      return '状态不合法'
    }
  }
  if (description !== undefined && (typeof description !== 'string' || description.length > 2000)) {
    return '描述不能超过 2000 字'
  }
  if (repo_url !== undefined) {
    if (repo_url !== null && (typeof repo_url !== 'string' || repo_url.length > 500)) {
      return '仓库地址不合法'
    }
  }
  if (tech_stack !== undefined) {
    if (
      !Array.isArray(tech_stack) ||
      tech_stack.length > 10 ||
      !tech_stack.every((t) => typeof t === 'string' && t.trim().length > 0 && t.trim().length <= 20)
    ) {
      return '技术栈最多 10 项,每项不超过 20 字'
    }
  }
  for (const d of [start_date, due_date]) {
    if (d !== undefined && d !== null && (typeof d !== 'number' || !Number.isFinite(d))) {
      return '日期格式不合法'
    }
  }
  return null
}

function normalizeTechStack(tech_stack) {
  if (!Array.isArray(tech_stack)) return null
  const cleaned = tech_stack.map((t) => String(t).trim()).filter(Boolean)
  return cleaned.length > 0 ? JSON.stringify(cleaned) : null
}

function rowToProject(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    status: row.status,
    repoUrl: row.repo_url ?? '',
    techStack: row.tech_stack ? JSON.parse(row.tech_stack) : [],
    startDate: row.start_date === null ? null : Number(row.start_date),
    dueDate: row.due_date === null ? null : Number(row.due_date),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    totalCount: Number(row.total_count ?? 0),
    doneCount: Number(row.done_count ?? 0),
    progress:
      Number(row.total_count ?? 0) > 0 ? Math.round((Number(row.done_count) / Number(row.total_count)) * 100) : null,
  }
}

const PROJECT_SELECT = `SELECT p.*,
        COUNT(t.id) AS total_count,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done_count
 FROM projects p LEFT JOIN tasks t ON t.project_id = p.id`

export async function listProjects(userId) {
  const [rows] = await pool.query(`${PROJECT_SELECT} WHERE p.owner_id = ? GROUP BY p.id ORDER BY p.updated_at DESC`, [
    userId,
  ])
  return rows.map(rowToProject)
}

export async function getProject(userId, projectId) {
  const [rows] = await pool.query(`${PROJECT_SELECT} WHERE p.id = ? AND p.owner_id = ? GROUP BY p.id`, [
    projectId,
    userId,
  ])
  if (rows.length === 0) throw httpError(404, '项目不存在')
  return rowToProject(rows[0])
}

export async function createProject(userId, body) {
  const error = validateProject(body)
  if (error) throw httpError(400, error)

  const id = randomUUID()
  const now = Date.now()
  await pool.execute(
    `INSERT INTO projects (id, owner_id, name, description, status, repo_url, tech_stack, start_date, due_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      String(body.name).trim(),
      body.description ?? '',
      body.status ?? 'planning',
      body.repo_url ?? null,
      normalizeTechStack(body.tech_stack),
      body.start_date ?? null,
      body.due_date ?? null,
      now,
      now,
    ],
  )
  return getProject(userId, id)
}

export async function updateProject(userId, projectId, body) {
  const [rows] = await pool.execute('SELECT * FROM projects WHERE id = ? AND owner_id = ?', [projectId, userId])
  const existing = rows[0]
  if (!existing) throw httpError(404, '项目不存在')

  const error = validateProject(body, { partial: true })
  if (error) throw httpError(400, error)

  const next = {
    name: body.name !== undefined ? String(body.name).trim() : existing.name,
    description: body.description !== undefined ? body.description : existing.description,
    status: body.status !== undefined ? body.status : existing.status,
    repo_url: body.repo_url !== undefined ? body.repo_url : existing.repo_url,
    tech_stack: body.tech_stack !== undefined ? normalizeTechStack(body.tech_stack) : existing.tech_stack,
    start_date: body.start_date !== undefined ? body.start_date : existing.start_date,
    due_date: body.due_date !== undefined ? body.due_date : existing.due_date,
  }
  await pool.execute(
    `UPDATE projects SET name = ?, description = ?, status = ?, repo_url = ?, tech_stack = ?, start_date = ?, due_date = ?, updated_at = ?
     WHERE id = ? AND owner_id = ?`,
    [next.name, next.description, next.status, next.repo_url, next.tech_stack, next.start_date, next.due_date, Date.now(), existing.id, userId],
  )
  return getProject(userId, existing.id)
}

/** 删除项目,关联任务的 project_id 置 NULL(任务保留) */
export async function deleteProject(userId, projectId) {
  const [rows] = await pool.execute('SELECT id FROM projects WHERE id = ? AND owner_id = ?', [projectId, userId])
  if (rows.length === 0) throw httpError(404, '项目不存在')

  await pool.execute('UPDATE tasks SET project_id = NULL WHERE project_id = ?', [projectId])
  await pool.execute('DELETE FROM projects WHERE id = ? AND owner_id = ?', [projectId, userId])
  return { ok: true }
}
