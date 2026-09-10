import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { runAgent, getAgentSession } from '../agent/harness'
import { resolveApproval } from '../agent/approvals'
import { httpError } from '../http/http-error'
import { AuthGuard, AgentRateLimitGuard } from '../http/guards'
import { UserId } from '../http/authed-request'

@UseGuards(AuthGuard)
@Controller('agent')
export class AgentController {
  @Post('run')
  @UseGuards(AgentRateLimitGuard)
  async run(@UserId() userId: string, @Body() body: Record<string, unknown> | undefined) {
    return runAgent(userId, body?.message)
  }

  /** 流式执行:SSE 逐工具步骤推送可视化事件(label 级,不含推理内容与原始参数)。
   * 首个事件发出前的错误(未配置模型 503、运行中 409、限流 429 等)仍在
   * 响应头写出之前抛出,照常走统一异常过滤器返回 JSON;运行本身的失败由 final 事件表达。 */
  @Post('run/stream')
  @UseGuards(AgentRateLimitGuard)
  async runStream(@UserId() userId: string, @Body() body: Record<string, unknown> | undefined, @Res() res: Response) {
    let opened = false
    let ping: NodeJS.Timeout | null = null
    const open = () => {
      if (opened) return
      opened = true
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      res.flushHeaders?.()
      // 长模型调用期间定期发注释帧,防止中间代理因空闲断链
      ping = setInterval(() => res.write(': ping\n\n'), 15_000)
    }
    try {
      await runAgent(userId, body?.message, {
        onEvent: (event) => {
          open()
          res.write(`data: ${JSON.stringify(event)}\n\n`)
        },
      })
    } finally {
      if (ping) clearInterval(ping)
    }
    res.end()
  }

  @Get('sessions/:id')
  getSessionView(@Param('id') id: string, @UserId() userId: string) {
    const session = getAgentSession(id, userId)
    if (!session) throw httpError(404, '会话不存在')
    return { session }
  }

  /** 高危操作人工确认:仅会话属主可审批;不在等待中(已处理/已超时)返回 409 */
  @Post('sessions/:id/approval')
  async approval(
    @Param('id') id: string,
    @UserId() userId: string,
    @Body() body: Record<string, unknown> | undefined,
  ) {
    const session = getAgentSession(id, userId)
    if (!session) throw httpError(404, '会话不存在')
    const { requestId, approved } = body ?? {}
    if (typeof requestId !== 'string' || typeof approved !== 'boolean') {
      throw httpError(400, 'requestId 与 approved 必填')
    }
    const ok = resolveApproval(id, requestId, approved)
    if (!ok) throw httpError(409, '该请求不在等待确认')
    return { ok: true }
  }
}
