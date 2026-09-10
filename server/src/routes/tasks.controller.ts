import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { getArchivedTasks, restoreTasks, purgeTasks } from '../services/taskService'
import { AuthGuard } from '../http/guards'
import { UserId } from '../http/authed-request'

// 归档:列表 / 恢复 / 彻底删除(仅针对 archived=1 的行)
@UseGuards(AuthGuard)
@Controller('tasks')
export class TasksController {
  @Get('archived')
  async archived(@UserId() userId: string) {
    return { tasks: await getArchivedTasks(userId) }
  }

  @Post('restore')
  async restore(@UserId() userId: string, @Body() body: Record<string, unknown> | undefined) {
    return restoreTasks(userId, body?.taskIds)
  }

  @Post('purge')
  async purge(@UserId() userId: string, @Body() body: Record<string, unknown> | undefined) {
    return purgeTasks(userId, body?.taskIds)
  }
}
