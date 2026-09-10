import { updateTask } from '../../services/taskService'
import type { Tool } from '../registry'

const PRIORITIES = ['P0', 'P1', 'P2', 'P3']

export const updateTaskTool: Tool = {
  name: 'updateTask',
  risk: 'SAFE_WRITE',
  description: '部分更新任务:仅传入需要修改的字段(标题/描述/所属项目/优先级/截止时间)。',
  parameters: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 id' },
      title: { type: 'string', description: '新标题,1-200 字' },
      description: { type: 'string', description: '新描述' },
      projectId: { type: 'string', description: '新所属项目 id,传空串表示解除关联' },
      priority: { type: 'string', enum: PRIORITIES, description: '新优先级' },
      dueDate: { type: 'number', description: '新截止时间,毫秒时间戳' },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  validate(args) {
    if (typeof args.taskId !== 'string' || args.taskId.length === 0) return 'taskId 必填'
    if (args.title !== undefined && (typeof args.title !== 'string' || args.title.trim().length === 0 || args.title.trim().length > 200)) {
      return 'title 需为 1-200 字的字符串'
    }
    if (args.description !== undefined && (typeof args.description !== 'string' || args.description.length > 5000)) {
      return 'description 需为不超过 5000 字的字符串'
    }
    if (args.projectId !== undefined && args.projectId !== null && typeof args.projectId !== 'string') {
      return 'projectId 需为字符串'
    }
    if (args.priority !== undefined && args.priority !== null && !PRIORITIES.includes(args.priority as string)) {
      return 'priority 需为 P0/P1/P2/P3'
    }
    if (args.dueDate !== undefined && args.dueDate !== null && typeof args.dueDate !== 'number') {
      return 'dueDate 需为毫秒时间戳数字'
    }
    return null
  },
  async execute(args, ctx) {
    const { taskId, ...patch } = args
    return { task: await updateTask(ctx.userId as string, taskId, patch) }
  },
}
