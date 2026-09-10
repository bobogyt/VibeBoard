/**
 * 内嵌 mini-RESP 假服务器启动器:node server/test/run-fake-redis.mjs [port]
 * 用途:本机无 Redis 时,为多 worker 冒烟/联调提供共享状态端点
 * (会话/限速计数/运行锁/审批 pub/sub;实现见 fake-redis-server.mjs)。
 */
import { createFakeRedisServer } from './fake-redis-server.mjs'

const port = Number(process.argv[2] || 6379)
const server = createFakeRedisServer()
server.listen(port, '127.0.0.1', () => {
  console.log(`[fake-redis] listening on http://127.0.0.1:${port}`)
})
