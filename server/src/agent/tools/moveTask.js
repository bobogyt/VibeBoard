import { moveTask } from '../../services/taskService.js'

const COLUMN_IDS = ['todo', 'doing', 'done']

export const moveTaskTool = {
  name: 'moveTask',
  risk: 'SAFE_WRITE',
  description: '把任务移动到目标状态列;toPosition 缺省时追加到目标列末尾。',
  parameters: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 id' },
      toStatus: { type: 'string', enum: COLUMN_IDS, description: '目标状态列 todo/doing/done' },
      toPosition: { type: 'integer', description: '目标列内的插入位置(0 开始),可选' },
    },
    required: ['taskId', 'toStatus'],
    additionalProperties: false,
  },
  validate(args) {
    if (typeof args.taskId !== 'string' || args.taskId.length === 0) return 'taskId 必填'
    if (!COLUMN_IDS.includes(args.toStatus)) return 'toStatus 需为 todo/doing/done'
    if (args.toPosition !== undefined && args.toPosition !== null && (!Number.isInteger(args.toPosition) || args.toPosition < 0)) {
      return 'toPosition 需为非负整数'
    }
    return null
  },
  async execute(args, ctx) {
    return { task: await moveTask(ctx.userId, args.taskId, args.toStatus, args.toPosition ?? undefined) }
  },
}
