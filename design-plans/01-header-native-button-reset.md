# 头部原生按钮补齐 UA 默认样式重置,恢复扁平 Linear 风头部

Written against: unavailable(项目非 git 仓库)

## Evidence chain

- Surface: 登录后的所有页面头部(BasicLayout,路由 `/board` `/projects` `/stats` `/archive` 的应用壳)
- Problem: `src/layouts/BasicLayout.tsx` 头部有三个原生 `<button>` 元素(AI 模型设置、主题切换、用户下拉菜单触发器),它们的类 `.header-icon-btn` / `.header-user` 只定义了尺寸、圆角、颜色和 hover,没有清除浏览器对 `<button>` 的默认样式。浏览器 UA 默认给按钮 `background-color: buttonface`(灰底)和可见边框,按钮也不继承页面字体。结果是头部渲染出带灰底和系统边框的「OS 风格」按钮,与全站纯边框、无阴影的扁平 Linear 风格(以及紧邻的 antd 扁平按钮)直接冲突。
- Design evidence:
  - `src/styles/app.css:100-115`(`.header-icon-btn`)与 `app.css:117-129`(`.header-user`):声明了 `display/width/height/border-radius/color/transition` 与 hover 背景,**没有** `appearance/background/border/padding` 重置
  - `src/main.tsx:6-7` 只全局引入 `styles/app.css` 与 `styles/projects.css`;两个 CSS 文件中均无任何针对 `button` 元素的全局重置(app.css 仅 `* { box-sizing: border-box }` 和 html/body margin)
  - antd v6 不会自动注入全局 reset(config-provider 无 reset 引用;即便引入 `antd/dist/reset.css` 也只做 normalize,不清按钮 border/background)
- Owner: `src/styles/app.css`(头部自绘样式的唯一归属文件)
- Scope and affected surfaces: 仅 `src/styles/app.css` 两个类;视觉影响所有登录后页面的头部
- Uncertainty: 无。UA 按钮默认样式是确定的浏览器行为,本项目无任何 reset 来源

## Design decision

在 `.header-icon-btn` 与 `.header-user` 两个类内补齐原生按钮重置声明(`appearance: none; background: transparent; border: 0; cursor: pointer; font: inherit`),使按钮恢复「透明底、无边框、继承页面字体」的扁平形态,现有 hover 胶囊背景、尺寸与圆角规则原样保留。这解决根因(UA 默认样式穿透),不引入新组件、不改变交互结构。

## Reuse

- 复用现有 CSS 变量 `var(--text-secondary)` / `var(--text)` / `var(--surface-hover)`(类内已在用,不新增 token)
- Exemplar: `src/styles/app.css:100-129`(现有两类的完整声明,重置声明并入其中)

不需要新原语:这是对既有类的补全,不是新的共享模式。

## Changes

1. `src/styles/app.css` — `.header-icon-btn`(现 100-115 行)
   - Change: 在类内新增 `appearance: none; background: transparent; border: 0; padding: 0; cursor: pointer; font: inherit;`,并保证 `font: inherit` 位于现有 `font-size: 15px` 之前(先继承再覆盖字号);其余现有声明与顺序不动
   - Preserve: 现有 32×32 尺寸、`border-radius: 7px`、`color: var(--text-secondary)`、0.12s hover 过渡与 hover 背景
   - Verify: 浅色/深色模式下按钮均为透明底、无边框的扁平图标按钮;hover 出现 `var(--surface-hover)` 背景;指针为 pointer;图标与相邻 antd 元素字体一致
2. `src/styles/app.css` — `.header-user`(现 117-129 行)
   - Change: 在类内新增 `appearance: none; background: transparent; border: 0; cursor: pointer; font: inherit;`(该类已有显式 `padding: 4px 10px 4px 4px`,不补 `padding: 0`)
   - Preserve: 现有胶囊圆角 `999px`、内边距、`gap`、用户名 13px/500 样式、hover 背景、Dropdown 点击触发
   - Verify: 用户胶囊无边框无灰底,hover 背景正常;点击仍弹出「退出登录」下拉菜单

## Scope

- Inherit: BasicLayout 头部的三个原生按钮(模型设置、主题切换、用户菜单)自动获得修正
- Verify: 头部在 `/board`、`/projects`、`/stats`、`/archive` 四个路由下外观一致;深色模式(`data-theme='dark'`)下同样生效;窄视口(<992px,Sider 折叠)头部其余按钮不受影响
- Exclude: 侧边栏 Menu 项、antd Button 组件(antd 自带样式,不属于原生按钮);不做移动端导航补全等其它工作

## Validation

- Product: 登录进入 `/board`,观察头部三个按钮——无灰底、无边框、扁平;hover 有浅色胶囊;点击用户菜单正常弹出
- Interface: 明暗两套主题各检查一次;`/board` 与任一占位页各检查一次;窄视口(<992px)检查头部不换行、按钮不变形
- System: 全局搜索确认未引入平行的按钮重置模式(修正收敛在既有两个类内,而非新增全局 `button {}` 规则)
- Repository: `npm run build` → 零类型错误;`npm run lint` → 零警告

## Stop conditions

- Stop if: 执行时发现项目已引入全局 CSS reset(则改为复核而非重复重置);或 BasicLayout 头部按钮已被替换为 antd Button(本计划作废);或需要扩大到修改布局结构/交互逻辑(超出本计划范围,先回报)

## Design documentation

- 验收通过后,在 `AGENTS.md`「工程约定」节追加一条:项目无全局 CSS reset,自绘原生 `<button>` 必须在类内显式重置 UA 默认样式(appearance/background/border/font)
