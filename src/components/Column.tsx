import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Button } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { COLUMN_TITLES } from '../constants'
import type { ColumnId, Task } from '../types'
import TaskCard from './TaskCard'

interface ColumnProps {
  columnId: ColumnId
  tasks: Task[]
  highlighted: boolean
  /** 全看板任务映射,用于计算依赖阻塞标识 */
  taskMap: Map<string, Task>
  onAdd: (column: ColumnId) => void
  onEdit: (task: Task) => void
  onDelete: (id: string) => void
}

export default function Column({ columnId, tasks, highlighted, taskMap, onAdd, onEdit, onDelete }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId })
  const title = COLUMN_TITLES[columnId]

  return (
    <section
      className="column"
      data-highlighted={highlighted || undefined}
      data-over={isOver || undefined}
    >
      <header className="column__header">
        <span className={`column__dot column__dot--${columnId}`} aria-hidden="true" />
        <h2 className="column__title">{title}</h2>
        <span className="column__count">{tasks.length}</span>
        <Button
          type="text"
          size="small"
          className="column__add"
          icon={<PlusOutlined />}
          aria-label={`在 ${title} 列添加任务`}
          onClick={() => onAdd(columnId)}
        />
      </header>

      <div className="column__body" ref={setNodeRef}>
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <ul className="column__list">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                blocked={(task.dependsOn ?? []).some((id) => taskMap.get(id) && taskMap.get(id)!.status !== 'done')}
                depsCount={(task.dependsOn ?? []).length}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </ul>
          {tasks.length === 0 && <p className="column__empty">暂无任务</p>}
        </SortableContext>
        <Button
          type="text"
          block
          className="column__add-bottom"
          icon={<PlusOutlined />}
          onClick={() => onAdd(columnId)}
        >
          添加任务
        </Button>
      </div>
    </section>
  )
}
