# 任务动态时间线 Todo 节点色对齐看板列色 #8f939c

Written against: unavailable(项目非 git 仓库)

## Evidence chain

- Surface: 看板页(`/board`)工具栏「任务动态」抽屉(`src/components/TaskTimelineDrawer.tsx`,右侧 Drawer,经通用组件 `src/components/TimelineView.tsx` 渲染)
- Problem: 时间线节点颜色表达「任务当前所在列」。看板三列的列点颜色定义在 `src/styles/app.css`:`--dot-todo: #8f939c`、`--dot-doing: #e2a336`、`--dot-done: #3fa871`。任务动态抽屉里的 doing(`#e2a336`)与 done(`#3fa871`)与列点完全一致,唯独 todo 用了 `#9ca3af`,与看板 Todo 列点的 `#8f939c` 是两个不同的灰。同一用户任务(查看任务在哪一列)中,同一种颜色编码出现两个值,属于直接的用户可见矛盾。
- Design evidence:
  - `src/styles/app.css:15` `--dot-todo: #8f939c;`(看板 Todo 列点的治理定义;该变量只在 `:root` 定义、暗色块未覆盖,明暗两主题同值)
  - `src/components/TaskTimelineDrawer.tsx:10-14` `COLUMN_COLORS = { todo: '#9ca3af', doing: '#e2a336', done: '#3fa871' }`
  - `AGENTS.md` 关键决策 #9:「看板『任务动态』抽屉(TaskTimelineDrawer,节点色 = 所在列)」——文档化契约:节点色必须等于所在列的颜色
- Owner: 列色的事实来源是 `src/styles/app.css` 的 `--dot-*` 变量;抽屉内的 `COLUMN_COLORS` 是其消费者(硬编码镜像)
- Scope and affected surfaces: 仅 `src/components/TaskTimelineDrawer.tsx` 一处常量;影响「任务动态」抽屉
- Uncertainty: 无。`#9ca3af` 与 doing/done 的精确一致相比,无任何注释或文档表明 todo 灰是有意选用的另一值

## Design decision

将 `COLUMN_COLORS.todo` 从 `'#9ca3af'` 改为 `'#8f939c'`,与看板 Todo 列点(`--dot-todo`)取值一致,使「节点色 = 所在列」契约在三种列状态上全部成立。选择改抽屉侧而非改列点侧:列点色是看板与列头一直在用的既成事实,doing/done 也已按它对齐。

## Reuse

- 复用既有列色值 `#8f939c`(即 `app.css` 的 `--dot-todo`;该值明暗主题通用,无需第二份)
- Exemplar: `TaskTimelineDrawer.tsx` 中 doing/done 两个条目(已正确镜像列色的写法,本修正使 todo 与之同构)

不引入新原语;继续沿用抽屉内三值常量的既有形态(与另两项保持同构),不改成 CSS 变量引用——antd Timeline 的 `color` prop 接收具体色值,现有写法即为项目既定模式。

## Changes

1. `src/components/TaskTimelineDrawer.tsx`(现 10-14 行,`COLUMN_COLORS` 常量)
   - Change: `todo: '#9ca3af'` → `todo: '#8f939c'`
   - Preserve: doing/done 两个值不动;组件其余逻辑(排序、MAX_ITEMS、时间标签、项目名回填)不动
   - Verify: 打开「任务动态」抽屉,Todo 节点圆点与看板 Todo 列头圆点颜色一致(浅色与深色主题下都是 `#8f939c`)

## Scope

- Inherit: 「任务动态」抽屉的全部 Todo 节点
- Verify: 同一页面内看板列点与抽屉节点并排比对;明暗两主题各一次
- Exclude: 项目管理页的时间线视图(`src/pages/ProjectsPage.tsx`,其节点色为项目状态色,属另一表面,不在本链路);`--dot-doing`/`--dot-done`;看板列点本身

## Validation

- Product: 登录 → `/board` → 点「任务动态」,确认 Todo 任务的时间线节点灰色与看板 Todo 列头圆点肉眼无差别
- Interface: 至少一条 Todo、一条 Doing、一条 Done 任务并存的看板;浅色与深色主题各检查一次;空看板时抽屉显示「暂无任务动态」不受影响
- System: 确认抽屉内三个 COLUMN_COLORS 值与 `app.css` 三个 `--dot-*` 值一一相等(改后 todo=#8f939c、doing=#e2a336、done=#3fa871)
- Repository: `npm run build` → 零类型错误;`npm run lint` → 零警告

## Stop conditions

- Stop if: 执行时发现 `app.css` 的 `--dot-*` 变量已被重命名/改值(则以当时的变量值为准重新核对三个值);或 TaskTimelineDrawer 的取色机制已改为引用 CSS 变量(本计划作废)

## Design documentation

- None(无文档变更)
