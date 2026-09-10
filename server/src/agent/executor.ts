import type { Tool, ToolContext } from './registry'

export interface ToolOutcome {
  ok: boolean
  result?: unknown
  error?: string
}

/**
 * 执行单个工具调用:参数 JSON 解析 → 工具级校验 → 执行。
 * 任何失败都规整为 { ok:false, error } 回填给模型,由模型决定重试、换工具还是放弃。
 * HIGH_RISK 工具仅在 ctx.approved === true(人工确认通过)时放行——纵深防御,
 * 正常路径由 harness 在审批通过后才调用。
 */
export async function executeTool(tool: Tool | null, rawArguments: string | undefined, ctx: ToolContext = {}): Promise<ToolOutcome> {
  if (!tool) return { ok: false, error: '未知工具' }
  if (tool.risk === 'HIGH_RISK' && ctx.approved !== true) {
    return { ok: false, error: '该工具为高危操作,需要用户人工确认后才能执行' }
  }

  const checked = parseAndValidate(tool, rawArguments)
  if (checked.error) return { ok: false, error: checked.error }

  try {
    return { ok: true, result: await tool.execute(checked.args as Record<string, unknown>, ctx) }
  } catch (err) {
    return { ok: false, error: (err as Error).message || '工具执行失败' }
  }
}

/** 参数解析与工具级校验;审批前也要走,避免让用户确认一个连参数都不合法的调用 */
export function parseAndValidate(
  tool: Tool,
  rawArguments: string | undefined,
): { args?: Record<string, unknown>; error?: string } {
  let args: unknown
  try {
    args = typeof rawArguments === 'string' ? JSON.parse(rawArguments || '{}') : rawArguments ?? {}
  } catch {
    return { error: '工具参数不是合法 JSON' }
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return { error: '工具参数需为 JSON 对象' }
  }
  const invalid = tool.validate?.(args as Record<string, unknown>)
  if (invalid) return { error: invalid }
  return { args: args as Record<string, unknown> }
}
