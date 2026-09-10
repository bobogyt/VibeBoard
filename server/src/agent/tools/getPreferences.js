import { listMemories } from '../../services/memoryService.js'

export const getPreferencesTool = {
  name: 'getPreferences',
  risk: 'READ',
  description: '读取用户的长期偏好记忆(工作时间、习惯、常用做法等),回答或拆解前可先查看。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async execute(_args, ctx) {
    const memories = await listMemories(ctx.userId)
    return { count: memories.length, memories: memories.map((m) => ({ id: m.id, content: m.content })) }
  },
}
