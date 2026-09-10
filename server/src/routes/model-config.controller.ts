import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common'
import { getAgentModelsInfo, saveModelConfig, deleteModelConfig } from '../services/modelConfigService'
import { AuthGuard } from '../http/guards'
import { UserId } from '../http/authed-request'

@UseGuards(AuthGuard)
@Controller('agent/models')
export class ModelConfigController {
  @Get()
  async info(@UserId() userId: string) {
    return getAgentModelsInfo(userId)
  }

  @Put()
  async save(@UserId() userId: string, @Body() body: Record<string, unknown> | undefined) {
    await saveModelConfig(userId, body ?? {})
    return getAgentModelsInfo(userId)
  }

  @Delete(':provider')
  async remove(@UserId() userId: string, @Param('provider') provider: string) {
    await deleteModelConfig(userId, provider)
    return getAgentModelsInfo(userId)
  }
}
