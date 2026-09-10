import { useEffect, useRef, useState } from 'react'
import { Button, Drawer, Input, Tag } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  EditOutlined,
  EyeOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  BulbOutlined,
  RobotOutlined,
  SendOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { api } from '../lib/api'
import type { AgentRunResult, AgentStepEvent, ApprovalTaskPreview } from '../lib/api'
import { COLUMN_TITLES } from '../constants'
import type { ColumnId } from '../types'
import ModelSettingsModal from './ModelSettingsModal'
import MemoryModal from './MemoryModal'

interface AgentChatDrawerProps {
  open: boolean
  onClose: () => void
  /** Agent 执行了写操作后回调(BoardPage 用它刷新看板) */
  onBoardChanged: () => void
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** 已执行的工具步骤(执行过程可视化;请求级失败没有) */
  steps?: AgentStepEvent[]
  failed?: boolean
}

interface PendingApproval {
  sessionId: string
  requestId: string
  name: string
  label: string
  tasks: ApprovalTaskPreview[]
  /** 用户已做出选择后的留档状态 */
  decided?: 'approved' | 'rejected' | 'timeout'
}

const WRITE_TOOLS = new Set([
  'createTask',
  'createTasks',
  'updateTask',
  'moveTask',
  'updateTaskPriority',
  'deleteTasks',
  'batchUpdateTasks',
  'archiveTasks',
  'setTaskDependencies',
])

/** 只读工具之外的一切成功动作都会改动看板,触发刷新;新增工具若漏登记也安全 */
const READ_TOOLS = new Set(['getProjects', 'getProject', 'getTasks', 'getTask', 'getPreferences'])

const EXAMPLE_PROMPTS = [
  '告诉我现在有哪些任务最重要',
  '帮我拆解:准备一次 30 分钟的技术分享',
  '看看各项目的进度',
]

function formatDuration(ms: number) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

/** 步骤图标:失败红叉;写操作编辑图标(accent 色),读操作眼睛图标 */
function StepIcon({ event }: { event: AgentStepEvent }) {
  if (event.ok === false) {
    return <CloseCircleOutlined className="agent-drawer__step-icon agent-drawer__step-icon--fail" />
  }
  if (event.name && WRITE_TOOLS.has(event.name)) {
    return <EditOutlined className="agent-drawer__step-icon agent-drawer__step-icon--write" />
  }
  if (event.ok === true) {
    return <CheckCircleOutlined className="agent-drawer__step-icon" />
  }
  return <EyeOutlined className="agent-drawer__step-icon" />
}

/** 工具执行步骤列表:进行中与完成后共用(完成后即步骤留档) */
function StepList({ steps }: { steps: AgentStepEvent[] }) {
  return (
    <div className="agent-drawer__steps">
      {steps.map((s, i) => (
        <div key={i} className={`agent-drawer__step${s.ok === false ? ' agent-drawer__step--failed' : ''}`}>
          <StepIcon event={s} />
          <span className="agent-drawer__step-label">
            {s.label ?? s.name}
            {s.ok === false && s.error ? `:${s.error}` : ''}
          </span>
          {typeof s.durationMs === 'number' && (
            <span className="agent-drawer__step-time">{formatDuration(s.durationMs)}</span>
          )}
        </div>
      ))}
    </div>
  )
}

/** 高危操作确认卡:等待用户选择时展示任务清单与按钮;选择后折叠为一行留档 */
function ApprovalCard({
  approval,
  onDecide,
}: {
  approval: PendingApproval
  onDecide: (approved: boolean) => void
}) {
  if (approval.decided) {
    const text = approval.decided === 'approved' ? '已确认执行' : approval.decided === 'rejected' ? '已拒绝' : '确认超时,已自动取消'
    return (
      <div className="agent-drawer__approval agent-drawer__approval--decided">
        <CheckCircleOutlined /> {approval.label} · {text}
      </div>
    )
  }
  return (
    <div className="agent-drawer__approval">
      <div className="agent-drawer__approval-head">
        <ExclamationCircleOutlined className="agent-drawer__approval-icon" />
        <span>{approval.label}</span>
      </div>
      <p className="agent-drawer__approval-hint">以下操作需要你的确认才会执行:</p>
      <ul className="agent-drawer__approval-tasks">
        {approval.tasks.map((t, i) => (
          <li key={t.id ?? i}>
            <span className="agent-drawer__approval-index">{i + 1}.</span>
            <span className="agent-drawer__approval-title">{t.title}</span>
            {t.priority && <Tag className="agent-drawer__approval-priority">{t.priority}</Tag>}
            <span className="agent-drawer__approval-status">
              {t.status ? COLUMN_TITLES[t.status as ColumnId] : '未知'}
            </span>
          </li>
        ))}
      </ul>
      <div className="agent-drawer__approval-actions">
        <Button size="small" danger type="primary" onClick={() => onDecide(true)}>
          确认执行
        </Button>
        <Button size="small" onClick={() => onDecide(false)}>
          拒绝
        </Button>
      </div>
    </div>
  )
}

/** AI 助手抽屉:用户与 GLM Agent 对话;实时展示工具执行步骤与高危操作确认,不展示模型推理过程 */
export default function AgentChatDrawer({ open, onClose, onBoardChanged }: AgentChatDrawerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [liveSteps, setLiveSteps] = useState<AgentStepEvent[]>([])
  const [approval, setApproval] = useState<PendingApproval | null>(null)
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, running, liveSteps, approval])

  const send = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || running) return
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }])
    setInput('')
    setRunning(true)
    setLiveSteps([])
    setApproval(null)
    try {
      const steps: AgentStepEvent[] = []
      const result: AgentRunResult = await api.agentRunStream(trimmed, (event) => {
        if (event.type === 'tool') {
          steps.push(event)
          setLiveSteps([...steps])
        } else if (event.type === 'approval' && event.requestId) {
          setApproval({
            sessionId: event.sessionId ?? '',
            requestId: event.requestId,
            name: event.name ?? '',
            label: event.label ?? event.name ?? '',
            tasks: event.tasks ?? [],
          })
        }
      })
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: result.finalAnswer,
          steps,
          failed: result.status !== 'COMPLETED',
        },
      ])
      if (result.actions.some((a) => a.ok && !READ_TOOLS.has(a.tool))) onBoardChanged()
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: err instanceof Error ? err.message : '请求失败,请重试',
          failed: true,
        },
      ])
    } finally {
      setRunning(false)
      setLiveSteps([])
      setApproval(null)
    }
  }

  const decide = async (approved: boolean) => {
    if (!approval || approval.decided) return
    try {
      await api.approveAgentRun(approval.sessionId, approval.requestId, approved)
      setApproval({ ...approval, decided: approved ? 'approved' : 'rejected' })
    } catch (err) {
      // 409 等:审批窗口已失效,交给 Agent 的工具结果兜底;这里仅标记
      setApproval({ ...approval, decided: 'timeout' })
      console.warn('审批提交失败', err)
    }
  }

  return (
    <Drawer
      title={
        <span className="agent-drawer__title">
          <RobotOutlined /> AI 助手
        </span>
      }
      extra={
        <span className="agent-drawer__extra">
          <Button
            type="text"
            size="small"
            icon={<BulbOutlined />}
            aria-label="偏好记忆"
            onClick={() => setMemoryOpen(true)}
          />
          <Button
            type="text"
            size="small"
            icon={<SettingOutlined />}
            aria-label="模型设置"
            onClick={() => setSettingsOpen(true)}
          />
        </span>
      }
      placement="right"
      width={460}
      open={open}
      onClose={onClose}
      className="agent-drawer"
      styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
    >
      <div className="agent-drawer__messages" ref={listRef}>
        {messages.length === 0 && !running && (
          <div className="agent-drawer__empty">
            <p>用一句话让 AI 帮你处理任务,例如:</p>
            {EXAMPLE_PROMPTS.map((p) => (
              <Button key={p} size="small" block onClick={() => void send(p)} disabled={running}>
                {p}
              </Button>
            ))}
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`agent-drawer__msg agent-drawer__msg--${msg.role}`}>
            <div className={`agent-drawer__bubble${msg.failed ? ' agent-drawer__bubble--failed' : ''}`}>
              {msg.steps && msg.steps.length > 0 && <StepList steps={msg.steps} />}
              <p className="agent-drawer__text">{msg.content}</p>
            </div>
          </div>
        ))}
        {running && (
          <div className="agent-drawer__msg agent-drawer__msg--assistant">
            <div className="agent-drawer__bubble">
              {liveSteps.length > 0 && <StepList steps={liveSteps} />}
              {approval && <ApprovalCard approval={approval} onDecide={(v) => void decide(v)} />}
              {(!approval || approval.decided) && (
                <p className="agent-drawer__text agent-drawer__pending">
                  <LoadingOutlined spin /> 正在读取数据、执行操作…
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="agent-drawer__composer">
        <Input
          placeholder="描述你想做的事…"
          value={input}
          maxLength={2000}
          disabled={running}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={() => void send(input)}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          loading={running}
          disabled={!input.trim()}
          onClick={() => void send(input)}
        />
      </div>
      <ModelSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <MemoryModal open={memoryOpen} onClose={() => setMemoryOpen(false)} />
    </Drawer>
  )
}
