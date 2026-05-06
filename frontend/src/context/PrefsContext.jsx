import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext'

/* ─────────────────────────────────────────────────────────────
   PrefsContext — UI preferences that don't need the server.

   Two preferences live here:
     - theme:       'dark' | 'light'   (toggles a `.light` class on <html>)
     - timeFormat:  '24h'  | '12h'     (used by utils/timeFormat.formatTime)

   Both are stored in localStorage scoped per-user (so two accounts on
   the same browser don't share preferences). Defaults: dark + 24h.

   On mount we apply the theme class to <html> immediately so the page
   doesn't flash the wrong theme on load.
   ───────────────────────────────────────────────────────────── */

const Ctx = createContext(null)

const PREFIX_THEME = 'tb_pref_theme_'
const PREFIX_TIMEFMT = 'tb_pref_timefmt_'
const DEFAULT_THEME = 'dark'
const DEFAULT_TIMEFMT = '24h'

function loadPref(prefix, userId, fallback) {
  if (!userId) return fallback
  try {
    const v = localStorage.getItem(`${prefix}${userId}`)
    return v || fallback
  } catch { return fallback }
}
function savePref(prefix, userId, value) {
  if (!userId) return
  try { localStorage.setItem(`${prefix}${userId}`, value) } catch {}
}

function applyTheme(theme) {
  // Toggle a class on <html> so :root.light overrides in index.css take effect.
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('light', theme === 'light')
}

export function PrefsProvider({ children }) {
  const { user } = useAuth()
  const [theme, setThemeState] = useState(DEFAULT_THEME)
  const [timeFormat, setTimeFormatState] = useState(DEFAULT_TIMEFMT)

  // Hydrate from storage when the user changes (or on mount).
  useEffect(() => {
    const t  = loadPref(PREFIX_THEME,   user?.id, DEFAULT_THEME)
    const tf = loadPref(PREFIX_TIMEFMT, user?.id, DEFAULT_TIMEFMT)
    setThemeState(t)
    setTimeFormatState(tf)
    applyTheme(t)
  }, [user?.id])

  // Re-apply theme class whenever the in-memory state changes.
  useEffect(() => { applyTheme(theme) }, [theme])

  const setTheme = useCallback((t) => {
    setThemeState(t)
    savePref(PREFIX_THEME, user?.id, t)
  }, [user?.id])

  const setTimeFormat = useCallback((f) => {
    setTimeFormatState(f)
    savePref(PREFIX_TIMEFMT, user?.id, f)
  }, [user?.id])

  const toggleTheme = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme])
  const toggleTimeFormat = useCallback(() => setTimeFormat(timeFormat === '24h' ? '12h' : '24h'), [timeFormat, setTimeFormat])

  return (
    <Ctx.Provider value={{ theme, timeFormat, setTheme, setTimeFormat, toggleTheme, toggleTimeFormat }}>
      {children}
    </Ctx.Provider>
  )
}

export function usePrefs() {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePrefs must be used inside <PrefsProvider>')
  return v
}
