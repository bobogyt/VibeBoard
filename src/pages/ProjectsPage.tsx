import { useEffect, useMemo, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
  DatePicker,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  DeleteOutlined,
  EditOutlined,
  GithubOutlined as GithubIcon,
  PlusOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../lib/api'
import { PROJECT_STATUSES, PROJECT_STATUS_DOT, PROJECT_STATUS_OPTIONS } from '../constants/projectStatus'
import type { Project, ProjectInput, ProjectStatus } from '../types'
import TimelineView from '../components/TimelineView'
import type { TimelineItemData } from '../components/TimelineView'
import GithubRepoDrawer from '../components/GithubRepoDrawer'
import { parseRepoUrl } from '../lib/github'

type ViewMode = 'card' | 'table' | 'timeline'

interface FormValues {
  name: string
  status: ProjectStatus
  description: string
  repoUrl: string
  techStack: string[]
  startDate: dayjs.Dayjs | null
  dueDate: dayjs.Dayjs | null
}

function isOverdue(project: Project): boolean {
  return (
    project.dueDate !== null &&
    project.dueDate < Date.now() &&
    !['released', 'archived'].includes(project.status)
  )
}

function formatDate(ts: number | null): string {
  return ts ? dayjs(ts).format('YYYY-MM-DD') : '—'
}

function StatusTag({ status }: { status: ProjectStatus }) {
  const { label, color } = PROJECT_STATUSES[status]
  return <Tag color={color}>{label}</Tag>
}

function ProjectProgress({ project }: { project: Project }) {
  if (project.progress === null) {
    return <span className="project-progress-none">暂无关联任务</span>
  }
  return (
    <Progress
      percent={project.progress}
      size="small"
      status={project.progress === 100 ? 'success' : 'normal'}
    />
  )
}

interface FormModalProps {
  open: boolean
  editing: Project | null
  onCancel: () => void
  onSubmit: (input: ProjectInput) => Promise<void>
}

function ProjectFormModal({ open, editing, onCancel, onSubmit }: FormModalProps) {
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    form.setFieldsValue({
      name: editing?.name ?? '',
      status: editing?.status ?? 'planning',
      description: editing?.description ?? '',
      repoUrl: editing?.repoUrl ?? '',
      techStack: editing?.techStack ?? [],
      startDate: editing?.startDate ? dayjs(editing.startDate) : null,
      dueDate: editing?.dueDate ? dayjs(editing.dueDate) : null,
    })
  }, [open, editing, form])

  const handleOk = () => {
    form
      .validateFields()
      .then(async (values) => {
        setSubmitting(true)
        const input: ProjectInput = {
          name: values.name.trim(),
          description: values.description ?? '',
          status: values.status,
          repoUrl: values.repoUrl ?? '',
          techStack: values.techStack ?? [],
          startDate: values.startDate ? values.startDate.startOf('day').valueOf() : null,
          dueDate: values.dueDate ? values.dueDate.endOf('day').valueOf() : null,
        }
        try {
          await onSubmit(input)
          form.resetFields()
        } finally {
          setSubmitting(false)
        }
      })
      .catch(() => {})
  }

  return (
    <Modal
      title={editing ? '编辑项目' : '新建项目'}
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      okText={editing ? '保存' : '创建'}
      cancelText="取消"
      confirmLoading={submitting}
      destroyOnHidden
      width={520}
    >
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          label="项目名称"
          name="name"
          rules={[
            { required: true, message: '请输入项目名称' },
            { max: 100, message: '不超过 100 字' },
          ]}
        >
          <Input placeholder="例如:VibeBoard" maxLength={100} autoFocus />
        </Form.Item>
        <Form.Item label="状态" name="status" rules={[{ required: true }]}>
          <Select options={PROJECT_STATUS_OPTIONS} />
        </Form.Item>
        <Form.Item label="描述(可选)" name="description">
          <Input.TextArea placeholder="项目简介…" rows={3} maxLength={2000} />
        </Form.Item>
        <Form.Item label="仓库地址(可选)" name="repoUrl">
          <Input placeholder="https://github.com/…" maxLength={500} />
        </Form.Item>
        <Form.Item label="开始日期(可选)" name="startDate">
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="目标发布日期(可选)" name="dueDate">
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="技术栈(可选)" name="techStack">
          <Select mode="tags" placeholder="回车添加,如 React、Node" maxCount={10} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default function ProjectsPage() {
  const { message } = AntdApp.useApp()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<ViewMode>('card')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [githubProject, setGithubProject] = useState<Project | null>(null)

  const reloadProjects = () => {
    api
      .listProjects()
      .then(({ projects: list }) => setProjects(list))
      .catch(() => {
        /* 抽屉内转任务后的静默刷新,失败不打扰 */
      })
  }

  useEffect(() => {
    let cancelled = false
    api.listProjects()
      .then(({ projects: list }) => {
        if (!cancelled) setProjects(list)
      })
      .catch((e: unknown) => {
        if (!cancelled) message.error(e instanceof Error ? e.message : '加载项目失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [message])

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  const openEdit = (project: Project) => {
    setEditing(project)
    setFormOpen(true)
  }

  const handleSubmit = async (input: ProjectInput) => {
    try {
      if (editing) {
        const { project } = await api.updateProject(editing.id, input)
        setProjects((prev) => prev.map((p) => (p.id === project.id ? project : p)))
        message.success('项目已更新')
      } else {
        const { project } = await api.createProject(input)
        setProjects((prev) => [project, ...prev])
        message.success('项目已创建')
      }
      setFormOpen(false)
      setEditing(null)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败')
    }
  }

  const handleDelete = async (project: Project) => {
    try {
      await api.deleteProject(project.id)
      setProjects((prev) => prev.filter((p) => p.id !== project.id))
      message.success('项目已删除,关联任务已解除关联')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  const columns: ColumnsType<Project> = [
    {
      title: '项目',
      dataIndex: 'name',
      render: (_, p) => (
        <Space>
          <span style={{ fontWeight: 500 }}>{p.name}</span>
          {p.repoUrl && (
            <a href={p.repoUrl} target="_blank" rel="noreferrer">
              <GithubIcon />
            </a>
          )}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      filters: Object.entries(PROJECT_STATUSES).map(([value, { label }]) => ({ text: label, value })),
      onFilter: (value, p) => p.status === value,
      render: (status: ProjectStatus) => <StatusTag status={status} />,
    },
    {
      title: '进度',
      dataIndex: 'progress',
      width: 200,
      render: (_, p) => <ProjectProgress project={p} />,
    },
    {
      title: '技术栈',
      dataIndex: 'techStack',
      render: (tech: string[]) =>
        tech.length > 0 ? (
          <Space size={4} wrap>
            {tech.map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </Space>
        ) : (
          '—'
        ),
    },
    {
      title: '截止日期',
      dataIndex: 'dueDate',
      width: 160,
      render: (_, p) =>
        isOverdue(p) ? (
          <Tooltip title="已超过目标日期但未发布">
            <span style={{ color: 'var(--danger)' }}>{formatDate(p.dueDate)}(已超期)</span>
          </Tooltip>
        ) : (
          formatDate(p.dueDate)
        ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 120,
      render: (ts: number) => dayjs(ts).format('YYYY-MM-DD'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_, p) => (
        <Space>
          <Tooltip title={parseRepoUrl(p.repoUrl) ? 'GitHub 仓库' : '未绑定 GitHub 仓库(仓库地址需为 github.com 链接)'}>
            <Button
              type="text"
              size="small"
              icon={<GithubIcon />}
              disabled={!parseRepoUrl(p.repoUrl)}
              onClick={() => setGithubProject(p)}
            />
          </Tooltip>
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(p)} />
          <Popconfirm
            title="删除该项目?"
            description="关联任务将保留并解除关联"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => void handleDelete(p)}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const timelineItems: TimelineItemData[] = useMemo(() => {
    return [...projects]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((p) => {
        const overdue = isOverdue(p)
        return {
          key: p.id,
          color: PROJECT_STATUS_DOT[p.status],
          title: p.name,
          tag: <StatusTag status={p.status} />,
          description: (
            <div className="project-timeline-desc">
              <div className="project-timeline-progress">
                {p.progress === null ? '暂无关联任务' : `进度 ${p.progress}%(${p.doneCount}/${p.totalCount})`}
              </div>
              {p.description && <div className="project-timeline-line">{p.description}</div>}
              <div className="project-timeline-line">
                <span className={overdue ? 'project-overdue' : ''}>
                  {overdue ? `截止 ${formatDate(p.dueDate)} 已超期` : `截止 ${formatDate(p.dueDate)}`}
                </span>
                {p.techStack.map((t) => (
                  <Tag key={t} style={{ marginInlineEnd: 0 }}>
                    {t}
                  </Tag>
                ))}
              </div>
            </div>
          ),
          timeLabel: dayjs(p.updatedAt).format('MM-DD HH:mm'),
        }
      })
  }, [projects])

  const tableNode = (
    <Table
      rowKey="id"
      columns={columns}
      dataSource={projects}
      loading={loading}
      pagination={{ pageSize: 10, showSizeChanger: false }}
      locale={{ emptyText: <Empty description="还没有项目,点击右上角创建" /> }}
    />
  )

  const cardNode = loading ? (
    <div className="projects-center">
      <Spin />
    </div>
  ) : projects.length === 0 ? (
    <Empty description="还没有项目,点击右上角创建" style={{ marginTop: 64 }} />
  ) : (
    <div className="projects-grid">
      {projects.map((p) => (
        <Card
          key={p.id}
          size="small"
          className="project-card"
          title={
            <Space size={8}>
              <span className="project-card-name">{p.name}</span>
              <StatusTag status={p.status} />
            </Space>
          }
          extra={
            <Space size={0}>
              <Tooltip title={parseRepoUrl(p.repoUrl) ? 'GitHub 仓库' : '未绑定 GitHub 仓库'}>
                <Button
                  type="text"
                  size="small"
                  icon={<GithubIcon />}
                  disabled={!parseRepoUrl(p.repoUrl)}
                  onClick={() => setGithubProject(p)}
                />
              </Tooltip>
              <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(p)} />
              <Popconfirm
                title="删除该项目?"
                description="关联任务将保留并解除关联"
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => void handleDelete(p)}
              >
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          }
        >
          <ProjectProgress project={p} />
          {p.description && <p className="project-card-desc">{p.description}</p>}
          <div className="project-card-meta">
            <span className={isOverdue(p) ? 'project-overdue' : ''}>
              {isOverdue(p) ? `${formatDate(p.dueDate)} 已超期` : `截止 ${formatDate(p.dueDate)}`}
            </span>
            <span>
              {p.techStack.map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </span>
          </div>
        </Card>
      ))}
    </div>
  )

  const timelineNode = loading ? (
    <div className="projects-center">
      <Spin />
    </div>
  ) : (
    <div className="projects-timeline">
      <TimelineView items={timelineItems} emptyText="还没有项目,点击右上角创建" />
    </div>
  )

  return (
    <div>
      <div className="projects-toolbar">
        <h2 className="projects-title">项目管理</h2>
        <Space>
          <Segmented
            value={view}
            onChange={(v) => setView(v as ViewMode)}
            options={[
              { label: '卡片', value: 'card' },
              { label: '表格', value: 'table' },
              { label: '时间线', value: 'timeline' },
            ]}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建项目
          </Button>
        </Space>
      </div>
      {view === 'table' ? tableNode : view === 'timeline' ? timelineNode : cardNode}
      <ProjectFormModal
        open={formOpen}
        editing={editing}
        onCancel={() => {
          setFormOpen(false)
          setEditing(null)
        }}
        onSubmit={handleSubmit}
      />
      {githubProject && (
        <GithubRepoDrawer
          key={githubProject.id}
          open
          onClose={() => setGithubProject(null)}
          project={githubProject}
          onTaskImported={reloadProjects}
        />
      )}
    </div>
  )
}
