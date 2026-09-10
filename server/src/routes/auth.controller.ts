import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { register, login, logout, me } from '../services/authService'
import { AuthGuard, LoginIpRateLimitGuard, LoginKeyRateLimitGuard, RegisterRateLimitGuard } from '../http/guards'
import { AuthToken, UserId, type AuthedRequest } from '../http/authed-request'

@Controller('auth')
export class AuthController {
  @Post('register')
  @UseGuards(RegisterRateLimitGuard)
  async register(@Body() body: Record<string, unknown> | undefined) {
    const { username, password } = body ?? {}
    return register(username, password)
  }

  @Post('login')
  @UseGuards(LoginIpRateLimitGuard, LoginKeyRateLimitGuard)
  async login(@Body() body: Record<string, unknown> | undefined) {
    const { username, password } = body ?? {}
    return login(username, password)
  }

  @Post('logout')
  async logout(@Req() req: AuthedRequest) {
    return logout(req.get('authorization')?.replace(/^Bearer\s+/i, ''))
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@UserId() userId: string, @AuthToken() token: string) {
    return me(userId, token)
  }
}
