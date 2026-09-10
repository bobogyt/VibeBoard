import { agentConfig } from './config.js'

function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}

/**
 * 调 OpenAI 兼容 /chat/completions;modelConfig = { apiKey, baseUrl, model },
 * 由 harness 按用户解析(用户自配优先,回退 .env)。返回原始 assistant 消息与解析后的 toolCalls。
 */
export async function chatCompletion({ messages, tools, modelConfig }) {
  if (!modelConfig?.apiKey || !modelConfig.baseUrl || !modelConfig.model) {
    throw httpError(503, 'AI 助手尚未配置模型,请在对话窗口右上角的设置中选择模型并填写 API Key')
  }

  let res
  try {
    res = await fetch(`${modelConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${modelConfig.apiKey}`,
      },
      body: JSON.stringify({ model: modelConfig.model, messages, ...(tools.length > 0 ? { tools } : {}) }),
      signal: AbortSignal.timeout(agentConfig.timeoutMs),
    })
  } catch (err) {
    const reason = err?.name === 'TimeoutError' || err?.code === 'UND_ERR_ABORTED' ? '请求超时' : err?.cause?.code ?? err?.message
    throw httpError(504, `GLM 请求失败:${reason}`)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.warn(`[glm] HTTP ${res.status}: ${body.slice(0, 300)}`)
    throw httpError(502, `GLM 服务返回 ${res.status}`)
  }

  const data = await res.json()
  const message = data.choices?.[0]?.message
  if (!message) throw httpError(502, 'GLM 返回缺少 choices.message')

  return {
    assistantMessage: message,
    content: typeof message.content === 'string' ? message.content : '',
    toolCalls: (message.tool_calls ?? []).map((tc, i) => ({
      id: tc.id ?? `call_${i}`,
      name: tc.function?.name ?? '',
      arguments: tc.function?.arguments ?? '{}',
    })),
    usage: data.usage ?? null,
  }
}
