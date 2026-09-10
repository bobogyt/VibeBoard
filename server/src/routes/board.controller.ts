import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common'
import { getBoard, saveBoard, withBoardLock } from '../board'
import { AuthGuard } from '../http/guards'
import { UserId } from '../http/authed-request'

@UseGuards(AuthGuard)
@Controller('board')
export class BoardController {
  @Get()
  async getBoardByUser(@UserId() userId: string) {
    const { state, cacheHit } = await getBoard(userId)
    console.log(`[board] GET user=${userId} cache=${cacheHit ? 'HIT' : 'MISS'}`)
    return { columns: state }
  }

  @Put()
  async saveBoardByUser(@UserId() userId: string, @Body() body: unknown) {
    // 与 Agent 的读-改-写共用用户级锁,防止全量保存互相覆盖
    await withBoardLock(userId, () => saveBoard(userId, body))
    return { ok: true }
  }
}
