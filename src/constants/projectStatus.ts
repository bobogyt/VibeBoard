import type { ProjectStatus } from '../types'

/** 项目状态:中文标签 + antd Tag 颜色(完整生命周期) */
export const PROJECT_STATUSES: Record<ProjectStatus, { label: string; color: string }> = {
  planning: { label: '规划中', color: 'default' },
  developing: { label: '开发中', color: 'processing' },
  testing: { label: '测试中', color: 'warning' },
  released: { label: '已发布', color: 'success' },
  maintaining: { label: '维护中', color: 'cyan' },
  paused: { label: '已暂停', color: 'error' },
  archived: { label: '已归档', color: 'default' },
}

export const PROJECT_STATUS_OPTIONS = (
  Object.entries(PROJECT_STATUSES) as [ProjectStatus, { label: string; color: string }][]
).map(([value, { label }]) => ({ value, label }))

/** 时间线等自绘场景使用的节点色(十六进制) */
export const PROJECT_STATUS_DOT: Record<ProjectStatus, string> = {
  planning: '#9ca3af',
  developing: '#5e6ad2',
  testing: '#e2a336',
  released: '#3fa871',
  maintaining: '#06b6d4',
  paused: '#d92c20',
  archived: '#6b7280',
}
