import { useSyncExternalStore } from 'react'

/** 订阅 CSS 媒体查询匹配状态(响应式 UI 的确定性数据源,不依赖组件库的断点回调) */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
  )
}
