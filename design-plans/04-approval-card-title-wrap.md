# 审批卡任务标题改自动换行,长标题不再截断

Written against: unavailable(项目非 git 仓库)

## Evidence chain

- Surface: AI 助手抽屉内的高危操作审批确认卡(`AgentChatDrawer.tsx` 的 `ApprovalCard`,所有 HIGH_RISK 工具确认时渲染)
- Problem: 审批卡的任务清单行 `.agent-drawer__approval-title` 使用 `white-space: nowrap` + `text-overflow: ellipsis`,任务标题上限 200 字,长标题会被单行截断——而「将影响哪些任务」恰是确认卡最关键的信息,用户可能在没看清的情况下确认删除/归档
- Design evidence:
  - `src/styles/app.css:620-624` 截断样式来源
  - 同抽屉的姊妹列表行 `.agent-drawer__step-label`(app.css)使用 `word-break: break-word` 自动换行——同一表面内同类列表行为不一致
  - 审美基线要求「信息层级清晰」;审批卡是刚上线的安全机制,信息完整性优先
- Owner: `src/styles/app.css`
- Scope and affected surfaces: 所有审批卡(删除/批量修改/归档/创建计划/依赖设置)
- Uncertainty: 无

## Design decision

`.agent-drawer__approval-title` 从单行截断改为自动换行(`word-break: break-word`,移除 nowrap/ellipsis),与步骤行 `.agent-drawer__step-label` 行为一致。外层清单 `.agent-drawer__approval-tasks` 已有 `max-height: 160px; overflow-y: auto`,超长清单滚动呈现,布局不受影响。

## Reuse

- 复用 `.agent-drawer__step-label` 的既有换行模式(Exemplar: app.css 同文件)
- 不新增 token 或组件

## Changes

1. `src/styles/app.css` — `.agent-drawer__approval-title`
   - Change: 删除 `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`,改为 `word-break: break-word;`
   - Preserve: 该 span 的 `flex: 1; min-width: 0;` 布局属性不动
   - Verify: 长标题任务(60+ 字)在审批卡中完整换行显示,不再出现省略号

## Scope

- Inherit: 所有 HIGH_RISK 审批卡的任务行
- Verify: 明暗两主题下长/短标题各一次;清单超 160px 高度时容器正常滚动
- Exclude: 步骤行、记忆弹窗条目(自有样式)不动

## Validation

- Product: 发起一次带 60+ 字标题任务的删除审批,确认卡内标题完整可读
- Interface: 明暗双主题;依赖设置卡(含「将被上述任务阻塞」行)
- Repository: `npm run build` → 零类型错误;`npm run lint` → 零警告

## Stop conditions

- Stop if: 换行导致卡片高度失控(清单滚动失效),则改为限制每条最多 2 行(-webkit-line-clamp: 2)并回报

## Design documentation

- None
