import { listMemories } from '../../services/memoryService'
import type { Tool } from '../registry'

export const getPreferencesTool: Tool = {
  name: 'getPreferences',
  risk: 'READ',
  description: '读取用户的长期偏好记忆(工作时间、习惯、常用做法等),回答或拆解前可先查看。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async execute(_args, ctx) {
    const memories = await listMemories(ctx.userId as string)
    return { count: memories.length, memories: memories.map((m) => ({ id: m.id, content: m.content })) }
  },
}
