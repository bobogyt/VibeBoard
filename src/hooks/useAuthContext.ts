import { useContext } from 'react'
import { AuthContext } from '../context/contexts'
import type { AuthContextValue } from '../context/contexts'

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider')
  return ctx
}
