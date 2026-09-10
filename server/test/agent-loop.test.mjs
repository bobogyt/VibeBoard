/**
 * Agent Loop 纯机制验证(不依赖 MySQL/Redis):
 * 用内存 mock 工具 + mock GLM 覆盖:正常多轮调用、错误回填自纠、非法 JSON 参数、
 * 未知工具、重复失败守卫、步数耗尽收尾。运行:node server/test/agent-loop.test.mjs
 */

// 必须在动态 import 业务模块前设置,config.js 在模块加载时读取 env
process.env.GLM_API_KEY = 'mock-key'
process.env.AGENT_MAX_STEPS = '4'
process.env.AGENT_TIMEOUT_MS = '5000'
process.env.AGENT_APPROVAL_TIMEOUT_MS = '800'

let currentRespond = null
const { createMockGlm } = await import('./mock-glm.mjs')
const server = await createMockGlm((messages) => currentRespond(messages))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
process.env.GLM_BASE_URL = `http://127.0.0.1:${port}`

const { registerTool } = await import('../dist/agent/registry.js')
const { runAgent } = await import('../dist/agent/harness.js')
const { resolveApproval } = await import('../dist/agent/approvals.js')

/* ---------- 内存数据源 + 两个测试工具 ---------- */
const store = [{ id: 't1', title: '写周报', status: 'todo', priority: null }]
let writeCount = 0
const destroyed = []
const planned = []
const memories = []

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 轮询等待审批事件出现 */
async function waitForApproval(events, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = events.find((e) => e.type === 'approval')
    if (found) return found
    if (Date.now() > deadline) throw new Error('审批事件未出现')
    await sleep(10)
  }
}

registerTool({
  name: 'listData',
  risk: 'READ',
  description: '列出任务',
  parameters: { type: 'object', properties: {} },
  validate: () => null,
  async execute() {
    return { count: store.length, titles: store.map((t) => `${t.title}(${t.priority ?? '无优先级'})`) }
  },
})
registerTool({
  name: 'writeData',
  risk: 'SAFE_WRITE',
  description: '设置优先级',
  parameters: { type: 'object', properties: { id: { type: 'string' }, priority: { type: 'string' } } },
  validate(args) {
    if (typeof args.id !== 'string' || args.id.length === 0) return 'id 必填'
    return null
  },
  async execute(args) {
    const task = store.find((t) => t.id === args.id)
    if (!task) throw Object.assign(new Error(`任务 ${args.id} 不存在`), { status: 404 })
    task.priority = args.priority ?? 'P0'
    writeCount += 1
    return { task: { ...task } }
  },
})

registerTool({
  name: 'destroyData',
  risk: 'HIGH_RISK',
  description: '高危删除',
  parameters: { type: 'object', properties: { id: { type: 'string' } } },
  validate(args) {
    if (typeof args.id !== 'string' || args.id.length === 0) return 'id 必填'
    return null
  },
  async execute(args) {
    destroyed.push(args.id)
    return { deleted: args.id }
  },
})

/** 与真实 createTasks 同名同参形态,验证 label/preview 的真实分支 */
registerTool({
  name: 'createTasks',
  risk: 'HIGH_RISK',
  description: '按计划批量创建',
  parameters: { type: 'object', properties: { tasks: { type: 'array' } } },
  validate(args) {
    return Array.isArray(args.tasks) && args.tasks.length > 0 ? null : 'tasks 必填'
  },
  /** 与 createTasks 相同的编号计划预览形态 */
  preview(args) {
    return args.tasks.map((t, i) => ({ title: `${i + 1}. ${t.title}`, status: 'todo', priority: t.priority ?? null }))
  },
  async execute(args) {
    args.tasks.forEach((t, i) => planned.push({ title: t.title, order: i }))
    return { created: args.tasks.length }
  },
})

/** 与真实 rememberPreference 同名同参形态,验证 label 与幂等语义 */
registerTool({
  name: 'rememberPreference',
  risk: 'SAFE_WRITE',
  description: '记住偏好',
  parameters: { type: 'object', properties: { content: { type: 'string' } } },
  validate(args) {
    return typeof args.content === 'string' && args.content.trim().length > 0 ? null : 'content 必填'
  },
  async execute(args) {
    const trimmed = args.content.trim()
    if (!memories.includes(trimmed)) memories.push(trimmed)
    return { memory: { id: `m${memories.length}`, content: trimmed } }
  },
})

/** 与真实 setTaskDependencies 同名同参形态,验证审批意图与执行 label */
registerTool({
  name: 'setTaskDependencies',
  risk: 'HIGH_RISK',
  description: '设置前置依赖',
  parameters: {
    type: 'object',
    properties: { taskId: { type: 'string' }, dependsOn: { type: 'array' } },
  },
  validate(args) {
    if (typeof args.taskId !== 'string' || args.taskId.length === 0) return 'taskId 必填'
    if (!Array.isArray(args.dependsOn)) return 'dependsOn 需为数组'
    return null
  },
  async execute(args) {
    return { taskId: args.taskId, dependsOn: args.dependsOn }
  },
})

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

/** 按脚本轮次响应:第 n 轮 = 已收到的 tool 消息数 */
function scripted(steps) {
  currentRespond = (messages) => {
    const round = messages.filter((m) => m.role === 'tool').length
    return steps[Math.min(round, steps.length - 1)]()
  }
}

/* ---------- 用例 1:正常多轮 tool calling 直到完成 ---------- */
{
  writeCount = 0
  scripted([
    () => ({ toolCalls: [{ name: 'listData', arguments: '{}' }] }),
    () => ({ toolCalls: [{ name: 'writeData', arguments: JSON.stringify({ id: 't1', priority: 'P0' }) }] }),
    () => ({ toolCalls: [{ name: 'listData', arguments: '{}' }] }),
    () => ({ content: '已完成:把「写周报」调整为 P0,并复核确认。' }),
  ])
  const result = await runAgent('user-a', '把写周报调成 P0')
  check('用例1 状态 COMPLETED', result.status === 'COMPLETED')
  check('用例1 最终回答包含 P0', result.finalAnswer.includes('P0'))
  check('用例1 执行了 3 次工具', result.actions.length === 3)
  check('用例1 写入恰好 1 次', writeCount === 1)
  check('用例1 步数记录为 4', result.currentStep === 4)
}

/* ---------- 用例 2:工具失败回填后模型自纠 ---------- */
{
  scripted([
    () => ({ toolCalls: [{ name: 'writeData', arguments: JSON.stringify({ id: 'missing' }) }] }),
    () => ({ toolCalls: [{ name: 'listData', arguments: '{}' }] }),
    () => ({ toolCalls: [{ name: 'writeData', arguments: JSON.stringify({ id: 't1', priority: 'P1' }) }] }),
    () => ({ content: '第一次用错 id,查询后已正确修改。' }),
  ])
  const result = await runAgent('user-a', '整理优先级')
  check('用例2 状态 COMPLETED', result.status === 'COMPLETED')
  check('用例2 首次调用失败', result.actions[0].ok === false)
  check('用例2 自纠后成功', result.actions.at(-1).ok === true)
}

/* ---------- 用例 3:非法 JSON 参数不炸 Harness ---------- */
{
  scripted([
    () => ({ toolCalls: [{ name: 'writeData', arguments: 'not-json' }] }),
    () => ({ content: '参数出错,我改为直接说明。' }),
  ])
  const result = await runAgent('user-a', '测试非法参数')
  check('用例3 状态 COMPLETED', result.status === 'COMPLETED')
  check('用例3 非法 JSON 被规整为失败', result.actions[0].ok === false)
}

/* ---------- 用例 4:未知工具回填错误 ---------- */
{
  scripted([
    () => ({ toolCalls: [{ name: 'noSuchTool', arguments: '{}' }] }),
    () => ({ content: '该工具不存在,如实告知用户。' }),
  ])
  const result = await runAgent('user-a', '测试未知工具')
  check('用例4 状态 COMPLETED', result.status === 'COMPLETED')
  check('用例4 未知工具被拒绝', result.actions[0].ok === false)
}

/* ---------- 用例 5:同一失败重复 3 次触发守卫,不允许无限重试 ---------- */
{
  writeCount = 0
  currentRespond = () => ({ toolCalls: [{ name: 'writeData', arguments: '{"id":"missing"}' }] })
  const result = await runAgent('user-a', '测试死循环守卫')
  check('用例5 状态 FAILED', result.status === 'FAILED')
  check('用例5 恰好尝试 3 次后终止', result.actions.length === 3)
  check('用例5 回答含执行中止说明', result.finalAnswer.includes('执行中止'))
  check('用例5 未发生真实写入', writeCount === 0)
}

/* ---------- 用例 6:步数耗尽 → MAX_STEPS_REACHED + 收尾总结 ---------- */
{
  currentRespond = (messages) => {
    if (messages.at(-1).content?.includes('已达到最大执行步数')) {
      return { content: '总结:已完成查询,修改未执行。' }
    }
    return { toolCalls: [{ name: 'listData', arguments: '{}' }] }
  }
  const result = await runAgent('user-a', '测试步数上限')
  check('用例6 状态 MAX_STEPS_REACHED', result.status === 'MAX_STEPS_REACHED')
  check('用例6 有收尾总结', result.finalAnswer.includes('总结'))
}

/* ---------- 用例 7:执行过程事件流(onEvent 可视化) ---------- */
{
  scripted([
    () => ({ toolCalls: [{ name: 'listData', arguments: '{}' }] }),
    () => ({ toolCalls: [{ name: 'writeData', arguments: JSON.stringify({ id: 't1', priority: 'P2' }) }] }),
    () => ({ content: '已完成调整。' }),
  ])
  const events = []
  const result = await runAgent('user-a', '测试事件流', { onEvent: (e) => events.push(e) })
  const toolEvents = events.filter((e) => e.type === 'tool')
  check(
    '用例7 事件序列 started→tool…→final',
    events[0]?.type === 'started' && events.at(-1)?.type === 'final' && toolEvents.length === 2,
  )
  check('用例7 started 携带模型标识', typeof events[0]?.model === 'string' && events[0].model.includes('/'))
  check(
    '用例7 步骤事件字段齐备',
    toolEvents.every(
      (e) => typeof e.label === 'string' && e.label.length > 0 && typeof e.step === 'number' && e.ok === true && typeof e.durationMs === 'number',
    ),
  )
  check(
    '用例7 final 携带完整公共结果',
    events.at(-1).status === result.status &&
      events.at(-1).sessionId === result.sessionId &&
      events.at(-1).finalAnswer === result.finalAnswer &&
      events.at(-1).actions.length === result.actions.length,
  )
  check('用例7 事件不泄漏原始参数与结果', toolEvents.every((e) => e.args === undefined && e.result === undefined))
}

/* ---------- 用例 8:失败步骤事件携带错误信息(用例 1-6 未传 onEvent,即无事件旧路径) ---------- */
{
  currentRespond = () => ({ toolCalls: [{ name: 'writeData', arguments: '{"id":"missing"}' }] })
  const events = []
  const result = await runAgent('user-a', '测试失败事件', { onEvent: (e) => events.push(e) })
  const toolEvents = events.filter((e) => e.type === 'tool')
  check('用例8 守卫终止 FAILED', result.status === 'FAILED')
  check(
    '用例8 三次失败步骤均带错误',
    toolEvents.length === 3 && toolEvents.every((e) => e.ok === false && typeof e.error === 'string' && e.error.length > 0),
  )
  check('用例8 final 事件状态为 FAILED', events.at(-1)?.type === 'final' && events.at(-1).status === 'FAILED')
}

/* ---------- 用例 9:高危工具审批通过后执行 ---------- */
{
  destroyed.length = 0
  scripted([
    () => ({ toolCalls: [{ name: 'destroyData', arguments: JSON.stringify({ id: 't1' }) }] }),
    () => ({ content: '已在用户确认后完成删除。' }),
  ])
  const events = []
  const runPromise = runAgent('user-a', '删除数据', { onEvent: (e) => events.push(e) })
  const approval = await waitForApproval(events)
  check(
    '用例9 审批事件带会话与预览',
    typeof approval.sessionId === 'string' &&
      typeof approval.requestId === 'string' &&
      approval.label.includes('待确认'),
  )
  check('用例9 等待期间未执行工具', destroyed.length === 0)
  check('用例9 审批提交被接受', resolveApproval(approval.sessionId, approval.requestId, true) === true)
  const result = await runPromise
  check('用例9 确认后真实执行', destroyed.length === 1 && result.status === 'COMPLETED')
  const toolEvents = events.filter((e) => e.type === 'tool')
  check(
    '用例9 事件序列 approval→tool→final',
    events[0].type === 'started' && events.some((e) => e.type === 'approval') && toolEvents.length === 1 && toolEvents[0].ok === true && events.at(-1).type === 'final',
  )
}

/* ---------- 用例 10:高危工具被拒绝则不执行 ---------- */
{
  destroyed.length = 0
  scripted([
    () => ({ toolCalls: [{ name: 'destroyData', arguments: JSON.stringify({ id: 't1' }) }] }),
    () => ({ content: '用户拒绝了删除,我未执行。' }),
  ])
  const events = []
  const runPromise = runAgent('user-a', '删除数据', { onEvent: (e) => events.push(e) })
  const approval = await waitForApproval(events)
  resolveApproval(approval.sessionId, approval.requestId, false)
  const result = await runPromise
  const toolEvents = events.filter((e) => e.type === 'tool')
  check('用例10 拒绝后未执行', destroyed.length === 0 && result.status === 'COMPLETED')
  check(
    '用例10 拒绝以失败步骤回填',
    toolEvents.length === 1 && toolEvents[0].ok === false && toolEvents[0].error.includes('拒绝'),
  )
}

/* ---------- 用例 11:审批超时自动取消 ---------- */
{
  destroyed.length = 0
  currentRespond = (messages) => {
    const round = messages.filter((m) => m.role === 'tool').length
    if (round === 0) return { toolCalls: [{ name: 'destroyData', arguments: JSON.stringify({ id: 't1' }) }] }
    return { content: '确认超时,未执行删除。' }
  }
  const events = []
  const result = await runAgent('user-a', '删除数据', { onEvent: (e) => events.push(e) })
  const toolEvents = events.filter((e) => e.type === 'tool')
  check('用例11 超时后未执行且运行收尾', destroyed.length === 0 && result.status === 'COMPLETED')
  check('用例11 超时错误回填模型', toolEvents.length === 1 && toolEvents[0].ok === false && toolEvents[0].error.includes('超时'))
}

/* ---------- 用例 12:目标拆解计划(审批通过后按数组顺序创建) ---------- */
{
  planned.length = 0
  scripted([
    () => ({
      toolCalls: [
        {
          name: 'createTasks',
          arguments: JSON.stringify({
            tasks: [{ title: '第一步' }, { title: '第二步' }, { title: '第三步' }],
          }),
        },
      ],
    }),
    () => ({ content: '计划已获确认并创建。' }),
  ])
  const events = []
  const runPromise = runAgent('user-a', '拆解目标', { onEvent: (e) => events.push(e) })
  const approval = await waitForApproval(events)
  check(
    '用例12 审批预览为编号计划',
    approval.tasks.length === 3 &&
      approval.tasks[0].title.startsWith('1.') &&
      approval.tasks[2].title.startsWith('3.'),
  )
  check('用例12 等待期间未创建', planned.length === 0)
  resolveApproval(approval.sessionId, approval.requestId, true)
  const result = await runPromise
  check(
    '用例12 确认后按数组顺序执行',
    planned.map((p) => `${p.order}:${p.title}`).join(',') === '0:第一步,1:第二步,2:第三步' &&
      result.status === 'COMPLETED',
  )
  const toolEvents = events.filter((e) => e.type === 'tool')
  check('用例12 执行步骤 label 含创建数', toolEvents.length === 1 && /创建 3 个任务/.test(toolEvents[0].label))
}

/* ---------- 用例 13:偏好记忆(label 与幂等) ---------- */
{
  memories.length = 0
  scripted([
    () => ({ toolCalls: [{ name: 'rememberPreference', arguments: JSON.stringify({ content: '周末不安排任务' }) }] }),
    () => ({ toolCalls: [{ name: 'rememberPreference', arguments: JSON.stringify({ content: ' 周末不安排任务 ' }) }] }),
    () => ({ content: '已记住。' }),
  ])
  const events = []
  const result = await runAgent('user-a', '记住偏好', { onEvent: (e) => events.push(e) })
  check('用例13 状态 COMPLETED', result.status === 'COMPLETED')
  check('用例13 同内容幂等不重复保存', memories.length === 1 && memories[0] === '周末不安排任务')
  const toolEvents = events.filter((e) => e.type === 'tool')
  check('用例13 步骤 label 为记住偏好', toolEvents.length === 2 && toolEvents.every((e) => e.label.startsWith('记住偏好「')))
}

/* ---------- 用例 14:前置依赖设置(审批意图与 label) ---------- */
{
  scripted([
    () => ({
      toolCalls: [{ name: 'setTaskDependencies', arguments: JSON.stringify({ taskId: 't1', dependsOn: ['x1'] }) }],
    }),
    () => ({ content: '已设置前置依赖。' }),
  ])
  const events = []
  const runPromise = runAgent('user-a', '设置依赖', { onEvent: (e) => events.push(e) })
  const approval = await waitForApproval(events)
  check('用例14 审批意图为设置前置依赖', approval.label.includes('设置前置依赖') && approval.label.includes('待确认'))
  resolveApproval(approval.sessionId, approval.requestId, true)
  const result = await runPromise
  const toolEvents = events.filter((e) => e.type === 'tool')
  check('用例14 状态 COMPLETED', result.status === 'COMPLETED')
  check('用例14 执行 label 含项数', toolEvents.length === 1 && toolEvents[0].label.includes('(1 项)'))
}

server.close()
console.log(`\n${passed} checks passed${process.exitCode ? '(含失败项)' : ''}`)
