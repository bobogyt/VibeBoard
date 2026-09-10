import { registerTool } from '../registry.js'
import { getProjectsTool } from './getProjects.js'
import { getProjectTool } from './getProject.js'
import { getTasksTool } from './getTasks.js'
import { getTaskTool } from './getTask.js'
import { createTaskTool } from './createTask.js'
import { updateTaskTool } from './updateTask.js'
import { moveTaskTool } from './moveTask.js'
import { updateTaskPriorityTool } from './updateTaskPriority.js'
import { deleteTasksTool } from './deleteTasks.js'
import { batchUpdateTasksTool } from './batchUpdateTasks.js'
import { archiveTasksTool } from './archiveTasks.js'
import { createTasksTool } from './createTasks.js'
import { getPreferencesTool } from './getPreferences.js'
import { rememberPreferenceTool } from './rememberPreference.js'
import { forgetPreferenceTool } from './forgetPreference.js'
import { setTaskDependenciesTool } from './setTaskDependencies.js'

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

export function registerAllTools() {
  for (const tool of ALL_TOOLS) registerTool(tool)
}
