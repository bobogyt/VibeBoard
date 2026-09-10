import { createTasksBatch } from '../../services/taskService'
import type { Tool } from '../registry'

const MAX_CREATE_BATCH = 20

export const createTasksTool: Tool = {
  name: 'createTasks',
  risk: 'HIGH_RISK',
  description:
    '按计划批量创建任务(目标拆解)。tasks 数组顺序 = 执行顺序:先做的在前,创建后按此顺序排入对应列。高危操作:调用后需要用户人工确认才会执行。',
  parameters: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        description: '要创建的任务列表,按执行顺序排列(先做的在前)',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '任务标题,具体可执行' },
            description: { type: 'string', description: '补充说明' },
            status: { type: 'string', enum: ['todo', 'doing', 'done'], description: '目标列,默认 todo' },
            priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'], description: '优先级' },
            projectId: { type: ['string', 'null'], description: '所属项目 id' },
            dueDate: { type: 'number', description: '截止时间(毫秒时间戳)' },
            dependsOn: {
              type: 'array',
              items: { type: 'integer' },
              description: '前置任务的下标(0 开始,只能指向数组中更早的项),表达「谁阻塞谁」',
            },
          },
          required: ['title'],
          additionalProperties: false,
        },
      },
    },
    required: ['tasks'],
    additionalProperties: false,
  },
  validate(args) {
    const tasks = args.tasks
    if (!Array.isArray(tasks)) return 'tasks 需为对象数组'
    if (tasks.length === 0) return 'tasks 不能为空'
    if (tasks.length > MAX_CREATE_BATCH) return `单次最多创建 ${MAX_CREATE_BATCH} 个任务`
    for (const item of tasks) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return 'tasks 每项需为对象'
      const t = item as Record<string, unknown>
      if (typeof t.title !== 'string' || t.title.trim().length === 0) return '每个任务都需要非空标题'
      if (t.title.length > 200) return '任务标题不能超过 200 字'
    }
    return null
  },
  /** 审批预览:数组顺序即执行顺序,标题带序号;声明了依赖的项标注其前置 */
  preview(args) {
    const tasks = args.tasks as Array<Record<string, unknown>>
    return tasks.map((t, i) => ({
      title: `${i + 1}. ${t.title}${
        Array.isArray(t.dependsOn) && t.dependsOn.length
          ? `(依赖 ${(t.dependsOn as number[]).map((d) => `第 ${d + 1} 项`).join('、')})`
          : ''
      }`,
      status: (t.status as string) ?? 'todo',
      priority: (t.priority as string) ?? null,
    }))
  },
  async execute(args, ctx) {
    return createTasksBatch(ctx.userId as string, args.tasks)
  },
}
