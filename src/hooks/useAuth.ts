import { useCallback, useEffect, useState } from 'react'
import { api, UnauthorizedError } from '../lib/api'
import { getToken, setToken, clearToken } from '../lib/session'

export type AuthStatus = 'loading' | 'anon' | 'authed'

export function useAuth() {
  // 无 token 时无需请求 /me,直接进入未登录态
  const [status, setStatus] = useState<AuthStatus>(() => (getToken() ? 'loading' : 'anon'))
  const [username, setUsername] = useState('')

  useEffect(() => {
    const token = getToken()
    if (!token) return
    let cancelled = false
    api
      .me()
      .then((r) => {
        if (cancelled) return
        setUsername(r.username)
        setStatus('authed')
      })
      .catch(() => {
        if (cancelled) return
        clearToken()
        setStatus('anon')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (name: string, password: string) => {
    const r = await api.login(name, password)
    setToken(r.token)
    setUsername(r.username)
    setStatus('authed')
  }, [])

  const register = useCallback(async (name: string, password: string) => {
    const r = await api.register(name, password)
    setToken(r.token)
    setUsername(r.username)
    setStatus('authed')
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch (e) {
      if (!(e instanceof UnauthorizedError)) console.warn('logout request failed:', e)
    }
    clearToken()
    setUsername('')
    setStatus('anon')
  }, [])

  /** 会话失效(任何请求返回 401)时调用,回到登录页 */
  const expireSession = useCallback(() => {
    clearToken()
    setUsername('')
    setStatus('anon')
  }, [])

  return { status, username, login, register, logout, expireSession }
}
