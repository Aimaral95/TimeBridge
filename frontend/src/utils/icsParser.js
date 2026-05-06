/* ─────────────────────────────────────────────────────────────────
   icsParser — minimal client-side .ics file → schedule_block converter.

   Goal: take a Google/Apple/Outlook calendar export and produce blocks
   shaped for our backend POST /schedule:
     { title, days: ['Mon','Tue',...], start_time: 'HH:MM',
       end_time: 'HH:MM', type, color }

   We deliberately keep this small instead of pulling ical.js. We support
   the common cases:
     • VEVENT with SUMMARY, DTSTART, DTEND
     • Repeating events (RRULE FREQ=WEEKLY BYDAY=MO,WE,FR)
     • Single events without RRULE → treated as a single-day weekly
       recurring block (the day-of-week from DTSTART)
     • All-day events (VALUE=DATE) → skipped, they're not "busy times"
     • Lines wrapped per RFC 5545 (continuation lines start with space/tab)
   We treat the DT values as LOCAL wall-clock times — the most common
   case for calendar exports — and ignore TZID conversions for the demo.
   ───────────────────────────────────────────────────────────────── */

const ICS_TO_DAY = {
  MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu',
  FR: 'Fri', SA: 'Sat', SU: 'Sun',
}
const DOW_FROM_DATE = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

/** Unfold lines per RFC 5545 §3.1: a line starting with WSP continues the previous. */
function unfold(text) {
  const raw = text.replace(/\r\n/g, '\n').split('\n')
  const out = []
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
      out[out.length - 1] += line.slice(1)
    } else {
      out.push(line)
    }
  }
  return out
}

/** Property line "DTSTART;TZID=America/Los_Angeles:20251015T090000"
 *  → { name: 'DTSTART', params: { TZID: 'America/Los_Angeles' }, value: '20251015T090000' } */
function parseLine(line) {
  const colon = line.indexOf(':')
  if (colon === -1) return null
  const left = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const parts = left.split(';')
  const name = parts[0].toUpperCase()
  const params = {}
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=')
    if (eq > 0) params[parts[i].slice(0, eq).toUpperCase()] = parts[i].slice(eq + 1)
  }
  return { name, params, value }
}

/** Pull "HH:MM" out of an ICS DT-TIME value like "20251015T090000" or "20251015T090000Z". */
function timeFromDt(value) {
  const m = /T(\d{2})(\d{2})/.exec(value)
  if (!m) return null
  return `${m[1]}:${m[2]}`
}

/** Extract date-of-week ("Mon"/"Tue"/...) from "20251015..." (YYYYMMDD prefix). */
function dowFromDt(value) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value)
  if (!m) return null
  // Use UTC date so timezone offsets don't shift the day.
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return DOW_FROM_DATE[d.getUTCDay()]
}

/** Parse a BYDAY list "MO,WE,FR" or "MO" into ['Mon','Wed','Fri']. */
function bydayToDays(byday) {
  if (!byday) return null
  const out = []
  for (const tok of byday.split(',')) {
    // Strip optional ordinal prefix like "2MO" → "MO".
    const code = tok.replace(/^[+-]?\d+/, '').toUpperCase()
    const day = ICS_TO_DAY[code]
    if (day && !out.includes(day)) out.push(day)
  }
  return out.length ? out : null
}

/** Main entry: parse .ics text into [{ title, days, start_time, end_time }, ...]. */
export function parseIcs(text) {
  const lines = unfold(text)
  const events = []
  let current = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === 'BEGIN:VEVENT') { current = {}; continue }
    if (trimmed === 'END:VEVENT') {
      if (current) events.push(current)
      current = null
      continue
    }
    if (!current) continue
    const p = parseLine(line)
    if (!p) continue
    switch (p.name) {
      case 'SUMMARY': current.summary = p.value; break
      case 'DTSTART':
        current.dtstart = p.value
        current.dtstartIsDate = (p.params.VALUE || '').toUpperCase() === 'DATE'
        break
      case 'DTEND':
        current.dtend = p.value
        current.dtendIsDate = (p.params.VALUE || '').toUpperCase() === 'DATE'
        break
      case 'RRULE': {
        // Naive parse of "FREQ=WEEKLY;BYDAY=MO,WE,FR".
        const r = {}
        for (const part of p.value.split(';')) {
          const eq = part.indexOf('=')
          if (eq > 0) r[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1)
        }
        current.rrule = r
        break
      }
      default: /* ignore */ break
    }
  }

  // Convert raw events → schedule blocks.
  const blocks = []
  for (const ev of events) {
    if (!ev.dtstart || !ev.dtend) continue
    if (ev.dtstartIsDate || ev.dtendIsDate) continue   // skip all-day
    const start_time = timeFromDt(ev.dtstart)
    const end_time = timeFromDt(ev.dtend)
    if (!start_time || !end_time) continue

    let days = null
    if (ev.rrule && (ev.rrule.FREQ || '').toUpperCase() === 'WEEKLY') {
      days = bydayToDays(ev.rrule.BYDAY) || (dowFromDt(ev.dtstart) ? [dowFromDt(ev.dtstart)] : null)
    } else {
      // No RRULE — recur weekly on the day-of-week of the original event.
      const d = dowFromDt(ev.dtstart)
      if (d) days = [d]
    }
    if (!days || days.length === 0) continue

    blocks.push({
      title: (ev.summary || 'Untitled event').slice(0, 80),
      days,
      start_time,
      end_time,
    })
  }

  // De-dupe identical entries (e.g. several occurrences of the same recurring event).
  const seen = new Set()
  const unique = []
  for (const b of blocks) {
    const key = `${b.title}|${b.days.join(',')}|${b.start_time}|${b.end_time}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(b)
  }
  return unique
}
