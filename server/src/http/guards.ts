import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { requireAuthToken } from '../services/authService'
import { createRateLimiter } from '../util/rateLimit'
import { httpError } from './http-error'
import { getRequest } from './authed-request'

/** 鉴权 Guard:校验 Bearer token,通过后把 userId/token 挂到请求上(对应原 requireAuth 中间件) */
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = getRequest(ctx)
    const { token, userId } = await requireAuthToken(req.get('authorization'))
    req.userId = userId
    req.token = token
    return true
  }
}

const TOO_MANY = '尝试过于频繁,请稍后再试'

/* ---------- 认证接口限速(防暴力破解) ---------- */
// 登录:同 IP+用户名 10 分钟 8 次,同 IP 10 分钟 40 次(防换用户名绕过);注册:同 IP 每小时 10 次
const LOGIN_WINDOW_MS = 10 * 60_000
const loginKeyLimiter = createRateLimiter({ windowMs: LOGIN_WINDOW_MS, max: 8 })
const loginIpLimiter = createRateLimiter({ windowMs: LOGIN_WINDOW_MS, max: 40 })
const registerLimiter = createRateLimiter({ windowMs: 60 * 60_000, max: 10 })

@Injectable()
export class RegisterRateLimitGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = getRequest(ctx)
    if (!registerLimiter.tryTake(String(req.ip))) throw httpError(429, TOO_MANY)
    return true
  }
}

@Injectable()
export class LoginIpRateLimitGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = getRequest(ctx)
    if (!loginIpLimiter.tryTake(String(req.ip))) throw httpError(429, TOO_MANY)
    return true
  }
}

@Injectable()
export class LoginKeyRateLimitGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = getRequest(ctx)
    const key = `${String(req.ip)}|${String((req.body as Record<string, unknown> | undefined)?.username ?? '').toLowerCase()}`
    if (!loginKeyLimiter.tryTake(key)) throw httpError(429, TOO_MANY)
    return true
  }
}

/* ---------- Agent 限速:按用户每小时 20 次(GLM 调用有成本) ---------- */
// 必须挂在 AuthGuard 之后(依赖 req.userId);run 内部还有单用户单运行会话守卫
const agentLimiter = createRateLimiter({ windowMs: 60 * 60_000, max: 20 })

@Injectable()
export class AgentRateLimitGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = getRequest(ctx)
    if (!agentLimiter.tryTake(String(req.userId))) throw httpError(429, TOO_MANY)
    return true
  }
}
