/**
 * Agent 全链路集成测试:真实 MySQL(本机 3306)+ 真实服务层 + 真实 8 个工具 + mock GLM。
 * 不覆盖 Express 路由与 Redis 会话(这两层在隧道恢复后的 HTTP E2E 中覆盖)。
 * 运行:node server/test/agent-integration.test.mjs
 * 说明:使用独立数据库 vibeboard_it,测试结束自动 DROP,不影响其他数据。
 */

process.env.MYSQL_HOST = '127.0.0.1'
process.env.MYSQL_PORT = '3306'
process.env.MYSQL_USER = 'root'
process.env.MYSQL_PASSWORD = '123456'
process.env.MYSQL_DATABASE = 'vibeboard_it'
process.env.GLM_API_KEY = 'mock-key'
process.env.AGENT_MAX_STEPS = '8'
process.env.AGENT_TIMEOUT_MS = '5000'

let currentRespond = null
const { createMockGlm } = await import('./mock-glm.mjs')
const server = await createMockGlm((messages) => currentRespond(messages))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
process.env.GLM_BASE_URL = `http://127.0.0.1:${port}`

const { initDb, pool } = await import('../dist/db.js')
const { registerAllTools } = await import('../dist/agent/tools/index.js')
const { listSchemas } = await import('../dist/agent/registry.js')
const { runAgent, getAgentSession } = await import('../dist/agent/harness.js')
const { resolveApproval } = await import('../dist/agent/approvals.js')
const taskService = await import('../dist/services/taskService.js')
const memoryService = await import('../dist/services/memoryService.js')
const projectService = await import('../dist/services/projectService.js')
const modelConfigService = await import('../dist/services/modelConfigService.js')
const { randomUUID } = await import('node:crypto')

registerAllTools()
await initDb()

/* ---------- 断言工具 ---------- */
let passed = 0
function check(name, condition) {
  if (!condition) {
    console.error(`FAIL: ${name}`)
    process.exitCode = 1
  } else {
    passed += 1
    console.log(`PASS: ${name}`)
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/* ---------- 准备用户与数据 ---------- */
const userId = randomUUID()
await pool.execute('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)', [
  userId,
  `it_${Date.now()}`,
  'x:y',
  Date.now(),
])

const project = await projectService.createProject(userId, {
  name: '集成测试项目',
  status: 'developing',
  description: '',
  repo_url: null,
  tech_stack: ['Node'],
  start_date: null,
  due_date: null,
})

const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999)
const t1 = await taskService.createTask(userId, {
  title: '今天最重要的任务',
  description: '集成测试种子数据',
  projectId: project.id,
  priority: 'P1',
  dueDate: todayEnd.getTime(),
})
const t2 = await taskService.createTask(userId, { title: '无优先级任务' })
const t3 = await taskService.createTask(userId, { title: '已完成任务', status: 'done' })

/* ---------- 服务层:细粒度操作 ---------- */
{
  const tasks = await taskService.getTasks(userId)
  check('服务:创建默认进 todo', tasks.filter((t) => t.status === 'todo').length === 2)
  check('服务:priority/dueDate 落库', t1.priority === 'P1' && typeof t1.dueDate === 'number')

  const p0Only = await taskService.getTasks(userId, { priority: 'P1' })
  check('服务:按优先级过滤', p0Only.length === 1 && p0Only[0].id === t1.id)
  const todoOnly = await taskService.getTasks(userId, { status: 'todo' })
  check('服务:按状态过滤', todoOnly.length === 2)
  const projOnly = await taskService.getTasks(userId, { projectId: project.id })
  check('服务:按项目过滤', projOnly.length === 1)

  const patched = await taskService.updateTask(userId, t2.id, { title: '改名后的任务', dueDate: 1757376000000 })
  check('服务:部分更新', patched.title === '改名后的任务' && patched.dueDate === 1757376000000)

  const moved = await taskService.moveTask(userId, t2.id, 'doing')
  check('服务:跨列移动', moved.status === 'doing')

  const bumped = await taskService.updateTaskPriority(userId, t2.id, 'P3')
  check('服务:改优先级', bumped.priority === 'P3')

  let caught404 = false
  try {
    await taskService.getTask(userId, 'no-such-id')
  } catch (err) {
    caught404 = err.status === 404
  }
  check('服务:任务不存在返回 404', caught404)

  let caught400 = false
  try {
    await taskService.updateTaskPriority(userId, t2.id, 'P9')
  } catch (err) {
    caught400 = err.status === 400
  }
  check('服务:非法优先级返回 400', caught400)
}

/* ---------- 服务层:并发写串行化(withBoardLock) ---------- */
{
  const results = await Promise.all(
    [0, 1, 2, 3, 4].map((i) => taskService.updateTaskPriority(userId, t1.id, i % 2 === 0 ? 'P0' : 'P2')),
  )
  check('锁:5 个并发写全部成功', results.length === 5 && results.every((r) => r.id === t1.id))
  const after = await taskService.getTask(userId, t1.id)
  check('锁:终态一致且任务未丢', ['P0', 'P2'].includes(after.priority ?? ''))
}

/* ---------- 服务层:批量/删除/归档(高危操作的业务基座) ---------- */
{
  // 404 原子性:任一任务缺失,整批不执行
  let caught404 = false
  try {
    await taskService.deleteTasks(userId, [t1.id, 'ghost-id'])
  } catch (err) {
    caught404 = err.status === 404
  }
  check('服务:删除含未知任务整批失败', caught404)

  const d1 = await taskService.createTask(userId, { title: '待删除A' })
  const d2 = await taskService.createTask(userId, { title: '待删除B' })
  const del = await taskService.deleteTasks(userId, [d1.id, d2.id])
  check('服务:批量删除成功', del.deleted === 2)
  check('服务:删除后看板不存在', (await taskService.getTasks(userId)).every((t) => t.id !== d1.id && t.id !== d2.id))

  const b1 = await taskService.createTask(userId, { title: '批量A' })
  const b2 = await taskService.createTask(userId, { title: '批量B' })
  const batch = await taskService.batchUpdateTasks(userId, [b1.id, b2.id], { status: 'doing', priority: 'P2' })
  check('服务:批量修改生效', batch.updated === 2)
  const b1After = await taskService.getTask(userId, b1.id)
  check('服务:批量移动+优先级', b1After.status === 'doing' && b1After.priority === 'P2')

  const a1 = await taskService.createTask(userId, { title: '要归档的任务' })
  const arch = await taskService.setTasksArchived(userId, [a1.id], true)
  check('服务:归档移出看板', arch.changed === 1 && !(await taskService.getTasks(userId)).some((t) => t.id === a1.id))
  check('服务:归档列表可见', (await taskService.getArchivedTasks(userId)).some((t) => t.id === a1.id))
  await taskService.restoreTasks(userId, [a1.id])
  check('服务:恢复回原列', (await taskService.getTask(userId, a1.id)).status === 'todo')

  await taskService.setTasksArchived(userId, [a1.id], true)
  check('服务:purge 彻底删除归档任务', (await taskService.purgeTasks(userId, [a1.id])).deleted === 1)
  check('服务:purge 后归档列表为空', !(await taskService.getArchivedTasks(userId)).some((t) => t.id === a1.id))

  // createTasksBatch:数组顺序 = 执行顺序
  let caughtEmpty = false
  try {
    await taskService.createTasksBatch(userId, [])
  } catch (err) {
    caughtEmpty = err.status === 400
  }
  check('服务:空批量创建返回 400', caughtEmpty)
  await taskService.createTasksBatch(userId, [
    { title: '拆解-第一步', priority: 'P0' },
    { title: '拆解-第二步', priority: 'P1' },
    { title: '拆解-第三步', priority: 'P2', status: 'todo' },
  ])
  const planTitles = (await taskService.getTasks(userId, { status: 'todo' }))
    .filter((t) => t.title.startsWith('拆解-'))
    .map((t) => t.title)
  check('服务:批量创建按顺序落库', eq(planTitles, ['拆解-第一步', '拆解-第二步', '拆解-第三步']))
  const firstPlan = await taskService.getTasks(userId).then((ts) => ts.find((t) => t.title === '拆解-第一步'))
  check('服务:批量创建优先级生效', firstPlan?.priority === 'P0')
}

/* ---------- 服务层:任务依赖(谁阻塞谁) ---------- */
{
  const depA = await taskService.createTask(userId, { title: '依赖-A' })
  const depB = await taskService.createTask(userId, { title: '依赖-B' })
  await taskService.setTaskDependencies(userId, depB.id, [depA.id])
  check('依赖:设置前置生效', eq((await taskService.getTask(userId, depB.id)).dependsOn, [depA.id]))
  await taskService.setTaskDependencies(userId, depB.id, [])
  check('依赖:空数组清空前置', (await taskService.getTask(userId, depB.id)).dependsOn.length === 0)

  let selfRef = false
  try {
    await taskService.setTaskDependencies(userId, depB.id, [depB.id])
  } catch (err) {
    selfRef = err.status === 400
  }
  check('依赖:自引用返回 400', selfRef)
  let missing = false
  try {
    await taskService.setTaskDependencies(userId, depB.id, ['ghost-id'])
  } catch (err) {
    missing = err.status === 404
  }
  check('依赖:前置缺失返回 404', missing)

  // 两节点环:先把 A 的前置设为 B,再让 B 前置为 A → 成环拒绝
  await taskService.setTaskDependencies(userId, depA.id, [depB.id])
  let cycle = false
  try {
    await taskService.setTaskDependencies(userId, depB.id, [depA.id])
  } catch (err) {
    cycle = err.status === 400
  }
  check('依赖:两节点环返回 400', cycle)
  await taskService.setTaskDependencies(userId, depA.id, [])

  // createTasksBatch:dependsOn 下标解析(仅可指向更早项)
  const depPlan = await taskService.createTasksBatch(userId, [
    { title: '拆解-依赖源' },
    { title: '拆解-被阻塞', dependsOn: [0] },
  ])
  check('依赖:createTasks 下标解析为真实 id', eq(depPlan.tasks[1].dependsOn, [depPlan.tasks[0].id]))
  let forward = false
  try {
    await taskService.createTasksBatch(userId, [{ title: 'x', dependsOn: [1] }])
  } catch (err) {
    forward = err.status === 400
  }
  check('依赖:下标只能指向更早项', forward)

  // 悬挂清理:删除/归档阻塞任务后,引用被剔除
  await taskService.setTaskDependencies(userId, depB.id, [depA.id])
  await taskService.deleteTasks(userId, [depA.id])
  check('依赖:删除后悬挂引用清理', (await taskService.getTask(userId, depB.id)).dependsOn.length === 0)
  await taskService.setTaskDependencies(userId, depB.id, [depPlan.tasks[0].id])
  await taskService.setTasksArchived(userId, [depPlan.tasks[0].id], true)
  check('依赖:归档后悬挂引用清理', (await taskService.getTask(userId, depB.id)).dependsOn.length === 0)

  // saveBoard 兜底(客户端全量保存路径是该路径唯一的依赖校验点):环拒绝 + 悬挂/自引用剔除
  const board = await import('../dist/board.js')
  const COLUMN_IDS = ['todo', 'doing', 'done']
  const cyc1 = await taskService.createTask(userId, { title: '环-A' })
  const cyc2 = await taskService.createTask(userId, { title: '环-B' })
  await taskService.setTaskDependencies(userId, cyc2.id, [cyc1.id])
  const cyclic = await board.getBoard(userId)
  for (const col of COLUMN_IDS) {
    for (const t of cyclic.state[col]) {
      if (t.id === cyc1.id) t.dependsOn = [cyc2.id]
    }
  }
  let cyclePut = false
  try {
    await board.saveBoard(userId, cyclic.state)
  } catch (err) {
    cyclePut = err.status === 400
  }
  check('依赖:客户端全量保存拒绝循环', cyclePut)
  const dangling = await board.getBoard(userId)
  for (const col of COLUMN_IDS) {
    for (const t of dangling.state[col]) {
      if (t.id === cyc2.id) t.dependsOn = [cyc2.id, cyc1.id, 'ghost-id']
    }
  }
  await board.saveBoard(userId, dangling.state)
  check(
    '依赖:全量保存剔除自引用与悬挂引用',
    eq((await taskService.getTask(userId, cyc2.id)).dependsOn, [cyc1.id]),
  )
}

/* ---------- 模型配置服务(用户自配 > .env 回退) ---------- */
{
  await modelConfigService.saveModelConfig(userId, {
    provider: 'deepseek',
    model: 'deepseek-chat',
    apiKey: 'sk-test-1234567890',
  })
  const resolved = await modelConfigService.resolveModelConfig(userId)
  check(
    '模型配置:保存后按用户解析生效',
    resolved?.source === 'user' &&
      resolved.provider === 'deepseek' &&
      resolved.model === 'deepseek-chat' &&
      resolved.apiKey === 'sk-test-1234567890' &&
      resolved.baseUrl.includes('deepseek'),
  )

  let caught = false
  try {
    await modelConfigService.saveModelConfig(userId, { provider: 'zhipu', model: 'glm-4.6' })
  } catch (err) {
    caught = err.status === 400
  }
  check('模型配置:该供应商无存 key 且未填 key 返回 400', caught)

  let caughtProvider = false
  try {
    await modelConfigService.saveModelConfig(userId, { provider: 'nope', model: 'x', apiKey: 'sk-abcdefgh' })
  } catch (err) {
    caughtProvider = err.status === 400
  }
  check('模型配置:目录外供应商返回 400', caughtProvider)

  await modelConfigService.saveModelConfig(userId, { provider: 'deepseek', model: 'deepseek-chat' })
  const info = await modelConfigService.getAgentModelsInfo(userId)
  check(
    '模型配置:不填 key 保存复用已存密钥',
    info.active?.provider === 'deepseek' && info.configured.deepseek.keyHint.startsWith('sk-t'),
  )

  await modelConfigService.deleteModelConfig(userId, 'deepseek')
  const resolvedAfterDelete = await modelConfigService.resolveModelConfig(userId)
  check(
    '模型配置:删除后回退 .env(测试环境有 mock key → env)',
    resolvedAfterDelete?.source === 'env' && resolvedAfterDelete.apiKey === 'mock-key',
  )
}

/* ---------- Agent × mock GLM:Case 1 只读 ---------- */
{
  const before = (await taskService.getTasks(userId)).map((t) => [t.id, t.status, t.priority, t.updatedAt])
  currentRespond = (messages) => {
    const round = messages.filter((m) => m.role === 'tool').length
    if (round === 0) return { toolCalls: [{ name: 'getTasks', arguments: '{}' }] }
    return { content: '最重要的任务:「今天最重要的任务」(P1,今天截止)。' }
  }
  const result = await runAgent(userId, '告诉我今天有哪些任务最重要')
  check('Case1 状态 COMPLETED', result.status === 'COMPLETED')
  check('Case1 仅使用了只读工具', result.actions.length > 0 && result.actions.every((a) => a.tool.startsWith('get')))
  const after = (await taskService.getTasks(userId)).map((t) => [t.id, t.status, t.priority, t.updatedAt])
  check('Case1 数据零改动', eq(before, after))
}

/* ---------- Agent × mock GLM:Case 2 改优先级并复核 ---------- */
{
  let pickedId = ''
  let pickedTitle = ''
  currentRespond = (messages) => {
    const round = messages.filter((m) => m.role === 'tool').length
    if (round === 0) return { toolCalls: [{ name: 'getTasks', arguments: '{}' }] }
    const last = JSON.parse(messages.filter((m) => m.role === 'tool').at(-1).content)
    if (round === 1) {
      const candidates = last.tasks.filter((t) => t.status !== 'done' && t.dueDate)
      candidates.sort((a, b) => a.dueDate - b.dueDate)
      pickedId = candidates[0].id
      pickedTitle = candidates[0].title
      return {
        toolCalls: [
          { name: 'updateTaskPriority', arguments: JSON.stringify({ taskId: pickedId, priority: 'P0' }) },
        ],
      }
    }
    if (round === 2) {
      return { toolCalls: [{ name: 'getTask', arguments: JSON.stringify({ taskId: pickedId }) }] }
    }
    return { content: `已把「${pickedTitle}」调整为 P0,并复核确认生效。` }
  }
  const result = await runAgent(userId, '把今天最重要的任务调整为 P0')
  check('Case2 状态 COMPLETED', result.status === 'COMPLETED')
  check('Case2 全部工具调用成功', result.actions.every((a) => a.ok))
  const task = await taskService.getTask(userId, pickedId)
  check('Case2 数据库中优先级已变更', task.priority === 'P0')
}

/* ---------- Agent × mock GLM:Case 4 无删除工具,如实说明 ---------- */
{
  const names = listSchemas().map((s) => s.function.name)
  check('Case4 注册表中没有 deleteTask', !names.includes('deleteTask'))
  const before = (await taskService.getTasks(userId)).length
  currentRespond = () => ({ content: '当前版本没有删除类工具,我无法删除任务。可以帮你把已完成任务移到 done 列。' })
  const result = await runAgent(userId, '删除所有已经完成的任务')
  check('Case4 状态 COMPLETED 且未假装成功', result.status === 'COMPLETED' && result.actions.length === 0)
  check('Case4 任务数量未减少', (await taskService.getTasks(userId)).length === before)
  const doneTask = await taskService.getTask(userId, t3.id)
  check('Case4 已完成任务仍原样存在', doneTask.title === '已完成任务' && doneTask.status === 'done')
}

/* ---------- Agent × mock GLM:Case 5 工具失败 → 自纠 ---------- */
{
  currentRespond = (messages) => {
    const round = messages.filter((m) => m.role === 'tool').length
    if (round === 0) {
      return {
        toolCalls: [{ name: 'updateTaskPriority', arguments: JSON.stringify({ taskId: 'ghost-id', priority: 'P0' }) }],
      }
    }
    if (round === 1) return { toolCalls: [{ name: 'getTasks', arguments: '{}' }] }
    const last = JSON.parse(messages.filter((m) => m.role === 'tool').at(-1).content)
    const target = last.tasks.find((t) => t.id === t2.id)
    return {
      toolCalls: [
        { name: 'updateTaskPriority', arguments: JSON.stringify({ taskId: target.id, priority: 'P2' }) },
      ],
    }
  }
  // 第 4 轮给最终回答
  const rawRespond = currentRespond
  currentRespond = (messages) => {
    const round = messages.filter((m) => m.role === 'tool').length
    if (round >= 3) return { content: '第一次用了不存在的 id,重新查询后已完成调整。' }
    return rawRespond(messages)
  }
  const result = await runAgent(userId, '把无优先级任务调成 P2')
  check('Case5 状态 COMPLETED', result.status === 'COMPLETED')
  check('Case5 首次失败被回填', result.actions[0].ok === false)
  check('Case5 自纠后成功', result.actions.at(-1).ok === true)
  const updated = await taskService.getTask(userId, t2.id)
  check('Case5 数据库已变更', updated.priority === 'P2')
}

/* ---------- Agent × mock GLM:Case 6 执行步骤事件含真实目标(可视化) ---------- */
{
  currentRespond = (messages) => {
    const round = messages.filter((m) => m.role === 'tool').length
    if (round === 0) return { toolCalls: [{ name: 'getTasks', arguments: '{}' }] }
    const last = JSON.parse(messages.filter((m) => m.role === 'tool').at(-1).content)
    if (round === 1) {
      const target = last.tasks.find((t) => t.id === t2.id)
      return { toolCalls: [{ name: 'moveTask', arguments: JSON.stringify({ taskId: target.id, toStatus: 'done' }) }] }
    }
    return { content: '已把「改名后的任务」移到 done 列。' }
  }
  const events = []
  const result = await runAgent(userId, '把改名后的任务移到 done', { onEvent: (e) => events.push(e) })
  check('Case6 状态 COMPLETED', result.status === 'COMPLETED')
  const toolEvents = events.filter((e) => e.type === 'tool')
  check('Case6 getTasks 步骤带条数摘要', /读取任务\(\d+ 条\)/.test(toolEvents[0]?.label ?? ''))
  check(
    'Case6 moveTask 步骤带标题与目标列',
    toolEvents[1]?.label.includes('改名后的任务') && toolEvents[1].label.includes('Done'),
  )
  check('Case6 数据库已移动', (await taskService.getTask(userId, t2.id)).status === 'done')
}

/* ---------- Agent × mock GLM:Case 7 删除任务(审批通过后真删) ---------- */
{
  const victim = await taskService.createTask(userId, { title: '将被 Agent 删除的任务' })
  currentRespond = (messages) => {
    const round = messages.filter((m) => m.role === 'tool').length
    if (round === 0) {
      return { toolCalls: [{ name: 'deleteTasks', arguments: JSON.stringify({ taskIds: [victim.id] }) }] }
    }
    return { content: '已在用户确认后删除该任务。' }
  }
  const events = []
  const runPromise = runAgent(userId, '删除那条测试任务', { onEvent: (e) => events.push(e) })
  let approval = null
  for (let i = 0; i < 500 && !approval; i += 1) {
    approval = events.find((e) => e.type === 'approval') ?? null
    if (!approval) await new Promise((resolve) => setTimeout(resolve, 10))
  }
  check(
    'Case7 收到审批请求且带任务预览',
    !!approval && approval.tasks.length === 1 && approval.tasks[0].title === '将被 Agent 删除的任务',
  )
  check('Case7 审批提交被接受', resolveApproval(approval.sessionId, approval.requestId, true) === true)
  const result = await runPromise
  check('Case7 状态 COMPLETED', result.status === 'COMPLETED')
  let gone = false
  try {
    await taskService.getTask(userId, victim.id)
  } catch (err) {
    gone = err.status === 404
  }
  check('Case7 数据库中任务已删除', gone)
}

/* ---------- Agent × mock GLM:Case 8 归档被拒绝则不执行 ---------- */
{
  const keep = await taskService.createTask(userId, { title: '不许归档的任务' })
  currentRespond = (messages) => {
    const round = messages.filter((m) => m.role === 'tool').length
    if (round === 0) {
      return { toolCalls: [{ name: 'archiveTasks', arguments: JSON.stringify({ taskIds: [keep.id] }) }] }
    }
    return { content: '用户拒绝了这个操作,我没有执行归档。' }
  }
  const events = []
  const runPromise = runAgent(userId, '归档那条任务', { onEvent: (e) => events.push(e) })
  let approval = null
  for (let i = 0; i < 500 && !approval; i += 1) {
    approval = events.find((e) => e.type === 'approval') ?? null
    if (!approval) await new Promise((resolve) => setTimeout(resolve, 10))
  }
  resolveApproval(approval.sessionId, approval.requestId, false)
  const result = await runPromise
  check('Case8 状态 COMPLETED', result.status === 'COMPLETED')
  const toolEv = events.find((e) => e.type === 'tool')
  check('Case8 拒绝以失败步骤回填', toolEv?.ok === false && String(toolEv.error).includes('拒绝'))
  check('Case8 任务未被归档', (await taskService.getTask(userId, keep.id)).status === 'todo')
}

/* ---------- Agent × mock GLM:Case 9 目标拆解(createTasks 审批后按顺序创建) ---------- */
{
  currentRespond = (messages) => {
    const round = messages.filter((m) => m.role === 'tool').length
    if (round === 0) {
      return {
        toolCalls: [
          {
            name: 'createTasks',
            arguments: JSON.stringify({
              tasks: [
                { title: '定主题与大纲', priority: 'P1' },
                { title: '制作演示文稿', priority: 'P1' },
                { title: '排练并计时', priority: 'P2' },
              ],
            }),
          },
        ],
      }
    }
    return { content: '已按执行顺序创建 3 个任务。' }
  }
  const events = []
  const runPromise = runAgent(userId, '帮我拆解:准备一次技术分享', { onEvent: (e) => events.push(e) })
  let approval = null
  for (let i = 0; i < 500 && !approval; i += 1) {
    approval = events.find((e) => e.type === 'approval') ?? null
    if (!approval) await new Promise((resolve) => setTimeout(resolve, 10))
  }
  check('Case9 审批预览为编号计划', approval?.tasks.length === 3 && approval.tasks[0].title.startsWith('1.'))
  check('Case9 审批提交被接受', resolveApproval(approval.sessionId, approval.requestId, true) === true)
  const result = await runPromise
  check('Case9 状态 COMPLETED', result.status === 'COMPLETED')
  const planTitles = (await taskService.getTasks(userId, { status: 'todo' }))
    .filter((t) => ['定主题与大纲', '制作演示文稿', '排练并计时'].includes(t.title))
    .map((t) => t.title)
  check('Case9 任务按执行顺序创建', eq(planTitles, ['定主题与大纲', '制作演示文稿', '排练并计时']))
  const toolEv = events.find((e) => e.type === 'tool' && e.name === 'createTasks')
  check('Case9 步骤 label 含创建数', /创建 3 个任务/.test(toolEv?.label ?? ''))
}

/* ---------- Agent × mock GLM:Case 10/11 长期偏好记忆 ---------- */
{
  const m1 = await memoryService.addMemory(userId, '工作时间 9:00-19:00,周末不安排任务')
  await memoryService.addMemory(userId, '技术分享类任务习惯拆成 定题→做PPT→排练')
  const dup = await memoryService.addMemory(userId, ' 工作时间 9:00-19:00,周末不安排任务 ')
  check('记忆:同内容幂等', dup.id === m1.id)
  check('记忆:列表至少两条', (await memoryService.listMemories(userId)).length >= 2)
  let caught404 = false
  try {
    await memoryService.deleteMemory(userId, 'ghost-id')
  } catch (err) {
    caught404 = err.status === 404
  }
  check('记忆:删除不存在返回 404', caught404)

  // 注入:system 提示携带记忆文本
  currentRespond = () => ({ content: '好的。' })
  const injected = await runAgent(userId, '在吗')
  const session = getAgentSession(injected.sessionId, userId)
  check(
    '记忆:偏好已注入系统提示',
    typeof session?.messages[0]?.content === 'string' && session.messages[0].content.includes('工作时间 9:00-19:00'),
  )

  // Case 10:用户要求记住 → rememberPreference 落库
  currentRespond = (messages) => {
    const round = messages.filter((m) => m.role === 'tool').length
    if (round === 0) {
      return {
        toolCalls: [
          { name: 'rememberPreference', arguments: JSON.stringify({ content: '我习惯早上写代码,下午做评审' }) },
        ],
      }
    }
    return { content: '已记住你的工作习惯。' }
  }
  const events = []
  const r10 = await runAgent(userId, '记住:我习惯早上写代码,下午做评审', { onEvent: (e) => events.push(e) })
  check('Case10 状态 COMPLETED', r10.status === 'COMPLETED')
  check('Case10 记忆已落库', (await memoryService.listMemories(userId)).some((m) => m.content.includes('早上写代码')))
  const toolEv10 = events.find((e) => e.type === 'tool')
  check('Case10 步骤 label 为记住偏好', typeof toolEv10?.label === 'string' && toolEv10.label.startsWith('记住偏好「'))

  // Case 11:忘掉 → 行消失
  const target = (await memoryService.listMemories(userId)).find((m) => m.content.includes('早上写代码'))
  currentRespond = (messages) => {
    const round = messages.filter((m) => m.role === 'tool').length
    if (round === 0) {
      return { toolCalls: [{ name: 'forgetPreference', arguments: JSON.stringify({ memoryId: target.id }) }] }
    }
    return { content: '已忘掉这条偏好。' }
  }
  const r11 = await runAgent(userId, '忘掉工作习惯那条')
  check('Case11 状态 COMPLETED', r11.status === 'COMPLETED')
  check('Case11 记忆已删除', !(await memoryService.listMemories(userId)).some((m) => m.content.includes('早上写代码')))
}

/* ---------- Agent × mock GLM:Case 12 依赖设置(审批后落库) ---------- */
{
  const blocker = await taskService.createTask(userId, { title: '阻塞源任务' })
  const dependent = await taskService.createTask(userId, { title: '被阻塞任务' })
  currentRespond = (messages) => {
    const round = messages.filter((m) => m.role === 'tool').length
    if (round === 0) {
      return {
        toolCalls: [
          {
            name: 'setTaskDependencies',
            arguments: JSON.stringify({ taskId: dependent.id, dependsOn: [blocker.id] }),
          },
        ],
      }
    }
    return { content: '已设置:阻塞源任务完成前,被阻塞任务处于被阻塞状态。' }
  }
  const events = []
  const runPromise = runAgent(userId, '让被阻塞任务依赖阻塞源任务', { onEvent: (e) => events.push(e) })
  let approval = null
  for (let i = 0; i < 500 && !approval; i += 1) {
    approval = events.find((e) => e.type === 'approval') ?? null
    if (!approval) await new Promise((resolve) => setTimeout(resolve, 10))
  }
  check(
    'Case12 审批预览含阻塞关系',
    approval?.tasks.length === 2 && approval.tasks.some((t) => t.title.includes('阻塞源任务')) ||
      (console.error('Case12 DEBUG approval =', JSON.stringify(approval), '| result =', JSON.stringify(await runPromise.catch((e) => e.message))), false),
  )
  check('Case12 审批提交被接受', resolveApproval(approval.sessionId, approval.requestId, true) === true)
  await runPromise
  check('Case12 依赖已落库', eq((await taskService.getTask(userId, dependent.id)).dependsOn, [blocker.id]))
  check(
    'Case12 getTasks 返回 dependsOn',
    eq((await taskService.getTasks(userId)).find((t) => t.id === dependent.id)?.dependsOn, [blocker.id]),
  )
}

/* ---------- 清理 ---------- */
await pool.query('DROP DATABASE IF EXISTS vibeboard_it')
await pool.end()
server.close()
console.log(`\n${passed} checks passed${process.exitCode ? '(含失败项)' : ''}`)
process.exit(process.exitCode ?? 0)
