import express from 'express'
import { initDb, healthCheck } from './db.js'
import { redisStatus } from './cache.js'
import {
  register,
  login,
  logout,
  me,
  requireAuth,
  loginKeyLimiter,
  loginIpLimiter,
  registerLimiter,
} from './auth.js'
import { getBoard, saveBoard, withBoardLock } from './board.js'
import { listProjects, createProject, updateProject, deleteProject } from './services/projectService.js'
import { getArchivedTasks, restoreTasks, purgeTasks } from './services/taskService.js'
import { listMemories, addMemory, deleteMemory } from './services/memoryService.js'
import { getAgentModelsInfo, saveModelConfig, deleteModelConfig } from './services/modelConfigService.js'
import { runAgent, getAgentSession } from './agent/index.js'
import { resolveApproval } from './agent/approvals.js'
import { createRateLimiter } from './util/rateLimit.js'

const PORT = Number(process.env.PORT || 3000)

const app = express()
app.use(express.json({ limit: '1mb' }))

// async 处理器的错误统一转发到错误中间件
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

app.get('/api/health', wrap(async (_req, res) => {
  const mysql = await healthCheck()
  res.json({ mysql, redis: redisStatus() })
}))

app.post('/api/auth/register', registerLimiter, wrap(register))
app.post('/api/auth/login', loginIpLimiter, loginKeyLimiter, wrap(login))
app.post('/api/auth/logout', wrap(logout))
app.get('/api/auth/me', requireAuth, wrap(me))

// Agent:按用户每小时 20 次(GLM 调用有成本);run 内部还有单用户单运行会话守卫
const agentLimiter = createRateLimiter({
  windowMs: 60 * 60_000,
  max: 20,
  keyOf: (req) => String(req.userId),
})

app.get('/api/agent/models', requireAuth, wrap(async (req, res) => {
  res.json(await getAgentModelsInfo(req.userId))
}))

app.put('/api/agent/models', requireAuth, wrap(async (req, res) => {
  await saveModelConfig(req.userId, req.body ?? {})
  res.json(await getAgentModelsInfo(req.userId))
}))

app.delete('/api/agent/models/:provider', requireAuth, wrap(async (req, res) => {
  await deleteModelConfig(req.userId, req.params.provider)
  res.json(await getAgentModelsInfo(req.userId))
}))

app.post('/api/agent/run', requireAuth, agentLimiter, wrap(async (req, res) => {
  res.json(await runAgent(req.userId, req.body?.message))
}))

// 流式执行:SSE 逐工具步骤推送可视化事件(label 级,不含推理内容与原始参数)。
// 首个事件发出前的错误(未配置模型 503、运行中 409、限流 429 等)仍在
// 响应头写出之前抛出,照常走统一错误中间件返回 JSON;运行本身的失败由 final 事件表达。
app.post('/api/agent/run/stream', requireAuth, agentLimiter, wrap(async (req, res) => {
  let opened = false
  let ping = null
  const open = () => {
    if (opened) return
    opened = true
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.flushHeaders?.()
    // 长模型调用期间定期发注释帧,防止中间代理因空闲断链
    ping = setInterval(() => res.write(': ping\n\n'), 15_000)
  }
  try {
    await runAgent(req.userId, req.body?.message, {
      onEvent: (event) => {
        open()
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      },
    })
  } finally {
    if (ping) clearInterval(ping)
  }
  res.end()
}))

app.get('/api/agent/sessions/:id', requireAuth, wrap(async (req, res) => {
  const session = getAgentSession(req.params.id, req.userId)
  if (!session) return res.status(404).json({ error: '会话不存在' })
  res.json({ session })
}))

// 高危操作人工确认:仅会话属主可审批;不在等待中(已处理/已超时)返回 409
app.post('/api/agent/sessions/:id/approval', requireAuth, wrap(async (req, res) => {
  const session = getAgentSession(req.params.id, req.userId)
  if (!session) return res.status(404).json({ error: '会话不存在' })
  const { requestId, approved } = req.body ?? {}
  if (typeof requestId !== 'string' || typeof approved !== 'boolean') {
    return res.status(400).json({ error: 'requestId 与 approved 必填' })
  }
  const ok = resolveApproval(req.params.id, requestId, approved)
  if (!ok) return res.status(409).json({ error: '该请求不在等待确认' })
  res.json({ ok: true })
}))

app.get('/api/board', requireAuth, wrap(async (req, res) => {
  const { state, cacheHit } = await getBoard(req.userId)
  console.log(`[board] GET user=${req.userId} cache=${cacheHit ? 'HIT' : 'MISS'}`)
  res.json({ columns: state })
}))

app.put('/api/board', requireAuth, wrap(async (req, res) => {
  // 与 Agent 的读-改-写共用用户级锁,防止全量保存互相覆盖
  await withBoardLock(req.userId, () => saveBoard(req.userId, req.body))
  res.json({ ok: true })
}))

app.get('/api/projects', requireAuth, wrap(async (req, res) => {
  res.json({ projects: await listProjects(req.userId) })
}))
app.post('/api/projects', requireAuth, wrap(async (req, res) => {
  res.json({ project: await createProject(req.userId, req.body) })
}))
app.put('/api/projects/:id', requireAuth, wrap(async (req, res) => {
  res.json({ project: await updateProject(req.userId, req.params.id, req.body) })
}))
app.delete('/api/projects/:id', requireAuth, wrap(async (req, res) => {
  res.json(await deleteProject(req.userId, req.params.id))
}))

// 归档:列表 / 恢复 / 彻底删除(仅针对 archived=1 的行)
app.get('/api/tasks/archived', requireAuth, wrap(async (req, res) => {
  res.json({ tasks: await getArchivedTasks(req.userId) })
}))
app.post('/api/tasks/restore', requireAuth, wrap(async (req, res) => {
  res.json(await restoreTasks(req.userId, req.body?.taskIds))
}))
app.post('/api/tasks/purge', requireAuth, wrap(async (req, res) => {
  res.json(await purgeTasks(req.userId, req.body?.taskIds))
}))

// 长期偏好记忆:列表 / 手动添加 / 删除
app.get('/api/memories', requireAuth, wrap(async (req, res) => {
  res.json({ memories: await listMemories(req.userId) })
}))
app.post('/api/memories', requireAuth, wrap(async (req, res) => {
  res.json({ memory: await addMemory(req.userId, req.body?.content) })
}))
app.delete('/api/memories/:id', requireAuth, wrap(async (req, res) => {
  res.json(await deleteMemory(req.userId, req.params.id))
}))

app.use((_req, res) => res.status(404).json({ error: 'Not Found' }))

app.use((err, _req, res, _next) => {
  const status = err.status ?? 500
  // 500 = 未预期错误打全堆栈;502/503/504 等上游/配置类问题只记一行
  if (status === 500) console.error('[server]', err)
  else if (status > 500) console.warn(`[server] ${status}:`, err.message)
  res.status(status).json({ error: err.status ? err.message : '服务器内部错误' })
})

async function main() {
  try {
    await initDb()
    console.log('[db] MySQL connected, schema ready')
  } catch (err) {
    console.error('[db] MySQL 初始化失败:', err.code || err.message)
    console.error('[db] 请检查 server/.env 中的数据库配置,以及服务器防火墙/安全组是否放行数据端口')
    process.exit(1)
  }
  app.listen(PORT, () => console.log(`[server] VibeBoard API listening on http://localhost:${PORT}`))
}

main()
