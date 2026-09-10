/**
 * 内嵌 mini-RESP Redis 假服务器:仅实现并发设施用到的命令
 * (INFO/SET(PX NX)/GET/DEL/INCR/PEXPIRE/PUBLISH/SUBSCRIBE/PING/QUIT),
 * 让真实 ioredis 客户端走完整 TCP 协议,测试无需外部 Redis。
 */
import net from 'node:net'

export function createFakeRedisServer() {
  const store = new Map() // key -> { value: string, expireAt: number | null }
  const subscribed = new Set()

  const alive = (key) => {
    const entry = store.get(key)
    if (!entry) return false
    if (entry.expireAt !== null && entry.expireAt <= Date.now()) {
      store.delete(key)
      return false
    }
    return true
  }

  const simple = (s) => `+${s}\r\n`
  const int = (n) => `:${n}\r\n`
  const bulk = (s) => (s === null ? `$-1\r\n` : `$${Buffer.byteLength(String(s))}\r\n${String(s)}\r\n`)
  const array = (items) => `*${items.length}\r\n${items.map(bulk).join('')}`

  function exec(conn, args) {
    const cmd = String(args[0]).toUpperCase()
    switch (cmd) {
      case 'INFO':
        return bulk('role:master\r\nloading:0\r\n')
      case 'HELLO':
        // 标准 HELLO 应答(RESP2 扁平数组,proto=2):ioredis 6 以此完成协议协商
        return array(['server', 'redis', 'version', '7.0.0', 'proto', 2, 'id', 1, 'mode', 'standalone', 'role', 'master', 'modules', []])
      case 'PING':
        return simple('PONG')
      case 'SET': {
        const [key, value, ...opts] = args.slice(1)
        let px = null
        let nx = false
        for (let i = 0; i < opts.length; i++) {
          const o = String(opts[i]).toUpperCase()
          if (o === 'PX') px = Number(opts[++i])
          if (o === 'EX') px = Number(opts[++i]) * 1000
          if (o === 'NX') nx = true
        }
        if (nx && alive(key)) return bulk(null)
        store.set(key, { value: String(value), expireAt: px ? Date.now() + px : null })
        return simple('OK')
      }
      case 'EXPIRE': {
        const key = args[1]
        if (!alive(key)) return int(0)
        store.get(key).expireAt = Date.now() + Number(args[2]) * 1000
        return int(1)
      }
      case 'GET':
        return alive(args[1]) ? bulk(store.get(args[1]).value) : bulk(null)
      case 'DEL': {
        let n = 0
        for (const key of args.slice(1)) {
          if (alive(key)) {
            store.delete(key)
            n += 1
          }
        }
        return int(n)
      }
      case 'INCR': {
        const key = args[1]
        const current = alive(key) ? Number(store.get(key).value) : 0
        const next = current + 1
        const expireAt = alive(key) ? store.get(key).expireAt : null
        store.set(key, { value: String(next), expireAt })
        return int(next)
      }
      case 'PEXPIRE': {
        const key = args[1]
        if (!alive(key)) return int(0)
        store.get(key).expireAt = Date.now() + Number(args[2])
        return int(1)
      }
      case 'PUBLISH': {
        const [, channel, payload] = args
        for (const target of subscribed) {
          target.write(array(['message', channel, payload]))
        }
        return int(subscribed.size)
      }
      case 'SUBSCRIBE': {
        subscribed.add(conn)
        return array(['subscribe', args[1], subscribed.size])
      }
      case 'QUIT':
        conn.end()
        return simple('OK')
      default:
        return simple(`ERR unknown command '${cmd}'`)
    }
  }

  /* RESP 解析:*N 头 + N 个 $len bulk;半包缓冲到下一事件 */
  const tcp = net.createServer((conn) => {
    let buffer = Buffer.alloc(0)
    conn.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      for (;;) {
        const parsed = tryParse(buffer)
        if (!parsed) break
        buffer = parsed.rest
        conn.write(exec(conn, parsed.args))
      }
    })
  })
  return tcp
}

function tryParse(buffer) {
  if (buffer[0] !== 0x2a) return null // '*'
  const headEnd = buffer.indexOf('\r\n')
  if (headEnd === -1) return null
  const count = Number(buffer.slice(1, headEnd).toString())
  if (!Number.isInteger(count)) return null
  let offset = headEnd + 2
  const args = []
  for (let i = 0; i < count; i++) {
    if (buffer[offset] !== 0x24) return null // '$'
    const lenEnd = buffer.indexOf('\r\n', offset)
    if (lenEnd === -1) return null
    const len = Number(buffer.slice(offset + 1, lenEnd))
    if (buffer.length < lenEnd + 2 + len + 2) return null
    args.push(buffer.slice(lenEnd + 2, lenEnd + 2 + len).toString())
    offset = lenEnd + 2 + len + 2
  }
  return { args, rest: buffer.slice(offset) }
}
