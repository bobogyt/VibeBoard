import 'reflect-metadata'
import cluster from 'node:cluster'
import express, { type Request, type Response, type NextFunction } from 'express'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { initDb } from './db'
import { GlobalExceptionFilter } from './http/global-exception.filter'
import { bodyContainsReplacementChar } from './http/encoding-guard'
import { registerAllTools } from './agent/tools'
import { initAutomationScheduler } from './automation/scheduler'
import { createRateLimiter } from './util/rateLimit'
import { redis } from './cache'

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
  // 安全响应头(API 服务最小集)
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    next()
  })
  // 全局洪泛限速:每 IP 240 次/分钟(路由级限速之外的最后防线;限速器故障时放行,不影响可用性)
  const globalLimiter = createRateLimiter({ windowMs: 60_000, max: 240, prefix: 'global', redis })
  app.use((req: Request, res: Response, next: NextFunction) => {
    void globalLimiter
      .tryTake(String(req.ip))
      .then((ok) => (ok ? next() : res.status(429).json({ error: '请求过于频繁,请稍后再试' })))
      .catch(() => next())
  })
  // 编码防护:请求体含 U+FFFD 替换符 = 字节流已被错误解码,直接拒绝,防止乱码静默入库
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.body !== undefined && bodyContainsReplacementChar(req.body)) {
      return res.status(400).json({ error: '请求包含无效编码字符(U+FFFD),请检查客户端编码' })
    }
    next()
  })
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
