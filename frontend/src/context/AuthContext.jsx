import { createContext, useContext, useState, useEffect } from 'react'

const Ctx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const t = localStorage.getItem('tb_token')
    const u = localStorage.getItem('tb_user')
    if (t && u) try { setUser(JSON.parse(u)) } catch {}
    setLoading(false)
  }, [])

  function login(token, userData) {
    localStorage.setItem('tb_token', token)
    localStorage.setItem('tb_user', JSON.stringify(userData))
    setUser(userData)
  }

  function updateUser(userData) {
    const merged = { ...user, ...userData }
    localStorage.setItem('tb_user', JSON.stringify(merged))
    setUser(merged)
  }

  function logout() {
    localStorage.removeItem('tb_token')
    localStorage.removeItem('tb_user')
    // Also wipe the legacy single-key schedule cache (pre user-scoped) so a
    // brand-new account doesn't see leftover sample blocks.
    localStorage.removeItem('tb_schedule')
    setUser(null)
  }

  return <Ctx.Provider value={{ user, loading, login, logout, updateUser }}>{children}</Ctx.Provider>
}

export function useAuth() { return useContext(Ctx) }
