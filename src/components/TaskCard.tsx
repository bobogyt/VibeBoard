import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { Button, Popconfirm, Tag } from 'antd'
import { DeleteOutlined, EditOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { Task, TaskPriority } from '../types'

interface TaskCardProps {
  task: Task
  /** 任一前置任务未完成 = 被阻塞 */
  blocked: boolean
  depsCount: number
  onEdit: (task: Task) => void
  onDelete: (id: string) => void
}

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  P0: 'red',
  P1: 'orange',
  P2: 'blue',
  P3: 'default',
}

export default function TaskCard({ task, blocked, depsCount, onEdit, onDelete }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { columnId: task.status },
  })
  const wasDraggingRef = useRef(false)

  useEffect(() => {
    if (isDragging) wasDraggingRef.current = true
  }, [isDragging])

  const style: CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
  }

  const due = task.dueDate ? dayjs(task.dueDate) : null
  const dueState = due
    ? task.status === 'done'
      ? 'plain'
      : due.isBefore(dayjs(), 'day')
        ? 'overdue'
        : due.isSame(dayjs(), 'day')
          ? 'today'
          : 'plain'
    : null

  return (
    <li
      className="task-card"
      ref={setNodeRef}
      style={style}
      data-dragging={isDragging || undefined}
      {...attributes}
      {...listeners}
      onClick={() => {
        // 拖拽释放后浏览器仍可能派发 click,此时不应打开编辑弹窗
        if (wasDraggingRef.current) {
          wasDraggingRef.current = false
          return
        }
        onEdit(task)
      }}
    >
      <div className="task-card__content">
        <p className="task-card__title">{task.title}</p>
        {task.description && <p className="task-card__desc">{task.description}</p>}
        {(task.priority || due || depsCount > 0) && (
          <div className="task-card__meta">
            {blocked && (
              <Tag className="task-card__tag" color="red">
                被阻塞
              </Tag>
            )}
            {!blocked && depsCount > 0 && (
              <Tag className="task-card__tag">前置 {depsCount}</Tag>
            )}
            {task.priority && (
              <Tag className="task-card__tag" color={PRIORITY_COLORS[task.priority]}>
                {task.priority}
              </Tag>
            )}
            {due && (
              <span className={`task-card__due task-card__due--${dueState}`}>
                {dueState === 'overdue' ? '已超期 ' : dueState === 'today' ? '今天到期 ' : ''}
                {due.format('MM-DD')}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="task-card__actions">
        <Button
          type="text"
          size="small"
          className="task-card__btn"
          icon={<EditOutlined />}
          aria-label={`编辑任务「${task.title}」`}
          onClick={(e) => {
            e.stopPropagation()
            onEdit(task)
          }}
        />
        <Popconfirm
          title="删除这条任务?"
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={(e) => {
            e?.stopPropagation()
            onDelete(task.id)
          }}
          onCancel={(e) => e?.stopPropagation()}
          onPopupClick={(e) => e.stopPropagation()}
        >
          <Button
            type="text"
            size="small"
            className="task-card__btn task-card__btn--danger"
            icon={<DeleteOutlined />}
            aria-label={`删除任务「${task.title}」`}
            onClick={(e) => e.stopPropagation()}
          />
        </Popconfirm>
      </div>
    </li>
  )
}
