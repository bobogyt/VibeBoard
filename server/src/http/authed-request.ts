import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'

/** 经 AuthGuard 校验后的请求:挂 userId 与原始 token */
export interface AuthedRequest extends Request {
  userId?: string
  token?: string
}

export function getRequest(ctx: ExecutionContext): AuthedRequest {
  return ctx.switchToHttp().getRequest<AuthedRequest>()
}

/** 取当前登录用户 id(路由挂在 AuthGuard 之后,必有值) */
export const UserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  return getRequest(ctx).userId as string
})

/** 取当前请求的 Bearer token */
export const AuthToken = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  return getRequest(ctx).token as string
})
