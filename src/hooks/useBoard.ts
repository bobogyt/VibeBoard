import { useCallback, useEffect, useRef, useState } from 'react'
import { api, UnauthorizedError } from '../lib/api'
import { COLUMN_IDS, createEmptyBoard } from '../constants'
import type { BoardState, ColumnId, Task, TaskInput } from '../types'

export type LoadStatus = 'loading' | 'ready' | 'error'
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const SAVE_DEBOUNCE_MS = 500

export function useBoard(onUnauthorized: () => void) {
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [loadError, setLoadError] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState('')
  const [board, setBoard] = useState<BoardState>(createEmptyBoard)

  // 首次加载完成后才允许自动保存;dirtyRef 标记有待写入的变更
  const loadedRef = useRef(false)
  const dirtyRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const savingRef = useRef(false)
  const boardRef = useRef(board)
  const scheduleSaveRef = useRef<() => void>(() => {})
  // Agent 修改后 refresh 拉取服务端状态,这次变更不应触发自动保存
  const skipSaveRef = useRef(false)

  useEffect(() => {
    boardRef.current = board
  }, [board])

  const doSave = useCallback(async () => {
    if (savingRef.current) {
      // 上一轮还在写,标记脏数据,写完的 finally 会再安排
      dirtyRef.current = true
      return
    }
    if (!dirtyRef.current) return
    dirtyRef.current = false
    savingRef.current = true
    setSaveStatus('saving')
    try {
      await api.saveBoard(boardRef.current)
      setSaveStatus('saved')
      setSaveError('')
    } catch (e) {
      dirtyRef.current = true // 失败的数据仍待保存,重试后写入
      setSaveStatus('error')
      setSaveError(e instanceof UnauthorizedError ? '' : e instanceof Error ? e.message : '保存失败')
      if (e instanceof UnauthorizedError) onUnauthorized()
    } finally {
      savingRef.current = false
      if (dirtyRef.current) scheduleSaveRef.current()
    }
  }, [onUnauthorized])

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void doSave()
    }, SAVE_DEBOUNCE_MS)
  }, [doSave])

  useEffect(() => {
    scheduleSaveRef.current = scheduleSave
  }, [scheduleSave])

  // 初次从服务端加载看板
  useEffect(() => {
    let cancelled = false
    api
      .fetchBoard()
      .then(({ columns }) => {
        if (cancelled) return
        setBoard(columns)
        setLoadStatus('ready')
        // 等本地状态渲染完成后再打开自动保存
        window.setTimeout(() => {
          loadedRef.current = true
        }, 0)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        if (e instanceof UnauthorizedError) {
          onUnauthorized()
          return
        }
        setLoadError(e instanceof Error ? e.message : '加载失败')
        setLoadStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [onUnauthorized])

  // 自动保存:loaded 之后每次变更防抖 PUT;refresh 引入的变更除外
  useEffect(() => {
    if (!loadedRef.current) return
    if (skipSaveRef.current) {
      skipSaveRef.current = false
      return
    }
    dirtyRef.current = true
    scheduleSave()
  }, [board, scheduleSave])

  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    },
    [],
  )

  const retrySave = useCallback(() => {
    dirtyRef.current = true
    void doSave()
  }, [doSave])

  const addTask = useCallback((status: ColumnId, input: TaskInput) => {
    const now = Date.now()
    const task: Task = {
      id: crypto.randomUUID(),
      title: input.title.trim(),
      description: input.description.trim(),
      status,
      projectId: input.projectId,
      priority: input.priority ?? null,
      dueDate: input.dueDate ?? null,
      dependsOn: [],
      createdAt: now,
      updatedAt: now,
    }
    setBoard((prev) => ({ ...prev, [status]: [task, ...prev[status]] }))
  }, [])

  const updateTask = useCallback((id: string, input: TaskInput) => {
    setBoard((prev) => {
      const next = createEmptyBoard()
      for (const col of COLUMN_IDS) {
        next[col] = prev[col].map((task) =>
          task.id === id
            ? {
                ...task,
                title: input.title.trim(),
                description: input.description.trim(),
                projectId: input.projectId,
                priority: input.priority ?? null,
                dueDate: input.dueDate ?? null,
                dependsOn: input.dependsOn ?? task.dependsOn,
                updatedAt: Date.now(),
              }
            : task,
        )
      }
      return next
    })
  }, [])

  const deleteTask = useCallback((id: string) => {
    setBoard((prev) => {
      const next = createEmptyBoard()
      for (const col of COLUMN_IDS) {
        next[col] = prev[col].filter((task) => task.id !== id)
      }
      return next
    })
  }, [])

  /** 跨列移动:把任务插入目标列的指定位置,并同步任务 status 字段 */
  const moveTaskToColumn = useCallback((id: string, targetColumn: ColumnId, targetIndex: number) => {
    setBoard((prev) => {
      let task: Task | undefined
      let fromColumn: ColumnId | undefined
      let fromIndex = -1

      for (const col of COLUMN_IDS) {
        const idx = prev[col].findIndex((t) => t.id === id)
        if (idx !== -1) {
          task = prev[col][idx]
          fromColumn = col
          fromIndex = idx
          break
        }
      }
      if (!task || !fromColumn) return prev

      const next = createEmptyBoard()
      for (const col of COLUMN_IDS) next[col] = [...prev[col]]

      next[fromColumn].splice(fromIndex, 1)
      next[targetColumn].splice(targetIndex, 0, { ...task, status: targetColumn })
      return next
    })
  }, [])

  /** 列内排序:同列两任务交换位置 */
  const reorderTask = useCallback((column: ColumnId, fromId: string, toId: string) => {
    setBoard((prev) => {
      const list = [...prev[column]]
      const from = list.findIndex((t) => t.id === fromId)
      const to = list.findIndex((t) => t.id === toId)
      if (from === -1 || to === -1) return prev
      list.splice(to, 0, list.splice(from, 1)[0])
      return { ...prev, [column]: list }
    })
  }, [])

  /** 拖拽结束后同步被移动任务的 updatedAt(仅当状态列发生变化) */
  const touchTask = useCallback((id: string) => {
    setBoard((prev) => {
      const next = createEmptyBoard()
      for (const col of COLUMN_IDS) {
        next[col] = prev[col].map((task) =>
          task.id === id ? { ...task, updatedAt: Date.now() } : task,
        )
      }
      return next
    })
  }, [])

  /** 从服务端重新拉取看板(Agent 可能改动了数据);丢弃本地未保存的脏状态 */
  const refresh = useCallback(async () => {
    try {
      const { columns } = await api.fetchBoard()
      dirtyRef.current = false
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      skipSaveRef.current = true
      setBoard(columns)
    } catch {
      /* 刷新失败保留本地状态 */
    }
  }, [])

  return {
    board,
    loadStatus,
    loadError,
    saveStatus,
    saveError,
    retrySave,
    addTask,
    updateTask,
    deleteTask,
    moveTaskToColumn,
    reorderTask,
    touchTask,
    refresh,
  }
}
