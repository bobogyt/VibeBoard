import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App as AntdApp,
  Button,
  Drawer,
  Empty,
  Modal,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
} from 'antd'
import { BranchesOutlined, LinkOutlined, StarFilled } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../lib/api'
import type { GithubBranchItem, GithubCommitItem, GithubIssueItem, GithubPullItem, GithubRepoInfo } from '../lib/api'
import { COLUMN_TITLES } from '../constants'
import type { GithubLink, Project, Task } from '../types'
import TimelineView from './TimelineView'
import type { TimelineItemData } from './TimelineView'
import GithubTokenModal from './GithubTokenModal'
import { parseRepoUrl } from '../lib/github'

type ListState = 'open' | 'closed' | 'all'

interface GithubRepoDrawerProps {
  open: boolean
  onClose: () => void
  project: Project | null
  /** Issue 转任务后通知父级(项目进度可能变化) */
  onTaskImported?: () => void
}

/** 项目绑定的 GitHub 仓库抽屉:Issue / PR / 提交 / 分支四视图 + 转任务 + 关联任务 */
export default function GithubRepoDrawer({ open, onClose, project, onTaskImported }: GithubRepoDrawerProps) {
  const { message } = AntdApp.useApp()
  const repoRef = useMemo(() => (project ? parseRepoUrl(project.repoUrl) : null), [project])
  const [tokenOpen, setTokenOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('issues')

  const [repoInfo, setRepoInfo] = useState<GithubRepoInfo | null>(null)
  const [infoLoading, setInfoLoading] = useState(true)
  const [infoError, setInfoError] = useState<string | null>(null)

  const [links, setLinks] = useState<GithubLink[]>([])
  const [boardTasks, setBoardTasks] = useState<Task[]>([])

  const [issues, setIssues] = useState<GithubIssueItem[]>([])
  const [issueState, setIssueState] = useState<ListState>('open')
  const [issuePage, setIssuePage] = useState(1)
  const [issueMore, setIssueMore] = useState(false)
  const [issueLoading, setIssueLoading] = useState(true)
  const [issueError, setIssueError] = useState<string | null>(null)

  const [pulls, setPulls] = useState<GithubPullItem[]>([])
  const [pullState, setPullState] = useState<ListState>('open')
  const [pullPage, setPullPage] = useState(1)
  const [pullMore, setPullMore] = useState(false)
  const [pullLoading, setPullLoading] = useState(false)
  const [pullError, setPullError] = useState<string | null>(null)

  const [commits, setCommits] = useState<GithubCommitItem[]>([])
  const [commitBranch, setCommitBranch] = useState<string | null>(null)
  const [commitPage, setCommitPage] = useState(1)
  const [commitMore, setCommitMore] = useState(false)
  const [commitLoading, setCommitLoading] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)

  const [branches, setBranches] = useState<GithubBranchItem[]>([])
  const [branchLoading, setBranchLoading] = useState(false)

  const [importing, setImporting] = useState<number | null>(null)
  const [linkTarget, setLinkTarget] = useState<{ type: 'issue' | 'pr'; number: number; title: string } | null>(null)
  const [linkTaskId, setLinkTaskId] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)

  const linksByKey = useMemo(() => new Map(links.map((l) => [`${l.type}:${l.number}`, l])), [links])
  const taskById = useMemo(() => new Map(boardTasks.map((t) => [t.id, t])), [boardTasks])

  useEffect(() => {
    if (!open || !repoRef) return
    let cancelled = false
    api
      .getGithubRepoInfo(repoRef.owner, repoRef.repo)
      .then((info) => {
        if (!cancelled) setRepoInfo(info)
      })
      .catch((e: unknown) => {
        if (!cancelled) setInfoError(e instanceof Error ? e.message : '加载仓库信息失败')
      })
      .finally(() => {
        if (!cancelled) setInfoLoading(false)
      })
    api
      .listGithubLinks()
      .then(({ links: list }) => {
        if (!cancelled) setLinks(list)
      })
      .catch(() => {
        /* 关联列表失败不阻塞浏览 */
      })
    api
      .fetchBoard()
      .then(({ columns }) => {
        if (!cancelled) setBoardTasks([...columns.todo, ...columns.doing, ...columns.done])
      })
      .catch(() => {
        /* 任务列表失败只影响关联弹窗选项 */
      })
    // 默认 Tab 是 Issue,随首屏一起拉取(其余 Tab 首次切换时按需加载)
    api
      .getGithubIssues(repoRef.owner, repoRef.repo, 'open', 1)
      .then((data) => {
        if (!cancelled) {
          setIssues(data.issues)
          setIssueMore(data.hasMore)
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setIssueError(e instanceof Error ? e.message : '加载 Issue 失败')
      })
      .finally(() => {
        if (!cancelled) setIssueLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, repoRef])

  const loadIssues = (state: ListState, page: number, append: boolean) => {
    if (!repoRef || issueLoading) return
    setIssueLoading(true)
    setIssueError(null)
    api
      .getGithubIssues(repoRef.owner, repoRef.repo, state, page)
      .then((data) => {
        setIssues((prev) => (append ? [...prev, ...data.issues] : data.issues))
        setIssuePage(data.page)
        setIssueMore(data.hasMore)
      })
      .catch((e: unknown) => {
        setIssueError(e instanceof Error ? e.message : '加载 Issue 失败')
      })
      .finally(() => setIssueLoading(false))
  }

  const loadPulls = (state: ListState, page: number, append: boolean) => {
    if (!repoRef || pullLoading) return
    setPullLoading(true)
    setPullError(null)
    api
      .getGithubPulls(repoRef.owner, repoRef.repo, state, page)
      .then((data) => {
        setPulls((prev) => (append ? [...prev, ...data.pulls] : data.pulls))
        setPullPage(data.page)
        setPullMore(data.hasMore)
      })
      .catch((e: unknown) => {
        setPullError(e instanceof Error ? e.message : '加载 PR 失败')
      })
      .finally(() => setPullLoading(false))
  }

  const loadCommits = (branch: string | null, page: number, append: boolean) => {
    if (!repoRef || commitLoading) return
    setCommitLoading(true)
    setCommitError(null)
    api
      .getGithubCommits(repoRef.owner, repoRef.repo, branch, page)
      .then((data) => {
        setCommits((prev) => (append ? [...prev, ...data.commits] : data.commits))
        setCommitPage(data.page)
        setCommitMore(data.hasMore)
      })
      .catch((e: unknown) => {
        setCommitError(e instanceof Error ? e.message : '加载提交失败')
      })
      .finally(() => setCommitLoading(false))
  }

  const loadBranches = () => {
    if (!repoRef || branchLoading) return
    setBranchLoading(true)
    api
      .getGithubBranches(repoRef.owner, repoRef.repo)
      .then(({ branches: list }) => setBranches(list))
      .catch((e: unknown) => {
        message.error(e instanceof Error ? e.message : '加载分支失败')
      })
      .finally(() => setBranchLoading(false))
  }

  const refreshLinks = async () => {
    if (!repoRef) return
    try {
      const { links: list } = await api.listGithubLinks()
      setLinks(list)
    } catch {
      /* 刷新失败保留旧列表 */
    }
  }

  const handleTabChange = (key: string) => {
    setActiveTab(key)
    if (!repoRef) return
    if (key === 'pulls' && pulls.length === 0 && !pullLoading) loadPulls(pullState, 1, false)
    if (key === 'commits' && commits.length === 0 && !commitLoading) loadCommits(commitBranch ?? repoInfo?.defaultBranch ?? null, 1, false)
    if (key === 'branches' && branches.length === 0 && !branchLoading) loadBranches()
  }

  const changeIssueState = (v: ListState) => {
    setIssueState(v)
    loadIssues(v, 1, false)
  }

  const changePullState = (v: ListState) => {
    setPullState(v)
    loadPulls(v, 1, false)
  }

  const changeCommitBranch = (name: string) => {
    setCommitBranch(name)
    loadCommits(name, 1, false)
  }

  const importIssue = async (issue: GithubIssueItem) => {
    if (!repoRef || importing !== null) return
    setImporting(issue.number)
    try {
      const { task } = await api.importGithubIssue({
        owner: repoRef.owner,
        repo: repoRef.repo,
        number: issue.number,
        projectId: project?.id ?? null,
      })
      message.success(`已创建任务「${task.title}」并关联`)
      await refreshLinks()
      onTaskImported?.()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '转任务失败')
    } finally {
      setImporting(null)
    }
  }

  const openLinkModal = (type: 'issue' | 'pr', number: number, title: string) => {
    setLinkTarget({ type, number, title })
    setLinkTaskId(null)
    if (boardTasks.length === 0) {
      api
        .fetchBoard()
        .then(({ columns }) => setBoardTasks([...columns.todo, ...columns.doing, ...columns.done]))
        .catch(() => {
          /* 拉取失败时关联弹窗内提示 */
        })
    }
  }

  const confirmLink = async () => {
    if (!repoRef || !linkTarget || !linkTaskId || linking) return
    setLinking(true)
    try {
      const { taskMovedToDone } = await api.linkGithub({
        taskId: linkTaskId,
        owner: repoRef.owner,
        repo: repoRef.repo,
        type: linkTarget.type,
        number: linkTarget.number,
      })
      message.success(taskMovedToDone ? '已建立关联,PR 已合并,任务移至 Done' : '已建立关联')
      setLinkTarget(null)
      await refreshLinks()
      if (taskMovedToDone) {
        api
          .fetchBoard()
          .then(({ columns }) => setBoardTasks([...columns.todo, ...columns.doing, ...columns.done]))
          .catch(() => {
            /* 刷新失败不影响关联 */
          })
        onTaskImported?.()
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '关联失败')
    } finally {
      setLinking(false)
    }
  }

  const linkedTag = (type: 'issue' | 'pr', number: number) => {
    const link = linksByKey.get(`${type}:${number}`)
    if (!link) return null
    const task = taskById.get(link.taskId)
    return (
      <Tooltip title={task ? `任务:${task.title}` : '关联任务已删除/归档'}>
        <Tag icon={<LinkOutlined />} color="purple">
          已关联
        </Tag>
      </Tooltip>
    )
  }

  const renderLoadMore = (hasMore: boolean, loading: boolean, onClick: () => void) =>
    hasMore ? (
      <div className="github-drawer__more">
        <Button size="small" loading={loading} onClick={onClick}>
          加载更多
        </Button>
      </div>
    ) : null

  const commitItems: TimelineItemData[] = commits.map((c) => ({
    key: `${c.sha}-${c.date}`,
    title: (
      <a href={c.htmlUrl} target="_blank" rel="noreferrer" className="github-drawer__commit-msg">
        {c.message}
      </a>
    ),
    description: (
      <span className="github-drawer__commit-meta">
        <code>{c.sha}</code>
        {c.author && ` · ${c.author}`}
      </span>
    ),
    timeLabel: dayjs(c.date).format('MM-DD HH:mm'),
  }))

  if (!project || !repoRef) {
    return (
      <Drawer title="GitHub 仓库" open={open} onClose={onClose} width={640} destroyOnHidden>
        <Empty description="该项目未绑定 GitHub 仓库:在项目表单中填写 github.com 仓库地址即可绑定" style={{ marginTop: 64 }} />
      </Drawer>
    )
  }

  const { owner, repo } = repoRef

  return (
    <Drawer
      title={
        <Space size={8}>
          <span>{`${owner}/${repo}`}</span>
          <a href={repoInfo?.htmlUrl ?? `https://github.com/${owner}/${repo}`} target="_blank" rel="noreferrer">
            ↗
          </a>
        </Space>
      }
      open={open}
      onClose={onClose}
      width={640}
      destroyOnHidden
    >
      {infoLoading ? (
        <div className="github-drawer__center">
          <Spin />
        </div>
      ) : infoError ? (
        <Alert
          type="warning"
          showIcon
          message="无法访问该仓库"
          description={infoError}
          action={
            <Button size="small" onClick={() => setTokenOpen(true)}>
              Token 设置
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : repoInfo ? (
        <div className="github-drawer__info">
          {repoInfo.description && <p className="github-drawer__desc">{repoInfo.description}</p>}
          <div className="github-drawer__stats">
            <span>
              <StarFilled style={{ color: '#f5a623' }} /> {repoInfo.stars}
            </span>
            <span>默认分支 {repoInfo.defaultBranch}</span>
            <span>{repoInfo.openIssuesCount} 个 open issue</span>
            <Button type="link" size="small" className="github-drawer__token-btn" onClick={() => setTokenOpen(true)}>
              Token 设置
            </Button>
          </div>
        </div>
      ) : null}

      <div className="github-drawer__tabs">
        <Segmented
          value={activeTab}
          onChange={(v) => handleTabChange(String(v))}
          options={[
            { label: 'Issue', value: 'issues' },
            { label: 'PR', value: 'pulls' },
            { label: '提交', value: 'commits' },
            { label: '分支', value: 'branches' },
          ]}
        />
      </div>

      {activeTab === 'issues' && (
        <div>
          <div className="github-drawer__filter">
            <Segmented
              size="small"
              value={issueState}
              onChange={(v) => changeIssueState(v as ListState)}
              options={[
                { label: '开放', value: 'open' },
                { label: '已关闭', value: 'closed' },
                { label: '全部', value: 'all' },
              ]}
            />
          </div>
          {issueError && <Alert type="error" showIcon message={issueError} style={{ marginBottom: 12 }} />}
          {issueLoading && issues.length === 0 ? (
            <div className="github-drawer__center">
              <Spin />
            </div>
          ) : issues.length === 0 && !issueError ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合条件的 Issue" />
          ) : (
            <ul className="github-drawer__list">
              {issues.map((it) => (
                <li key={it.number} className="github-drawer__item">
                  <div className="github-drawer__item-main">
                    <a href={it.htmlUrl} target="_blank" rel="noreferrer" className="github-drawer__item-title">
                      <Tag className="github-drawer__num">#{it.number}</Tag>
                      {it.title}
                    </a>
                    <span className="github-drawer__item-meta">
                      {it.state === 'open' ? <Tag color="green">开放</Tag> : <Tag>已关闭</Tag>}
                      {it.author && `@${it.author} · `}
                      {dayjs(it.updatedAt).format('MM-DD HH:mm')}
                    </span>
                  </div>
                  <div className="github-drawer__item-actions">
                    {linkedTag('issue', it.number) ?? (
                      <>
                        <Button type="link" size="small" loading={importing === it.number} onClick={() => void importIssue(it)}>
                          转任务
                        </Button>
                        <Button type="link" size="small" onClick={() => openLinkModal('issue', it.number, it.title)}>
                          关联任务
                        </Button>
      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {renderLoadMore(issueMore, issueLoading, () => loadIssues(issueState, issuePage + 1, true))}
        </div>
      )}

      {activeTab === 'pulls' && (
        <div>
          <div className="github-drawer__filter">
            <Segmented
              size="small"
              value={pullState}
              onChange={(v) => changePullState(v as ListState)}
              options={[
                { label: '开放', value: 'open' },
                { label: '已关闭', value: 'closed' },
                { label: '全部', value: 'all' },
              ]}
            />
          </div>
          {pullError && <Alert type="error" showIcon message={pullError} style={{ marginBottom: 12 }} />}
          {pullLoading && pulls.length === 0 ? (
            <div className="github-drawer__center">
              <Spin />
            </div>
          ) : pulls.length === 0 && !pullError ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合条件的 PR" />
          ) : (
            <ul className="github-drawer__list">
              {pulls.map((it) => (
                <li key={it.number} className="github-drawer__item">
                  <div className="github-drawer__item-main">
                    <a href={it.htmlUrl} target="_blank" rel="noreferrer" className="github-drawer__item-title">
                      <Tag className="github-drawer__num">#{it.number}</Tag>
                      {it.title}
                    </a>
                    <span className="github-drawer__item-meta">
                      {it.merged ? (
                        <Tag color="purple">已合并</Tag>
                      ) : it.state === 'open' ? (
                        <Tag color="green">开放</Tag>
                      ) : (
                        <Tag>已关闭</Tag>
                      )}
                      {it.author && `@${it.author} · `}
                      {dayjs(it.updatedAt).format('MM-DD HH:mm')}
                    </span>
                  </div>
                  <div className="github-drawer__item-actions">
                    {linkedTag('pr', it.number) ?? (
                      <Button
                        type="link"
                        size="small"
                        onClick={() => openLinkModal('pr', it.number, it.title)}
                      >
                        关联任务
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {renderLoadMore(pullMore, pullLoading, () => loadPulls(pullState, pullPage + 1, true))}
        </div>
      )}

      {activeTab === 'commits' && (
        <div>
          <div className="github-drawer__filter">
            <Select
              size="small"
              style={{ minWidth: 200 }}
              placeholder={repoInfo?.defaultBranch ?? '默认分支'}
              value={commitBranch ?? repoInfo?.defaultBranch ?? undefined}
              onChange={changeCommitBranch}
              showSearch
              options={(branches.length > 0
                ? branches
                : repoInfo
                  ? [{ name: repoInfo.defaultBranch, sha: '', protected: false }]
                  : []
              ).map((b) => ({ value: b.name, label: b.name }))}
            />
          </div>
          {commitError && <Alert type="error" showIcon message={commitError} style={{ marginBottom: 12 }} />}
          {commitLoading && commits.length === 0 ? (
            <div className="github-drawer__center">
              <Spin />
            </div>
          ) : commits.length === 0 && !commitError ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有提交记录" />
          ) : (
            <TimelineView items={commitItems} emptyText="没有提交记录" />
          )}
          {renderLoadMore(commitMore, commitLoading, () => loadCommits(commitBranch, commitPage + 1, true))}
        </div>
      )}

      {activeTab === 'branches' && (
        <div>
          {branchLoading ? (
            <div className="github-drawer__center">
              <Spin />
            </div>
          ) : branches.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有分支" />
          ) : (
            <ul className="github-drawer__list">
              {branches.map((b) => (
                <li key={b.name} className="github-drawer__item">
                  <div className="github-drawer__item-main">
                    <span className="github-drawer__item-title">
                      <BranchesOutlined />
                      <span style={{ marginInlineStart: 8 }}>{b.name}</span>
                    </span>
                    <span className="github-drawer__item-meta">
                      {b.name === repoInfo?.defaultBranch && <Tag color="blue">默认</Tag>}
                      {b.protected && <Tag color="gold">受保护</Tag>}
                      {b.sha && <code>{b.sha}</code>}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Modal
        title={`关联到任务:${linkTarget ? `#${linkTarget.number} ${linkTarget.title}`.slice(0, 40) : ''}`}
        open={linkTarget !== null}
        onCancel={() => setLinkTarget(null)}
        onOk={() => void confirmLink()}
        okText="关联"
        cancelText="取消"
        okButtonProps={{ disabled: !linkTaskId, loading: linking }}
        destroyOnHidden
      >
        {boardTasks.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="看板还没有任务" />
        ) : (
          <Select
            style={{ width: '100%' }}
            placeholder="选择要关联的任务"
            value={linkTaskId}
            onChange={setLinkTaskId}
            showSearch
            optionFilterProp="label"
            options={boardTasks.map((t) => ({
              value: t.id,
              label: `${t.title} · ${COLUMN_TITLES[t.status]}`,
            }))}
          />
        )}
      </Modal>

      <GithubTokenModal
        open={tokenOpen}
        onClose={() => {
          setTokenOpen(false)
          // Token 变化后重新拉取(服务端缓存按鉴权状态分键,必然是新请求)
          setRepoInfo(null)
          setInfoLoading(true)
          setInfoError(null)
          api
            .getGithubRepoInfo(owner, repo)
            .then((info) => setRepoInfo(info))
            .catch((e: unknown) => setInfoError(e instanceof Error ? e.message : '加载仓库信息失败'))
            .finally(() => setInfoLoading(false))
        }}
      />
    </Drawer>
  )
}
