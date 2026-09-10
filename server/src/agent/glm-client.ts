import { agentConfig } from './config'
import { httpError } from '../http/http-error'

export interface ChatMessage {
  role: string
  content?: string | null
  tool_calls?: Array<{
    id?: string
    type?: string
    function?: { name?: string; arguments?: string }
  }>
  tool_call_id?: string
}

export interface ModelConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export interface ChatCompletionResult {
  assistantMessage: ChatMessage
  content: string
  toolCalls: Array<{ id: string; name: string; arguments: string }>
  usage: { total_tokens?: number } | null
}

/**
 * 调 OpenAI 兼容 /chat/completions;modelConfig = { apiKey, baseUrl, model },
 * 由 harness 按用户解析(用户自配优先,回退 .env)。返回原始 assistant 消息与解析后的 toolCalls。
 */
export async function chatCompletion({
  messages,
  tools,
  modelConfig,
}: {
  messages: ChatMessage[]
  tools: Array<Record<string, unknown>>
  modelConfig: ModelConfig
}): Promise<ChatCompletionResult> {
  if (!modelConfig?.apiKey || !modelConfig.baseUrl || !modelConfig.model) {
    throw httpError(503, 'AI 助手尚未配置模型,请在对话窗口右上角的设置中选择模型并填写 API Key')
  }

  let res: Response
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
    const e = err as { name?: string; code?: string; message?: string; cause?: { code?: string } }
    const reason = e?.name === 'TimeoutError' || e?.code === 'UND_ERR_ABORTED' ? '请求超时' : e?.cause?.code ?? e?.message
    throw httpError(504, `GLM 请求失败:${reason}`)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.warn(`[glm] HTTP ${res.status}: ${body.slice(0, 300)}`)
    throw httpError(502, `GLM 服务返回 ${res.status}`)
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: ChatMessage }>
    usage?: { total_tokens?: number } | null
  }
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
