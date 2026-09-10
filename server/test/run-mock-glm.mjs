/**
 * 独立 mock GLM 服务器:node server/test/run-mock-glm.mjs [port]
 * 按「读取任务 → 改优先级 → 汇报」的剧本响应,配合 MODEL_BASE_URL_DEEPSEEK 覆盖做全链路联调。
 */
import { createMockGlm, toolResultAt } from './mock-glm.mjs'

let pickedId = ''
let pickedTitle = ''

const respond = (messages) => {
  if (messages.at(-1).content?.includes('已达到最大执行步数')) {
    return { content: '总结:已达步数上限。' }
  }
  const round = messages.filter((m) => m.role === 'tool').length
  if (round === 0) return { toolCalls: [{ name: 'getTasks', arguments: '{}' }] }
  if (round === 1) {
    const result = toolResultAt(messages, -1)
    const candidates = (result?.tasks ?? []).filter((t) => t.status !== 'done')
    candidates.sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity))
    if (candidates.length === 0) return { content: '看板上没有进行中的任务。' }
    pickedId = candidates[0].id
    pickedTitle = candidates[0].title
    return {
      toolCalls: [{ name: 'updateTaskPriority', arguments: JSON.stringify({ taskId: pickedId, priority: 'P0' }) }],
    }
  }
  if (round === 2) {
    return { toolCalls: [{ name: 'getTask', arguments: JSON.stringify({ taskId: pickedId }) }] }
  }
  const verify = toolResultAt(messages, -1)
  const ok = verify?.task?.priority === 'P0'
  return {
    content: ok
      ? `已把「${pickedTitle}」调整为 P0,并复核确认生效。建议今天优先完成它。`
      : `调整似乎没有生效,请稍后重试。`,
  }
}

const port = Number(process.argv[2] ?? 3900)
const server = createMockGlm(respond)
server.listen(port, '127.0.0.1', () => console.log(`[mock-glm] listening on http://127.0.0.1:${port}`))
