/**
 * 步骤可视化:按工具名 + 入参/结果生成一条面向用户的中文摘要。
 * 只输出 label 级信息,原始参数与完整结果不出服务端(推理过程不可见的边界保持不变)。
 */

const STATUS_LABELS = { todo: 'Todo', doing: 'Doing', done: 'Done' }

function argsOf(args) {
  return args && typeof args === 'object' ? args : {}
}

function taskTitle(result) {
  const title = result?.task?.title
  return typeof title === 'string' && title.length > 0 ? title : null
}

/** 生成步骤摘要;取不到目标细节时回退为通用文案,保证 label 永远非空 */
export function stepLabel(name, args, ok, result) {
  const a = argsOf(args)
  switch (name) {
    case 'getTasks':
      return ok ? `读取任务(${result?.count ?? 0} 条)` : '读取任务失败'
    case 'getTask':
      return ok && taskTitle(result) ? `读取任务「${taskTitle(result)}」` : ok ? '读取任务详情' : '读取任务失败'
    case 'getProjects':
      return ok ? `读取项目(${result?.count ?? 0} 个)` : '读取项目失败'
    case 'getProject': {
      const projectName = result?.project?.name
      return ok && projectName ? `读取项目「${projectName}」` : ok ? '读取项目详情' : '读取项目失败'
    }
    case 'createTask':
      return taskTitle(result) ? `创建任务「${taskTitle(result)}」` : ok ? '创建任务' : '创建任务失败'
    case 'updateTask':
      return taskTitle(result) ? `更新任务「${taskTitle(result)}」` : ok ? '更新任务' : '更新任务失败'
    case 'moveTask': {
      const to = a.toStatus ? (STATUS_LABELS[a.toStatus] ?? a.toStatus) : null
      if (taskTitle(result) && to) return `移动「${taskTitle(result)}」→ ${to}`
      if (to) return `移动任务 → ${to}${ok ? '' : ' 失败'}`
      return ok ? '移动任务' : '移动任务失败'
    }
    case 'updateTaskPriority': {
      if (taskTitle(result) && a.priority) return `「${taskTitle(result)}」优先级改为 ${a.priority}`
      if (a.priority) return `调整优先级为 ${a.priority}${ok ? '' : ' 失败'}`
      return ok ? '调整任务优先级' : '调整优先级失败'
    }
    case 'deleteTasks': {
      const count = ok ? (result?.deleted ?? a.taskIds?.length) : a.taskIds?.length
      const singleTitle = ok && Array.isArray(result?.tasks) && result.tasks.length === 1 ? result.tasks[0].title : null
      if (singleTitle) return `删除任务「${singleTitle}」`
      if (count === undefined) return ok ? '删除任务' : '删除任务失败'
      return `删除 ${count} 个任务${ok ? '' : '失败'}`
    }
    case 'archiveTasks': {
      const count = ok ? (result?.changed ?? a.taskIds?.length) : a.taskIds?.length
      const singleTitle = ok && Array.isArray(result?.tasks) && result.tasks.length === 1 ? result.tasks[0].title : null
      if (singleTitle) return `归档任务「${singleTitle}」`
      if (count === undefined) return ok ? '归档任务' : '归档任务失败'
      return `归档 ${count} 个任务${ok ? '' : '失败'}`
    }
    case 'batchUpdateTasks': {
      const count = ok ? (result?.updated ?? a.taskIds?.length) : a.taskIds?.length
      const parts = batchPatchParts(a)
      if (count === undefined || parts.length === 0) return ok ? '批量修改任务' : '批量修改任务失败'
      return `批量将 ${count} 个任务${parts.join('、')}${ok ? '' : '失败'}`
    }
    case 'createTasks': {
      const count = ok ? (result?.created ?? a.tasks?.length) : a.tasks?.length
      if (count === undefined) return ok ? '创建任务' : '创建任务失败'
      if (ok && count === 1 && Array.isArray(result?.tasks) && result.tasks[0]) {
        return `创建任务「${result.tasks[0].title}」`
      }
      return `创建 ${count} 个任务${ok ? '(按执行顺序)' : '失败'}`
    }
    case 'getPreferences':
      return ok ? `读取偏好记忆(${result?.count ?? 0} 条)` : '读取偏好记忆失败'
    case 'rememberPreference': {
      const content = ok ? result?.memory?.content : a.content
      if (!content) return ok ? '记住偏好' : '记住偏好失败'
      const brief = content.length > 20 ? `${content.slice(0, 20)}…` : content
      return `记住偏好「${brief}」${ok ? '' : '失败'}`
    }
    case 'forgetPreference':
      return ok ? '忘掉一条偏好记忆' : '忘掉偏好记忆失败'
    case 'setTaskDependencies': {
      const count = a.dependsOn?.length
      if (count === undefined) return ok ? '设置前置依赖' : '设置前置依赖失败'
      return `设置前置依赖(${count} 项)${ok ? '' : '失败'}`
    }
    default:
      return ok ? `执行 ${name}` : `执行 ${name} 失败`
  }
}

/** 批量修改的变更点描述(status/priority/projectId) */
function batchPatchParts(args) {
  const a = argsOf(args)
  const parts = []
  if (a.patch?.status) parts.push(`移动到 ${STATUS_LABELS[a.patch.status] ?? a.patch.status}`)
  if (a.patch?.priority) parts.push(`优先级改为 ${a.patch.priority}`)
  if (a.patch?.projectId !== undefined) parts.push(a.patch.projectId === null ? '移出所属项目' : '修改所属项目')
  return parts
}

/** 审批前的意图摘要(尚未执行,无结果可依赖) */
export function intentLabel(name, args) {
  if (name === 'batchUpdateTasks') {
    const parts = batchPatchParts(args)
    const count = argsOf(args).taskIds?.length
    if (parts.length === 0 || count === undefined) return '批量修改任务(待确认)'
    return `批量将 ${count} 个任务${parts.join('、')}(待确认)`
  }
  if (name === 'createTasks') {
    const count = argsOf(args).tasks?.length
    return `创建 ${count ?? '?'} 个任务的任务计划(待确认)`
  }
  if (name === 'setTaskDependencies') {
    const count = argsOf(args).dependsOn?.length
    return `设置前置依赖(${count ?? '?'} 项)(待确认)`
  }
  const label = stepLabel(name, args, true, null)
  return `${label}(待确认)`
}
