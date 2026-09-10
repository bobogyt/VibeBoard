import type { AgentEvent } from './session'

export type ToolRisk = 'READ' | 'SAFE_WRITE' | 'HIGH_RISK'

/** 工具执行上下文:userId 永远来自 requireAuth 注入,绝不由模型传参 */
export interface ToolContext {
  userId?: string
  approved?: boolean
  /** 只读会话(无人值守自动化):拒绝一切非 READ 工具,纵深防御第二层 */
  readOnly?: boolean
}

export interface Tool {
  name: string
  risk: ToolRisk
  description: string
  /** OpenAI 兼容 JSON Schema(发给 GLM 的 parameters) */
  parameters: Record<string, unknown>
  /** 参数校验:非法返回错误文案 */
  validate?: (args: Record<string, unknown>) => string | null
  /** 审批预览(HIGH_RISK 工具):可为异步,拿到 userId 后可读看板富化 */
  preview?: (args: Record<string, unknown>, ctx: { userId?: string }) => unknown | Promise<unknown>
  execute: (args: Record<string, unknown>, ctx: ToolContext) => unknown | Promise<unknown>
}

const tools = new Map<string, Tool>()

export function registerTool(tool: Tool): void {
  tools.set(tool.name, tool)
}

export function getTool(name: string): Tool | null {
  return tools.get(name) ?? null
}

/** 汇总为 OpenAI 兼容 tools 数组,发给 GLM;readOnly 时只暴露 READ 工具(无人值守自动化) */
export function listSchemas(readOnly = false): Array<{ type: string; function: Record<string, unknown> }> {
  return [...tools.values()]
    .filter((t) => (readOnly ? t.risk === 'READ' : true))
    .map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }))
}

export type { AgentEvent }
