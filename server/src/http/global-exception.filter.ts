import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common'
import type { Response } from 'express'

/**
 * 全局异常过滤器:所有错误统一输出 { error } JSON,保持与原 Express 版完全一致:
 * - 带 status 的错误(HttpError / body-parser 400 等)→ 该状态码 + 原始 message
 * - 无 status 的未预期错误 → 500 + 固定文案「服务器内部错误」
 * - Nest 路由未匹配等框架异常 → 404 + 「Not Found」
 * 500 打全堆栈;>500 只记一行(上游/配置类问题)。
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>()
    let status = 500
    let message: string | null = null

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      const response = exception.getResponse()
      message =
        typeof response === 'string' ? response : (String((response as { message?: unknown }).message ?? exception.message))
      if (typeof message === 'string' && message.startsWith('Cannot ')) {
        message = 'Not Found'
      }
    } else {
      const e = exception as { status?: unknown; message?: string }
      if (typeof e?.status === 'number' && e.status >= 400) {
        status = e.status
        message = e.message ?? null
      }
    }

    if (status === 500) console.error('[server]', exception)
    else if (status > 500) console.warn(`[server] ${status}:`, (exception as Error)?.message)

    res.status(status).json({ error: message ?? '服务器内部错误' })
  }
}
