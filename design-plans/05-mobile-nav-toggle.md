# 移动端(<992px)补导航开关,消除侧边栏死端

Written against: unavailable(项目非 git 仓库)

## Evidence chain

- Surface: 全局应用壳 `BasicLayout.tsx`(所有登录后页面),移动端/窄窗口分支
- Problem: `<Sider width={208} breakpoint="lg" collapsedWidth="0" collapsible>` 在窄于 992px(antd lg 断点)时自动折叠为 0 宽;antd 折叠触发器渲染在 Sider 内部,随宽度 0 一起被裁掉,Header 上也没有任何菜单开关——窄屏下「项目管理/数据统计/任务归档」导航整体不可达,应用退化为看板单页
- Design evidence:
  - `src/layouts/BasicLayout.tsx:49` Sider 配置;59-84 行 Header 仅含模型设置/主题切换/用户菜单,无开关
  - 用户审美基线(本项目明确要求):「桌面优先、**同时兼容移动端**」;当前响应式分支与之矛盾
  - antd 官方 responsive 壳模式:受控 Sider + Header 汉堡按钮(breakpoint 触发 onBreakpoint)
- Owner: `src/layouts/BasicLayout.tsx`
- Scope and affected surfaces: 应用壳;桌面端(≥992px)渲染不变
- Uncertainty: 无(折叠行为可从源码与 antd 语义直接证明)

## Design decision

Sider 折叠改为受控状态(`collapsed` useState,初始由 `window.innerWidth < 992` 判定,保留 `breakpoint="lg"` 自动触发 `onBreakpoint` 同步状态),`trigger={null}` 关闭内置触发器;Header 左侧(logo 区之前或汉堡位)增加一个仅在折叠态显示的菜单开关按钮(antd Button `MenuOutlined`/`MenuFoldOutlined`,aria-label「菜单」),点击切换 collapsed。≥992px 时按钮不渲染,桌面视觉零变化。

## Reuse

- 复用既有 `.header-icon-btn` 样式类(与模型设置/主题按钮同款 32×32 图标钮)
- 复用 antd Layout + Menu 既有结构;不引入新组件库

## Changes

1. `src/layouts/BasicLayout.tsx`
   - Change: 增加 `const [collapsed, setCollapsed] = useState(() => window.innerWidth < 992)`;Sider 改 `collapsible trigger={null} collapsed={collapsed} onBreakpoint={(bp) => setCollapsed(!bp)}`(移除 collapsedWidth="0" 改为 `collapsedWidth={0}`);Header 开头加 `{collapsed && <Button className="header-icon-btn" icon={<MenuOutlined />} aria-label="菜单" onClick={() => setCollapsed(false)} />}`(仅移动端折叠态显示)
   - Preserve: 桌面端 ≥992px 的 Sider 常驻、Header 三个控件、Menu 选中态逻辑全部不动
   - Verify: 窄屏(<992px)头部出现菜单按钮,点击可展开/收起导航,可进入全部四个页面;宽屏视觉与现状一致
2. `src/styles/app.css` — 如按钮对齐需微调,仅允许新增 `.layout-header` 内的间距规则

## Scope

- Inherit: 所有登录后页面在 <992px 视口下的导航
- Verify: 320/768/992/1280 四档宽度;明暗两主题;抽屉打开时开关不遮挡
- Exclude: 不做底部 Tab、不做抽屉式导航菜单(Modal/Drawer 内容页不受影响)

## Validation

- Product: 992px 以下注册→看板→菜单进项目管理/归档,全部可达
- Interface: 明暗主题 × 窄宽视口;抽屉与 Sider 同时交互无层级冲突
- Repository: `npm run build` → 零类型错误;`npm run lint` → 零警告

## Stop conditions

- Stop if: 受控折叠与 breakpoint 自动触发的组合出现抖动(反复折叠),改用纯 CSS 方案(Sider 常挂载 + transform 隐藏)并回报

## Design documentation

- None
