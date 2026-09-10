import { useContext } from 'react'
import { ThemeContext } from '../context/contexts'
import type { ThemeContextValue } from '../context/contexts'

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}
