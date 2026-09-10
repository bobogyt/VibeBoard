import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { THEME_STORAGE_KEY } from '../constants'
import { ThemeContext } from './contexts'
import type { Theme } from './contexts'

/** 初始值由 index.html 的内联脚本写在 <html data-theme> 上,这里读取保持一致 */
function getInitialTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'light' ? 'dark' : 'light'
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next)
      } catch {
        /* localStorage 不可用时主题仍可切换,只是不记忆 */
      }
      return next
    })
  }, [])

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}
