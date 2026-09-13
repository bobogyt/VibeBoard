import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Empty, Space } from 'antd'
import { FieldTimeOutlined, RobotOutlined } from '@ant-design/icons'
import Board from '../components/Board'
import TaskModal from '../components/TaskModal'
import TaskTimelineDrawer from '../components/TaskTimelineDrawer'
import AgentChatDrawer from '../components/AgentChatDrawer'
import { COLUMN_TITLES } from '../constants'
import { useBoard } from '../hooks/useBoard'
import { api } from '../lib/api'
import type { ColumnId, GithubLink, Task } from '../types'

type ModalState = { mode: 'create'; column: ColumnId } | { mode: 'edit'; taskId: string }

interface BoardPageProps {
  onUnauthorized: () => void
}

export default function BoardPage({ onUnauthorized }: BoardPageProps) {
  const {
    board,
    loadStatus,
    loadError,
    saveStatus,
    saveError,
    retrySave,
    addTask,
    updateTask,
    deleteTask,
    moveTaskToColumn,
    reorderTask,
    touchTask,
    refresh,
  } = useBoard(onUnauthorized)
  const [modal, setModal] = useState<ModalState | null>(null)
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const [linksByTask, setLinksByTask] = useState<Record<string, GithubLink[]>>({})

  useEffect(() => {
    let cancelled = false
    api
      .listGithubLinks()
      .then(({ links }) => {
        if (cancelled) return
        const map: Record<string, GithubLink[]> = {}
        for (const l of links) {
          ;(map[l.taskId] ??= []).push(l)
        }
        setLinksByTask(map)
      })
      .catch(() => {
        /* 关联拉取失败不阻塞看板 */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const reloadLinks = () => {
    api
      .listGithubLinks()
      .then(({ links }) => {
        const map: Record<string, GithubLink[]> = {}
        for (const l of links) {
          ;(map[l.taskId] ??= []).push(l)
        }
        setLinksByTask(map)
      })
      .catch(() => {
        /* 刷新失败保留旧关联 */
      })
  }

  // 展示层合并:任务对象附加 githubLinks(保存看板时多余字段会被后端丢弃)
  const displayBoard = useMemo(() => {
    const enrich = (tasks: Task[]) =>
      tasks.map((t) => ({ ...t, githubLinks: linksByTask[t.id] ?? [] }))
    return { todo: enrich(board.todo), doing: enrich(board.doing), done: enrich(board.done) }
  }, [board, linksByTask])

  const displayBoardTaskMap = useMemo(() => {
    const map = new Map<string, Task>()
    for (const t of [...displayBoard.todo, ...displayBoard.doing, ...displayBoard.done]) map.set(t.id, t)
    return map
  }, [displayBoard])

  if (loadStatus === 'loading') {
    return <Empty description="正在加载看板…" style={{ marginTop: 96 }} />
  }

  if (loadStatus === 'error') {
    return (
      <Alert
        type="error"
        showIcon
        message="看板加载失败"
        description={loadError}
        action={
          <Button size="small" onClick={() => window.location.reload()}>
            重试
          </Button>
        }
      />
    )
  }

  return (
    <>
      {saveStatus === 'error' && saveError && (
        <Alert
          type="error"
          showIcon
          message={`保存失败:${saveError}`}
          action={
            <Button size="small" onClick={retrySave} loading={saveStatus === 'error'}>
              重试
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      )}
      <div className="board-toolbar">
        <Space>
          <Button type="primary" ghost icon={<RobotOutlined />} onClick={() => setAgentOpen(true)}>
            AI 助手
          </Button>
          <Button icon={<FieldTimeOutlined />} onClick={() => setTimelineOpen(true)}>
            任务动态
          </Button>
        </Space>
      </div>
      <Board
        board={displayBoard}
        onAdd={(column) => setModal({ mode: 'create', column })}
        onEdit={(task) => setModal({ mode: 'edit', taskId: task.id })}
        onDelete={deleteTask}
        onMoveToColumn={moveTaskToColumn}
        onReorder={reorderTask}
        onTouch={touchTask}
      />
      <TaskTimelineDrawer
        open={timelineOpen}
        onClose={() => setTimelineOpen(false)}
        board={displayBoard}
      />
      <AgentChatDrawer
        open={agentOpen}
        onClose={() => setAgentOpen(false)}
        onBoardChanged={() => {
          void refresh()
          reloadLinks()
        }}
      />
      {modal && (
        <TaskModal
          key={modal.mode === 'edit' ? modal.taskId : modal.column}
          mode={modal.mode}
          columnTitle={modal.mode === 'create' ? COLUMN_TITLES[modal.column] : undefined}
          task={modal.mode === 'edit' ? displayBoardTaskMap.get(modal.taskId) : undefined}
          board={displayBoard}
          onClose={() => setModal(null)}
          onLinksChanged={reloadLinks}
          onSubmit={(input) => {
            if (modal.mode === 'create') {
              addTask(modal.column, input)
            } else {
              updateTask(modal.taskId, input)
            }
            setModal(null)
          }}
        />
      )}
    </>
  )
}
