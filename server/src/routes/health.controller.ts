import { Controller, Get } from '@nestjs/common'
import { healthCheck } from '../db'
import { redisStatus } from '../cache'

@Controller('health')
export class HealthController {
  @Get()
  async check() {
    const mysql = await healthCheck()
    return { mysql, redis: redisStatus() }
  }
}
