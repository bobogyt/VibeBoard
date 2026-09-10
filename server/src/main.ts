import 'reflect-metadata'
import express from 'express'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { initDb } from './db'
import { GlobalExceptionFilter } from './http/global-exception.filter'
import { registerAllTools } from './agent/tools'

const PORT = Number(process.env.PORT || 3000)

async function bootstrap(): Promise<void> {
  try {
    await initDb()
    console.log('[db] MySQL connected, schema ready')
  } catch (err) {
    console.error('[db] MySQL 初始化失败:', (err as { code?: string; message?: string }).code || (err as Error).message)
    console.error('[db] 请检查 server/.env 中的数据库配置,以及服务器防火墙/安全组是否放行数据端口')
    process.exit(1)
  }

  // Agent 工具注册表:进程内一次性注册(READ/SAFE_WRITE/HIGH_RISK 共 16 个)
  registerAllTools()

  const app = await NestFactory.create(AppModule, { bodyParser: false })
  // 关闭 Nest 默认 body parser,沿用原 1mb JSON 限制
  app.use(express.json({ limit: '1mb' }))
  app.setGlobalPrefix('api')
  app.useGlobalFilters(new GlobalExceptionFilter())

  await app.listen(PORT)
  console.log(`[server] VibeBoard API listening on http://localhost:${PORT}`)
}

bootstrap()
