# VibeBoard

个人任务看板(Kanban)Web 应用:Todo / Doing / Done 三列管理任务,支持拖拽移动、中后台布局、Light / Dark 主题、移动端使用。账号登录,数据持久化到 MySQL,Redis 承担会话与读缓存。内置基于 GLM 的 AI 助手(Agent Harness):用自然语言让 Agent 自主读写任务与项目。

## 技术栈

- **前端**:React 19 + TypeScript(strict)+ Vite + **Ant Design 6** + react-router 7 + @dnd-kit(拖拽)
- **后端**:**NestJS 11 + TypeScript(strict)**(`server/`,独立 npm 工程,tsc 构建到 server/dist;Controller/Guard/异常过滤器只做 HTTP 适配,业务层为纯函数服务)
- **存储**:MySQL(用户与任务持久化)+ Redis(登录会话、看板读缓存)
- **认证**:Node 内置 `crypto.scrypt` 密码哈希;随机 token 会话存 Redis,TTL 7 天滑动续期;密码最短 8 位;登录/注册接口限速(登录同 IP+用户名 10 分钟 8 次,注册同 IP 每小时 10 次);登录失败统一话术且恒定时长校验,不泄露用户名是否存在
- **AI Agent**:自研轻量 Agent Harness(`server/src/agent/`,框架无关,Model + Tools + Loop + Guardrails + Human Approval),调 GLM OpenAI 兼容接口(纯 fetch 零依赖),工具分 READ / SAFE_WRITE / HIGH_RISK 三级,带步数上限、重复失败守卫与结构化 trace

## 启动

1. 配置服务端凭据:`server/.env`(字段:PORT / MYSQL_* / REDIS_* / SESSION_TTL_SECONDS / BOARD_CACHE_TTL_SECONDS;AI 助手:GLM_API_KEY / GLM_BASE_URL / GLM_MODEL / AGENT_MAX_STEPS / AGENT_TIMEOUT_MS,GLM_API_KEY 未配置时 AI 助手返回明确提示,其余功能不受影响)
2. 数据库连接建议走 SSH 隧道,不要把 3306/6379 暴露公网
3. 并发相关(可选):`WEB_WORKERS=N` 启用 Node cluster 多进程(默认 1 = 单进程;限速计数/单运行锁/审批投递自动经 Redis 跨进程共享,Redis 不可用降级进程内);`MYSQL_POOL_SIZE` 每进程连接池大小(默认 10,注意 N × 池大小 ≤ MySQL 连接上限)

```bash
npm install                      # 根(前端)依赖
npm install --prefix server      # 后端依赖(server/ 是独立 npm 工程)
npm run server                   # 终端 1:后端 API(默认 http://localhost:3000,构建 + watch 启动,启动时自动建表)
npm run dev                      # 终端 2:前端,http://localhost:5173(/api 由 Vite 代理)
```

生产构建:

```bash
npm run build         # 前端类型检查 + 打包
npm run build:server  # 后端 tsc 构建到 server/dist(npm run server:start 运行)
npm run preview
```

## 功能

- 注册 / 登录 / 退出;每个账号独立数据
- **任务看板**:Todo / Doing / Done 三列,新增 / 编辑 / 删除任务(标题必填、可选描述、所属项目、优先级 P0-P3、截止日期、前置任务依赖;删除有 Popconfirm 二次确认),拖拽排序与跨列移动
  - 卡片上显示优先级彩色徽标与截止提示(已超期红字 / 今天到期橙色);被前置任务阻塞的卡片显示「前置 N」标签
- **任务归档**:任务可移出看板归档(行保留,看板/缓存只含未归档任务),归档页查看全部归档,支持恢复回原列原位置与彻底删除(均整批原子);归档/删除后其他任务对它的前置引用自动清理
- **项目管理**:维护开发项目(名称、7 态生命周期状态、描述、仓库地址、起止时间、技术栈标签),卡片 / 表格 / 时间线三种视图
  - 项目进度从任务自动计算:任务可关联项目,进度 = 已完成任务占比(无关联任务显示「暂无关联任务」)
  - 目标日期已过但未发布的项目显示「已超期」红字提示
  - 删除项目时关联任务保留并自动解除关联;后端写入侧过滤悬空引用,防止陈旧保存复活
- **任务动态时间线**:看板工具栏打开「任务动态」抽屉,全部任务按最近更新倒序展示,节点颜色区分所在列,显示所属项目与描述
  - 通用 `TimelineView` 组件被项目管理时间线与任务动态共用,各自组装不同的条目内容
- **AI 助手(Agent Harness)**:看板工具栏「AI 助手」打开对话抽屉,用自然语言让 Agent 自主操作任务
  - 架构:GLM(OpenAI 兼容接口)→ AgentHarness(循环)→ ToolExecutor(校验/风险检查)→ 16 个 Tool → 业务 Service → MySQL;业务层与 Harness 完全解耦
  - 工具:只读 getProjects / getProject / getTasks / getTask / getPreferences;安全写 createTask / updateTask / moveTask / updateTaskPriority / rememberPreference / forgetPreference;高危(需人工确认)deleteTasks / batchUpdateTasks / archiveTasks / createTasks / setTaskDependencies
  - 守卫:最大步数(默认 10)、同参失败 3 次熔断、60s 超时、单用户单运行会话、每小时 20 次限速;工具失败以错误信息回填模型自纠
  - 可观测:每步模型调用 / 工具入参 / 结果 / 时长落 `[agent]` 结构化日志与会话 trace(`GET /api/agent/sessions/:id`);前端只展示最终回答与工具摘要,不暴露推理过程
  - Agent 的写操作与用户手动保存共用用户级锁串行化;完成后前端自动刷新看板
- **模型自助配置**:AI 助手抽屉右上角 ⚙ 打开「模型设置」——选供应商(智谱 GLM / DeepSeek,baseUrl 预置)→ 填 API Key(每供应商存一次,可留空沿用)→ 选模型(预设列表 + 可自行输入)→ 一键「保存并使用」;密钥按账号存 MySQL(`user_model_configs`),接口只回传掩码;未自配时回退 `server/.env` 的 GLM_*;自建/代理场景可用 `MODEL_BASE_URL_ZHIPU` / `MODEL_BASE_URL_DEEPSEEK` 覆盖目录地址
- **数据统计**:五个模块——项目完成率(进度条 + 平均值)、优先级分布(P0-P3/无)、逾期任务清单(逾期天数高亮)、每日/每周完成趋势(轻量柱状图,基于 tasks.completed_at 完成时间跟踪)、Agent 操作统计(持久化操作日志:总次数/近 7 天/成功率/按工具聚合;仅记录实际执行,拒绝与超时不计入)
- **自动化**:四个内置自动化(每日计划 / 每周复盘:只读 Agent 无人值守运行;截止日期提醒 / 逾期与阻塞盘点:确定性扫描),按用户开关启用,到点自动执行并产出通知;头部铃铛显示未读数(60s 轮询);多进程部署由 Redis 锁选主,只有 leader 触发;支持「立即运行」手动触发
- 数据自动保存到 MySQL(500ms 防抖全量保存,乐观更新);刷新/换设备登录后数据一致
- Redis 缓存:看板读路径命中直接返回;保存后写穿透更新(缓存写入过滤后的状态);Redis 故障自动降级直读 MySQL
- 中后台布局:侧边栏菜单(任务看板 / 项目管理 / 数据统计 / 任务归档),顶栏主题切换与用户菜单;窄屏(<992px)侧边栏收起,由头部汉堡按钮打开抽屉导航
- Light / Dark 主题(antd token 定制 Linear 靛蓝配色),首次访问跟随系统偏好
- 响应式:窄屏侧边栏折叠为抽屉,看板单列堆叠

## 结构

```
server/
├── .env                   # 数据库/Redis 凭据 + GLM Agent 配置(不入库)
├── package.json           # 后端独立依赖(NestJS 11;与根前端依赖分离)
├── tsconfig.json          # strict + experimentalDecorators
├── test/                  # Agent 测试:mock GLM + Loop 机制测试 + 集成测试(引 server/dist,需先构建)
└── src/
    ├── main.ts            # Nest 启动编排(initDb → 注册工具 → 装配 → 监听;WEB_WORKERS>1 时 cluster 多进程)
    ├── app.module.ts      # 控制器模块图
    ├── routes/            # Controller(HTTP 适配层):auth/board/projects/memories/tasks/agent/model-config/health
    ├── http/              # AuthGuard + 限速 Guard + 全局异常过滤器(统一 {error} JSON)+ @UserId 装饰器
    ├── types.ts           # 领域类型(Task/BoardState/Project)
    ├── db.ts              # MySQL 连接池 + 自动建库建表与列迁移
    ├── cache.ts           # Redis 会话与看板缓存(故障降级)
    ├── board.ts           # 看板读写(事务全量替换 + cache-aside + 用户级写锁)
    ├── util/rateLimit.ts  # 限速器(Redis INCR 固定窗口,降级进程内存;登录/注册/Agent Guard 共用)
    ├── services/          # 业务服务层:authService / projectService / taskService / memoryService / modelConfigService(纯函数模块,测试直接引用)
    └── agent/             # Agent Harness(框架无关)
        ├── config.ts      #   AgentConfig(env:模型/步数/超时)
        ├── glm-client.ts  #   OpenAI 兼容 /chat/completions(纯 fetch)
        ├── harness.ts     #   AgentLoop(多轮 tool calling + 守卫 + 人工确认)
        ├── session.ts     #   AgentSession(内存 trace 存储 + 状态机)+ RunSlotStore(单运行锁,Redis NX)
        ├── trace.ts       #   AgentTrace(结构化步骤日志)
        ├── stepLabel.ts   #   步骤可视化中文摘要(SSE label)
        ├── registry.ts    #   Tool 注册表(READ/SAFE_WRITE/HIGH_RISK)
        ├── executor.ts    #   参数解析/校验 + 风险检查
        ├── approvals.ts   #   HIGH_RISK 人工确认挂起/落点(跨 worker 经 Redis 标记 + pub/sub 投递)
        └── tools/         #   16 个工具(5 只读 + 6 安全写 + 5 高危),全部调业务 Service
src/
├── theme/index.ts         # antd 明暗两套 token(Linear 靛蓝 #5e6ad2)
├── context/               # AuthContext / ThemeContext(Provider + contexts.ts)
├── constants/projectStatus.ts # 项目 7 态状态的标签与颜色映射
├── hooks/                 # useAuth / useAuthContext / useTheme / useBoard
├── lib/api.ts             # fetch 封装(token 注入、401 处理、项目 CRUD、Agent 调用)
├── lib/session.ts         # token 存取
├── layouts/BasicLayout.tsx # 中后台布局壳(antd Layout + Menu)
├── pages/                 # LoginPage / BoardPage / ProjectsPage / PlaceholderPage
├── components/            # Board / Column / TaskCard / TaskModal / AgentChatDrawer / TimelineView / TaskTimelineDrawer
└── styles/                # app.css(布局壳与看板)+ projects.css(项目管理)
```

## Agent 测试

```bash
npm run build:server                          # 先构建(测试引用 server/dist 编译产物)
MYSQL_DATABASE=<临时库> MYSQL_PASSWORD=... node server/test/agent-loop.test.mjs          # Loop 纯机制测试:45 项(需可达 MySQL 且库存在)
node server/test/agent-integration.test.mjs   # 全链路集成(本机 MySQL + mock GLM):108 项,用独立库 vibeboard_it 并自动清理
node server/test/concurrency.test.mjs         # 并发设施(限速窗口/运行锁/审批跨进程路由):26 项,内嵌 mini-RESP 假服务器,无外部依赖
```

mock GLM(`server/test/mock-glm.mjs`)实现 OpenAI 兼容 `/chat/completions`;`server/test/run-mock-glm.mjs` 起独立 mock 服务(默认 3900 端口);隧道可用时 `bash server/test/e2e-check.sh` 一键跑 HTTP E2E(模型配置增删 + mock 全链路)。配好真实模型后 `node --env-file=server/.env server/test/acceptance-five-cases.mjs` 跑五场景验收(只读问答/改优先级/整理任务/删除拒绝/优雅失败),自动补种子并还原看板。本机无 Redis 时可用 `node server/test/run-fake-redis.mjs <port>` 起内嵌假服务器(会话/限速/锁/审批 pub/sub)做多进程联调。

## 并发能力

- **多进程**:`WEB_WORKERS=N`(Node cluster)启用多 worker,主进程自动重生崩溃 worker;默认 1 = 单进程,行为不变
- **跨进程状态全部在 Redis**:登录/注册/Agent 限速计数(INCR 固定窗口)、Agent 单用户单运行锁(SET NX + TTL 兜底)、高危操作审批投递(Redis 标记 + pub/sub 回投持有 worker)——多 worker 下语义与单进程一致
- **降级**:Redis 不可用时以上设施自动退回进程内存(单进程部署语义不变;会话校验安全优先仍 fail-closed)
- 已知边界:Agent 会话 trace(观测接口 `GET /api/agent/sessions/:id`)是进程本地存储;跨多机部署时 SSE 需网关层粘性支持

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/auth/register | 注册并登录 |
| POST | /api/auth/login | 登录 |
| POST | /api/auth/logout | 退出 |
| GET | /api/auth/me | 恢复登录态 |
| GET | /api/board | 读取看板 |
| PUT | /api/board | 全量保存看板 |
| GET | /api/projects | 项目列表(含进度聚合) |
| POST | /api/projects | 新建项目 |
| PUT | /api/projects/:id | 更新项目 |
| DELETE | /api/projects/:id | 删除项目(关联任务解除关联) |
| GET | /api/agent/models | 供应商目录 + 已存密钥(掩码)+ 当前生效配置 |
| PUT | /api/agent/models | 保存(添加/更新密钥)并切换当前模型 |
| DELETE | /api/agent/models/:provider | 清除某供应商已存密钥 |
| POST | /api/agent/run | 运行 Agent 会话(自然语言指令) |
| GET | /api/agent/sessions/:id | 会话 trace(仅本人) |
| GET | /api/stats | 数据统计(项目完成率/优先级分布/逾期/趋势/Agent 操作) |
| GET/PUT | /api/automations(/:id) | 自动化目录与用户开关 |
| POST | /api/automations/:id/run | 立即执行一次自动化 |
| GET/POST | /api/automations/runs · notifications(/read) | 运行历史与通知中心 |
| GET | /api/health | MySQL/Redis 健康检查 |
