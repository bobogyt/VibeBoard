import { useCallback, useEffect, useState } from 'react'
import { App as AntdApp, Button, Popconfirm, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { api } from '../lib/api'
import { COLUMN_TITLES } from '../constants'
import type { ColumnId, Task } from '../types'

const PRIORITY_COLORS: Record<string, string> = {
  P0: 'red',
  P1: 'orange',
  P2: 'blue',
  P3: 'default',
}

/** 任务归档页:已归档任务移出看板,可恢复回原列或彻底删除 */
export default function ArchivePage() {
  const { message } = AntdApp.useApp()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)

  const reload = useCallback(async () => {
    const { tasks } = await api.getArchivedTasks()
    setTasks(tasks)
  }, [])

  useEffect(() => {
    let cancelled = false
    api
      .getArchivedTasks()
      .then((data) => {
        if (!cancelled) setTasks(data.tasks)
      })
      .catch((err) => {
        if (!cancelled) message.error(err instanceof Error ? err.message : '归档加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [message])

  const runAction = useCallback(
    async (action: () => Promise<unknown>, successText: string) => {
      setActing(true)
      try {
        await action()
        message.success(successText)
        await reload()
      } catch (err) {
        message.error(err instanceof Error ? err.message : '操作失败')
      } finally {
        setActing(false)
      }
    },
    [message, reload],
  )


  const columns: ColumnsType<Task> = [
    {
      title: '任务标题',
      dataIndex: 'title',
      ellipsis: true,
    },
    {
      title: '原所在列',
      dataIndex: 'status',
      width: 100,
      render: (status: ColumnId) => <Tag>{COLUMN_TITLES[status] ?? status}</Tag>,
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 90,
      render: (priority: string | null) =>
        priority ? <Tag color={PRIORITY_COLORS[priority] ?? 'default'}>{priority}</Tag> : <span>—</span>,
    },
    {
      title: '归档时间',
      dataIndex: 'updatedAt',
      width: 170,
      render: (updatedAt: number) => <span>{dayjs(updatedAt).format('YYYY-MM-DD HH:mm')}</span>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_, task) => (
        <>
          <Button
            size="small"
            type="link"
            disabled={acting}
            onClick={() => void runAction(() => api.restoreTasks([task.id]), `已恢复「${task.title}」`)}
          >
            恢复
          </Button>
          <Popconfirm
            title="彻底删除这条任务?"
            description="删除后不可恢复"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => void runAction(() => api.purgeTasks([task.id]), '已彻底删除')}
          >
            <Button size="small" type="link" danger disabled={acting}>
              彻底删除
            </Button>
          </Popconfirm>
        </>
      ),
    },
  ]

  return (
    <div>
      <h2 className="projects-title">任务归档</h2>
      <p className="archive-subtitle">已归档任务移出看板,可恢复回原列或彻底删除。</p>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={tasks}
        columns={columns}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
      />
    </div>
  )
}
