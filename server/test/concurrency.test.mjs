/**
 * 并发设施测试:Redis 计数限速 / 单用户单运行锁 / 审批跨进程投递。
 *
 * 两层验证:
 *  1) 内嵌 mini-RESP 假服务器(fake-redis-server.mjs)走真实 ioredis 客户端与 TCP 协议,
 *     验证限速窗口/运行锁的 Redis 命令语义与降级路径;
 *  2) FakeRedisClient 直连注入 ApprovalRouter/RunSlotStore,确定性验证审批跨 worker 路由。
 * 不依赖外部 MySQL/Redis。运行:npm run build:server && node server/test/concurrency.test.mjs
 */

// 必须在动态 import 业务模块前启动假服务器并指定端口(cache.js 在模块加载时读取 env)
const { createFakeRedisServer } = await import('./fake-redis-server.mjs')
const fakeServer = createFakeRedisServer()
await new Promise((resolve) => fakeServer.listen(0, '127.0.0.1', resolve))
const { port } = fakeServer.address()
process.env.REDIS_HOST = '127.0.0.1'
process.env.REDIS_PORT = String(port)

const { redis } = await import('../dist/cache.js')
const { RedisRateLimiter, MemoryRateLimiter } = await import('../dist/util/rateLimit.js')
const { acquireRunSlot, releaseRunSlot } = await import('../dist/agent/session.js')
const { ApprovalRouter } = await import('../dist/agent/approvals.js')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const deadline = Date.now() + 5000
while (redis.status !== 'ready') {
  if (Date.now() > deadline) {
    console.error('FAIL: ioredis 未连接到假服务器')
    process.exit(1)
  }
  await sleep(20)
}

/* ---------- 断言工具 ---------- */
let passed = 0
function check(name, condition) {
  if (!condition) {
    console.error(`FAIL: ${name}`)
    process.exitCode = 1
  } else {
    passed += 1
    console.log(`PASS: ${name}`)
  }
}

/* ---------- 第一层:真实 ioredis × TCP 假服务器 ---------- */

// 限速器:Redis 固定窗口计数
{
  const limiter = new RedisRateLimiter(redis, 't-limit', 60_000, 3)
  check('限速:窗口内前 3 次放行', (await limiter.tryTake('k1')) && (await limiter.tryTake('k1')) && (await limiter.tryTake('k1')))
  check('限速:第 4 次拒绝', (await limiter.tryTake('k1')) === false)
  check('限速:不同 key 独立计数', (await limiter.tryTake('k2')) === true)

  const expired = new RedisRateLimiter(redis, 't-exp', 50, 1)
  check('限速:过期后窗口重置', (await expired.tryTake('k')) === true && (await expired.tryTake('k')) === false)
  await sleep(60)
  check('限速:TTL 到期后重新放行', (await expired.tryTake('k')) === true)
}

// 限速器:Redis 不可用降级内存
{
  const offline = new RedisRateLimiter({ status: 'end' }, 't-off', 60_000, 2)
  check('降级:未连接时走内存且计数正确', (await offline.tryTake('m')) && (await offline.tryTake('m')) && (await offline.tryTake('m')) === false)

  const erring = new RedisRateLimiter({ status: 'ready', incr: async () => { throw new Error('boom') } }, 't-err', 60_000, 2)
  check('降级:命令报错落回内存计数', (await erring.tryTake('m')) && (await erring.tryTake('m')) && (await erring.tryTake('m')) === false)

  const memory = new MemoryRateLimiter(60_000, 1)
  check('降级:纯内存限速器语义', (await memory.tryTake('x')) === true && (await memory.tryTake('x')) === false)
}

// 单运行锁:Redis NX 跨进程互斥
{
  check('锁:首次获取成功', (await acquireRunSlot('u1')) === true)
  check('锁:占用期间重复获取被拒', (await acquireRunSlot('u1')) === false)
  check('锁:不同用户互不影响', (await acquireRunSlot('u2')) === true)
  check('锁:标记写入 Redis', (await redis.get('agent:running:u1')) === '1')

  await releaseRunSlot('u1')
  check('锁:释放后可重新获取', (await acquireRunSlot('u1')) === true)
  await releaseRunSlot('u1')
  await releaseRunSlot('u2')

  // 并发竞争:10 个并发请求同一用户,恰好一个成功
  const results = await Promise.all(Array.from({ length: 10 }, () => acquireRunSlot('u3')))
  check('锁:10 并发恰好 1 个获位', results.filter(Boolean).length === 1)
  await releaseRunSlot('u3')
}

/* ---------- 第二层:FakeRedisClient 注入,审批跨 worker 路由 ---------- */

/** 模拟 Redis 语义的最小 client(INCR/SETPX/GET/DEL/PEXPIRE/PUBLISH/SUBSCRIBE),共享 broker 存储 */
class FakeRedis {
  constructor(broker, name) {
    this.broker = broker
    this.name = name
    this.status = 'ready'
    this.messageHandlers = []
  }
  async set(key, value, ...opts) {
    let px = null
    let nx = false
    for (let i = 0; i < opts.length; i++) {
      const o = String(opts[i]).toUpperCase()
      if (o === 'PX') px = Number(opts[++i])
      if (o === 'NX') nx = true
    }
    return this.broker.set(key, String(value), px, nx)
  }
  async get(key) {
    return this.broker.get(key)
  }
  async del(key) {
    return this.broker.del(key)
  }
  async incr(key) {
    return this.broker.incr(key)
  }
  async pexpire(key, ms) {
    return this.broker.pexpire(key, ms)
  }
  async publish(channel, message) {
    return this.broker.publish(channel, message)
  }
  duplicate() {
    return new FakeRedis(this.broker, `${this.name}+sub`)
  }
  on(event, handler) {
    if (event === 'message') this.messageHandlers.push(handler)
    return this
  }
  async subscribe() {
    this.broker.subscribers.push(this)
    return 1
  }
  _deliver(channel, message) {
    for (const handler of this.messageHandlers) handler(channel, message)
  }
}

class FakeBroker {
  store = new Map()
  subscribers = []
  alive(key) {
    const entry = this.store.get(key)
    if (!entry) return null
    if (entry.expireAt !== null && entry.expireAt <= Date.now()) {
      this.store.delete(key)
      return null
    }
    return entry
  }
  set(key, value, px, nx) {
    if (nx && this.alive(key)) return null
    this.store.set(key, { value, expireAt: px ? Date.now() + px : null })
    return 'OK'
  }
  get(key) {
    return this.alive(key)?.value ?? null
  }
  del(key) {
    return this.alive(key) ? (this.store.delete(key), 1) : 0
  }
  incr(key) {
    const current = Number(this.alive(key)?.value ?? 0)
    const next = current + 1
    const expireAt = this.alive(key)?.expireAt ?? null
    this.store.set(key, { value: String(next), expireAt })
    return next
  }
  pexpire(key, ms) {
    if (!this.alive(key)) return 0
    this.store.get(key).expireAt = Date.now() + ms
    return 1
  }
  publish(channel, message) {
    for (const sub of this.subscribers) sub._deliver(channel, message)
    return this.subscribers.length
  }
}

{
  const broker = new FakeBroker()
  // worker A:持有会话;worker B:收到审批 POST(共享 broker 存储,各自独立连接)
  const clientA = new FakeRedis(broker, 'A')
  const clientB = new FakeRedis(broker, 'B')
  const routerA = new ApprovalRouter(clientA, () => clientA.duplicate())
  const routerB = new ApprovalRouter(clientB, () => clientB.duplicate())

  const pending = routerA.requestApproval('s1', 'r1', 5000)
  check('审批:等待标记写入共享存储', (await clientB.get('agent:approval:s1')) === 'r1')

  // 审批落在 worker B:本地无 waiter → 查标记 → pub/sub 投递 → worker A 的订阅者收到并 resolve
  check('审批:B 端 resolve 跨 worker 返回 true', (await routerB.resolveApproval('s1', 'r1', true)) === true)
  check('审批:A 端挂起的 Promise 收到决定', (await pending).approved === true)
  check('审批:resolve 后标记清除', (await clientB.get('agent:approval:s1')) === null)

  // requestId 不匹配的投递不生效
  const pending2 = routerA.requestApproval('s2', 'r2', 5000)
  await routerB.resolveApproval('s2', 'wrong', true)
  await sleep(50)
  check('审批:requestId 不匹配时忽略投递', (await clientB.get('agent:approval:s2')) === 'r2')
  check('审批:正确 requestId 仍可 resolve', (await routerB.resolveApproval('s2', 'r2', false)) === true)
  check('审批:拒绝原因正确', (await pending2).reason === 'rejected')

  // 不在等待中 → false(路由层 409 语义)
  check('审批:非等待请求返回 false', (await routerB.resolveApproval('nope', 'r-x', true)) === false)

  // 本地命中优先于跨 worker 投递(同一 worker 内的原始路径)
  const pending3 = routerA.requestApproval('s3', 'r3', 5000)
  check('审批:本地 resolve 返回 true', (await routerA.resolveApproval('s3', 'r3', true)) === true)
  check('审批:本地 Promise 收到决定', (await pending3).approved === true)

  // 超时自动拒绝,标记随之消失
  const pending4 = routerA.requestApproval('s4', 'r4', 80)
  const decision = await pending4
  await sleep(20)
  check('审批:超时按拒绝返回', decision.approved === false && decision.reason === 'timeout')
  check('审批:超时后标记清除', (await clientB.get('agent:approval:s4')) === null)
}

redis.disconnect()
fakeServer.close()
console.log(`\n${passed} checks passed${process.exitCode ? '(含失败项)' : ''}`)
process.exit(process.exitCode ?? 0)
