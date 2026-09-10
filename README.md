# VibeBoard

个人任务看板(Kanban)Web 应用:Todo / Doing / Done 三列管理任务,支持拖拽移动、中后台布局、Light / Dark 主题、移动端使用。账号登录,数据持久化到 MySQL,Redis 承担会话与读缓存。内置基于 GLM 的 AI 助手(Agent Harness):用自然语言让 Agent 自主读写任务与项目。

## 技术栈

- **前端**:React 19 + TypeScript(strict)+ Vite + **Ant Design 6** + react-router 7 + @dnd-kit(拖拽)
- **后端**:Node + Express(`server/`,纯 JS ESM,零构建)
- **存储**:MySQL(用户与任务持久化)+ Redis(登录会话、看板读缓存)
- **认证**:Node 内置 `crypto.scrypt` 密码哈希;随机 token 会话存 Redis,TTL 7 天滑动续期;密码最短 8 位;登录/注册接口限速(登录同 IP+用户名 10 分钟 8 次,注册同 IP 每小时 10 次);登录失败统一话术且恒定时长校验,不泄露用户名是否存在
- **AI Agent**:自研轻量 Agent Harness(`server/src/agent/`,Model + Tools + Loop + Guardrails),调 GLM OpenAI 兼容接口(纯 fetch 零依赖),工具分 READ / SAFE_WRITE 两级,带步数上限、重复失败守卫与结构化 trace

## 启动

1. 配置服务端凭据:`server/.env`(字段:PORT / MYSQL_* / REDIS_* / SESSION_TTL_SECONDS / BOARD_CACHE_TTL_SECONDS;AI 助手:GLM_API_KEY / GLM_BASE_URL / GLM_MODEL / AGENT_MAX_STEPS / AGENT_TIMEOUT_MS,GLM_API_KEY 未配置时 AI 助手返回明确提示,其余功能不受影响)
2. 数据库连接建议走 SSH 隧道,不要把 3306/6379 暴露公网

```bash
npm install
npm run server    # 终端 1:后端 API,默认 http://localhost:3000(启动时自动建表)
npm run dev       # 终端 2:前端,http://localhost:5173(/api 由 Vite 代理)
```

生产构建:

```bash
npm run build     # 前端类型检查 + 打包
npm run preview
```

## 功能

- 注册 / 登录 / 退出;每个账号独立数据
- **任务看板**:Todo / Doing / Done 三列,新增 / 编辑 / 删除任务(标题必填、可选描述、所属项目、优先级 P0-P3、截止日期;删除有 Popconfirm 二次确认),拖拽排序与跨列移动
  - 卡片上显示优先级彩色徽标与截止提示(已超期红字 / 今天到期橙色)
- **项目管理**:维护开发项目(名称、7 态生命周期状态、描述、仓库地址、起止时间、技术栈标签),卡片 / 表格 / 时间线三种视图
  - 项目进度从任务自动计算:任务可关联项目,进度 = 已完成任务占比(无关联任务显示「暂无关联任务」)
  - 目标日期已过但未发布的项目显示「已超期」红字提示
  - 删除项目时关联任务保留并自动解除关联;后端写入侧过滤悬空引用,防止陈旧保存复活
- **任务动态时间线**:看板工具栏打开「任务动态」抽屉,全部任务按最近更新倒序展示,节点颜色区分所在列,显示所属项目与描述
  - 通用 `TimelineView` 组件被项目管理时间线与任务动态共用,各自组装不同的条目内容
- **AI 助手(Agent Harness)**:看板工具栏「AI 助手」打开对话抽屉,用自然语言让 Agent 自主操作任务
  - 架构:GLM(OpenAI 兼容接口)→ AgentHarness(循环)→ ToolExecutor(校验/风险检查)→ 8 个 Tool → 业务 Service → MySQL;业务层与 Harness 完全解耦
  - 工具:只读 getProjects / getProject / getTasks / getTask;安全写 createTask / updateTask / moveTask / updateTaskPriority;无 deleteTask 等高危工具,模型无法越权
  - 守卫:最大步数(默认 10)、同参失败 3 次熔断、60s 超时、单用户单运行会话、每小时 20 次限速;工具失败以错误信息回填模型自纠
  - 可观测:每步模型调用 / 工具入参 / 结果 / 时长落 `[agent]` 结构化日志与会话 trace(`GET /api/agent/sessions/:id`);前端只展示最终回答与工具摘要,不暴露推理过程
  - Agent 的写操作与用户手动保存共用用户级锁串行化;完成后前端自动刷新看板
- **模型自助配置**:AI 助手抽屉右上角 ⚙ 打开「模型设置」——选供应商(智谱 GLM / DeepSeek,baseUrl 预置)→ 填 API Key(每供应商存一次,可留空沿用)→ 选模型(预设列表 + 可自行输入)→ 一键「保存并使用」;密钥按账号存 MySQL(`user_model_configs`),接口只回传掩码;未自配时回退 `server/.env` 的 GLM_*;自建/代理场景可用 `MODEL_BASE_URL_ZHIPU` / `MODEL_BASE_URL_DEEPSEEK` 覆盖目录地址
- 数据自动保存到 MySQL(500ms 防抖全量保存,乐观更新);刷新/换设备登录后数据一致
- Redis 缓存:看板读路径命中直接返回;保存后写穿透更新(缓存写入过滤后的状态);Redis 故障自动降级直读 MySQL
- 中后台布局:侧边栏菜单(任务看板 / 项目管理 / 数据统计* / 任务归档*),顶栏主题切换与用户菜单
  - *数据统计、任务归档为占位页
- Light / Dark 主题(antd token 定制 Linear 靛蓝配色),首次访问跟随系统偏好
- 响应式:窄屏侧边栏折叠为抽屉,看板单列堆叠

## 结构

```
server/
├── .env                   # 数据库/Redis 凭据 + GLM Agent 配置(不入库)
├── test/                  # Agent 测试:mock GLM + Loop 机制测试 + 集成测试
└── src/
    ├── index.js           # Express 装配与路由
    ├── db.js              # MySQL 连接池 + 自动建库建表与列迁移
    ├── cache.js           # Redis 会话与看板缓存(故障降级)
    ├── auth.js            # 注册/登录/登出/scrypt 哈希/会话校验
    ├── board.js           # 看板读写(事务全量替换 + cache-aside + 用户级写锁)
    ├── util/rateLimit.js  # 内存限速器(登录/注册/Agent 共用)
    ├── services/          # 业务服务层:projectService(项目 CRUD+进度聚合)/ taskService(细粒度任务操作)
    └── agent/             # Agent Harness
        ├── config.js      #   AgentConfig(env:模型/步数/超时)
        ├── glm-client.js  #   GlmClient(OpenAI 兼容 /chat/completions,纯 fetch)
        ├── harness.js     #   AgentLoop(多轮 tool calling + 守卫)
        ├── session.js     #   AgentSession(内存存储 + 状态机)
        ├── trace.js       #   AgentTrace(结构化步骤日志)
        ├── registry.js    #   AgentToolRegistry
        ├── executor.js    #   AgentToolExecutor(JSON/参数校验 + 风险检查)
        └── tools/         #   8 个工具(4 只读 + 4 安全写),全部调业务 Service
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
node server/test/agent-loop.test.mjs          # Loop 纯机制测试(无需 MySQL/Redis):18 项
node server/test/agent-integration.test.mjs   # 全链路集成(本机 MySQL + mock GLM):31 项,用独立库 vibeboard_it 并自动清理
```

mock GLM(`server/test/mock-glm.mjs`)实现 OpenAI 兼容 `/chat/completions`;`server/test/run-mock-glm.mjs` 起独立 mock 服务(默认 3900 端口);隧道可用时 `bash server/test/e2e-check.sh` 一键跑 HTTP E2E(模型配置增删 + mock 全链路)。配好真实模型后 `node --env-file=server/.env server/test/acceptance-five-cases.mjs` 跑五场景验收(只读问答/改优先级/整理任务/删除拒绝/优雅失败),自动补种子并还原看板。

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
| GET | /api/health | MySQL/Redis 健康检查 |
