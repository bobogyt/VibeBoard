import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common'
import { AUTOMATIONS, getAutomation } from '../automation/catalog'
import { runAutomationForUser } from '../automation/scheduler'
import {
  getUserAutomationStates,
  listNotifications,
  listRuns,
  markNotificationsRead,
  setAutomationEnabled,
} from '../automation/store'
import { httpError } from '../http/http-error'
import { AuthGuard } from '../http/guards'
import { UserId } from '../http/authed-request'

@UseGuards(AuthGuard)
@Controller('automations')
export class AutomationsController {
  /** 目录 + 当前用户的开关/最近运行状态 */
  @Get()
  async list(@UserId() userId: string) {
    const states = await getUserAutomationStates(userId)
    const byId = new Map(states.map((s) => [s.automation_id, s]))
    return {
      automations: AUTOMATIONS.map((def) => {
        const state = byId.get(def.id)
        return {
          id: def.id,
          name: def.name,
          description: def.description,
          type: def.type,
          cron: def.cron,
          cronLabel: def.cronLabel,
          enabled: (state?.enabled ?? 0) === 1,
          lastRunAt: state?.last_run_at ?? null,
        }
      }),
    }
  }

  @Put(':id')
  async setEnabled(@UserId() userId: string, @Param('id') id: string, @Body() body: Record<string, unknown> | undefined) {
    if (!getAutomation(id)) throw httpError(404, '自动化不存在')
    if (typeof body?.enabled !== 'boolean') throw httpError(400, 'enabled 需为布尔值')
    await setAutomationEnabled(userId, id, body.enabled)
    return { ok: true, enabled: body.enabled }
  }

  /** 立即执行一次(等同到点触发;未启用时报 409) */
  @Post(':id/run')
  async runNow(@UserId() userId: string, @Param('id') id: string) {
    const run = await runAutomationForUser(userId, id)
    return {
      status: run.status,
      summary: run.summary,
      error: run.error,
      createdAt: Number(run.created_at),
    }
  }

  @Get('runs')
  async runs(@UserId() userId: string, @Query('automationId') automationId?: string, @Query('limit') limit?: string) {
    if (automationId && !getAutomation(automationId)) throw httpError(404, '自动化不存在')
    const runs = await listRuns(userId, automationId ?? null, Number(limit) || 20)
    return { runs }
  }

  @Get('notifications')
  async notifications(@UserId() userId: string, @Query('limit') limit?: string) {
    return listNotifications(userId, Number(limit) || 30)
  }

  @Post('notifications/read')
  async markRead(@UserId() userId: string) {
    return { updated: await markNotificationsRead(userId) }
  }
}
