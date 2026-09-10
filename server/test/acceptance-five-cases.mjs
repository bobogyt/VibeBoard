/**
 * 真实模型五场景验收:node --env-file=server/.env server/test/acceptance-five-cases.mjs
 * 前置:后端已启动且模型已配置(界面或 .env)。
 * 流程:登录 → 看板快照 → 补充种子任务 → 顺序跑五个场景 → 还原快照。
 */
const BASE = process.env.BASE ?? 'http://localhost:3000'
const USER = process.env.E2E_USER ?? 'e2euser'
const PASS = process.env.E2E_PASS ?? 'e2epass123'
const COLUMN_IDS = ['todo', 'doing', 'done']

const login = await (
  await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  })
).json()
const auth = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' }

const getBoard = async () => (await (await fetch(`${BASE}/api/board`, { headers: auth })).json()).columns
const putBoard = async (columns) => {
  const res = await fetch(`${BASE}/api/board`, { method: 'PUT', headers: auth, body: JSON.stringify({ columns }) })
  if (!res.ok) throw new Error(`board PUT ${res.status}`)
}

// 快照 + 种子任务(给模型可推理的真实素材)
const snapshot = await getBoard()
const seed = structuredClone(snapshot)
const todayEnd = new Date()
todayEnd.setHours(23, 59, 59, 999)
const has = (title) => COLUMN_IDS.some((c) => seed[c].some((t) => t.title === title))
if (!has('【回归】修复登录页崩溃 Bug')) {
  seed.todo.unshift({
    id: crypto.randomUUID(),
    title: '【回归】修复登录页崩溃 Bug',
    description: '登录页在深色模式下崩溃',
    status: 'todo',
    projectId: null,
    priority: 'P1',
    dueDate: todayEnd.getTime(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
}
if (!has('【回归】整理测试数据')) {
  seed.todo.unshift({
    id: crypto.randomUUID(),
    title: '【回归】整理测试数据',
    description: '',
    status: 'todo',
    projectId: null,
    priority: null,
    dueDate: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
}
await putBoard(seed)

const cases = [
  ['C1 只读问答', '告诉我现在有哪些任务最重要'],
  ['C2 改优先级', '把今天最重要的任务调整为 P0'],
  ['C3 整理任务', '帮我整理一下今天的任务'],
  ['C4 删除请求', '删除所有已经完成的任务'],
  ['C5 优雅失败', '把任务「根本不存在的任务xyz」调整为 P0'],
]

for (const [name, message] of cases) {
  const t0 = Date.now()
  const res = await fetch(`${BASE}/api/agent/run`, { method: 'POST', headers: auth, body: JSON.stringify({ message }) })
  const data = await res.json()
  const seconds = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\n===== ${name}(${seconds}s, HTTP ${res.status}) =====`)
  console.log(`status: ${data.status}  steps: ${data.currentStep}`)
  console.log(`answer: ${data.finalAnswer}`)
  console.log(`tools: ${(data.actions ?? []).map((a) => `${a.tool}${a.ok ? '' : '(失败)'}`).join(' -> ') || '(无)'}`)
}

console.log('\n===== 还原看板 =====')
await putBoard(snapshot)
console.log('board restored')
