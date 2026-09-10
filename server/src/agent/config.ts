const {
  GLM_API_KEY = '',
  GLM_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4',
  GLM_MODEL = 'glm-4.6',
  AGENT_MAX_STEPS = '10',
  AGENT_TIMEOUT_MS = '60000',
  AGENT_APPROVAL_TIMEOUT_MS = '300000',
} = process.env

export const agentConfig = {
  apiKey: GLM_API_KEY.trim(),
  baseUrl: GLM_BASE_URL.replace(/\/+$/, ''),
  model: GLM_MODEL,
  maxSteps: Math.max(1, Number(AGENT_MAX_STEPS) || 10),
  timeoutMs: Math.max(1000, Number(AGENT_TIMEOUT_MS) || 60000),
  // HIGH_RISK 工具的人工确认等待上限,超时按拒绝处理
  approvalTimeoutMs: Math.max(1000, Number(AGENT_APPROVAL_TIMEOUT_MS) || 300000),
}

export function glmConfigured(): boolean {
  return agentConfig.apiKey.length > 0
}
