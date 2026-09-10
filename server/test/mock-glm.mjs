import http from 'node:http'

/**
 * 极简 OpenAI 兼容 /chat/completions mock,仅用于本地验证 Agent Loop。
 * respond(messages) 返回 { content } 或 { toolCalls: [{ name, arguments }] }。
 */
export function createMockGlm(respond) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
      res.writeHead(404).end()
      return
    }
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      const { messages } = JSON.parse(body)
      const out = respond(messages)
      const message =
        out.content !== undefined
          ? { role: 'assistant', content: out.content }
          : {
              role: 'assistant',
              content: null,
              tool_calls: out.toolCalls.map((call, i) => ({
                id: `mock_${i}_${Math.random().toString(36).slice(2, 8)}`,
                type: 'function',
                function: {
                  name: call.name,
                  arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments),
                },
              })),
            }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message }], usage: { total_tokens: 42 } }))
    })
  })
  return server
}

/** 从消息里取第 n 个工具结果(已 JSON 解析) */
export function toolResultAt(messages, index) {
  const toolMsgs = messages.filter((m) => m.role === 'tool')
  const raw = toolMsgs.at(index)?.content
  return raw ? JSON.parse(raw) : null
}
