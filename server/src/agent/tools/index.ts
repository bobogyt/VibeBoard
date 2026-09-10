import { registerTool } from '../registry'
import { getProjectsTool } from './getProjects'
import { getProjectTool } from './getProject'
import { getTasksTool } from './getTasks'
import { getTaskTool } from './getTask'
import { createTaskTool } from './createTask'
import { updateTaskTool } from './updateTask'
import { moveTaskTool } from './moveTask'
import { updateTaskPriorityTool } from './updateTaskPriority'
import { deleteTasksTool } from './deleteTasks'
import { batchUpdateTasksTool } from './batchUpdateTasks'
import { archiveTasksTool } from './archiveTasks'
import { createTasksTool } from './createTasks'
import { getPreferencesTool } from './getPreferences'
import { rememberPreferenceTool } from './rememberPreference'
import { forgetPreferenceTool } from './forgetPreference'
import { setTaskDependenciesTool } from './setTaskDependencies'

/** 工具集:只读 5 个 + 安全写 5 个(自动执行)+ 高危 5 个(执行前需用户人工确认) */
const ALL_TOOLS = [
  getProjectsTool,
  getProjectTool,
  getTasksTool,
  getTaskTool,
  getPreferencesTool,
  createTaskTool,
  updateTaskTool,
  moveTaskTool,
  updateTaskPriorityTool,
  rememberPreferenceTool,
  forgetPreferenceTool,
  deleteTasksTool,
  batchUpdateTasksTool,
  archiveTasksTool,
  createTasksTool,
  setTaskDependenciesTool,
]

export function registerAllTools(): void {
  for (const tool of ALL_TOOLS) registerTool(tool)
}
