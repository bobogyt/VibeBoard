import { listProjects } from '../../services/projectService.js'

export const getProjectsTool = {
  name: 'getProjects',
  risk: 'READ',
  description: '获取当前用户的全部项目列表:名称、状态、自动计算的进度、技术栈、起止时间。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  validate: () => null,
  async execute(_args, ctx) {
    const projects = await listProjects(ctx.userId)
    return { count: projects.length, projects }
  },
}
