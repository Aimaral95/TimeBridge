import { createContext, useContext, useState, useEffect } from 'react'
import { api } from '../api/client'

const Ctx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('tb_token')
    if (!token) { setLoading(false); return }

    const cached = localStorage.getItem('tb_user')
    if (cached) {
      try { setUser(JSON.parse(cached)) } catch {}
    }

    api.getMe()
      .then(d => {
        setUser(d.user)
        try { localStorage.setItem('tb_user', JSON.stringify(d.user)) } catch {}
      })
      .catch(() => {
        localStorage.removeItem('tb_token')
        localStorage.removeItem('tb_user')
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  function login(token, userData) {
    localStorage.setItem('tb_token', token)
    localStorage.setItem('tb_user', JSON.stringify(userData))
    setUser(userData)
  }

  function updateUser(patch) {
    setUser(prev => {
      const next = { ...prev, ...patch }
      try { localStorage.setItem('tb_user', JSON.stringify(next)) } catch {}
      return next
    })
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
