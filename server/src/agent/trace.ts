/** Trace:写入 session.steps 并同步落 [agent] 结构化日志;只记录模型调用/工具调用/入参/结果/错误/步数/时长 */
import { stepLabel } from './stepLabel'
import type { AgentSession } from './session'

function preview(value: unknown): string | undefined {
  const raw = JSON.stringify(value)
  return raw === undefined ? undefined : raw.length > 300 ? `${raw.slice(0, 300)}…` : raw
}

export function traceModel(
  session: AgentSession,
  { duration, toolCalls, usage }: { duration: number; toolCalls: string[]; usage: { total_tokens?: number } | null },
): void {
  session.steps.push({
    step: session.currentStep,
    type: 'model',
    durationMs: duration,
    toolCalls,
    usageTokens: usage?.total_tokens ?? null,
  })
  console.log(
    `[agent] session=${session.sessionId} step=${session.currentStep} model duration=${duration}ms toolCalls=${JSON.stringify(toolCalls)}`,
  )
}

export function traceTool(
  session: AgentSession,
  { name, args, ok, duration, result, error }: { name: string; args: unknown; ok: boolean; duration: number; result?: unknown; error?: string },
): void {
  session.steps.push({
    step: session.currentStep,
    type: 'tool',
    name,
    args,
    ok,
    durationMs: duration,
    ...(ok ? { result } : { error }),
  })
  session.toolCalls.push({ step: session.currentStep, name, args })
  session.toolResults.push({ step: session.currentStep, name, ok, ...(ok ? { result: preview(result) } : { error }) })
  // 可视化事件:只带 label 级摘要,不带原始参数/完整结果
  if (typeof session.emit === 'function') {
    session.emit({
      type: 'tool',
      step: session.currentStep,
      name,
      ok,
      label: stepLabel(name, args, ok, ok ? result : null),
      durationMs: duration,
      ...(ok ? {} : { error }),
    })
  }
  console.log(
    `[agent] session=${session.sessionId} step=${session.currentStep} tool=${name} ok=${ok} duration=${duration}ms ${
      ok ? `result=${preview(result)}` : `error=${JSON.stringify(error)}`
    }`,
  )
}

export function traceFinal(session: AgentSession, totalDuration: number): void {
  session.steps.push({ type: 'final', status: session.status, steps: session.currentStep, durationMs: totalDuration })
  console.log(
    `[agent] session=${session.sessionId} final status=${session.status} steps=${session.currentStep} duration=${totalDuration}ms`,
  )
}
