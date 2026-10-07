import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { auth, getToken, setToken } from './api'

/* Signed-in user, role and permissions for the whole app. The server checks everything again -
   this only decides what to show. */
const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

export const ROLE_INFO = {
  Admin: 'Everything: users, tenants, ETL, reports, system health',
  Accountant: 'Dashboards, reports, FS mapping, run ETL and rebuild, system health',
  Finance: 'Dashboards and reports, export',
  Viewer: 'Dashboards and reports, read only',
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [state, setState] = useState(getToken() ? 'checking' : 'signed-out')   // checking | signed-in | signed-out

  const loadMe = useCallback(() => {
    if (!getToken()) { setUser(null); setState('signed-out'); return }
    auth('me').then((u) => { setUser(u); setState('signed-in') })
      .catch((e) => { if (e.status === 401) setToken(''); setUser(null); setState(e.status === 401 ? 'signed-out' : 'error') })
  }, [])

  useEffect(() => {
    loadMe()
    const on = () => { if (!getToken()) { setUser(null); setState('signed-out') } }
    window.addEventListener('auth-token', on)
    return () => window.removeEventListener('auth-token', on)
  }, [loadMe])

  const login = async (username, password) => {
    const r = await auth('login', { username, password })
    setToken(r.token); setUser(r.user); setState('signed-in')
    return r.user
  }
  const logout = async () => {
    try { await auth('logout', {}) } catch { /* ignore */ }
    setToken(''); setUser(null); setState('signed-out')
  }
  const changePassword = async (current, next) => {
    const r = await auth('change-password', { current, new: next })
    setToken(r.token); setUser(r.user)
  }
  const can = useCallback((perm) => !!user?.permissions?.includes(perm), [user])
  /** per-user limit on dashboards / reports (User Management › Report access); other pages are not limited */
  const canPage = useCallback((path) => {
    if (!user) return false
    if (!/^\/(dashboards|reports|adjustments)\//.test(path) || user.all_pages !== false) return true
    return (user.pages || []).includes(path)
  }, [user])

  return (
    <AuthCtx.Provider value={{ user, state, login, logout, changePassword, can, canPage, reload: loadMe }}>
      {children}
    </AuthCtx.Provider>
  )
}
