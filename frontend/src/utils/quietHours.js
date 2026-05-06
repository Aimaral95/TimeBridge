/* ─────────────────────────────────────────────────────────────────
   Quiet hours — a per-user "do not suggest call" window.

   Stored in localStorage (no backend column yet) keyed by userId so
   two users on the same browser don't share the setting.

   Format: { start: 'HH:MM', end: 'HH:MM' }. Wraps midnight when
   start > end (e.g. 22:00 → 08:00).
   ───────────────────────────────────────────────────────────────── */

const PREFIX = 'tb_quiet_'
export const DEFAULT_QUIET = { start: '22:00', end: '08:00' }

function key(userId) { return userId ? `${PREFIX}${userId}` : null }

export function loadQuietHours(userId) {
  const k = key(userId)
  if (!k) return { ...DEFAULT_QUIET }
  try {
    const raw = localStorage.getItem(k)
    if (!raw) return { ...DEFAULT_QUIET }
    const v = JSON.parse(raw)
    if (typeof v?.start === 'string' && typeof v?.end === 'string') return v
  } catch {}
  return { ...DEFAULT_QUIET }
}

export function saveQuietHours(userId, qh) {
  const k = key(userId)
  if (!k) return
  try { localStorage.setItem(k, JSON.stringify(qh)) } catch {}
}

function toMin(hhmm) {
  if (!hhmm) return 0
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Is the given Date inside the quiet window?
 *  Handles wrap-around (start > end means "evening through next morning"). */
export function inQuietHours(date, qh) {
  if (!qh) return false
  const mins = date.getHours() * 60 + date.getMinutes()
  const s = toMin(qh.start)
  const e = toMin(qh.end)
  if (s === e) return false                    // disabled
  if (s < e) return mins >= s && mins < e      // same-day window
  return mins >= s || mins < e                 // wraps midnight
}
