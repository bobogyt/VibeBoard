import { createTask } from '../../services/taskService'
import type { Tool } from '../registry'

const COLUMN_IDS = ['todo', 'doing', 'done']
const PRIORITIES = ['P0', 'P1', 'P2', 'P3']

export const createTaskTool: Tool = {
  name: 'createTask',
  risk: 'SAFE_WRITE',
  description:
    '创建一个新任务(默认进入 todo 列末尾)。title 必填;status/priority/dueDate(毫秒时间戳)/projectId/description 可选。',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '任务标题,1-200 字' },
      description: { type: 'string', description: '任务描述,可选' },
      status: { type: 'string', enum: COLUMN_IDS, description: '初始状态列,默认 todo' },
      projectId: { type: 'string', description: '所属项目 id,可选' },
      priority: { type: 'string', enum: PRIORITIES, description: '优先级 P0-P3,可选' },
      dueDate: { type: 'number', description: '截止时间,毫秒时间戳,可选' },
    },
    required: ['title'],
    additionalProperties: false,
  },
  validate(args) {
    if (typeof args.title !== 'string' || args.title.trim().length === 0 || args.title.trim().length > 200) {
      return 'title 必填且不超过 200 字'
    }
    if (args.description !== undefined && (typeof args.description !== 'string' || args.description.length > 5000)) {
      return 'description 需为不超过 5000 字的字符串'
    }
    if (args.status !== undefined && !COLUMN_IDS.includes(args.status as string)) return 'status 需为 todo/doing/done'
    if (args.priority !== undefined && args.priority !== null && !PRIORITIES.includes(args.priority as string)) {
      return 'priority 需为 P0/P1/P2/P3'
    }
    if (args.dueDate !== undefined && args.dueDate !== null && typeof args.dueDate !== 'number') {
      return 'dueDate 需为毫秒时间戳数字'
    }
    if (args.projectId !== undefined && args.projectId !== null && typeof args.projectId !== 'string') {
      return 'projectId 需为字符串'
    }
    return null
  },
  async execute(args, ctx) {
    return { task: await createTask(ctx.userId as string, args) }
  },
}
