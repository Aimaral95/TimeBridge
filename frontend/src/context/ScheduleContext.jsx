import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api } from '../api/client'
import { useAuth } from './AuthContext'
import { wallClockInTz, browserTz } from '../utils/tz'

/* ─────────────────────────────────────────────────────────────
   Schedule context.

   Stores the user's weekly recurring blocks and exposes helpers
   the Dashboard uses to derive a "current status" automatically.

   Each block looks like:
     { id, title, type, days: ['Mon','Tue',...], start_time: 'HH:MM', end_time: 'HH:MM' }

   We keep a localStorage cache so the UI feels instant and so the
   demo still works offline (e.g. before /schedule endpoints are wired).
   ───────────────────────────────────────────────────────────── */

const Ctx = createContext(null)
const STORAGE_PREFIX = 'tb_schedule_'

// Cache is now PER-USER so two accounts on the same browser don't share blocks.
function cacheKey(userId) {
  return userId ? `${STORAGE_PREFIX}${userId}` : null
}

function loadCache(userId) {
  const k = cacheKey(userId)
  if (!k) return null
  try {
    const raw = localStorage.getItem(k)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch { return null }
}
function saveCache(userId, blocks) {
  const k = cacheKey(userId)
  if (!k) return
  try { localStorage.setItem(k, JSON.stringify(blocks)) } catch {}
}

/* "HH:MM" -> minutes since midnight */
function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

/** Find the block (if any) covering "now".
 *
 *  Each block carries a `tzid` (added in the v1.x timezone fix). Comparisons
 *  use the wall-clock projection of `now` into the block's tzid, so a block
 *  authored as "09:00 in America/Los_Angeles" stays anchored to LA time
 *  even if the viewer is in a different zone.
 *
 *  Legacy blocks created before tzid existed (tzid = null) fall back to the
 *  viewer's local clock — that's the historical behaviour, preserved so we
 *  don't silently shift old data. */
export function activeBlock(blocks, now = new Date()) {
  if (!blocks || blocks.length === 0) return null
  return blocks.find(b => {
    if (!Array.isArray(b.days)) return false
    const { dayKey, minutes } = wallClockInTz(now, b.tzid)
    return b.days.includes(dayKey)
        && toMin(b.start_time) <= minutes
        && minutes < toMin(b.end_time)
  }) || null
}

/** Block -> dashboard status key. Types are free-text, so any active block = busy
 *  unless the user explicitly tagged it 'class' (kept for the "In Class" badge). */
export function blockToStatus(block) {
  if (!block) return 'free'
  if ((block.type || '').toLowerCase() === 'class') return 'class'
  return 'busy'
}

/** Find the next upcoming block today, for a friendly "next up" hint.
 *  Same tzid-aware semantics as activeBlock. */
export function nextBlock(blocks, now = new Date()) {
  if (!blocks || blocks.length === 0) return null
  const todays = blocks
    .filter(b => {
      if (!Array.isArray(b.days)) return false
      const { dayKey, minutes } = wallClockInTz(now, b.tzid)
      return b.days.includes(dayKey) && toMin(b.start_time) > minutes
    })
    .sort((a, b) => toMin(a.start_time) - toMin(b.start_time))
  return todays[0] || null
}

export function ScheduleProvider({ children }) {
  const { user } = useAuth()
  const [blocks, setBlocks] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Whenever the logged-in user changes, immediately reload from THAT user's
  // cache (so we don't show the previous user's blocks) and then re-fetch
  // from the backend.
  useEffect(() => {
    if (!user) {
      setBlocks([]) // logged out
      return
    }
    setBlocks(loadCache(user.id) || [])
    // fall through to reload effect below
  }, [user?.id])

  const reload = useCallback(async () => {
    if (!user) return
    setLoading(true); setError(null)
    try {
      const data = await api.getSchedule()
      const list = (data.blocks || [])
      // ALWAYS trust the backend, even when empty. A new user should see
      // an empty schedule, not a leftover sample or someone else's blocks.
      setBlocks(list)
      saveCache(user.id, list)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { reload() }, [reload])

  async function addBlock(block) {
    // Optimistic + persistent. We tag every new block with the user's saved
    // tzid (or the browser's tzid as a fallback) so the time anchor follows
    // them around — see utils/tz.js + activeBlock() for why this matters.
    const tzid = block.tzid || user?.timezone || browserTz()
    const optimistic = { ...block, tzid, id: `tmp-${Date.now()}` }
    setBlocks(b => { const n = [...b, optimistic]; saveCache(user?.id, n); return n })
    try {
      const data = await api.addScheduleBlock({
        title: block.title,
        type: block.type,
        color: block.color,            // <-- bug fix: was being dropped
        days: block.days,
        start_time: block.start_time,
        end_time: block.end_time,
        tzid,                          // <-- new: anchor block to a tzid
      })
      setBlocks(b => {
        const n = b.map(x => x === optimistic ? data.block : x)
        saveCache(user?.id, n); return n
      })
    } catch (e) {
      // Backend not available — keep optimistic copy.
      console.warn('addScheduleBlock fell back to local-only:', e.message)
    }
  }

  async function removeBlock(id) {
    setBlocks(b => { const n = b.filter(x => x.id !== id); saveCache(user?.id, n); return n })
    if (typeof id === 'number' && id > 0) {
      try { await api.removeScheduleBlock(id) }
      catch (e) { console.warn('removeScheduleBlock backend error:', e.message) }
    }
  }

  return (
    <Ctx.Provider value={{ blocks, loading, error, reload, addBlock, removeBlock }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSchedule() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSchedule must be used inside <ScheduleProvider>')
  return v
}
