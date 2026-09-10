import mysql from 'mysql2/promise'

const {
  MYSQL_HOST = '127.0.0.1',
  MYSQL_PORT = '3306',
  MYSQL_USER = 'root',
  MYSQL_PASSWORD = '',
  MYSQL_DATABASE = 'vibeboard',
} = process.env

export const pool = mysql.createPool({
  host: MYSQL_HOST,
  port: Number(MYSQL_PORT),
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: false,
})

/** 优先直连目标库;库不存在时再回退到建库流程(受限账号场景下库由管理员预先建好) */
export async function initDb() {
  let boot
  try {
    boot = await mysql.createConnection({
      host: MYSQL_HOST,
      port: Number(MYSQL_PORT),
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      database: MYSQL_DATABASE,
    })
  } catch (err) {
    if (err.code !== 'ER_BAD_DB_ERROR') throw err
    boot = await mysql.createConnection({
      host: MYSQL_HOST,
      port: Number(MYSQL_PORT),
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
    })
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
  if (cols.length === 0) {
    await boot.query('ALTER TABLE tasks ADD COLUMN project_id CHAR(36) NULL, ADD KEY idx_project (project_id)')
  }
  // 存量库的 tasks 表补 Agent 相关列(优先级/截止时间);并发启动可能撞列,列已存在即视为成功
  const [taskCols] = await boot.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tasks'`,
    [MYSQL_DATABASE],
  )
  const taskColNames = new Set(taskCols.map((r) => r.COLUMN_NAME))
  if (!taskColNames.has('priority')) {
    await boot.query('ALTER TABLE tasks ADD COLUMN priority VARCHAR(4) NULL').catch((err) => {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err
    })
  }
  if (!taskColNames.has('due_date')) {
    await boot.query('ALTER TABLE tasks ADD COLUMN due_date BIGINT NULL').catch((err) => {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err
    })
  }
  // 存量库的 tasks 表补 archived 列(归档功能;看板与缓存只含未归档任务)
  if (!taskColNames.has('archived')) {
    await boot.query('ALTER TABLE tasks ADD COLUMN archived TINYINT NOT NULL DEFAULT 0').catch((err) => {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err
    })
  }
  // 存量库的 tasks 表补 depends_on 列(任务前置依赖,JSON 字符串数组)
  if (!taskColNames.has('depends_on')) {
    await boot.query('ALTER TABLE tasks ADD COLUMN depends_on TEXT NULL').catch((err) => {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err
    })
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
  await boot.end()
}

export async function healthCheck() {
  const [row] = await pool.query('SELECT 1 AS ok')
  return row[0].ok === 1
}
