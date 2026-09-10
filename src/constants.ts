import type { BoardState, ColumnId } from './types'

export const COLUMN_IDS: readonly ColumnId[] = ['todo', 'doing', 'done'] as const

export const COLUMN_TITLES: Record<ColumnId, string> = {
  todo: 'Todo',
  doing: 'Doing',
  done: 'Done',
}

export const THEME_STORAGE_KEY = 'vibeboard:theme'

export function createEmptyBoard(): BoardState {
  return { todo: [], doing: [], done: [] }
}
