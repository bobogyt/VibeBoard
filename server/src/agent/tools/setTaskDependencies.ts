import { getTasks, setTaskDependencies } from '../../services/taskService'
import type { Tool, ToolContext } from '../registry'

export const setTaskDependenciesTool: Tool = {
  name: 'setTaskDependencies',
  risk: 'HIGH_RISK',
  description:
    '设置任务的前置依赖(谁阻塞谁):dependsOn 中的任务未完成前,该任务被视为被阻塞。只做标识、不改变看板顺序。高危操作:调用后需要用户人工确认才会执行。',
  parameters: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要设置依赖的任务 id' },
      dependsOn: {
        type: 'array',
        items: { type: 'string' },
        description: '前置任务 id 列表(空数组 = 清空全部前置依赖)',
      },
    },
    required: ['taskId', 'dependsOn'],
    additionalProperties: false,
  },
  validate(args) {
    if (typeof args.taskId !== 'string' || args.taskId.length === 0) return 'taskId 必填'
    if (!Array.isArray(args.dependsOn)) return 'dependsOn 需为字符串数组'
    if (args.dependsOn.some((id) => typeof id !== 'string' || id.length === 0)) return 'dependsOn 需为非空字符串'
    if (args.dependsOn.includes(args.taskId)) return '前置任务不能包含自身'
    return null
  },
  /** 审批预览:展示被阻塞任务与全部前置(异步读看板取标题) */
  async preview(args, ctx: ToolContext) {
    if (ctx?.userId === undefined) {
      console.error('[agent] setTaskDependencies preview ctx.userId undefined, stack:')
      console.error(new Error('trace').stack)
    }
    const all = await getTasks(ctx.userId as string)
    const byId = new Map(all.map((t) => [t.id, t]))
    const rows = (args.dependsOn as string[]).map((id) => {
      const dep = byId.get(id)
      return {
        title: dep ? dep.title : `(未知任务 ${id.slice(0, 8)})`,
        status: dep?.status ?? null,
        priority: dep?.priority ?? null,
      }
    })
    const self = byId.get(args.taskId as string)
    rows.unshift({
      title: `「${self?.title ?? args.taskId}」将被上述任务阻塞`,
      status: self?.status ?? null,
      priority: null,
    })
    return rows
  },
  async execute(args, ctx) {
    return { task: await setTaskDependencies(ctx.userId as string, args.taskId, args.dependsOn) }
  },
}
