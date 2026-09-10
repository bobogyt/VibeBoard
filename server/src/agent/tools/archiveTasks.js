import { setTasksArchived } from '../../services/taskService.js'

const MAX_BATCH = 50

export const archiveTasksTool = {
  name: 'archiveTasks',
  risk: 'HIGH_RISK',
  description:
    '把一个或多个任务移出看板并归档(可在归档页恢复)。高危操作:调用后需要用户人工确认才会执行。',
  parameters: {
    type: 'object',
    properties: {
      taskIds: { type: 'array', items: { type: 'string' }, description: '要归档的任务 id 列表' },
    },
    required: ['taskIds'],
    additionalProperties: false,
  },
  validate(args) {
    if (!Array.isArray(args.taskIds)) return 'taskIds 需为字符串数组'
    if (args.taskIds.length === 0) return 'taskIds 不能为空'
    if (args.taskIds.length > MAX_BATCH) return `单次最多 ${MAX_BATCH} 个任务`
    if (args.taskIds.some((id) => typeof id !== 'string' || id.length === 0)) return 'taskIds 需为非空字符串'
    return null
  },
  async execute(args, ctx) {
    return setTasksArchived(ctx.userId, args.taskIds, true)
  },
}
