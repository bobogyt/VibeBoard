import { useEffect, useState } from 'react'
import { App as AntdApp, DatePicker, Form, Input, Modal, Select } from 'antd'
import dayjs from 'dayjs'
import { api } from '../lib/api'
import { COLUMN_TITLES } from '../constants'
import type { BoardState, Project, Task, TaskInput, TaskPriority } from '../types'

interface TaskModalProps {
  mode: 'create' | 'edit'
  columnTitle?: string
  task?: Task
  /** 全看板任务:编辑模式下用于选择前置任务 */
  board?: BoardState
  onClose: () => void
  onSubmit: (input: TaskInput) => void
}

interface FormValues {
  title: string
  description: string
  projectId: string | null
  priority: TaskPriority | null
  dueDate: dayjs.Dayjs | null
  dependsOn: string[]
}

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'P0', label: 'P0 - 紧急' },
  { value: 'P1', label: 'P1 - 高' },
  { value: 'P2', label: 'P2 - 中' },
  { value: 'P3', label: 'P3 - 低' },
]

export default function TaskModal({ mode, columnTitle, task, board, onClose, onSubmit }: TaskModalProps) {
  const { message } = AntdApp.useApp()
  const [form] = Form.useForm<FormValues>()
  const [projects, setProjects] = useState<Project[]>([])

  useEffect(() => {
    form.setFieldsValue({
      title: task?.title ?? '',
      description: task?.description ?? '',
      projectId: task?.projectId ?? null,
      priority: task?.priority ?? null,
      dueDate: task?.dueDate ? dayjs(task.dueDate) : null,
      dependsOn: task?.dependsOn ?? [],
    })
  }, [task, form])

  useEffect(() => {
    api
      .listProjects()
      .then(({ projects }) => setProjects(projects.filter((p) => p.status !== 'archived')))
      .catch(() => {
        /* 项目列表拉取失败不阻塞任务编辑 */
      })
  }, [])

  const handleOk = () => {
    form
      .validateFields()
      .then((values: FormValues) => {
        onSubmit({
          title: values.title,
          description: values.description,
          projectId: values.projectId ?? null,
          priority: values.priority ?? null,
          dueDate: values.dueDate ? values.dueDate.valueOf() : null,
          dependsOn: mode === 'edit' ? (values.dependsOn ?? []) : undefined,
        })
        form.resetFields()
      })
      .catch(() => {
        message.error('请检查表单填写')
      })
  }

  const dependencyOptions = (board ? [...board.todo, ...board.doing, ...board.done] : [])
    .filter((t) => t.id !== task?.id)
    .map((t) => ({ value: t.id, label: `${t.title} · ${COLUMN_TITLES[t.status]}` }))

  return (
    <Modal
      title={mode === 'create' ? `添加任务到 ${columnTitle ?? ''}` : '编辑任务'}
      open
      onCancel={onClose}
      onOk={handleOk}
      okText={mode === 'create' ? '添加' : '保存'}
      cancelText="取消"
      destroyOnHidden
    >
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          label="标题"
          name="title"
          rules={[
            { required: true, message: '请输入标题' },
            { max: 200, message: '标题不能超过 200 字' },
          ]}
        >
          <Input placeholder="要做什么?" maxLength={200} autoFocus />
        </Form.Item>
        <Form.Item label="描述(可选)" name="description">
          <Input.TextArea placeholder="补充说明…" rows={4} maxLength={2000} showCount />
        </Form.Item>
        <Form.Item label="所属项目(可选)" name="projectId" extra="关联后,任务完成情况将计入项目进度">
          <Select
            placeholder="不关联项目"
            allowClear
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
          />
        </Form.Item>
        <Form.Item label="优先级(可选)" name="priority">
          <Select placeholder="未设置" allowClear options={PRIORITY_OPTIONS} />
        </Form.Item>
        <Form.Item label="截止日期(可选)" name="dueDate">
          <DatePicker style={{ width: '100%' }} placeholder="不设置截止日期" showTime />
        </Form.Item>
        {mode === 'edit' && board && (
          <Form.Item label="前置任务(完成后才不阻塞本任务)" name="dependsOn">
            <Select mode="multiple" allowClear placeholder="不设置前置" options={dependencyOptions} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}
