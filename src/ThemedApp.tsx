import { BrowserRouter } from 'react-router'
import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { useTheme } from './hooks/useTheme'
import { themeConfig } from './theme'
import App from './App'

/** 桥接 ThemeContext → antd ConfigProvider */
export default function ThemedApp() {
  const { theme } = useTheme()
  return (
    <ConfigProvider locale={zhCN} theme={themeConfig[theme]}>
      <AntdApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  )
}
