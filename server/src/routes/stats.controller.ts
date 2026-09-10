import { Controller, Get, UseGuards } from '@nestjs/common'
import { getStats } from '../services/statsService'
import { AuthGuard } from '../http/guards'
import { UserId } from '../http/authed-request'

@UseGuards(AuthGuard)
@Controller('stats')
export class StatsController {
  @Get()
  async stats(@UserId() userId: string) {
    return getStats(userId)
  }
}
