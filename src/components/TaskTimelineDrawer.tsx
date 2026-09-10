import { useEffect, useMemo, useState } from 'react'
import { Drawer, Tag } from 'antd'
import dayjs from 'dayjs'
import { api } from '../lib/api'
import { COLUMN_TITLES } from '../constants'
import type { BoardState, ColumnId } from '../types'
import TimelineView from './TimelineView'
import type { TimelineItemData } from './TimelineView'

const COLUMN_COLORS: Record<ColumnId, string> = {
  // 与 app.css 的 --dot-* 保持一致,时间线节点色 = 所在列
  todo: '#8f939c',
  doing: '#e2a336',
  done: '#3fa871',
}

const MAX_ITEMS = 30

interface TaskTimelineDrawerProps {
  open: boolean
  onClose: () => void
  board: BoardState
}

/** 任务动态抽屉:全部任务按最近更新倒序的时间线,节点颜色 = 所在列 */
export default function TaskTimelineDrawer({ open, onClose, board }: TaskTimelineDrawerProps) {
  const [projectNames, setProjectNames] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    api
      .listProjects()
      .then(({ projects }) => {
        const map: Record<string, string> = {}
        for (const p of projects) map[p.id] = p.name
        setProjectNames(map)
      })
      .catch(() => {})
  }, [open])

  const items: TimelineItemData[] = useMemo(() => {
    const all = [...board.todo, ...board.doing, ...board.done]
    return all
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_ITEMS)
      .map((t) => ({
        key: t.id,
        color: COLUMN_COLORS[t.status],
        title: t.title,
        tag: <Tag>{COLUMN_TITLES[t.status]}</Tag>,
        description: (
          <div className="timeline-item-desc">
            {t.projectId && projectNames[t.projectId] && (
              <div className="timeline-project">📁 {projectNames[t.projectId]}</div>
            )}
            {t.description && <div>{t.description}</div>}
          </div>
        ),
        timeLabel: `更新 ${dayjs(t.updatedAt).format('MM-DD HH:mm')}`,
      }))
  }, [board, projectNames])

  return (
    <Drawer title="任务动态" placement="right" width={460} open={open} onClose={onClose}>
      <TimelineView items={items} emptyText="暂无任务动态" />
    </Drawer>
  )
}
