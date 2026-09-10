import { listProjects } from '../../services/projectService'
import type { Tool } from '../registry'

export const getProjectsTool: Tool = {
  name: 'getProjects',
  risk: 'READ',
  description: '获取当前用户的全部项目列表:名称、状态、自动计算的进度、技术栈、起止时间。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  validate: () => null,
  async execute(_args, ctx) {
    const projects = await listProjects(ctx.userId as string)
    return { count: projects.length, projects }
  },
}
