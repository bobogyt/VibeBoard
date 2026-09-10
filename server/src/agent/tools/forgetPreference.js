import { deleteMemory } from '../../services/memoryService.js'

export const forgetPreferenceTool = {
  name: 'forgetPreference',
  risk: 'SAFE_WRITE',
  description: '删除一条长期偏好记忆(先用 getPreferences 查 id)。用户说「忘掉…」时使用。',
  parameters: {
    type: 'object',
    properties: {
      memoryId: { type: 'string', description: '要删除的记忆 id(getPreferences 返回的 id)' },
    },
    required: ['memoryId'],
    additionalProperties: false,
  },
  validate(args) {
    if (typeof args.memoryId !== 'string' || args.memoryId.length === 0) return 'memoryId 必填'
    return null
  },
  async execute(args, ctx) {
    return deleteMemory(ctx.userId, args.memoryId)
  },
}
