import { getTasks } from '../../services/taskService.js'

const COLUMN_IDS = ['todo', 'doing', 'done']
const PRIORITIES = ['P0', 'P1', 'P2', 'P3']

export const getTasksTool = {
  name: 'getTasks',
  risk: 'READ',
  description:
    '获取当前用户的任务列表(描述截断),可按状态列/所属项目/优先级组合过滤,不传过滤条件则返回全部任务。每条任务含 id、标题、状态、优先级、截止时间(dueDate 毫秒时间戳)、所属项目。',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: COLUMN_IDS, description: '按状态列过滤:todo/doing/done' },
      projectId: { type: 'string', description: '按所属项目 id 过滤' },
      priority: { type: 'string', enum: PRIORITIES, description: '按优先级过滤' },
    },
    additionalProperties: false,
  },
  validate(args) {
    if (args.status !== undefined && !COLUMN_IDS.includes(args.status)) return 'status 需为 todo/doing/done'
    if (args.priority !== undefined && !PRIORITIES.includes(args.priority)) return 'priority 需为 P0/P1/P2/P3'
    if (args.projectId !== undefined && (typeof args.projectId !== 'string' || args.projectId.length === 0)) {
      return 'projectId 需为非空字符串'
    }
    return null
  },
  async execute(args, ctx) {
    const tasks = await getTasks(ctx.userId, {
      status: args.status,
      projectId: args.projectId,
      priority: args.priority,
    })
    return { count: tasks.length, tasks }
  },
}
