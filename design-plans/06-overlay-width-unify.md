# 同族弹层宽度统一(记忆弹窗 420 / 任务动态抽屉 460)

Written against: unavailable(项目非 git 仓库)

## Evidence chain

- Surface: AI 助手抽屉头部的两个相邻图标入口(💡 偏好记忆 / ⚙ 模型设置)打开的两个设置类 Modal;看板工具栏相邻按钮打开的两个右侧 Drawer(AI 助手 / 任务动态)
- Problem: 同一交互区、同一族、相邻入口打开的弹层宽度不一致——偏好记忆弹窗 480 vs 模型设置弹窗 420;任务动态抽屉 420 vs AI 助手抽屉 460。相邻入口打开的弹层宽度跳变,视觉不连贯
- Design evidence:
  - `src/components/MemoryModal.tsx:72` width=480;`ModelSettingsModal.tsx:88` width=420(先建立的设置族先例)
  - `TaskTimelineDrawer.tsx:64` width=420;`AgentChatDrawer.tsx:257` width=460(先建立的抽屉先例)
- Owner: 各组件文件的 Modal/Drawer width 属性
- Scope and affected surfaces: 四个弹层的宽度属性;内容布局不变
- Uncertainty: 无

## Design decision

各自对齐同族先建立者的宽度:**偏好记忆弹窗 480 → 420**(对齐模型设置弹窗);**任务动态抽屉 420 → 460**(对齐 AI 助手抽屉)。规则:设置类 Modal 统一 420,内容型右抽屉统一 460。内容均为流式布局,宽度变化无适配风险。

## Reuse

- 既有 Modal/Drawer width 属性,无新原语

## Changes

1. `src/components/MemoryModal.tsx`
   - Change: `width={480}` → `width={420}`
   - Preserve: destroyOnHidden、footer=null、内部列表样式不动
   - Verify: 弹窗与模型设置弹窗宽度一致
2. `src/components/TaskTimelineDrawer.tsx`
   - Change: `width={420}` → `width={460}`
   - Preserve: 时间线内容、TimelineView 复用不动
   - Verify: 与 AI 助手抽屉宽度一致,时间线排版正常

## Scope

- Inherit: 四个弹层
- Verify: 明暗主题下依次打开四个弹层对比宽度
- Exclude: 归档页 Table、审批卡宽度

## Validation

- Product: 依次打开四个弹层,同族宽度肉眼一致
- Interface: 明暗主题;窄视口(<480px)下弹层自适应不变(antd Modal/Drawer 自带宽度上限处理)
- Repository: `npm run build` → 零类型错误;`npm run lint` → 零警告

## Stop conditions

- Stop if: 任务动态抽屉 460 下时间线左标签换行明显劣化,则改回 420 并改为统一 AI 助手抽屉到 420(反向对齐)再回报

## Design documentation

- None
