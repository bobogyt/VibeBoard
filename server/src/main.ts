import 'reflect-metadata'
import cluster from 'node:cluster'
import express from 'express'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { initDb } from './db'
import { GlobalExceptionFilter } from './http/global-exception.filter'
import { registerAllTools } from './agent/tools'
import { initAutomationScheduler } from './automation/scheduler'

const PORT = Number(process.env.PORT || 3000)
// 多进程并发:WEB_WORKERS=N(N>1)时启用 Node cluster;默认 1 = 单进程,行为不变。
// 跨进程状态(限速计数/单运行锁/审批投递)由 Redis 承载,Redis 不可用时各 worker 自动退化为进程内。
const WORKERS = Math.max(1, Number(process.env.WEB_WORKERS || 1))

async function bootstrap(): Promise<void> {
  try {
    await initDb()
    console.log(`[db] MySQL connected, schema ready (pid=${process.pid})`)
  } catch (err) {
    console.error('[db] MySQL 初始化失败:', (err as { code?: string; message?: string }).code || (err as Error).message)
    console.error('[db] 请检查 server/.env 中的数据库配置,以及服务器防火墙/安全组是否放行数据端口')
    process.exit(1)
  }

  // Agent 工具注册表:进程内一次性注册(READ/SAFE_WRITE/HIGH_RISK 共 16 个)
  registerAllTools()
  // 自动化调度器:所有 worker 参与选主,仅持有 Redis 锁的进程触发定时任务
  initAutomationScheduler()

  const app = await NestFactory.create(AppModule, { bodyParser: false })
  // 关闭 Nest 默认 body parser,沿用原 1mb JSON 限制
  app.use(express.json({ limit: '1mb' }))
  app.setGlobalPrefix('api')
  app.useGlobalFilters(new GlobalExceptionFilter())

  await app.listen(PORT)
  console.log(`[server] VibeBoard API listening on http://localhost:${PORT} (pid=${process.pid}, worker=${cluster.isPrimary ? 'primary' : 'child'})`)
}

if (WORKERS > 1 && cluster.isPrimary) {
  console.log(`[server] cluster primary pid=${process.pid}, forking ${WORKERS} workers`)
  for (let i = 0; i < WORKERS; i++) cluster.fork()
  // worker 崩溃自动拉起,保持并发能力不缩水
  cluster.on('exit', (worker, code, signal) => {
    console.warn(`[server] worker ${worker.process.pid} exited (${signal || code}), respawning`)
    cluster.fork()
  })
} else {
  bootstrap()
}
