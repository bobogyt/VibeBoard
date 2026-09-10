import { batchUpdateTasks } from '../../services/taskService.js'

const COLUMN_IDS = ['todo', 'doing', 'done']
const PRIORITIES = ['P0', 'P1', 'P2', 'P3']
const MAX_BATCH = 50

function validateTaskIds(args) {
  if (!Array.isArray(args.taskIds)) return 'taskIds 需为字符串数组'
  if (args.taskIds.length === 0) return 'taskIds 不能为空'
  if (args.taskIds.length > MAX_BATCH) return `单次最多 ${MAX_BATCH} 个任务`
  if (args.taskIds.some((id) => typeof id !== 'string' || id.length === 0)) return 'taskIds 需为非空字符串'
  return null
}

export const batchUpdateTasksTool = {
  name: 'batchUpdateTasks',
  risk: 'HIGH_RISK',
  description:
    '批量修改多个任务的状态/优先级/所属项目;status 变更会把任务移动到目标列末尾。高危操作:调用后需要用户人工确认才会执行。',
  parameters: {
    type: 'object',
    properties: {
      taskIds: { type: 'array', items: { type: 'string' }, description: '要修改的任务 id 列表' },
      patch: {
        type: 'object',
        description: '要应用的变更(至少一项)',
        properties: {
          status: { type: 'string', enum: COLUMN_IDS, description: '目标状态列 todo/doing/done' },
          priority: { type: 'string', enum: PRIORITIES, description: '目标优先级 P0-P3' },
          projectId: { type: ['string', 'null'], description: '所属项目 id,null 表示移出项目' },
        },
        additionalProperties: false,
      },
    },
    required: ['taskIds', 'patch'],
    additionalProperties: false,
  },
  validate(args) {
    const idsError = validateTaskIds(args)
    if (idsError) return idsError
    const patch = args.patch
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return 'patch 需为对象'
    const hasStatus = patch.status !== undefined
    const hasPriority = patch.priority !== undefined
    const hasProjectId = patch.projectId !== undefined
    if (!hasStatus && !hasPriority && !hasProjectId) return 'patch 至少包含 status/priority/projectId 一项'
    if (hasStatus && !COLUMN_IDS.includes(patch.status)) return 'status 需为 todo/doing/done'
    if (hasPriority && !PRIORITIES.includes(patch.priority)) return 'priority 需为 P0/P1/P2/P3'
    if (hasProjectId && patch.projectId !== null && typeof patch.projectId !== 'string') {
      return 'projectId 需为字符串或 null'
    }
    return null
  },
  async execute(args, ctx) {
    return batchUpdateTasks(ctx.userId, args.taskIds, args.patch)
  },
}
