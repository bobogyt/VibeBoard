import { addMemory } from '../../services/memoryService.js'

export const rememberPreferenceTool = {
  name: 'rememberPreference',
  risk: 'SAFE_WRITE',
  description:
    '把用户陈述的偏好/习惯/工作时间保存为长期记忆(自动去重),之后每次对话都会遵循。用户说「以后…」「我习惯…」时使用。',
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string', description: '要记住的偏好内容,一句话,如「工作时间 9:00-19:00,周末不安排任务」' },
    },
    required: ['content'],
    additionalProperties: false,
  },
  validate(args) {
    if (typeof args.content !== 'string' || args.content.trim().length === 0) return 'content 必填'
    if (args.content.trim().length > 300) return 'content 不能超过 300 字'
    return null
  },
  async execute(args, ctx) {
    return { memory: await addMemory(ctx.userId, args.content) }
  },
}
