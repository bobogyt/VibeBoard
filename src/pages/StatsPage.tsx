import { useCallback, useEffect, useState } from 'react'
import { App as AntdApp, Button, Card, Col, Empty, Progress, Row, Segmented, Statistic, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { ReloadOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import type { BoardStats, OverdueTaskInfo, PriorityCounts, TrendPoint } from '../types'

const PRIORITY_COLORS: Record<string, string> = {
  P0: 'red',
  P1: 'orange',
  P2: 'blue',
  P3: 'default',
}

const PRIORITY_LABELS: Array<{ key: keyof PriorityCounts; label: string }> = [
  { key: 'P0', label: 'P0' },
  { key: 'P1', label: 'P1' },
  { key: 'P2', label: 'P2' },
  { key: 'P3', label: 'P3' },
  { key: 'none', label: '无优先级' },
]

/** 轻量柱状趋势图(纯 CSS,零图表依赖) */
function TrendBars({ points, emptyText }: { points: TrendPoint[]; emptyText: string }) {
  const total = points.reduce((sum, p) => sum + p.count, 0)
  if (total === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
  const max = Math.max(1, ...points.map((p) => p.count))
  return (
    <div className="stats-bars">
      {points.map((p) => (
        <div key={p.label} className="stats-bar-col" title={`${p.label}:${p.count}`}>
          <span className="stats-bar-count">{p.count > 0 ? p.count : ''}</span>
          <div
            className={`stats-bar${p.count === 0 ? ' stats-bar--empty' : ''}`}
            style={{ height: `${Math.max(2, Math.round((p.count / max) * 96))}px` }}
          />
          <span className="stats-bar-label">{p.label}</span>
        </div>
      ))}
    </div>
  )
}

/** 数据统计页:项目完成率 / 优先级分布 / 逾期任务 / 完成趋势 / Agent 操作统计 */
export default function StatsPage() {
  const { message } = AntdApp.useApp()
  const [stats, setStats] = useState<BoardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [trendMode, setTrendMode] = useState<'daily' | 'weekly'>('daily')

  const load = useCallback(async () => {
    const data = await api.getStats()
    setStats(data)
  }, [])

  useEffect(() => {
    let cancelled = false
    api
      .getStats()
      .then((data) => {
        if (!cancelled) setStats(data)
      })
      .catch((err) => {
        if (!cancelled) message.error(err instanceof Error ? err.message : '统计加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [message])

  const refresh = useCallback(async () => {
    try {
      await load()
      message.success('已刷新')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '统计加载失败')
    }
  }, [load, message])

  const overdueColumns: ColumnsType<OverdueTaskInfo> = [
    { title: '任务标题', dataIndex: 'title', ellipsis: true },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 90,
      render: (priority: OverdueTaskInfo['priority']) =>
        priority ? <Tag color={PRIORITY_COLORS[priority]}>{priority}</Tag> : <Tag>-</Tag>,
    },
    {
      title: '截止时间',
      dataIndex: 'dueDate',
      width: 150,
      render: (dueDate: number) => dayjs(dueDate).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '逾期',
      dataIndex: 'daysOverdue',
      width: 100,
      render: (days: number) => <span className="stats-overdue-days">{days} 天</span>,
    },
  ]

  const toolColumns: ColumnsType<{ tool: string; count: number; okCount: number }> = [
    { title: '工具', dataIndex: 'tool', ellipsis: true },
    { title: '执行次数', dataIndex: 'count', width: 100 },
    { title: '成功', dataIndex: 'okCount', width: 80 },
    {
      title: '成功率',
      width: 90,
      render: (_: unknown, record) => `${Math.round((record.okCount / record.count) * 100)}%`,
    },
  ]

  return (
    <div className="stats-page">
      <div className="stats-page__header">
        <h2 className="stats-page__title">数据统计</h2>
        <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
          刷新
        </Button>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card loading={loading}>
            <Statistic
              title="平均项目完成率"
              value={stats?.projects.averageProgress ?? 0}
              suffix="%"
              precision={0}
            />
            <div className="stats-card__sub">
              {stats ? (stats.projects.tracked > 0 ? `共 ${stats.projects.total} 个项目` : '暂无关联任务的项目') : ''}
            </div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card loading={loading}>
            <Statistic title="逾期任务" value={stats?.overdue.length ?? 0} precision={0} />
            <div className="stats-card__sub">未完成且已过截止时间</div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card loading={loading}>
            <Statistic title="本周完成" value={stats?.trends.weekly.at(-1)?.count ?? 0} precision={0} suffix="项" />
            <div className="stats-card__sub">近 8 周共 {stats ? stats.trends.weekly.reduce((s, w) => s + w.count, 0) : 0} 项</div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card loading={loading}>
            <Statistic title="Agent 操作" value={stats?.agent.total ?? 0} precision={0} suffix="次" />
            <div className="stats-card__sub">
              {stats?.agent.successRate !== null && stats?.agent.successRate !== undefined
                ? `成功率 ${stats.agent.successRate}%`
                : '暂无操作记录'}
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="项目完成率" loading={loading}>
            {stats && stats.projects.items.length > 0 ? (
              <div className="stats-project-list">
                {stats.projects.items.map((p) => (
                  <div key={p.id} className="stats-project-row">
                    <div className="stats-project-row__head">
                      <span className="stats-project-row__name">{p.name}</span>
                      <span className="stats-project-row__count">
                        {p.progress === null ? '暂无关联任务' : `${p.doneCount}/${p.totalCount}`}
                      </span>
                    </div>
                    <Progress percent={p.progress ?? 0} size="small" status={p.progress === 100 ? 'success' : 'normal'} />
                  </div>
                ))}
              </div>
            ) : (
              !loading && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无项目" />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title="优先级分布"
            loading={loading}
            extra={<span className="stats-card__sub">当前看板任务</span>}
          >
            {stats ? (
              <div className="stats-dist">
                {PRIORITY_LABELS.map(({ key, label }) => {
                  const count = stats.priorities[key]
                  const total = Object.values(stats.priorities).reduce((s, v) => s + v, 0)
                  return (
                    <div key={key} className="stats-dist-row">
                      <span className="stats-dist-row__label">
                        {key === 'none' ? label : <Tag color={PRIORITY_COLORS[key]}>{label}</Tag>}
                      </span>
                      <div className="stats-dist-track">
                        <div
                          className="stats-dist-fill"
                          style={{ width: `${total > 0 ? Math.round((count / total) * 100) : 0}%` }}
                        />
                      </div>
                      <span className="stats-dist-row__count">{count}</span>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            title="完成趋势"
            loading={loading}
            extra={
              <Segmented
                size="small"
                options={[
                  { label: '每日', value: 'daily' },
                  { label: '每周', value: 'weekly' },
                ]}
                value={trendMode}
                onChange={(v) => setTrendMode(v as 'daily' | 'weekly')}
              />
            }
          >
            {stats && (
              <TrendBars
                points={trendMode === 'daily' ? stats.trends.daily : stats.trends.weekly}
                emptyText={trendMode === 'daily' ? '近 14 天没有完成的任务' : '近 8 周没有完成的任务'}
              />
            )}
            <div className="stats-trend__hint">
              {trendMode === 'daily' ? '近 14 天每日完成任务数(含今天)' : '近 8 周每周完成任务数(周一起算,含当前周)'}
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="逾期任务" loading={loading}>
            {stats && stats.overdue.length > 0 ? (
              <Table<OverdueTaskInfo>
                size="small"
                rowKey="id"
                columns={overdueColumns}
                dataSource={stats.overdue}
                pagination={false}
              />
            ) : (
              !loading && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有逾期任务" />
            )}
          </Card>
        </Col>
      </Row>

      <Card
        title="Agent 操作统计"
        loading={loading}
        extra={<span className="stats-card__sub">AI 助手实际执行过的工具调用(近 7 天 {stats?.agent.last7d ?? 0} 次)</span>}
      >
        {stats && stats.agent.byTool.length > 0 ? (
          <Table
            size="small"
            rowKey="tool"
            columns={toolColumns}
            dataSource={stats.agent.byTool}
            pagination={false}
          />
        ) : (
          !loading && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 Agent 操作记录" />
        )}
      </Card>
    </div>
  )
}
