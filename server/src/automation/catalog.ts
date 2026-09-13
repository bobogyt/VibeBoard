/** 内置自动化目录:新增自动化 = 加一行(与模型供应商目录同一模式) */

export interface AutomationDef {
  id: string
  name: string
  description: string
  /** agent = 无人值守只读 Agent 运行;scan = 确定性扫描(不经模型) */
  type: 'agent' | 'scan'
  /** croner 五段表达式,固定 Asia/Shanghai */
  cron: string
  cronLabel: string
  /** agent 类型的用户消息(readOnly 模式:模型只能用 READ 工具) */
  prompt?: string
}

export const AUTOMATIONS: AutomationDef[] = [
  {
    id: 'daily-plan',
    name: '每日计划',
    type: 'agent',
    cron: '0 9 * * *',
    cronLabel: '每天 09:00',
    description: '每天早上让 AI 助手查看看板与项目,给出当天建议的执行顺序,并指出逾期或被阻塞的任务。只读运行,不会改动任务。',
    prompt:
      '请为我制定今天的执行计划:先查看当前任务与项目状态,按优先级与截止时间给出今天建议专注的任务顺序;如有逾期或被前置任务阻塞的事项请明确指出,并简要说明理由。只读取数据,不要创建或修改任务。',
  },
  {
    id: 'weekly-review',
    name: '每周复盘',
    type: 'agent',
    cron: '0 18 * * 5',
    cronLabel: '每周五 18:00',
    description: '每周五傍晚复盘本周:完成了什么、哪些逾期或被阻塞、下周的建议。只读运行,不会改动任务。',
    prompt:
      '请复盘我本周的任务情况:查看当前任务与项目,总结已完成的工作、仍然逾期或被前置阻塞的事项,并给出下周的安排建议。只读取数据,不要创建或修改任务。',
  },
  {
    id: 'deadline-reminder',
    name: '截止日期提醒',
    type: 'scan',
    cron: '30 8 * * *',
    cronLabel: '每天 08:30',
    description: '每天早上检查 48 小时内即将到期的未完成任务,并发送提醒通知。',
  },
  {
    id: 'overdue-blocked-scan',
    name: '逾期与阻塞盘点',
    type: 'scan',
    cron: '0 20 * * *',
    cronLabel: '每天 20:00',
    description: '每天晚上盘点全部逾期任务,以及因前置任务未完成而被阻塞的任务。',
  },
  {
    id: 'github-pr-sync',
    name: 'GitHub PR 同步',
    type: 'scan',
    cron: '*/30 * * * *',
    cronLabel: '每 30 分钟',
    description:
      '定期检查任务关联的 GitHub PR:发现已合并时自动把对应任务移至 Done 并更新关联状态。需要项目绑定 GitHub 仓库且任务已关联 PR。',
  },
]

export function getAutomation(id: string): AutomationDef | null {
  return AUTOMATIONS.find((a) => a.id === id) ?? null
}
