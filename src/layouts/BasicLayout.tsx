import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { Avatar, Button, Dropdown, Layout, Menu } from 'antd'
import type { MenuProps } from 'antd'
import {
  AppstoreOutlined,
  BarChartOutlined,
  InboxOutlined,
  LogoutOutlined,
  ProjectOutlined,
  RobotOutlined,
  UserOutlined,
  MoonOutlined,
  SunOutlined,
  MenuOutlined,
  MenuFoldOutlined,
} from '@ant-design/icons'
import { useAuthContext } from '../hooks/useAuthContext'
import { useTheme } from '../hooks/useTheme'
import ModelSettingsModal from '../components/ModelSettingsModal'

const { Sider, Header, Content } = Layout

const menuItems: MenuProps['items'] = [
  { key: '/board', icon: <AppstoreOutlined />, label: '任务看板' },
  { key: '/projects', icon: <ProjectOutlined />, label: '项目管理' },
  { key: '/stats', icon: <BarChartOutlined />, label: '数据统计' },
  { key: '/archive', icon: <InboxOutlined />, label: '任务归档' },
]

/** antd lg 断点:窄于此值时 Sider 折叠,由 Header 上的按钮开关导航 */
const LG_BREAKPOINT = 992

export default function BasicLayout() {
  const { username, logout } = useAuthContext()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [modelOpen, setModelOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < LG_BREAKPOINT)
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < LG_BREAKPOINT)

  const userMenu: MenuProps['items'] = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: () => {
        void logout().then(() => navigate('/login', { replace: true }))
      },
    },
  ]

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={208}
        theme="light"
        breakpoint="lg"
        collapsedWidth={0}
        collapsed={collapsed}
        trigger={null}
        onBreakpoint={(bp) => {
          setIsMobile(!bp)
          setCollapsed(!bp)
        }}
      >
        <div className="layout-logo">VibeBoard</div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header className="layout-header">
          {isMobile && (
            <Button
              type="text"
              size="small"
              className="header-icon-btn header-nav-toggle"
              icon={collapsed ? <MenuOutlined /> : <MenuFoldOutlined />}
              aria-label={collapsed ? '打开导航菜单' : '收起导航菜单'}
              onClick={() => setCollapsed(!collapsed)}
            />
          )}
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="header-icon-btn"
            onClick={() => setModelOpen(true)}
            aria-label="模型设置"
            title="AI 模型设置"
          >
            <RobotOutlined />
          </button>
          <button
            type="button"
            className="header-icon-btn"
            onClick={toggleTheme}
            aria-label={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}
          >
            {theme === 'light' ? <MoonOutlined /> : <SunOutlined />}
          </button>
          <Dropdown menu={{ items: userMenu }} placement="bottomRight" trigger={['click']}>
            <button type="button" className="header-user">
              <Avatar size={26} icon={<UserOutlined />} />
              <span className="header-user-name">{username}</span>
            </button>
          </Dropdown>
        </Header>
        <Content style={{ padding: '24px 24px 48px', maxWidth: 1240, width: '100%', margin: '0 auto' }}>
          <Outlet />
        </Content>
      </Layout>
      <ModelSettingsModal open={modelOpen} onClose={() => setModelOpen(false)} />
    </Layout>
  )
}
