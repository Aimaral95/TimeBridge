/* ─────────────────────────────────────────────────────────────────
   tz.js — tiny helpers for evaluating wall-clock times in arbitrary
   IANA timezones, without pulling in luxon / date-fns-tz.

   These exist because schedule_blocks are anchored to the *creator's*
   timezone (via the `tzid` column added to schedule_blocks). When the
   Dashboard asks "is the user in a class right now?", the comparison
   has to be done in the block's tzid, not in the browser's local clock.
   Otherwise a block authored in America/Los_Angeles as "9 AM" would be
   re-interpreted as "9 AM Europe/Paris" the moment the user travels.

   Public API:
     wallClockInTz(date, tzid) -> { dayKey, minutes }
     browserTz()               -> 'America/Los_Angeles' (etc)
   ───────────────────────────────────────────────────────────────── */

const DAY_KEYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const SHORT_TO_INDEX = Object.fromEntries(DAY_KEYS.map((d, i) => [d, i]))

/** What does the wall-clock look like in `tzid` for the given UTC instant?
 *  Returns { dayKey: 'Mon'..'Sun', minutes: 0..1439 }.
 *  `date` may be a Date or an ISO string.
 *  If `tzid` is falsy, falls back to the browser's local clock. */
export function wallClockInTz(date, tzid) {
  const d = (date instanceof Date) ? date : new Date(date)
  if (!tzid) {
    return {
      dayKey: DAY_KEYS[d.getDay()],
      minutes: d.getHours() * 60 + d.getMinutes(),
    }
  }
  // Intl.DateTimeFormat with a specified timeZone projects the UTC instant
  // into that zone's wall clock. We pull weekday + hour + minute and map
  // weekday into our 'Mon' / 'Tue' / ... shorthand.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tzid,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const o = Object.fromEntries(parts.map(p => [p.type, p.value]))
  // Intl returns 'Mon' as a short weekday — happens to match our DAY_KEYS.
  const dayKey = o.weekday in SHORT_TO_INDEX ? o.weekday : 'Sun'
  // Intl can return "24" for midnight in some locales — clamp to 0.
  const h = parseInt(o.hour, 10) % 24
  const m = parseInt(o.minute, 10) || 0
  return { dayKey, minutes: h * 60 + m }
}

/** The browser's IANA timezone name (e.g. 'Asia/Almaty').
 *  Returns 'UTC' if the browser can't tell. */
export function browserTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch { return 'UTC' }
}
