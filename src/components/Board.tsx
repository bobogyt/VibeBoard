import { useCallback, useRef, useState } from 'react'
import {
  DndContext,
  MeasuringStrategy,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import { COLUMN_IDS } from '../constants'
import type { BoardState, ColumnId, Task } from '../types'
import Column from './Column'

interface BoardProps {
  board: BoardState
  onAdd: (column: ColumnId) => void
  onEdit: (task: Task) => void
  onDelete: (id: string) => void
  onMoveToColumn: (id: string, targetColumn: ColumnId, targetIndex: number) => void
  onReorder: (column: ColumnId, fromId: string, toId: string) => void
  onTouch: (id: string) => void
}

/** over.id 可能是列本身的 id(空列/列空白区域),也可能是某个任务的 id */
function isColumnId(id: string): id is ColumnId {
  return (COLUMN_IDS as readonly string[]).includes(id)
}

export default function Board({ board, onAdd, onEdit, onDelete, onMoveToColumn, onReorder, onTouch }: BoardProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const [highlightedColumn, setHighlightedColumn] = useState<ColumnId | null>(null)
  const dragStartColumnRef = useRef<ColumnId | null>(null)

  const findColumnByItemId = useCallback(
    (id: string): ColumnId | undefined => {
      if (isColumnId(id)) return id
      for (const col of COLUMN_IDS) {
        if (board[col].some((t) => t.id === id)) return col
      }
      return undefined
    },
    [board],
  )

  const handleDragStart = (event: DragStartEvent) => {
    const startColumn = findColumnByItemId(String(event.active.id)) ?? null
    dragStartColumnRef.current = startColumn
    setHighlightedColumn(startColumn)
  }

  // 跨列拖拽:进入新列时立刻把任务移过去,卡片获得实时的跨列预览
  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over) return

    const activeId = String(active.id)
    const overId = String(over.id)
    if (activeId === overId) return

    const activeColumn = findColumnByItemId(activeId)
    const overColumn = findColumnByItemId(overId)
    if (!activeColumn || !overColumn || activeColumn === overColumn) return

    const overIndex = board[overColumn].findIndex((t) => t.id === overId)
    let targetIndex: number
    if (overIndex === -1) {
      // 悬停在列空白处 → 放到该列末尾
      targetIndex = board[overColumn].length
    } else {
      const activeRect = active.rect.current.translated
      const isBelowOverItem = activeRect
        ? activeRect.top > over.rect.top + over.rect.height / 2
        : false
      targetIndex = overIndex + (isBelowOverItem ? 1 : 0)
    }

    onMoveToColumn(activeId, overColumn, targetIndex)
    setHighlightedColumn(overColumn)
  }

  const finishDrag = () => {
    setHighlightedColumn(null)
    dragStartColumnRef.current = null
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    const startColumn = dragStartColumnRef.current

    if (!over) {
      finishDrag()
      return
    }

    const activeId = String(active.id)
    const overId = String(over.id)
    const currentColumn = findColumnByItemId(activeId)

    if (!startColumn || !currentColumn) {
      finishDrag()
      return
    }

    if (startColumn !== currentColumn) {
      // 跨列移动已在 dragOver 中落库,这里只需收尾
      onTouch(activeId)
      finishDrag()
      return
    }

    // 同列排序
    if (activeId !== overId && findColumnByItemId(overId) === currentColumn) {
      onReorder(currentColumn, activeId, overId)
    }
    finishDrag()
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={finishDrag}
    >
      <div className="board">
        {COLUMN_IDS.map((columnId) => {
          // 依赖标识:任一前置任务存在且未完成 = 被阻塞
          const taskMap = new Map(
            COLUMN_IDS.flatMap((col) => board[col]).map((task) => [task.id, task]),
          )
          return (
            <Column
              key={columnId}
              columnId={columnId}
              tasks={board[columnId]}
              highlighted={highlightedColumn === columnId}
              onAdd={onAdd}
              onEdit={onEdit}
              onDelete={onDelete}
              taskMap={taskMap}
            />
          )
        })}
      </div>
    </DndContext>
  )
}
