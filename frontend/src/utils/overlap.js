/* ─────────────────────────────────────────────────────────────────
   overlap.js — pure functions for the Overlap page.

   Extracted from OverlapPage.jsx so the logic can be unit-tested
   without rendering React.

   Three functions are exported:

     sameFreeSet(a, b)        — equivalence check on the "who's free" set
     coalesceRows(rows)       — merge consecutive 1-hour rows into N-hour
                                "windows" when the same set of family
                                members are free across the whole span
     rankWindows(windows, …)  — score each window by (people × duration ×
                                quiet-hours penalty), return windows sorted
                                best-first with a `.score` and `.rank` field

   The ranking turns the raw set of overlapping windows into "the actual
   best times to call right now" — which is the user-facing question.
   ───────────────────────────────────────────────────────────────── */

export const HOUR_MS = 60 * 60 * 1000

/** Two free-sets are equivalent iff they contain the same other_id values. */
export function sameFreeSet(a, b) {
  if (a.length !== b.length) return false
  const ids = new Set(a.map(x => x.other_id))
  for (const c of b) if (!ids.has(c.other_id)) return false
  return true
}

/**
 * Coalesce a sorted list of 1-hour rows into windows where consecutive
 * rows that share the same free-set merge into one entry.
 *
 * Input row shape:  { iso, when: Date, free: [{ other_id, ... }] }
 * Output window:    { startIso, lastIso, when, endTime, free, hours }
 *
 * Two rows are merged when:
 *   (a) the next row starts exactly at the end of the current window, AND
 *   (b) the same set of family members are free in both rows.
 *
 * The function never mutates its inputs; it returns a fresh array.
 */
export function coalesceRows(rows) {
  if (!rows.length) return []
  const out = []
  let cur = null
  for (const r of rows) {
    if (
      cur &&
      r.when.getTime() - cur.endTime.getTime() === 0 &&
      sameFreeSet(cur.free, r.free)
    ) {
      cur.endTime = new Date(r.when.getTime() + HOUR_MS)
      cur.hours += 1
      cur.lastIso = r.iso
    } else {
      cur = {
        startIso: r.iso,
        lastIso: r.iso,
        when: r.when,
        endTime: new Date(r.when.getTime() + HOUR_MS),
        free: r.free,
        hours: 1,
      }
      out.push(cur)
    }
  }
  return out
}

/* ── Ranking ─────────────────────────────────────────────────────── */

/**
 * Score a single window. Larger is better.
 *
 *   score = peopleFree * (1 + log2(hours))
 *           * (1 - 0.4  if any minute lies in any quiet window)
 *           * (1 - 0.2  if it starts in the past)
 *
 * Rationale for the shape:
 *   • Linear in peopleFree — doubling the number of family members free
 *     should roughly double the value of the slot.
 *   • Logarithmic in hours — a 4-hour window is better than a 1-hour
 *     window but not 4x better; flexibility has diminishing returns.
 *   • Multiplicative quiet-hours penalty — a window that intrudes on
 *     anyone's sleep is downweighted but not zero'd out (the user may
 *     have a brief overlap with someone whose night happens to start
 *     there).
 *   • Past-start penalty — the front-end keeps the row visible for the
 *     current hour even after it's begun, but it shouldn't be the
 *     headline recommendation.
 *
 * Pure: no Date.now() reads, no surprises in tests.
 *
 * @param {object} w        — window from coalesceRows
 * @param {object} opts
 * @param {Date}   opts.now — reference "now" for the past-start penalty
 * @param {Array<{userId, start: 'HH:MM', end: 'HH:MM'}>} [opts.quietWindows]
 *                          — every participant's quiet window (used to
 *                            decide if the window touches anyone's quiet
 *                            time). When empty, the penalty is skipped.
 */
export function scoreWindow(w, { now = new Date(), quietWindows = [] } = {}) {
  const people = w.free.length
  if (people === 0) return 0

  // log2(1) = 0 → a 1-hour window keeps its base value.
  const durationFactor = 1 + Math.log2(w.hours)

  let score = people * durationFactor

  // Quiet-hours penalty: did the window touch any minute that's quiet
  // for at least one participant? We sweep every hour the window covers.
  if (quietWindows.length > 0) {
    const cursor = new Date(w.when.getTime())
    let intrudes = false
    for (let h = 0; h < w.hours && !intrudes; h++) {
      const mins = cursor.getHours() * 60 + cursor.getMinutes()
      for (const qw of quietWindows) {
        if (_minsInQuiet(mins, qw)) { intrudes = true; break }
      }
      cursor.setTime(cursor.getTime() + HOUR_MS)
    }
    if (intrudes) score *= 0.6
  }

  // Past-start penalty.
  if (w.when.getTime() < now.getTime()) score *= 0.8

  return Math.round(score * 100) / 100
}

/**
 * Take the output of coalesceRows() and return it sorted best-first,
 * each window decorated with `.score` and `.rank` (1-indexed).
 *
 * Stable: equal scores preserve their original chronological order so
 * the UI doesn't shuffle on every re-render.
 */
export function rankWindows(windows, opts = {}) {
  const scored = windows.map((w, i) => ({
    ...w,
    score: scoreWindow(w, opts),
    _origIndex: i,
  }))
  scored.sort((a, b) => (b.score - a.score) || (a._origIndex - b._origIndex))
  return scored.map((w, i) => {
    delete w._origIndex
    return { ...w, rank: i + 1 }
  })
}

/* Internal helper — duplicated from quietHours.js to keep this module
   dependency-free (so it can be imported by both web and mobile without
   pulling in browser-storage code). Same wrap-around semantics. */
function _minsInQuiet(mins, qw) {
  const s = _toMin(qw.start)
  const e = _toMin(qw.end)
  if (s === e) return false
  if (s < e)   return mins >= s && mins < e
  return mins >= s || mins < e
}
function _toMin(hhmm) {
  if (!hhmm) return 0
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
