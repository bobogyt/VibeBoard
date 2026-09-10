/** 服务端领域类型(与前端 src/types.ts 的接口契约对应) */

export type ColumnId = 'todo' | 'doing' | 'done'

export const COLUMN_IDS: ColumnId[] = ['todo', 'doing', 'done']

export type Priority = 'P0' | 'P1' | 'P2' | 'P3'

export const PRIORITIES: Priority[] = ['P0', 'P1', 'P2', 'P3']

export interface Task {
  id: string
  title: string
  description: string
  status: string
  projectId: string | null
  priority: Priority | null
  dueDate: number | null
  dependsOn: string[]
  createdAt: number
  updatedAt: number
}

export type BoardState = Record<ColumnId, Task[]>

export interface Project {
  id: string
  name: string
  description: string
  status: string
  repoUrl: string
  techStack: string[]
  startDate: number | null
  dueDate: number | null
  createdAt: number
  updatedAt: number
  totalCount: number
  doneCount: number
  progress: number | null
}

export interface MemoryItem {
  id: string
  content: string
  updatedAt: number
}
