import { getTask } from '../../services/taskService'
import type { Tool } from '../registry'

export const getTaskTool: Tool = {
  name: 'getTask',
  risk: 'READ',
  description: '按 id 获取单个任务完整详情(含完整描述),常用于修改后的结果确认。',
  parameters: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 id(来自 getTasks 返回的 id)' },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  validate(args) {
    if (typeof args.taskId !== 'string' || args.taskId.length === 0) return 'taskId 必填'
    return null
  },
  async execute(args, ctx) {
    return { task: await getTask(ctx.userId as string, args.taskId) }
  },
}
