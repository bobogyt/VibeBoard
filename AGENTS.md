# AGENTS.md — VibeBoard 项目上下文

> 本文件供 AI 编码工具(ZCode 等)在每次会话开始时读取,记录跨会话需要知道的架构、决策与环境事实。修改项目关键结构或决策时请同步更新此文件。

## 项目是什么

个人任务看板(Kanban):登录账号 → Todo / Doing / Done 三列任务,拖拽移动,自动持久化到 MySQL,Redis 做会话与读缓存。内置基于 GLM 的 AI 助手(自研轻量 Agent Harness),可用自然语言让 Agent 自主读写任务。

## 架构

```
React 19 + TS(strict) + Vite + Ant Design 6 + react-router 7 + @dnd-kit
        │ fetch /api/*(Vite 代理 → localhost:3000)
Node + Express(server/,纯 JS ESM 零构建)
        ├── MySQL(SSH 隧道 127.0.0.1:13306):users + tasks 表,库 vibeboard
        └── Redis(SSH 隧道 127.0.0.1:16379):session:{token}(7d 滑动)+ board:{userId} 缓存(1h)
```

- 前端读:Redis cache-aside(未命中读 MySQL 回填);前端写:500ms 防抖全量 PUT → MySQL 事务(DELETE+批量 INSERT)→ 写穿透更新缓存;Redis 故障降级直连 MySQL,会话校验不降级
- 凭据在 `server/.env`(已 gitignore),不在任何文档中记录明文密码

## 关键决策(不要回退)

1. **保留 Linear 配色** `#5e6ad2`(light)/ `#6e79d8`(dark),通过 antd v6 ThemeConfig token 定制;用户明确否决过 antd 默认蓝
2. **拖拽用 @dnd-kit**:antd 没有看板拖拽;不要尝试换成别的
3. **不用 @ant-design/pro-components**:其 antd v6 支持仅在 beta 通道(3.1.14-x),稳定版 2.8.10 只支持 antd 4/5;布局壳用 antd 原生 Layout/Menu 自建(`src/layouts/BasicLayout.tsx`)
4. **数据统计/任务归档是占位页**(antd Empty「开发中」),是用户主动要求的中后台观感,不是待实现功能承诺
5. **认证**:scrypt(内置 crypto,不要引入 bcrypt)+ Redis 会话;开放注册
6. 看板列/卡片保留手写 DOM(拖拽需要),全局组件一律 antd
7. **项目进度自动计算**:进度 = 关联任务中 done 占比,后端 LEFT JOIN 聚合,无任务时 progress=null(UI 显示「暂无关联任务」);status 仍手动维护。不要改成手动进度条
8. **删除项目** = tasks.project_id 置 NULL(任务保留);board.js 写入侧会过滤指向不存在项目的 projectId(防陈旧保存复活悬空引用),且 Redis 缓存只写过滤后的 sanitized 状态——三处缺一不可,勿回退
9. **通用时间线组件** `src/components/TimelineView.tsx`:数据驱动(items: key/color/title/description/timeLabel/tag),调用方负责排序与内容组装。现有两个消费方:项目管理页第三种视图「时间线」(节点色 = PROJECT_STATUS_DOT)、看板「任务动态」抽屉(TaskTimelineDrawer,节点色 = 所在列)。新增时间线场景时复用此组件,不要另写
10. **Agent Harness 自研,不用 LangChain/LangGraph/Multi-Agent**(`server/src/agent/`,2026-09-09 用户明确要求):Model + System Instructions + Tools + Loop + Guardrails 的最小实现;GLM 走 OpenAI 兼容 `/chat/completions`(纯 fetch,不引 SDK)
11. **Agent 工具只调业务 Service,不碰 SQL/Express**:调用链 Tool → services/taskService・projectService → board.js/pool;工具分 READ(自动执行)与 SAFE_WRITE(自动执行+记录)两级,第一版刻意不提供 deleteTask——验收场景要求 Agent 对删除请求如实说明做不到,不要"补全"删除工具(加则必须带 Human Approval)
12. **Agent 边界安全**:userId 永远来自 requireAuth 注入的 ctx,绝不由模型传参;工具返回 {error} 回填模型自纠;同参失败 3 次熔断、maxSteps(10)上限、单用户单运行会话、agent 路由每小时 20 次限速;前端只显示 finalAnswer + 工具摘要,不暴露推理过程
13. **看板用户级写锁** `board.js withBoardLock(userId, fn)`:Agent 读-改-写与前端全量 PUT /api/board 共用此锁串行化,防止互相覆盖(最后写入胜出的全量保存模型下,这是唯一防线,勿绕过)
14. **tasks 表的 priority(P0-P3)/ due_date(毫秒)是为 Agent 验收场景加的最小数据模型扩展**,迁移走 information_schema 检查模式(同 project_id 先例);taskService 的细粒度操作都构建在 getBoard/saveBoard 读-改-写之上,没有按任务行的 SQL
15. **模型自助配置走预置供应商目录**(`services/modelConfigService.js` CATALOG:zhipu/deepseek),用户只填 API Key + 选模型,baseUrl 由目录内置(勿开放用户自定义 URL——防 SSRF);密钥按 (user_id, provider) 存 `user_model_configs` 表,接口只回传掩码;解析顺序 = 用户激活行 > server/.env 的 GLM_*(回退) > 503;新增供应商 = 目录加一行 + 可选 MODEL_BASE_URL_<ID> 覆盖

## 历史与环境风险

- **原远程 MySQL(8.130.71.74:3306, root)曾被勒索软件入侵**(库内遗留 RECOVER_YOUR_DATA 勒索信)。已禁用直连,现在只经 SSH 隧道访问;处置完成前不要把任何服务暴露公网
- 本机 MySQL80 服务(127.0.0.1:3306, 8.0.44)存在,root 密码在 2026-09 被重置为 123456(用户知情),当前未被本项目使用
- 远程 Redis 密码已更换为强密码(见 server/.env),旧的 default/123456 已废弃

## 工程约定

- `npm run build` 必须零类型错误;oxlint 必须零警告(有 set-state-in-effect、refs-during-render、only-export-components 拦截,Context 的 Provider 与 hook 分文件:contexts.ts 存对象,*.tsx 存 Provider,hooks/ 存 hook)
- tsconfig 开启 verbatimModuleSyntax + erasableSyntaxOnly(类型导入必须 `import type`)
- Windows + Git Bash 环境;路径大小写不敏感,**不要创建仅大小写不同的同名文件**(曾因 ThemeContext.tsx / themeContext.ts 并存导致模块解析冲突,现合并为 contexts.ts)

## 测试注意(浏览器自动化)

- antd 按钮对两个汉字文案自动插空格(「登录」渲染为「登 录」),定位用正则 `/登\s*录/`
- cua.drag 不要用 Promise.race 截断(鼠标不释放会回弹);让其完整执行,必要时把 js 调用 timeout_ms 提到 60-90s
- 浏览器标签页输入通道偶发卡死(点击/截图超时):换新标签页即恢复;fill 通常仍可用,点击/按键退化为 dom_cua 通道
- 测试产生的脏数据要清理(DELETE users/tasks 后再交付)

## 当前状态(2026-09-09)

- 已含「项目管理」功能:projects 表(7 态状态/进度聚合/仓库/起止/技术栈)+ tasks.project_id 关联 + 卡片/表格双视图页
- 已含 AI 助手(Agent Harness):8 工具 + Loop + 守卫 + trace + 前端 AgentChatDrawer + **模型自助设置弹窗**(切换/添加模型只需填 Key);.env 的 GLM_* 降级为兜底,不再必须填写
- 已实测:Agent Loop 机制 18 项(`node server/test/agent-loop.test.mjs`,无 DB);全链路集成 31 项(`node server/test/agent-integration.test.mjs`,本机 MySQL 3306 + mock GLM,独立库 vibeboard_it 自动清理,含模型配置服务用例);build + lint 全绿
- **待办**:2026-09-09 隧道当天断了三次(不稳定)。恢复后:① 起后端 + mock(`node server/test/run-mock-glm.mjs 3900`)并以 MODEL_BASE_URL_DEEPSEEK=http://127.0.0.1:3900 启动 → `bash server/test/e2e-check.sh` 一键 HTTP E2E;② 浏览器验收模型设置弹窗全链路;③ 用户填真实 Key 后五场景真实对话回归
- 2026-09-09 观察:SSH 隧道(13306/16379)会静默断开,后端起不来时先查 `netstat | grep 13306`;应急可用本机 MySQL(3306 root/123456)经环境变量覆盖启动(不改 .env),但 Redis 无本机替身,登录会话不可用(fail-closed 是有意的)
- 数据统计、任务归档为占位页
- 后台进程不常驻:启动用 `npm run server` + `npm run dev`;**杀后端必须连 --watch 子进程一起杀**(TaskStop 只杀 shell 会留孤儿占着 3000:PowerShell 按 CommandLine 匹配 server/src/index.js 清理)
