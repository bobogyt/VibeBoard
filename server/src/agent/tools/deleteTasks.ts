import { deleteTasks } from '../../services/taskService'
import type { Tool } from '../registry'

const MAX_BATCH = 50

function validateTaskIds(args: Record<string, unknown>): string | null {
  const ids = args.taskIds
  if (!Array.isArray(ids)) return 'taskIds 需为字符串数组'
  if (ids.length === 0) return 'taskIds 不能为空'
  if (ids.length > MAX_BATCH) return `单次最多 ${MAX_BATCH} 个任务`
  if (ids.some((id) => typeof id !== 'string' || id.length === 0)) return 'taskIds 需为非空字符串'
  return null
}

export const deleteTasksTool: Tool = {
  name: 'deleteTasks',
  risk: 'HIGH_RISK',
  description: '永久删除一个或多个任务,不可恢复。高危操作:调用后需要用户人工确认才会执行。',
  parameters: {
    type: 'object',
    properties: {
      taskIds: { type: 'array', items: { type: 'string' }, description: '要删除的任务 id 列表' },
    },
    required: ['taskIds'],
    additionalProperties: false,
  },
  validate: validateTaskIds,
  async execute(args, ctx) {
    return deleteTasks(ctx.userId as string, args.taskIds)
  },
}
