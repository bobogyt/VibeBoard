import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common'
import { listMemories, addMemory, deleteMemory } from '../services/memoryService'
import { AuthGuard } from '../http/guards'
import { UserId } from '../http/authed-request'

// 长期偏好记忆:列表 / 手动添加 / 删除
@UseGuards(AuthGuard)
@Controller('memories')
export class MemoriesController {
  @Get()
  async list(@UserId() userId: string) {
    return { memories: await listMemories(userId) }
  }

  @Post()
  async add(@UserId() userId: string, @Body() body: Record<string, unknown> | undefined) {
    return { memory: await addMemory(userId, body?.content) }
  }

  @Delete(':id')
  async remove(@UserId() userId: string, @Param('id') id: string) {
    return deleteMemory(userId, id)
  }
}
