export type ColumnId = 'todo' | 'doing' | 'done'

export type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3'

export interface Task {
  id: string
  title: string
  description: string
  status: ColumnId
  projectId: string | null
  priority: TaskPriority | null
  /** 截止时间(毫秒时间戳),null = 未设置 */
  dueDate: number | null
  /** 前置任务 id 列表:它们未完成前本任务被视为被阻塞 */
  dependsOn: string[]
  createdAt: number
  updatedAt: number
}

/** 看板状态:每列一个任务数组,数组顺序即卡片显示顺序 */
export type BoardState = Record<ColumnId, Task[]>

export interface TaskInput {
  title: string
  description: string
  projectId: string | null
  priority?: TaskPriority | null
  dueDate?: number | null
  /** 前置任务 id 列表(编辑弹窗可改) */
  dependsOn?: string[]
}

export type ProjectStatus =
  | 'planning'
  | 'developing'
  | 'testing'
  | 'released'
  | 'maintaining'
  | 'paused'
  | 'archived'

export interface Project {
  id: string
  name: string
  description: string
  status: ProjectStatus
  repoUrl: string
  techStack: string[]
  startDate: number | null
  dueDate: number | null
  createdAt: number
  updatedAt: number
  /** 进度自动计算:done/total;无关联任务时为 null */
  totalCount: number
  doneCount: number
  progress: number | null
}

export interface ProjectInput {
  name: string
  description: string
  status: ProjectStatus
  repoUrl: string
  techStack: string[]
  startDate: number | null
  dueDate: number | null
}
