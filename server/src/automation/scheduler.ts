import { randomUUID } from 'node:crypto'
import { Cron } from 'croner'
import { redis } from '../cache'
import { pool } from '../db'
import { AUTOMATIONS, getAutomation, type AutomationDef } from './catalog'
import { createNotification, isAutomationEnabled, listEnabledUsers, recordRun } from './store'
import { acquireRunSlot, releaseRunSlot } from '../agent/session'
import { runAgent } from '../agent/harness'
import { httpError } from '../http/http-error'

/* ---------- 运行器 ---------- */

interface AutomationResult {
  status: 'ok' | 'failed' | 'skipped'
  summary: string | null
  error: string | null
  /** 是否产出用户通知 */
  notify: { title: string; body: string | null } | null
}

interface BoardTaskRow {
  id: string
  title: string
  status: string
  priority: string | null
  due_date: number | null
  depends_on: string | null
}

function parseDepends(raw: string | null): string[] {
  try {
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

async function loadBoardTasks(userId: string): Promise<BoardTaskRow[]> {
  const [rows] = await pool.execute(
    'SELECT id, title, status, priority, due_date, depends_on FROM tasks WHERE board_id = ? AND archived = 0',
    [userId],
  )
  return (rows as unknown as Array<Omit<BoardTaskRow, 'due_date'> & { due_date: number | string | null }>).map((r) => ({
    ...r,
    due_date: r.due_date === null ? null : Number(r.due_date),
  }))
}

/** 截止日期提醒:48 小时内到期的未完成任务(确定性扫描,不经模型) */
async function runDeadlineReminder(userId: string): Promise<AutomationResult> {
  const now = Date.now()
  const tasks = await loadBoardTasks(userId)
  const dueSoon = tasks
    .filter((t) => t.status !== 'done' && t.due_date !== null && t.due_date >= now && t.due_date <= now + 48 * 3_600_000)
    .sort((a, b) => (a.due_date as number) - (b.due_date as number))
  if (dueSoon.length === 0) {
    return { status: 'ok', summary: '48 小时内没有到期的任务', error: null, notify: null }
  }
  const lines = dueSoon.map((t) => {
    const when = new Date(t.due_date as number).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    return `- ${t.title}(${t.priority ?? '无优先级'})· ${when} 到期`
  })
  return {
    status: 'ok',
    summary: `${dueSoon.length} 个任务将在 48 小时内到期`,
    error: null,
    notify: { title: `截止提醒:${dueSoon.length} 个任务即将到期`, body: lines.join('\n') },
  }
}

/** 逾期与阻塞盘点:逾期(未完成且过截止)+ 被阻塞(前置任务未完成) */
async function runOverdueBlockedScan(userId: string): Promise<AutomationResult> {
  const now = Date.now()
  const tasks = await loadBoardTasks(userId)
  const doneIds = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.id))
  const byId = new Map(tasks.map((t) => [t.id, t]))

  const overdue = tasks.filter((t) => t.status !== 'done' && t.due_date !== null && (t.due_date as number) < now)
  const blocked: Array<{ task: BoardTaskRow; blockers: string[] }> = []
  for (const t of tasks) {
    const deps = parseDepends(t.depends_on)
    const unfinished = deps.filter((id) => byId.has(id) && !doneIds.has(id))
    if (unfinished.length > 0) {
      blocked.push({ task: t, blockers: unfinished.map((id) => byId.get(id)?.title ?? id) })
    }
  }
  if (overdue.length === 0 && blocked.length === 0) {
    return { status: 'ok', summary: '没有逾期或被阻塞的任务', error: null, notify: null }
  }
  const lines: string[] = []
  if (overdue.length > 0) {
    lines.push(`【逾期 ${overdue.length} 项】`)
    for (const t of overdue) {
      const days = Math.max(1, Math.floor((now - (t.due_date as number)) / 86_400_000))
      lines.push(`- ${t.title}(逾期 ${days} 天)`)
    }
  }
  if (blocked.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(`【被阻塞 ${blocked.length} 项】`)
    for (const b of blocked) {
      lines.push(`- ${b.task.title} ← 被阻塞:${b.blockers.join('、')}`)
    }
  }
  return {
    status: 'ok',
    summary: `逾期 ${overdue.length} 项,被阻塞 ${blocked.length} 项`,
    error: null,
    notify: { title: `任务盘点:逾期 ${overdue.length} 项,被阻塞 ${blocked.length} 项`, body: lines.join('\n') },
  }
}

/** 无人值守 Agent 运行:只读模式,绝不触发人工确认挂起 */
async function runAgentAutomation(userId: string, def: AutomationDef): Promise<AutomationResult> {
  const slot = await acquireRunSlot(userId)
  if (!slot) {
    return { status: 'skipped', summary: null, error: 'Agent 正在运行中,本次自动跳过', notify: null }
  }
  try {
    // acquireSlot=false:本函数已持有运行席位,runAgent 内部不再重复获取
    const result = await runAgent(userId, def.prompt, { readOnly: true, acquireSlot: false })
    const dateLabel = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' })
    return {
      status: 'ok',
      summary: result.finalAnswer,
      error: null,
      notify: { title: `${def.name} · ${dateLabel}`, body: result.finalAnswer },
    }
  } finally {
    await releaseRunSlot(userId)
  }
}

/** 对单个用户执行一次自动化(供调度器与测试直接调用) */
export async function runAutomationForUser(userId: string, automationId: string) {
  const def = getAutomation(automationId)
  if (!def) throw httpError(404, '自动化不存在')
  if (!(await isAutomationEnabled(userId, automationId))) throw httpError(409, '该自动化未启用')

  let result: AutomationResult
  try {
    result = def.type === 'agent' ? await runAgentAutomation(userId, def) : await runDeadlineBlockedScan(userId, def)
  } catch (err) {
    result = { status: 'failed', summary: null, error: (err as Error).message, notify: null }
  }
  const run = await recordRun({ userId, automationId, status: result.status, summary: result.summary, error: result.error })
  if (result.notify) {
    await createNotification({ userId, automationId, title: result.notify.title, body: result.notify.body })
  }
  return run
}

// scan 分发(deadline-reminder 与 overdue-blocked-scan 各自的实现)
async function runDeadlineBlockedScan(userId: string, def: AutomationDef): Promise<AutomationResult> {
  if (def.id === 'deadline-reminder') return runDeadlineReminder(userId)
  if (def.id === 'overdue-blocked-scan') return runOverdueBlockedScan(userId)
  throw httpError(400, `扫描型自动化缺少实现:${def.id}`)
}

/* ---------- 调度器(多进程下由 Redis 锁选出唯一 leader) ---------- */

const WORKER_ID = randomUUID()
const LEADER_KEY = 'automation:leader'
const LEADER_TTL_MS = 60_000
const LEADER_RETRY_MS = 30_000

let started = false
let leader = false
const jobs: Cron[] = []

function scheduleJobs(): void {
  if (jobs.length > 0) return
  for (const def of AUTOMATIONS) {
    jobs.push(
      new Cron(def.cron, { timezone: 'Asia/Shanghai' }, () => {
        void tick(def.id)
      }),
    )
  }
  console.log(`[automation] scheduler active on worker ${WORKER_ID.slice(0, 8)} (${jobs.length} automations)`)
}

async function tick(automationId: string): Promise<void> {
  try {
    // 每次触发前复核领导权:防止锁过期后双 worker 同时执行
    if (redis.status !== 'ready' || (await redis.get(LEADER_KEY)) !== WORKER_ID) return
    const users = await listEnabledUsers(automationId)
    for (const userId of users) {
      try {
        const run = await runAutomationForUser(userId, automationId)
        console.log(`[automation] ${automationId} user=${userId} → ${run.status}`)
      } catch (err) {
        console.error(`[automation] ${automationId} user=${userId} failed:`, (err as Error).message)
      }
    }
  } catch (err) {
    console.error('[automation] tick failed:', (err as Error).message)
  }
}

async function tryBecomeLeader(): Promise<void> {
  if (redis.status !== 'ready') return
  try {
    const acquired = await redis.set(LEADER_KEY, WORKER_ID, 'PX', LEADER_TTL_MS, 'NX')
    if (acquired === 'OK') {
      leader = true
    } else {
      leader = (await redis.get(LEADER_KEY)) === WORKER_ID
    }
    if (leader) scheduleJobs()
  } catch (err) {
    console.warn('[automation] leader election failed:', (err as { code?: string; message?: string }).code || (err as Error).message)
  }
}

/** 进程启动时调用:所有 worker 都参与选主,只有持有 Redis 锁的 worker 真正调度 croner */
export function initAutomationScheduler(): void {
  if (started) return
  started = true
  void tryBecomeLeader()
  setInterval(() => void tryBecomeLeader(), LEADER_RETRY_MS).unref()
}

export function isSchedulerLeader(): boolean {
  return leader
}
