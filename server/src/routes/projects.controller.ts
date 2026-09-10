import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common'
import { listProjects, createProject, updateProject, deleteProject } from '../services/projectService'
import { AuthGuard } from '../http/guards'
import { UserId } from '../http/authed-request'

@UseGuards(AuthGuard)
@Controller('projects')
export class ProjectsController {
  @Get()
  async list(@UserId() userId: string) {
    return { projects: await listProjects(userId) }
  }

  @Post()
  async create(@UserId() userId: string, @Body() body: Record<string, unknown>) {
    return { project: await createProject(userId, body) }
  }

  @Put(':id')
  async update(@UserId() userId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return { project: await updateProject(userId, id, body) }
  }

  @Delete(':id')
  async remove(@UserId() userId: string, @Param('id') id: string) {
    return deleteProject(userId, id)
  }
}
