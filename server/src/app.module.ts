import { Module } from '@nestjs/common'
import { HealthController } from './routes/health.controller'
import { AuthController } from './routes/auth.controller'
import { BoardController } from './routes/board.controller'
import { ProjectsController } from './routes/projects.controller'
import { MemoriesController } from './routes/memories.controller'
import { TasksController } from './routes/tasks.controller'
import { AgentController } from './routes/agent.controller'
import { ModelConfigController } from './routes/model-config.controller'
import { StatsController } from './routes/stats.controller'
import { AutomationsController } from './routes/automations.controller'
import { GithubController } from './routes/github.controller'

/** 单模块组织全部控制器:业务层为纯函数模块(服务层单例),无需额外 provider 注入 */
@Module({
  controllers: [
    HealthController,
    AuthController,
    BoardController,
    ProjectsController,
    MemoriesController,
    TasksController,
    AgentController,
    ModelConfigController,
    StatsController,
    AutomationsController,
    GithubController,
  ],
})
export class AppModule {}
