import { pool } from '../db'
import { agentConfig } from '../agent/config'
import { httpError } from '../http/http-error'

/**
 * 预置供应商目录:用户只需填 API Key + 选模型,baseUrl 由目录内置。
 * 新增供应商 = 加一行;baseUrl 可用 MODEL_BASE_URL_<ID> 环境变量覆盖(自建/代理场景)。
 */
const CATALOG = [
  {
    id: 'zhipu',
    label: '智谱 GLM',
    baseUrl: process.env.MODEL_BASE_URL_ZHIPU || 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4.6', 'glm-4.5-air', 'glm-4-flash'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: process.env.MODEL_BASE_URL_DEEPSEEK || 'https://api.deepseek.com',
    models: ['deepseek-chat'],
  },
]

export interface ResolvedModelConfig {
  source: 'user' | 'env'
  provider: string
  model: string
  apiKey: string
  baseUrl: string
}

function getProvider(providerId: unknown) {
  return CATALOG.find((p) => p.id === providerId) ?? null
}

export function getCatalog() {
  return CATALOG.map(({ id, label, models }) => ({ id, label, models }))
}

function maskKey(key: string): string {
  return key.length > 8 ? `${key.slice(0, 4)}***${key.slice(-4)}` : '***'
}

/**
 * 解析某用户实际生效的模型配置:用户自配优先;未配置时回退 server/.env 的 GLM_*;
 * 两者皆无返回 null(调用方转 503)。Key 只在此层使用,任何接口都不回传明文。
 */
export async function resolveModelConfig(userId: string): Promise<ResolvedModelConfig | null> {
  const [rows] = await pool.execute(
    'SELECT provider, api_key, active_model FROM user_model_configs WHERE user_id = ? AND is_active = 1',
    [userId],
  )
  const list = rows as unknown as Array<{ provider: string; api_key: string; active_model: string }>
  if (list.length > 0) {
    const row = list[0]
    const provider = getProvider(row.provider)
    if (!provider) return null
    return {
      source: 'user',
      provider: row.provider,
      model: row.active_model,
      apiKey: row.api_key,
      baseUrl: provider.baseUrl,
    }
  }
  if (agentConfig.apiKey) {
    return {
      source: 'env',
      provider: 'zhipu',
      model: agentConfig.model,
      apiKey: agentConfig.apiKey,
      baseUrl: agentConfig.baseUrl,
    }
  }
  return null
}

export async function getAgentModelsInfo(userId: string) {
  const [rows] = await pool.execute(
    'SELECT provider, api_key, active_model, is_active FROM user_model_configs WHERE user_id = ?',
    [userId],
  )
  const list = rows as unknown as Array<{
    provider: string
    api_key: string
    active_model: string
    is_active: number
  }>
  const configured: Record<string, { keyHint: string; activeModel: string }> = {}
  let active: { provider: string; model: string; source: 'user' | 'env' } | null = null
  for (const row of list) {
    configured[row.provider] = { keyHint: maskKey(row.api_key), activeModel: row.active_model }
    if (row.is_active === 1) active = { provider: row.provider, model: row.active_model, source: 'user' }
  }
  if (!active && agentConfig.apiKey) {
    active = { provider: 'zhipu', model: agentConfig.model, source: 'env' }
  }
  return { providers: getCatalog(), configured, active }
}

/** 保存(添加/更新密钥)并切换到该供应商:apiKey 缺省时复用已存密钥 */
export async function saveModelConfig(userId: string, { provider, model, apiKey }: { provider?: unknown; model?: unknown; apiKey?: unknown } = {}): Promise<void> {
  const entry = getProvider(provider)
  if (!entry) throw httpError(400, '不支持的模型供应商')
  const providerId = entry.id
  if (typeof model !== 'string' || !model.trim() || model.trim().length > 60) {
    throw httpError(400, '请填写模型名(不超过 60 字)')
  }
  const trimmedKey =
    apiKey === undefined || apiKey === null || String(apiKey).trim() === '' ? null : String(apiKey).trim()
  if (trimmedKey !== null && (trimmedKey.length < 8 || trimmedKey.length > 200)) {
    throw httpError(400, 'API Key 长度需在 8-200 之间')
  }

  const [rows] = await pool.execute('SELECT api_key FROM user_model_configs WHERE user_id = ? AND provider = ?', [
    userId,
    providerId,
  ])
  const stored = (rows as unknown as Array<{ api_key: string }>)[0]?.api_key
  const keyToStore = trimmedKey ?? stored ?? null
  if (!keyToStore) throw httpError(400, '请填写该供应商的 API Key')

  const now = Date.now()
  await pool.execute(
    `INSERT INTO user_model_configs (user_id, provider, api_key, active_model, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)
     ON DUPLICATE KEY UPDATE api_key = VALUES(api_key), active_model = VALUES(active_model),
       is_active = 1, updated_at = VALUES(updated_at)`,
    [userId, providerId, keyToStore, model.trim(), now, now],
  )
  await pool.execute('UPDATE user_model_configs SET is_active = 0 WHERE user_id = ? AND provider <> ?', [
    userId,
    providerId,
  ])
}

/** 删除某供应商的已存密钥;若它是当前激活配置,生效配置回退 .env 或未配置 */
export async function deleteModelConfig(userId: string, provider: string): Promise<{ ok: boolean }> {
  if (!getProvider(provider)) throw httpError(400, '不支持的模型供应商')
  await pool.execute('DELETE FROM user_model_configs WHERE user_id = ? AND provider = ?', [userId, provider])
  return { ok: true }
}
