import { useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { Avatar, Badge, Button, Drawer, Dropdown, Layout, Menu } from 'antd'
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
  BellOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useAuthContext } from '../hooks/useAuthContext'
import { useTheme } from '../hooks/useTheme'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { api } from '../lib/api'
import type { NotificationItem } from '../types'
import dayjs from 'dayjs'
import ModelSettingsModal from '../components/ModelSettingsModal'

const { Sider, Header, Content } = Layout

const menuItems: MenuProps['items'] = [
  { key: '/board', icon: <AppstoreOutlined />, label: '任务看板' },
  { key: '/projects', icon: <ProjectOutlined />, label: '项目管理' },
  { key: '/automations', icon: <ThunderboltOutlined />, label: '自动化' },
  { key: '/stats', icon: <BarChartOutlined />, label: '数据统计' },
  { key: '/archive', icon: <InboxOutlined />, label: '任务归档' },
]

/** antd lg 断点:窄于此值时不渲染 Sider,导航改由 Header 汉堡按钮 + Drawer 抽屉承载 */
const LG_BREAKPOINT = 992
const MOBILE_QUERY = `(max-width: ${LG_BREAKPOINT - 1}px)`

export default function BasicLayout() {
  const { username, logout } = useAuthContext()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [modelOpen, setModelOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const isMobile = useMediaQuery(MOBILE_QUERY)

  // 通知轮询:60s 一次(后端不可达时静默忽略,不影响页面)
  useEffect(() => {
    let cancelled = false
    const poll = () => {
      api
        .getNotifications(5)
        .then((data) => {
          if (!cancelled) {
            setNotifications(data.items)
            setUnreadCount(data.unread)
          }
        })
        .catch(() => {})
    }
    poll()
    const timer = setInterval(poll, 60_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const markReadAndRefresh = useCallback(() => {
    void api
      .markNotificationsRead()
      .catch(() => {})
      .then(() => api.getNotifications(5))
      .then((data) => {
        setNotifications(data.items)
        setUnreadCount(data.unread)
      })
      .catch(() => {})
  }, [])

  const notifMenuItems: MenuProps['items'] = [
    ...(notifications.length > 0
      ? notifications.map((n) => ({
          key: n.id,
          label: (
            <div className="notif-menu-item">
              <div className="notif-menu-item__title">{n.title}</div>
              <div className="notif-menu-item__time">{dayjs(n.createdAt).format('MM-DD HH:mm')}</div>
            </div>
          ),
        }))
      : [{ key: 'empty', label: '暂无通知', disabled: true }]),
    { type: 'divider' as const },
    { key: 'open-automations', label: '查看自动化' },
  ]

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    navigate(key)
    setNavOpen(false)
  }

  const menu = (
    <Menu
      mode="inline"
      selectedKeys={[location.pathname]}
      items={menuItems}
      onClick={handleMenuClick}
    />
  )

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
      {!isMobile && (
        <Sider width={208} theme="light">
          <div className="layout-logo">VibeBoard</div>
          {menu}
        </Sider>
      )}
      <Layout>
        <Header className="layout-header">
          {isMobile && (
            <Button
              type="text"
              size="small"
              className="header-icon-btn header-nav-toggle"
              icon={<MenuOutlined />}
              aria-label="打开导航菜单"
              onClick={() => setNavOpen(true)}
            />
          )}
          <div style={{ flex: 1 }} />
          <Dropdown
            menu={{
              items: notifMenuItems,
              onClick: ({ key }) => {
                if (key === 'open-automations') navigate('/automations')
                else markReadAndRefresh()
              },
            }}
            placement="bottomRight"
            trigger={['click']}
          >
            <button
              type="button"
              className="header-icon-btn"
              aria-label="通知"
              title="通知"
              onClick={markReadAndRefresh}
            >
              <Badge count={unreadCount} size="small">
                <BellOutlined />
              </Badge>
            </button>
          </Dropdown>
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
      <Drawer
        open={isMobile && navOpen}
        placement="left"
        width={260}
        title="VibeBoard"
        onClose={() => setNavOpen(false)}
        styles={{ body: { padding: 0 } }}
      >
        {menu}
      </Drawer>
      <ModelSettingsModal open={modelOpen} onClose={() => setModelOpen(false)} />
    </Layout>
  )
}
