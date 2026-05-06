/* Tiny format helpers that respect the user's 12h/24h preference.
   Live as pure functions (no React) so they can be imported from anywhere. */

/** Format a Date as HH:MM (24h) or h:MM AM/PM (12h). */
export function formatTime(date, timeFormat = '24h', tz) {
  if (!(date instanceof Date)) date = new Date(date)
  const opts = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: timeFormat === '12h',
  }
  if (tz) opts.timeZone = tz
  return date.toLocaleTimeString(timeFormat === '24h' ? 'en-GB' : 'en-US', opts)
}

/** Format a clock string "HH:MM" the same way (handy for schedule blocks). */
export function formatClock(hhmm, timeFormat = '24h') {
  if (!hhmm) return ''
  if (timeFormat === '24h') return hhmm
  const [h, m] = hhmm.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = ((h + 11) % 12) + 1
  return `${h12}:${String(m || 0).padStart(2, '0')} ${period}`
}
