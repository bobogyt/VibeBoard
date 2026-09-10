import { useCallback, useEffect, useState } from 'react'
import { App as AntdApp, Button, Card, Empty, List, Segmented, Switch, Tag } from 'antd'
import { BellOutlined, ReloadOutlined, RobotOutlined, ScanOutlined, PlayCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../lib/api'
import type { AutomationInfo, AutomationRunInfo, NotificationItem } from '../types'

const RUN_STATUS: Record<string, { color: string; label: string }> = {
  ok: { color: 'green', label: '成功' },
  failed: { color: 'red', label: '失败' },
  skipped: { color: 'default', label: '跳过' },
}

function formatTime(ts: number): string {
  return dayjs(ts).format('MM-DD HH:mm')
}

/** 自动化页:内置自动化开关、运行历史、通知中心 */
export default function AutomationsPage() {
  const { message } = AntdApp.useApp()
  const [automations, setAutomations] = useState<AutomationInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)
  const [historyScope, setHistoryScope] = useState<string>('all')
  const [runs, setRuns] = useState<AutomationRunInfo[]>([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])

  const reloadAutomations = useCallback(async () => {
    const { automations: list } = await api.getAutomations()
    setAutomations(list)
  }, [])

  const reloadRuns = useCallback(async (scope: string) => {
    setRunsLoading(true)
    try {
      const { runs: list } = await api.getAutomationRuns(scope === 'all' ? undefined : scope, 20)
      setRuns(list)
    } finally {
      setRunsLoading(false)
    }
  }, [])

  const reloadNotifications = useCallback(async () => {
    const { items } = await api.getNotifications(20)
    setNotifications(items)
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([api.getAutomations(), api.getNotifications(20)])
      .then(([autoRes, notifRes]) => {
        if (cancelled) return
        setAutomations(autoRes.automations)
        setNotifications(notifRes.items)
      })
      .catch((err) => {
        if (!cancelled) message.error(err instanceof Error ? err.message : '自动化加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [message])

  useEffect(() => {
    let cancelled = false
    api
      .getAutomationRuns(historyScope === 'all' ? undefined : historyScope, 20)
      .then((data) => {
        if (!cancelled) setRuns(data.runs)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRunsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [historyScope])

  const toggle = useCallback(
    async (info: AutomationInfo, enabled: boolean) => {
      setToggling(info.id)
      try {
        await api.setAutomationEnabled(info.id, enabled)
        message.success(enabled ? `已开启「${info.name}」` : `已关闭「${info.name}」`)
        await reloadAutomations()
      } catch (err) {
        message.error(err instanceof Error ? err.message : '操作失败')
      } finally {
        setToggling(null)
      }
    },
    [message, reloadAutomations],
  )

  const markAllRead = useCallback(async () => {
    try {
      await api.markNotificationsRead()
      await reloadNotifications()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败')
    }
  }, [message, reloadNotifications])

  const [runningId, setRunningId] = useState<string | null>(null)

  const runNow = useCallback(
    async (info: AutomationInfo) => {
      setRunningId(info.id)
      try {
        const result = await api.runAutomation(info.id)
        if (result.status === 'ok') {
          message.success(`「${info.name}」运行完成`)
        } else if (result.status === 'skipped') {
          message.info(`「${info.name}」已跳过:${result.error ?? ''}`)
        } else {
          message.error(`「${info.name}」运行失败:${result.error ?? '未知原因'}`)
        }
        await Promise.all([reloadAutomations(), reloadRuns(historyScope), reloadNotifications()])
      } catch (err) {
        message.error(err instanceof Error ? err.message : '运行失败')
      } finally {
        setRunningId(null)
      }
    },
    [historyScope, message, reloadAutomations, reloadNotifications, reloadRuns],
  )

  return (
    <div className="automations-page">
      <div className="automations-page__header">
        <h2 className="automations-page__title">自动化</h2>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            void reloadAutomations()
            void reloadNotifications()
            void reloadRuns(historyScope)
          }}
        >
          刷新
        </Button>
      </div>

      <Card title="内置自动化" loading={loading}>
        <List
          dataSource={automations}
          renderItem={(item) => (
            <List.Item
              actions={[
                <Button
                  key="run"
                  size="small"
                  icon={<PlayCircleOutlined />}
                  loading={runningId === item.id}
                  disabled={!item.enabled}
                  onClick={() => void runNow(item)}
                >
                  立即运行
                </Button>,
                <Switch
                  key="switch"
                  checked={item.enabled}
                  loading={toggling === item.id}
                  onChange={(checked) => void toggle(item, checked)}
                />,
              ]}
            >
              <List.Item.Meta
                avatar={item.type === 'agent' ? <RobotOutlined className="automations-icon" /> : <ScanOutlined className="automations-icon" />}
                title={
                  <span>
                    {item.name} <Tag>{item.cronLabel}</Tag>
                    {item.type === 'agent' && <Tag color="purple">只读 Agent</Tag>}
                  </span>
                }
                description={
                  <span>
                    {item.description}
                    <br />
                    最近运行:{item.lastRunAt ? formatTime(item.lastRunAt) : '从未运行'}
                  </span>
                }
              />
            </List.Item>
          )}
        />
      </Card>

      <Card
        title="通知中心"
        loading={loading}
        extra={
          <Button size="small" onClick={() => void markAllRead()}>
            全部已读
          </Button>
        }
      >
        {notifications.length > 0 ? (
          <List
            dataSource={notifications}
            renderItem={(item) => (
              <List.Item>
                <List.Item.Meta
                  avatar={<BellOutlined className="automations-icon" />}
                  title={
                    <span>
                      {!item.read && <Tag color="processing">未读</Tag>}
                      {item.title}
                    </span>
                  }
                  description={
                    <span className="automations-notif__body">
                      {item.body?.split('\n').map((line, i) => (
                        <span key={i}>
                          {line}
                          <br />
                        </span>
                      ))}
                      <span className="automations-notif__time">{formatTime(item.createdAt)}</span>
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无通知(开启自动化后,运行结果会出现在这里)" />
        )}
      </Card>

      <Card
        title="运行历史"
        loading={loading}
        extra={
          <Segmented
            size="small"
            value={historyScope}
            onChange={(v) => setHistoryScope(v as string)}
            options={[{ label: '全部', value: 'all' }, ...automations.map((a) => ({ label: a.name, value: a.id }))]}
          />
        }
      >
        {runs.length > 0 ? (
          <List
            loading={runsLoading}
            dataSource={runs}
            renderItem={(item) => (
              <List.Item>
                <List.Item.Meta
                  title={
                    <span>
                      <Tag color={RUN_STATUS[item.status]?.color ?? 'default'}>{RUN_STATUS[item.status]?.label ?? item.status}</Tag>
                      {automations.find((a) => a.id === item.automationId)?.name ?? item.automationId}
                      <span className="automations-run__time">{formatTime(item.createdAt)}</span>
                    </span>
                  }
                  description={item.status === 'failed' ? `失败原因:${item.error}` : item.summary}
                />
              </List.Item>
            )}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行记录(开启自动化后可在此查看每次执行结果)" />
        )}
      </Card>
    </div>
  )
}
