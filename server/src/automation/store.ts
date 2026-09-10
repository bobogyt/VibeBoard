import { randomUUID } from 'node:crypto'
import { pool } from '../db'

/* ---------- 用户自动化开关 ---------- */

export interface UserAutomationRow {
  automation_id: string
  enabled: number
  last_run_at: number | null
}

export async function getUserAutomationStates(userId: string): Promise<UserAutomationRow[]> {
  const [rows] = await pool.execute('SELECT automation_id, enabled, last_run_at FROM user_automations WHERE user_id = ?', [userId])
  return rows as unknown as UserAutomationRow[]
}

export async function isAutomationEnabled(userId: string, automationId: string): Promise<boolean> {
  const [rows] = await pool.execute('SELECT enabled FROM user_automations WHERE user_id = ? AND automation_id = ?', [
    userId,
    automationId,
  ])
  const list = rows as unknown as Array<{ enabled: number }>
  return list.length > 0 && list[0].enabled === 1
}

export async function listEnabledUsers(automationId: string): Promise<string[]> {
  const [rows] = await pool.execute('SELECT user_id FROM user_automations WHERE automation_id = ? AND enabled = 1', [
    automationId,
  ])
  return (rows as unknown as Array<{ user_id: string }>).map((r) => r.user_id)
}

export async function setAutomationEnabled(userId: string, automationId: string, enabled: boolean): Promise<void> {
  await pool.execute(
    `INSERT INTO user_automations (user_id, automation_id, enabled, updated_at) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), updated_at = VALUES(updated_at)`,
    [userId, automationId, enabled ? 1 : 0, Date.now()],
  )
}

/* ---------- 运行历史 ---------- */

export interface AutomationRunRow {
  id: string
  user_id: string
  automation_id: string
  status: 'ok' | 'failed' | 'skipped'
  summary: string | null
  error: string | null
  created_at: number
}

export async function recordRun(input: {
  userId: string
  automationId: string
  status: AutomationRunRow['status']
  summary: string | null
  error: string | null
}): Promise<AutomationRunRow> {
  const run: AutomationRunRow = {
    id: randomUUID(),
    user_id: input.userId,
    automation_id: input.automationId,
    status: input.status,
    summary: input.summary?.slice(0, 20_000) ?? null,
    error: input.error?.slice(0, 500) ?? null,
    created_at: Date.now(),
  }
  await pool.execute(
    'INSERT INTO automation_runs (id, user_id, automation_id, status, summary, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [run.id, run.user_id, run.automation_id, run.status, run.summary, run.error, run.created_at],
  )
  await pool.execute(
    `INSERT INTO user_automations (user_id, automation_id, enabled, last_run_at, updated_at) VALUES (?, ?, 1, ?, ?)
     ON DUPLICATE KEY UPDATE last_run_at = VALUES(last_run_at)`,
    [input.userId, input.automationId, run.created_at, run.created_at],
  )
  return run
}

export async function listRuns(userId: string, automationId: string | null, limit: number): Promise<Array<{ id: string; automationId: string; status: string; summary: string | null; error: string | null; createdAt: number }>> {
  const cap = Math.min(Math.max(1, limit), 100)
  const [rows] = automationId
    ? await pool.execute(
        'SELECT id, user_id, automation_id, status, summary, error, created_at FROM automation_runs WHERE user_id = ? AND automation_id = ? ORDER BY created_at DESC LIMIT ?',
        [userId, automationId, cap],
      )
    : await pool.execute(
        'SELECT id, user_id, automation_id, status, summary, error, created_at FROM automation_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
        [userId, cap],
      )
  return (rows as unknown as AutomationRunRow[]).map((r) => ({
    id: r.id,
    automationId: r.automation_id,
    status: r.status,
    summary: r.summary,
    error: r.error,
    createdAt: Number(r.created_at),
  }))
}

/* ---------- 通知中心 ---------- */

export interface NotificationRow {
  id: string
  user_id: string
  automation_id: string | null
  title: string
  body: string | null
  is_read: number
  created_at: number
}

export async function createNotification(input: {
  userId: string
  automationId: string | null
  title: string
  body: string | null
}): Promise<NotificationRow> {
  const row: NotificationRow = {
    id: randomUUID(),
    user_id: input.userId,
    automation_id: input.automationId,
    title: input.title.slice(0, 200),
    body: input.body?.slice(0, 20_000) ?? null,
    is_read: 0,
    created_at: Date.now(),
  }
  await pool.execute(
    'INSERT INTO notifications (id, user_id, automation_id, title, body, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
    [row.id, row.user_id, row.automation_id, row.title, row.body, row.created_at],
  )
  // 保留最近 50 条,淘汰最旧(与偏好记忆同一模式)
  await pool.execute(
    `DELETE FROM notifications WHERE user_id = ? AND id NOT IN (
       SELECT id FROM (SELECT id FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50) AS keep
     )`,
    [input.userId, input.userId],
  )
  return row
}

export async function listNotifications(userId: string, limit = 30): Promise<{ unread: number; items: Array<{ id: string; automationId: string | null; title: string; body: string | null; read: boolean; createdAt: number }> }> {
  const cap = Math.min(Math.max(1, limit), 100)
  const [items] = await pool.execute(
    'SELECT id, user_id, automation_id, title, body, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    [userId, cap],
  )
  const [countRows] = await pool.execute(
    'SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = 0',
    [userId],
  )
  return {
    unread: Number((countRows as unknown as Array<{ unread: number }>)[0]?.unread ?? 0),
    items: (items as unknown as NotificationRow[]).map((r) => ({
      id: r.id,
      automationId: r.automation_id,
      title: r.title,
      body: r.body,
      read: r.is_read === 1,
      createdAt: Number(r.created_at),
    })),
  }
}

export async function markNotificationsRead(userId: string): Promise<number> {
  const [result] = await pool.execute('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [userId])
  return (result as { affectedRows?: number }).affectedRows ?? 0
}
