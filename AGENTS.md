# AGENTS.md — VibeBoard 项目上下文

> 本文件供 AI 编码工具(ZCode 等)在每次会话开始时读取,记录跨会话需要知道的架构、决策与环境事实。修改项目关键结构或决策时请同步更新此文件。

## 项目是什么

个人任务看板(Kanban):登录账号 → Todo / Doing / Done 三列任务,拖拽移动,自动持久化到 MySQL,Redis 做会话与读缓存。内置基于 GLM 的 AI 助手(自研轻量 Agent Harness),可用自然语言让 Agent 自主读写任务。

## 架构

```
React 19 + TS(strict) + Vite + Ant Design 6 + react-router 7 + @dnd-kit
        │ fetch /api/*(Vite 代理 → localhost:3000)
NestJS 11 + TypeScript(strict)(server/,独立 package.json,tsc 构建到 server/dist)
        ├── MySQL(SSH 隧道 127.0.0.1:13306):users + tasks 表,库 vibeboard
        └── Redis(SSH 隧道 127.0.0.1:16379):session:{token}(7d 滑动)+ board:{userId} 缓存(1h)
```

- 后端分层:`src/routes/`(Controller + Guard,仅 HTTP 适配)→ `src/services/` + `board.ts`(业务,纯函数模块级单例)→ `db.ts`/`cache.ts`(连接单例);Agent harness 与工具在 `src/agent/`,框架无关。鉴权 = `AuthGuard`,限速 = Guard(`http/guards.ts`),错误 = `GlobalExceptionFilter` 统一 `{error}` JSON(带 status 的错误透传 message,否则「服务器内部错误」,与旧 Express 版逐字一致)
- 服务层刻意保持「模块单例 + 命名导出函数」而非 class DI:两个测试套件直接 import 这些模块,这是测试接缝,勿改成注入式
- 前端读:Redis cache-aside(未命中读 MySQL 回填);前端写:500ms 防抖全量 PUT → MySQL 事务(DELETE+批量 INSERT)→ 写穿透更新缓存;Redis 故障降级直连 MySQL,会话校验不降级
- 凭据在 `server/.env`(已 gitignore),不在任何文档中记录明文密码;env 经 `node --env-file=.env` 原生加载(无 dotenv)

## 关键决策(不要回退)

1. **保留 Linear 配色** `#5e6ad2`(light)/ `#6e79d8`(dark),通过 antd v6 ThemeConfig token 定制;用户明确否决过 antd 默认蓝
2. **拖拽用 @dnd-kit**:antd 没有看板拖拽;不要尝试换成别的
3. **不用 @ant-design/pro-components**:其 antd v6 支持仅在 beta 通道(3.1.14-x),稳定版 2.8.10 只支持 antd 4/5;布局壳用 antd 原生 Layout/Menu 自建(`src/layouts/BasicLayout.tsx`)
4. **占位页已全部落地(2026-09-10)**:数据统计页(StatsPage,五模块:项目完成率/优先级分布/逾期任务/日周完成趋势/Agent 操作统计)与任务归档页均已完整实现。支撑数据模型:tasks.completed_at(完成时间,saveBoard 事务内跟踪 done 迁移写入/清空,存量以 updated_at 回填)+ agent_operation_log 表(harness 埋点,仅记录实际执行的工具调用,拒绝/超时不算,写入失败不阻塞运行)
5. **认证**:scrypt(内置 crypto,不要引入 bcrypt)+ Redis 会话;开放注册
6. 看板列/卡片保留手写 DOM(拖拽需要),全局组件一律 antd
7. **项目进度自动计算**:进度 = 关联任务中 done 占比,后端 LEFT JOIN 聚合,无任务时 progress=null(UI 显示「暂无关联任务」);status 仍手动维护。不要改成手动进度条
8. **删除项目** = tasks.project_id 置 NULL(任务保留);board.js 写入侧会过滤指向不存在项目的 projectId(防陈旧保存复活悬空引用),且 Redis 缓存只写过滤后的 sanitized 状态——三处缺一不可,勿回退
9. **通用时间线组件** `src/components/TimelineView.tsx`:数据驱动(items: key/color/title/description/timeLabel/tag),调用方负责排序与内容组装。现有两个消费方:项目管理页第三种视图「时间线」(节点色 = PROJECT_STATUS_DOT)、看板「任务动态」抽屉(TaskTimelineDrawer,节点色 = 所在列)。新增时间线场景时复用此组件,不要另写
10. **Agent Harness 自研,不用 LangChain/LangGraph/Multi-Agent**(`server/src/agent/`,2026-09-09 用户明确要求):Model + System Instructions + Tools + Loop + Guardrails 的最小实现;GLM 走 OpenAI 兼容 `/chat/completions`(纯 fetch,不引 SDK)
11. **Agent 工具只调业务 Service,不碰 SQL/HTTP 层**:调用链 Tool → services/taskService・projectService → board.ts/pool;工具分 READ(自动执行)与 SAFE_WRITE(自动执行+记录)两级,第一版刻意不提供 deleteTask——验收场景要求 Agent 对删除请求如实说明做不到,不要"补全"删除工具(加则必须带 Human Approval)
12. **Agent 边界安全**:userId 永远来自 requireAuth 注入的 ctx,绝不由模型传参;工具返回 {error} 回填模型自纠;同参失败 3 次熔断、maxSteps(10)上限、单用户单运行会话、agent 路由每小时 20 次限速;前端只显示 finalAnswer + 工具摘要,不暴露推理过程
13. **看板用户级写锁** `board.ts withBoardLock(userId, fn)`:Agent 读-改-写与前端全量 PUT /api/board 共用此锁串行化,防止互相覆盖(最后写入胜出的全量保存模型下,这是唯一防线,勿绕过)
14. **tasks 表的 priority(P0-P3)/ due_date(毫秒)是为 Agent 验收场景加的最小数据模型扩展**,迁移走 information_schema 检查模式(同 project_id 先例);taskService 的细粒度操作都构建在 getBoard/saveBoard 读-改-写之上,没有按任务行的 SQL
15. **模型自助配置走预置供应商目录**(`services/modelConfigService.ts` CATALOG:zhipu/deepseek),用户只填 API Key + 选模型,baseUrl 由目录内置(勿开放用户自定义 URL——防 SSRF);密钥按 (user_id, provider) 存 `user_model_configs` 表,接口只回传掩码;解析顺序 = 用户激活行 > server/.env 的 GLM_*(回退) > 503;新增供应商 = 目录加一行 + 可选 MODEL_BASE_URL_<ID> 覆盖
16. **后端用 NestJS(2026-09-10 用户选定,替换裸 Express)**:框架只负责 HTTP 适配(Controller/Guard/Filter/启动编排),业务层保持纯函数单例;Agent harness/Glm 客户端保持框架无关(纯 fetch);SSE 接口 `agent/run/stream` 用 `@Res()` 裸写 res 保持线格式,不要改造成 @Sse() 装饰器
17. **并发设施已 Redis 外置(2026-09-10 用户要求优化并发)**:限速计数(`util/rateLimit.ts` RedisRateLimiter,INCR 固定窗口)、Agent 单运行锁(`agent/session.ts` RunSlotStore,SET NX+PX,TTL 兜底崩溃悬挂)、高危审批跨 worker 投递(`agent/approvals.ts` ApprovalRouter,pending 标记+pub/sub 频道 agent:approval)全部以 Redis 为权威,三者均带进程内存降级(Redis 不可用→单进程语义不变)。多进程:`WEB_WORKERS=N` 启用 Node cluster(主进程自动重生崩溃 worker);连接池 `MYSQL_POOL_SIZE`(默认 10/进程,N×池 ≤ MySQL 上限)。已知限制:① agent 会话 trace(`session.ts` 内存 Map 50 条)是进程本地的,多 worker 下 GET /api/agent/sessions/:id 仅持有 worker 可读(前端不依赖);② 跨 worker 审批与超时竞态时可能返回 ok 而实际已超时(与单进程版先到先得竞态同源)。测试:`node server/test/concurrency.test.mjs`(mini-RESP 假服务器走真实 ioredis + FakeRedisClient 注入 ApprovalRouter,26 项);本机联调可用 `node server/test/run-fake-redis.mjs 16390` 充当共享 Redis

## 历史与环境风险

- **原远程 MySQL(8.130.71.74:3306, root)曾被勒索软件入侵**(库内遗留 RECOVER_YOUR_DATA 勒索信)。已禁用直连,现在只经 SSH 隧道访问;处置完成前不要把任何服务暴露公网
- 本机 MySQL80 服务(127.0.0.1:3306, 8.0.44)存在,root 密码在 2026-09 被重置为 123456(用户知情),当前未被本项目使用
- 远程 Redis 密码已更换为强密码(见 server/.env),旧的 default/123456 已废弃

## 工程约定

- `npm run build`(前端)与 `npm run build:server`(server/ tsc)都必须零类型错误;oxlint 必须零警告(有 set-state-in-effect、refs-during-render、only-export-components 拦截,Context 的 Provider 与 hook 分文件:contexts.ts 存对象,*.tsx 存 Provider,hooks/ 存 hook)
- 前端 tsconfig 开启 verbatimModuleSyntax + erasableSyntaxOnly(类型导入必须 `import type`);server/ tsconfig 是独立配置(strict + experimentalDecorators,不启用 verbatimModuleSyntax)
- Windows + Git Bash 环境;路径大小写不敏感,**不要创建仅大小写不同的同名文件**(曾因 ThemeContext.tsx / themeContext.ts 并存导致模块解析冲突,现合并为 contexts.ts)

## 测试注意(浏览器自动化)

- antd 按钮对两个汉字文案自动插空格(「登录」渲染为「登 录」),定位用正则 `/登\s*录/`
- cua.drag 不要用 Promise.race 截断(鼠标不释放会回弹);让其完整执行,必要时把 js 调用 timeout_ms 提到 60-90s
- 浏览器标签页输入通道偶发卡死(点击/截图超时):换新标签页即恢复;fill 通常仍可用,点击/按键退化为 dom_cua 通道
- 测试产生的脏数据要清理(DELETE users/tasks 后再交付)

## 当前状态(2026-09-10)

- **后端已迁移到 NestJS 11 + TS strict**(替换裸 Express,用户选定):server/ 成为独立 npm 工程(自己的 package.json/tsconfig,依赖不再挂在根),构建产物 server/dist;根脚本 `npm run server` = server/ 内 build + `node --env-file=.env --watch dist/main.js`。API 路径、请求/响应 JSON、错误文案与限速阈值与 Express 版逐字一致,前端零改动
- 已含「项目管理」功能:projects 表(7 态状态/进度聚合/仓库/起止/技术栈)+ tasks.project_id 关联 + 卡片/表格双视图页
- 已含 AI 助手(Agent Harness):16 工具(READ 5 + SAFE_WRITE 5 + HIGH_RISK 6)+ Loop + 守卫 + trace + SSE 执行可视化 + 前端 AgentChatDrawer + 模型自助设置弹窗;.env 的 GLM_* 降级为兜底
- 已含 GitHub 集成(2026-09-13,见决策 20):项目绑定仓库 → 抽屉浏览 Issue/PR/Commit/Branch、Issue 转任务(自动建关联)、任务卡片/弹窗展示与解除关联、自动化 github-pr-sync 每 30 分钟同步 PR 合并状态
- 已实测(2026-09-10,含数据统计与自动化):`npm run build:server` 零错误;Agent Loop 45 项 + 全链路集成 108 项 + 并发设施 26 项断言全过(本机 MySQL 3306 + mock GLM,独立库 vibeboard_it 自动清理);oxlint 零警告;前端 build 正常;真隧道双 worker 冒烟(限速聚合/会话跨 worker)通过
- **并发优化已完成(2026-09-10)**:限速/单运行锁/审批投递 Redis 外置(见决策 17)+ cluster 多进程。concurrency.test.mjs 26 项全过;WEB_WORKERS=2 冒烟:双 worker 健康检查轮询、注册限速跨 worker 聚合(11 次第 11 次 429)、登录会话跨 worker 共享(board/me/projects 均过)。当日隧道又断,冒烟用本机 MySQL + run-fake-redis 假 Redis 完成
- **测试运行方式**:两套测试 import 的是 `server/dist`(编译产物),跑之前先 `npm run build:server`;loop 测试需要可达 MySQL 且库存在(应急:`MYSQL_DATABASE=<临时库> MYSQL_PASSWORD=123456` 先用 `dist/db.js` 的 initDb 建表,跑完 DROP),否则 resolveModelConfig 连不上会直接抛错
- **待办**:① 用户填真实 Key 后五场景真实对话回归;② 隧道恢复后用真 Redis 复跑一次多 worker 冒烟(当日冒烟用的 run-fake-redis);③ 未来真多机部署:SSE 需粘性会话或网关层处理,agent 会话 trace 若要跨 worker 可读需外置
- 2026-09-09 观察:SSH 隧道(13306/16379)会静默断开,后端起不来时先查 `netstat | grep 13306`;应急可用本机 MySQL(3306 root/123456)经环境变量覆盖启动(不改 .env),但 Redis 无本机替身,登录会话不可用(fail-closed 是有意的)
- 占位页已全部落地:数据统计(StatsPage)与任务归档均为完整功能
- 后台进程不常驻:启动用 `npm run server` + `npm run dev`;**杀后端必须连 --watch 子进程一起杀**(TaskStop 只杀 shell 会留孤儿占着 3000:PowerShell 按 CommandLine 匹配 server/dist/main.js 清理)
18. **自动化子系统(2026-09-10)**:四个内置自动化(每日计划/每周复盘 = 只读 Agent 无人值守运行;截止日期提醒/逾期与阻塞盘点 = 确定性扫描不经模型),目录模式在 `server/src/automation/catalog.ts`(新增自动化 = 加一行)。无人值守运行**必须 readOnly**(runAgent options + ToolContext.readOnly 双层:只暴露 READ 工具且拒绝写入,否则高危工具会挂起等人工审批直到超时);调度器(`automation/scheduler.ts`)用 croner(Asia/Shanghai)+ Redis 锁 `automation:leader` 选主,多 worker 只有 leader 触发,每次 tick 复核领导权;Agent 运行复用单运行锁,占用中记 skipped;调度运行绕过 HTTP 限速(用户主动开启且频率受 cron 约束)。扫描结果与 Agent 产出写入 notifications 表(保留 50 条),头部铃铛 60s 轮询未读数。测试:集成测试含 12 项自动化断言(只读拒绝写入/扫描通知/409/运行历史)
- **编码红线(2026-09-10 实锤)**:Windows 控制台 curl/mintty 发送中文会按 GBK 编码,UTF-8 应用收到即成乱码(曾污染项目描述)。任何含非 ASCII 的请求体一律用 node fetch 脚本播种,禁止控制台 curl。后端 HTTP 边界有编码防护(`http/encoding-guard.ts`:请求体含 U+FFFD 替换符 → 400,防止乱码静默入库);发现存量乱码先用 `LIKE '%\uFFFD%'` 扫描各文本列再修复
19. **公网部署安全加固(2026-09-10)**:模型 API Key 静态加密(AES-256-GCM,`util/secretBox.ts`,格式 `v1:iv:tag:cipher`,存量明文读取兼容、保存时自动升级;密钥 `MODEL_KEY_ENCRYPTION_KEY` 未配置时从部署凭据派生);scrypt 改异步(同步版在公网并发登录下阻塞事件循环,构成 DoS 面);看板规模上限(单看板 ≤500 任务、单任务前置依赖 ≤50,parseBoardState 与 applyDependencies 双侧把关);automations run-now 与交互式 Agent 共享 20 次/时限速;全局洪泛限速 240 次/分/IP + 最小安全响应头;multer 高危传递依赖用 package.json overrides 强制 ^2.3.0(Nest 锁 2.2.0,本应用不收文件上传,实际不可达但保持清零)。**部署前必读 README「部署安全清单」**:删 e2euser(账密在公开仓库)、DB 不暴露公网、HTTPS 反代 + trust proxy、显式配置加密密钥
20. **GitHub 集成(2026-09-13,用户需求)**:项目 `repo_url` 能解析出 `github.com/{owner}/{repo}` 即视为已绑定(不建绑定表,parseRepoUrl 前后端同规则,`src/lib/github.ts` 是前端唯一出处);仓库浏览/Issue 转 Task/任务关联走 `services/githubService.ts`(纯 fetch 打固定 `api.github.com`,`GITHUB_API_BASE` 仅测试/代理可覆盖;owner/repo 白名单正则防路径注入;60s 进程内响应缓存按 user+鉴权态分键);**任务关联存独立表 `task_github_links`,绝不动 tasks 列**(saveBoard 整表替换);PAT 复用 secretBox 加密存 `user_github_configs`(接口只回掩码,公开仓库匿名可用);PR 合并感知走**轮询不走 webhook**(webhook 需公网端点,与"处置完成前不暴露公网"红线冲突)——scan 型自动化 `github-pr-sync` 每 30 分钟检查未合并 PR 关联,已合并则 moveTask 到 done(自带写锁);**关联已合并 PR 时立即移 Done**(linkTaskToGithub 内联判断);前端入口是项目页抽屉 `GithubRepoDrawer`(四 Tab:Issue/PR/提交/分支)不新增导航页,TaskCard 显示 `#n` 紫标(展示层把 links 合并进 task 对象,BoardPage 按 taskId 派生);GitHub 限速 60 次/分/用户。测试:mock GitHub HTTP 服务(`GITHUB_API_BASE` 注入)共 28 项断言在集成套件内
