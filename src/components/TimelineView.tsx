import { Empty, Timeline } from 'antd'
import type { ReactNode } from 'react'

export interface TimelineItemData {
  key: string
  /** 节点颜色:antd 预设色名或十六进制 */
  color?: string
  title: ReactNode
  description?: ReactNode
  /** 左侧时间标签,如 "09-09 14:30" 或 "2026-08-01" */
  timeLabel: string
  /** 标题右侧的附加标记(如状态 Tag) */
  tag?: ReactNode
}

interface TimelineViewProps {
  items: TimelineItemData[]
  emptyText?: string
}

/**
 * 通用时间线组件:按传入顺序渲染(调用方负责排序),
 * 任务动态与项目管理各自的展现差异由调用方组装 items 决定。
 */
export default function TimelineView({ items, emptyText = '暂无数据' }: TimelineViewProps) {
  if (items.length === 0) {
    return <Empty description={emptyText} style={{ marginTop: 48 }} />
  }
  return (
    <Timeline
      mode="left"
      items={items.map((it) => ({
        key: it.key,
        color: it.color,
        label: <span className="timeline-time">{it.timeLabel}</span>,
        children: (
          <div className="timeline-item">
            <div className="timeline-item-head">
              <span className="timeline-item-title">{it.title}</span>
              {it.tag}
            </div>
            {it.description && <div className="timeline-item-desc">{it.description}</div>}
          </div>
        ),
      }))}
    />
  )
}
