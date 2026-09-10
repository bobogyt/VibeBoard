import { createContext } from 'react'
import type { AuthStatus } from '../hooks/useAuth'

export type Theme = 'light' | 'dark'

export interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

export const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  toggleTheme: () => {},
})

export interface AuthContextValue {
  status: AuthStatus
  username: string
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  expireSession: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
