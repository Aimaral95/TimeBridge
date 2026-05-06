import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext'
import { api } from '../api/client'

/* NotesContext exposes:
     unreadCount   — the badge value the sidebar renders
     refreshUnread — call after any action that may change it
     markAllRead   — convenience: bumps unreadCount to 0 immediately
                     (the GET /notes endpoint already does this server-side
                     when the user opens the inbox; this just keeps the UI
                     in sync without a refetch round-trip)

   Polling: every 60s while a user is logged in. Cheap enough for the demo;
   v1.1 swaps this for SSE / WebSockets per the report's Future Work. */

const Ctx = createContext(null)

export function NotesProvider({ children }) {
  const { user } = useAuth()
  const [unreadCount, setUnreadCount] = useState(0)

  const refreshUnread = useCallback(async () => {
    if (!user) { setUnreadCount(0); return }
    try {
      const d = await api.getUnreadCount()
      setUnreadCount(d.count || 0)
    } catch { /* swallow — badge defaults to last value */ }
  }, [user])

  useEffect(() => {
    refreshUnread()
    if (!user) return undefined
    const id = setInterval(refreshUnread, 60_000)
    return () => clearInterval(id)
  }, [refreshUnread, user])

  function markAllRead() { setUnreadCount(0) }

  return (
    <Ctx.Provider value={{ unreadCount, refreshUnread, markAllRead }}>
      {children}
    </Ctx.Provider>
  )
}

export function useNotes() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useNotes must be used inside <NotesProvider>')
  return v
}
