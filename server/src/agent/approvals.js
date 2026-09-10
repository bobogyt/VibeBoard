/**
 * 人工确认(Human Approval):HIGH_RISK 工具执行前挂起 runAgent,
 * 等待 HTTP 审批或超时自动拒绝。与 Agent 会话同生命周期(单进程内存)。
 */
const waiters = new Map() // sessionId -> { requestId, resolve, timer }

/** 挂起等待审批;超时自动按拒绝返回,Promise 永不 reject */
export function requestApproval(sessionId, requestId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const waiter = waiters.get(sessionId)
      if (waiter && waiter.requestId === requestId) {
        waiters.delete(sessionId)
        resolve({ approved: false, reason: 'timeout' })
      }
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    waiters.set(sessionId, { requestId, resolve, timer })
  })
}

/** 审批落点(HTTP 路由调用);返回 false 表示该请求不在等待中(已处理/已超时/非本人) */
export function resolveApproval(sessionId, requestId, approved) {
  const waiter = waiters.get(sessionId)
  if (!waiter || waiter.requestId !== requestId) return false
  clearTimeout(waiter.timer)
  waiters.delete(sessionId)
  waiter.resolve({ approved, reason: approved ? 'approved' : 'rejected' })
  return true
}
