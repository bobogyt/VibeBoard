import mysql, { type Pool } from 'mysql2/promise'

const {
  MYSQL_HOST = '127.0.0.1',
  MYSQL_PORT = '3306',
  MYSQL_USER = 'root',
  MYSQL_PASSWORD = '',
  MYSQL_DATABASE = 'vibeboard',
  MYSQL_POOL_SIZE = '10',
} = process.env

export const pool: Pool = mysql.createPool({
  host: MYSQL_HOST,
  port: Number(MYSQL_PORT),
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
  waitForConnections: true,
  // 每进程连接数:多 worker 部署时注意 MySQL 侧总连接上限(N worker × MYSQL_POOL_SIZE)
  connectionLimit: Math.max(1, Number(MYSQL_POOL_SIZE) || 10),
  namedPlaceholders: false,
})

function connectConfig() {
  return {
    host: MYSQL_HOST,
    port: Number(MYSQL_PORT),
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
  }
}

/** 优先直连目标库;库不存在时再回退到建库流程(受限账号场景下库由管理员预先建好) */
export async function initDb(): Promise<void> {
  let boot: mysql.Connection
  try {
    boot = await mysql.createConnection({ ...connectConfig(), database: MYSQL_DATABASE })
  } catch (err) {
    if ((err as { code?: string }).code !== 'ER_BAD_DB_ERROR') throw err
    boot = await mysql.createConnection(connectConfig())
    await boot.query(
      `CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    )
    await boot.changeUser({ database: MYSQL_DATABASE })
  }
  await boot.query(`
    CREATE TABLE IF NOT EXISTS users (
      id CHAR(36) PRIMARY KEY,
      username VARCHAR(32) NOT NULL UNIQUE,
      password_hash VARCHAR(256) NOT NULL,
      created_at BIGINT NOT NULL
    ) CHARACTER SET utf8mb4
  `)
  await boot.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id CHAR(36) PRIMARY KEY,
      board_id CHAR(36) NOT NULL,
      title VARCHAR(200) NOT NULL,
      description TEXT NULL,
      status VARCHAR(10) NOT NULL,
      position INT NOT NULL,
      project_id CHAR(36) NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      KEY idx_board (board_id, status, position)
    ) CHARACTER SET utf8mb4
  `)
  await boot.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id CHAR(36) PRIMARY KEY,
      owner_id CHAR(36) NOT NULL,
      name VARCHAR(100) NOT NULL,
      description TEXT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'planning',
      repo_url VARCHAR(500) NULL,
      tech_stack TEXT NULL,
      start_date BIGINT NULL,
      due_date BIGINT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      KEY idx_owner (owner_id, updated_at)
    ) CHARACTER SET utf8mb4
  `)
  // 存量库的 tasks 表补 project_id 列(项目关联)
  const [cols] = await boot.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'project_id'`,
    [MYSQL_DATABASE],
  )
  if ((cols as unknown[]).length === 0) {
    await boot.query('ALTER TABLE tasks ADD COLUMN project_id CHAR(36) NULL, ADD KEY idx_project (project_id)')
  }
  // 存量库的 tasks 表补 Agent 相关列(优先级/截止时间);并发启动可能撞列,列已存在即视为成功
  const [taskCols] = await boot.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tasks'`,
    [MYSQL_DATABASE],
  )
  const taskColNames = new Set((taskCols as Array<{ COLUMN_NAME: string }>).map((r) => r.COLUMN_NAME))
  if (!taskColNames.has('priority')) {
    await boot.query('ALTER TABLE tasks ADD COLUMN priority VARCHAR(4) NULL').catch((err: { code?: string }) => {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err
    })
  }
  if (!taskColNames.has('due_date')) {
    await boot.query('ALTER TABLE tasks ADD COLUMN due_date BIGINT NULL').catch((err: { code?: string }) => {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err
    })
  }
  // 存量库的 tasks 表补 archived 列(归档功能;看板与缓存只含未归档任务)
  if (!taskColNames.has('archived')) {
    await boot.query('ALTER TABLE tasks ADD COLUMN archived TINYINT NOT NULL DEFAULT 0').catch((err: { code?: string }) => {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err
    })
  }
  // 存量库的 tasks 表补 depends_on 列(任务前置依赖,JSON 字符串数组)
  if (!taskColNames.has('depends_on')) {
    await boot.query('ALTER TABLE tasks ADD COLUMN depends_on TEXT NULL').catch((err: { code?: string }) => {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err
    })
  }
  // 存量库的 tasks 表补 completed_at 列(完成时间,毫秒;每日/每周完成趋势的数据来源)
  if (!taskColNames.has('completed_at')) {
    await boot.query('ALTER TABLE tasks ADD COLUMN completed_at BIGINT NULL').catch((err: { code?: string }) => {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err
    })
    // 存量回填:已完成任务以 updated_at 近似首次完成时间(该列此前任何编辑都会刷新,仅作历史近似)
    await boot.query("UPDATE tasks SET completed_at = updated_at WHERE status = 'done' AND completed_at IS NULL")
  }
  await boot.query(`
    CREATE TABLE IF NOT EXISTS user_model_configs (
      user_id CHAR(36) NOT NULL,
      provider VARCHAR(20) NOT NULL,
      api_key TEXT NOT NULL,
      active_model VARCHAR(60) NOT NULL,
      is_active TINYINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, provider)
    ) CHARACTER SET utf8mb4
  `)
  // 长期偏好记忆:自由文本条目,Agent 对话自动注入
  await boot.query(`
    CREATE TABLE IF NOT EXISTS user_memories (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      content VARCHAR(300) NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      KEY idx_user (user_id, updated_at)
    ) CHARACTER SET utf8mb4
  `)
  // Agent 操作日志:每次工具实际执行落一行,供数据统计页做操作统计(失败不阻塞 Agent 运行)
  await boot.query(`
    CREATE TABLE IF NOT EXISTS agent_operation_log (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      tool VARCHAR(40) NOT NULL,
      ok TINYINT NOT NULL,
      created_at BIGINT NOT NULL,
      KEY idx_user_time (user_id, created_at)
    ) CHARACTER SET utf8mb4
  `)
  // 自动化:用户开关 + 运行历史 + 通知中心
  await boot.query(`
    CREATE TABLE IF NOT EXISTS user_automations (
      user_id CHAR(36) NOT NULL,
      automation_id VARCHAR(40) NOT NULL,
      enabled TINYINT NOT NULL DEFAULT 0,
      last_run_at BIGINT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, automation_id)
    ) CHARACTER SET utf8mb4
  `)
  await boot.query(`
    CREATE TABLE IF NOT EXISTS automation_runs (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      automation_id VARCHAR(40) NOT NULL,
      status VARCHAR(10) NOT NULL,
      summary TEXT NULL,
      error VARCHAR(500) NULL,
      created_at BIGINT NOT NULL,
      KEY idx_user_auto_time (user_id, automation_id, created_at)
    ) CHARACTER SET utf8mb4
  `)
  await boot.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      automation_id VARCHAR(40) NULL,
      title VARCHAR(200) NOT NULL,
      body TEXT NULL,
      is_read TINYINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      KEY idx_user_read_time (user_id, is_read, created_at)
    ) CHARACTER SET utf8mb4
  `)
  await boot.end()
}

export async function healthCheck(): Promise<boolean> {
  const [rows] = await pool.query('SELECT 1 AS ok')
  return (rows as Array<{ ok: number }>)[0].ok === 1
}
