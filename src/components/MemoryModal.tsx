import { useCallback, useEffect, useState } from 'react'
import { App as AntdApp, Button, Empty, Input, Modal, Popconfirm } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../lib/api'
import type { Memory } from '../lib/api'

const CONTENT_MAX = 300

/** 偏好记忆管理弹窗:查看/手动添加/删除 Agent 的长期记忆条目 */
export default function MemoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = AntdApp.useApp()
  const [memories, setMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const [draft, setDraft] = useState('')

  const reload = useCallback(async () => {
    try {
      const { memories } = await api.getMemories()
      setMemories(memories)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '记忆加载失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    api
      .getMemories()
      .then((data) => {
        if (!cancelled) setMemories(data.memories)
      })
      .catch((err) => {
        if (!cancelled) message.error(err instanceof Error ? err.message : '记忆加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, message])

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

  const add = async () => {
    const content = draft.trim()
    if (!content || acting) return
    await runAction(() => api.addMemory(content), '已添加记忆')
    setDraft('')
  }

  return (
    <Modal title="偏好记忆" open={open} onCancel={onClose} footer={null} width={420} destroyOnHidden>
      <p className="memory-modal__hint">
        Agent 在拆解任务、安排优先级时会遵循这些记忆;对话里说「记住…」「忘掉…」也可以管理。
      </p>
      {memories.length === 0 && !loading ? (
        <Empty description="还没有记忆,在对话中告诉我你的偏好即可" />
      ) : (
        <ul className="memory-modal__list">
          {memories.map((m) => (
            <li key={m.id} className="memory-modal__item">
              <div className="memory-modal__content">
                <p className="memory-modal__text">{m.content}</p>
                <span className="memory-modal__time">{dayjs(m.updatedAt).format('YYYY-MM-DD HH:mm')}</span>
              </div>
              <Popconfirm
                title="删除这条记忆?"
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => void runAction(() => api.deleteMemory(m.id), '已删除')}
              >
                <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={acting} aria-label={`删除记忆「${m.content}」`} />
              </Popconfirm>
            </li>
          ))}
        </ul>
      )}
      <div className="memory-modal__composer">
        <Input
          placeholder="手动添加一条偏好,如「周末不安排任务」"
          value={draft}
          maxLength={CONTENT_MAX}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={() => void add()}
        />
        <Button type="primary" disabled={!draft.trim() || acting} onClick={() => void add()}>
          添加
        </Button>
      </div>
    </Modal>
  )
}
