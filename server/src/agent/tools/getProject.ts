import { getProject } from '../../services/projectService'
import type { Tool } from '../registry'

export const getProjectTool: Tool = {
  name: 'getProject',
  risk: 'READ',
  description: '按 id 获取单个项目详情(含任务进度聚合)。',
  parameters: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: '项目 id(来自 getProjects 返回的 id)' },
    },
    required: ['projectId'],
    additionalProperties: false,
  },
  validate(args) {
    if (typeof args.projectId !== 'string' || args.projectId.length === 0) return 'projectId 必填'
    return null
  },
  async execute(args, ctx) {
    return { project: await getProject(ctx.userId as string, args.projectId as string) }
  },
}
