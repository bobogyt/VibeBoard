import { theme } from 'antd'
import type { ThemeConfig } from 'antd'
import type { Theme } from '../context/contexts'

/** Linear 靛蓝 + 极简边框,明暗两套与 app.css 的 CSS 变量保持一致 */
export const themeConfig: Record<Theme, ThemeConfig> = {
  light: {
    algorithm: theme.defaultAlgorithm,
    cssVar: { key: 'vibeboard' },
    token: {
      colorPrimary: '#5e6ad2',
      colorInfo: '#5e6ad2',
      colorLink: '#5e6ad2',
      colorBgLayout: '#fafafa',
      colorBgContainer: '#ffffff',
      colorText: '#111113',
      colorTextSecondary: '#6e7076',
      colorBorder: '#e5e5e8',
      colorBorderSecondary: '#f0f0f2',
      borderRadius: 8,
      fontSize: 14,
    },
    components: {
      Layout: {
        siderBg: '#ffffff',
        headerBg: 'rgba(250, 250, 250, 0.82)',
        bodyBg: '#fafafa',
      },
      Menu: {
        itemBg: 'transparent',
        itemSelectedBg: 'rgba(94, 106, 210, 0.1)',
        itemSelectedColor: '#5e6ad2',
        itemBorderRadius: 8,
      },
    },
  },
  dark: {
    algorithm: theme.darkAlgorithm,
    cssVar: { key: 'vibeboard' },
    token: {
      colorPrimary: '#6e79d8',
      colorInfo: '#6e79d8',
      colorLink: '#6e79d8',
      colorBgLayout: '#0a0a0b',
      colorBgContainer: '#17171a',
      colorText: '#ececf0',
      colorTextSecondary: '#8f919b',
      colorBorder: '#26262b',
      colorBorderSecondary: '#202024',
      borderRadius: 8,
      fontSize: 14,
    },
    components: {
      Layout: {
        siderBg: '#101013',
        headerBg: 'rgba(10, 10, 11, 0.78)',
        bodyBg: '#0a0a0b',
      },
      Menu: {
        itemBg: 'transparent',
        itemSelectedBg: 'rgba(110, 121, 216, 0.16)',
        itemSelectedColor: '#a5aee8',
        itemBorderRadius: 8,
      },
    },
  },
}
