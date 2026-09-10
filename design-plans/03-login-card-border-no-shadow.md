# 登录卡片回归「纯边框、静态不加阴影」基线

Written against: unavailable(项目非 git 仓库)

## Evidence chain

- Surface: 登录页(`/login`,`src/pages/LoginPage.tsx`,居中的 antd Card 注册/登录表单)
- Problem: 登录卡片使用了 `variant="borderless"`(无边框)并叠加 `box-shadow: 0 16px 40px rgb(10 10 12 / 0.06)`。这与项目审美基线「纯边框卡片、静态不加阴影(仅拖拽/弹窗等必须有深度处保留)」相反:登录卡是静态卡片,既无边界也无应有深度。实际效果上,浅色模式仅剩一层几乎不可见的浅阴影,深色模式下这层近黑 6% 透明度的阴影在 `#0a0a0b` 近黑背景上完全不可见,卡片边界只剩 `#17171a`(容器)与 `#0a0a0b`(背景)的微小底色差,视觉上近乎消失。
- Design evidence:
  - `src/pages/LoginPage.tsx:46` `<Card className="auth-card" variant="borderless">`
  - `src/styles/app.css:345-348` `.auth-card { width: min(380px, 100%); box-shadow: 0 16px 40px rgb(10 10 12 / 0.06); }`
  - 项目审美基线(用户 2026-09-08 对本项目 UI 的明确要求):纯边框卡片、静态不加阴影,阴影仅保留给拖拽(`--shadow-drag`)、弹窗/抽屉等必须有深度的场景;8–12px 适度圆角;中性色板
  - 系统内一致佐证:看板任务卡(`app.css` `.task-card`)即「`var(--surface)` 底 + `var(--border)` 1px 边框、静态无阴影」的标准实现
- Owner: 卡片边框形态由 antd Card 的 `variant` 决定(边框色走主题 `colorBorder` token:`#e5e5e8` / `#26262b`);`.auth-card` 类负责宽度与(现存的)阴影
- Scope and affected surfaces: `src/pages/LoginPage.tsx` 一处 JSX 属性 + `src/styles/app.css` `.auth-card` 一条声明;影响登录页
- Uncertainty: 无功能性影响,纯视觉;antd 默认(描边)variant 的边框色已由主题 token 管理明暗两态

## Design decision

登录卡片改回 antd Card 默认描边变体(移除 `variant="borderless"`),并删除 `.auth-card` 的 box-shadow。卡片边界由主题 `colorBorder` token 的 1px 边框承担,与看板任务卡、全站卡片语言一致,同时消除深色模式下卡片边界近乎消失的问题。宽度 `min(380px, 100%)` 与其余表单不动。

## Reuse

- antd Card 默认 variant(边框自动取 `theme/index.ts` 的 `colorBorder`,明暗自适应)
- Exemplar: `src/styles/app.css` `.task-card`(surface 底 + border 1px、无静态阴影的既有标准卡片形态)

不引入新原语:仅移除偏离系统的例外,不需要任何新 token 或组件。

## Changes

1. `src/pages/LoginPage.tsx`(现 46 行)
   - Change: `<Card className="auth-card" variant="borderless">` → `<Card className="auth-card">`
   - Preserve: 类名 `auth-card`、表单结构、文案、按钮与全部交互逻辑不动
   - Verify: 登录卡四周出现 1px 主题边框(浅色 `#e5e5e8` / 深色 `#26262b`)
2. `src/styles/app.css` — `.auth-card`(现 345-348 行)
   - Change: 删除 `box-shadow: 0 16px 40px rgb(10 10 12 / 0.06);`,保留 `width: min(380px, 100%);`
   - Preserve: 卡片宽度、内边距(antd Card 默认)、圆角(主题 `borderRadius` token)
   - Verify: 浅色与深色模式下登录卡均无投影;深色模式卡片边界清晰可辨

## Scope

- Inherit: 登录页(`/login`)的登录与注册两种形态共用同一卡片,自动生效
- Verify: 明暗两主题、登录/注册文案切换两种状态;窄视口(<380px)下 `width: min(380px, 100%)` 仍正确收缩
- Exclude: 拖拽阴影 `--shadow-drag`、Modal/Drawer 深度(基线允许的例外,不动);`.app-splash` 启动屏;看板卡片

## Validation

- Product: 退出登录进入 `/login`,卡片有清晰边框、无阴影;表单可正常提交登录(功能不回归)
- Interface: 浅色/深色主题各检查一次;切换「注册一个」文案形态再各检查一次;360px 宽视口卡片不出屏
- System: 确认改动后代码库中唯一的静态卡片阴影被移除,`.auth-card` 与 `.task-card` 同属「边框卡片、无静态阴影」体系,无并行例外残留
- Repository: `npm run build` → 零类型错误;`npm run lint` → 零警告

## Stop conditions

- Stop if: 执行时发现 `.auth-card` 阴影已被移除或 variant 已改回描边(计划已部分完成,只补差额);或登录页已重构为其它布局(先回报再继续)

## Design documentation

- None(审美基线已存在于用户既有要求中,无需新增文档;若团队希望显式沉淀,可在验收后于 `AGENTS.md`「工程约定」补一句「静态卡片一律边框、不加静态阴影」)
