import { updateTaskPriority } from '../../services/taskService.js'

const PRIORITIES = ['P0', 'P1', 'P2', 'P3']

export const updateTaskPriorityTool = {
  name: 'updateTaskPriority',
  risk: 'SAFE_WRITE',
  description: '调整任务优先级(P0 最高,P3 最低)。',
  parameters: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 id' },
      priority: { type: 'string', enum: PRIORITIES, description: '目标优先级' },
    },
    required: ['taskId', 'priority'],
    additionalProperties: false,
  },
  validate(args) {
    if (typeof args.taskId !== 'string' || args.taskId.length === 0) return 'taskId 必填'
    if (!PRIORITIES.includes(args.priority)) return 'priority 需为 P0/P1/P2/P3'
    return null
  },
  async execute(args, ctx) {
    return { task: await updateTaskPriority(ctx.userId, args.taskId, args.priority) }
  },
}
