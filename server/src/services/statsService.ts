import { randomUUID } from 'node:crypto'
import { pool } from '../db'
import { listProjects } from './projectService'
import type { Priority } from '../types'

/* ---------- Agent 操作日志(埋点写入) ---------- */

/** 记录一次 Agent 工具实际执行;失败只打日志,绝不阻塞 Agent 运行 */
export async function logAgentOperation(userId: string, tool: string, ok: boolean): Promise<void> {
  try {
    await pool.execute(
      'INSERT INTO agent_operation_log (id, user_id, tool, ok, created_at) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), userId, tool.slice(0, 40), ok ? 1 : 0, Date.now()],
    )
  } catch (err) {
    console.warn('[stats] agent operation log failed:', (err as { code?: string; message?: string }).code || (err as Error).message)
  }
}

/* ---------- 统计聚合 ---------- */

export interface PriorityCounts {
  P0: number
  P1: number
  P2: number
  P3: number
  none: number
}

export interface OverdueTask {
  id: string
  title: string
  status: string
  priority: Priority | null
  dueDate: number
  daysOverdue: number
}

export interface TrendPoint {
  label: string
  count: number
}

export interface AgentToolStat {
  tool: string
  count: number
  okCount: number
}

export interface BoardStats {
  projects: {
    total: number
    tracked: number
    averageProgress: number | null
    items: Array<{ id: string; name: string; status: string; progress: number | null; totalCount: number; doneCount: number }>
  }
  priorities: PriorityCounts
  overdue: OverdueTask[]
  trends: { daily: TrendPoint[]; weekly: TrendPoint[] }
  agent: { total: number; last7d: number; successRate: number | null; byTool: AgentToolStat[] }
}

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 本周周一零点(中文习惯周一为一周之始) */
function startOfWeek(ts: number): number {
  const d = new Date(startOfDay(ts))
  const day = (d.getDay() + 6) % 7 // 周日=0 → 6
  d.setDate(d.getDate() - day)
  return d.getTime()
}

const DAY_MS = 86_400_000

function labelOfDay(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function buildTrends(completedAts: number[], now: number): { daily: TrendPoint[]; weekly: TrendPoint[] } {
  // 每日:含今天在内的近 14 天
  const dailyStart = startOfDay(now) - 13 * DAY_MS
  const daily = Array.from({ length: 14 }, (_, i) => {
    const dayStart = dailyStart + i * DAY_MS
    return { label: labelOfDay(dayStart), start: dayStart, count: 0 }
  })
  // 每周:含当前周在内的近 8 周(周一为始)
  const weekStart = startOfWeek(now)
  const weekly = Array.from({ length: 8 }, (_, i) => {
    const ws = weekStart - (7 - i) * 7 * DAY_MS
    return { label: labelOfDay(ws), start: ws, count: 0 }
  })
  for (const ts of completedAts) {
    const day = daily.find((d) => ts >= d.start && ts < d.start + DAY_MS)
    if (day) day.count += 1
    const week = weekly.find((w) => ts >= w.start && ts < w.start + 7 * DAY_MS)
    if (week) week.count += 1
  }
  return {
    daily: daily.map(({ label, count }) => ({ label, count })),
    weekly: weekly.map(({ label, count }) => ({ label, count })),
  }
}

/** 数据统计页全量数据:项目完成率 / 优先级分布 / 逾期任务 / 完成趋势 / Agent 操作统计 */
export async function getStats(userId: string): Promise<BoardStats> {
  const now = Date.now()

  // 项目完成率:复用 LEFT JOIN 进度聚合
  const projects = await listProjects(userId)
  const tracked = projects.filter((p) => p.progress !== null)
  const averageProgress =
    tracked.length > 0 ? Math.round(tracked.reduce((sum, p) => sum + (p.progress as number), 0) / tracked.length) : null

  // 优先级分布(当前看板上的未归档任务)
  const [priorityRows] = await pool.execute(
    'SELECT priority, COUNT(*) AS cnt FROM tasks WHERE board_id = ? AND archived = 0 GROUP BY priority',
    [userId],
  )
  const priorities: PriorityCounts = { P0: 0, P1: 0, P2: 0, P3: 0, none: 0 }
  for (const row of priorityRows as unknown as Array<{ priority: string | null; cnt: number }>) {
    const key = (row.priority ?? 'none') as keyof PriorityCounts
    priorities[key] = Number(row.cnt)
  }

  // 逾期任务:未完成且截止时间已过(未归档)
  const [overdueRows] = await pool.execute(
    `SELECT id, title, status, priority, due_date FROM tasks
     WHERE board_id = ? AND archived = 0 AND status <> 'done' AND due_date IS NOT NULL AND due_date < ?
     ORDER BY due_date ASC`,
    [userId, now],
  )
  const overdue: OverdueTask[] = (overdueRows as unknown as Array<{ id: string; title: string; status: string; priority: string | null; due_date: number | string }>).map(
    (row) => {
      const dueDate = Number(row.due_date)
      return {
        id: row.id,
        title: row.title,
        status: row.status,
        priority: (row.priority as Priority | null) ?? null,
        dueDate,
        daysOverdue: Math.max(1, Math.floor((now - startOfDay(dueDate)) / DAY_MS)),
      }
    },
  )

  // 完成趋势:所有完成过(含后来被归档)的任务,按 completed_at 归入近 14 天 / 8 周
  const since = startOfWeek(now) - 7 * 7 * DAY_MS
  const [completedRows] = await pool.execute(
    'SELECT completed_at FROM tasks WHERE board_id = ? AND completed_at IS NOT NULL AND completed_at >= ?',
    [userId, since],
  )
  const completedAts = (completedRows as unknown as Array<{ completed_at: number | string }>).map((r) => Number(r.completed_at))
  const trends = buildTrends(completedAts, now)

  // Agent 操作统计(实际执行过的工具调用)
  const [opRows] = await pool.execute(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last7d,
            SUM(ok) AS okTotal
     FROM agent_operation_log WHERE user_id = ?`,
    [now - 7 * DAY_MS, userId],
  )
  const opRow = (opRows as unknown as Array<{ total: number; last7d: number | null; okTotal: number | null }>)[0]
  const [toolRows] = await pool.execute(
    `SELECT tool, COUNT(*) AS cnt, SUM(ok) AS okCnt FROM agent_operation_log WHERE user_id = ?
     GROUP BY tool ORDER BY cnt DESC`,
    [userId],
  )
  const byTool = (toolRows as unknown as Array<{ tool: string; cnt: number; okCnt: number }>).map((r) => ({
    tool: r.tool,
    count: Number(r.cnt),
    okCount: Number(r.okCnt),
  }))
  const total = Number(opRow?.total ?? 0)
  const okTotal = Number(opRow?.okTotal ?? 0)

  return {
    projects: {
      total: projects.length,
      tracked: tracked.length,
      averageProgress,
      items: projects.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        progress: p.progress,
        totalCount: p.totalCount,
        doneCount: p.doneCount,
      })),
    },
    priorities,
    overdue,
    trends,
    agent: {
      total,
      last7d: Number(opRow?.last7d ?? 0),
      successRate: total > 0 ? Math.round((okTotal / total) * 100) : null,
      byTool,
    },
  }
}
