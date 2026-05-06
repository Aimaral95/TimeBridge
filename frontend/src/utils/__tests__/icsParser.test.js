import { describe, it, expect } from 'vitest'
import { parseIcs } from '../icsParser.js'

/* Synthetic ICS samples kept inline so the tests don't need fixtures.
   They cover the four cases the parser is designed to handle:
     1. Plain VEVENT with explicit DTSTART / DTEND (single weekly recurrence)
     2. RRULE FREQ=WEEKLY;BYDAY=MO,WE,FR
     3. All-day event (VALUE=DATE) — must be skipped
     4. Line folding per RFC 5545 (continuation lines)                       */

const HEADER =
  'BEGIN:VCALENDAR\r\n' +
  'VERSION:2.0\r\n' +
  'PRODID:-//TimeBridge tests//EN\r\n'
const FOOTER = 'END:VCALENDAR\r\n'

function ics(...events) {
  return HEADER + events.join('') + FOOTER
}

describe('parseIcs — single timed event', () => {
  it('treats a one-off Wednesday meeting as weekly Wed', () => {
    const evt =
      'BEGIN:VEVENT\r\n' +
      'SUMMARY:Algorithms Lecture\r\n' +
      'DTSTART:20260415T090000\r\n' + // 2026-04-15 was a Wednesday
      'DTEND:20260415T103000\r\n' +
      'END:VEVENT\r\n'
    const out = parseIcs(ics(evt))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      title: 'Algorithms Lecture',
      days: ['Wed'],
      start_time: '09:00',
      end_time: '10:30',
    })
  })
})

describe('parseIcs — RRULE BYDAY', () => {
  it('parses MO,WE,FR weekly recurrence into Mon/Wed/Fri', () => {
    const evt =
      'BEGIN:VEVENT\r\n' +
      'SUMMARY:CS Tutoring\r\n' +
      'DTSTART:20260413T140000\r\n' +
      'DTEND:20260413T150000\r\n' +
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR\r\n' +
      'END:VEVENT\r\n'
    const out = parseIcs(ics(evt))
    expect(out).toHaveLength(1)
    expect(out[0].days.sort()).toEqual(['Fri', 'Mon', 'Wed'])
    expect(out[0].start_time).toBe('14:00')
    expect(out[0].end_time).toBe('15:00')
  })

  it('strips BYDAY ordinal prefixes like 1MO', () => {
    const evt =
      'BEGIN:VEVENT\r\n' +
      'SUMMARY:First Monday Standup\r\n' +
      'DTSTART:20260406T100000\r\n' +
      'DTEND:20260406T103000\r\n' +
      'RRULE:FREQ=WEEKLY;BYDAY=1MO\r\n' +
      'END:VEVENT\r\n'
    const out = parseIcs(ics(evt))
    expect(out[0].days).toEqual(['Mon'])
  })
})

describe('parseIcs — skipped events', () => {
  it('skips all-day events (VALUE=DATE)', () => {
    const evt =
      'BEGIN:VEVENT\r\n' +
      'SUMMARY:Birthday\r\n' +
      'DTSTART;VALUE=DATE:20260415\r\n' +
      'DTEND;VALUE=DATE:20260416\r\n' +
      'END:VEVENT\r\n'
    expect(parseIcs(ics(evt))).toEqual([])
  })

  it('skips events missing DTSTART or DTEND', () => {
    const evt =
      'BEGIN:VEVENT\r\n' +
      'SUMMARY:Incomplete\r\n' +
      'DTSTART:20260415T090000\r\n' +
      'END:VEVENT\r\n'
    expect(parseIcs(ics(evt))).toEqual([])
  })
})

describe('parseIcs — RFC 5545 line folding', () => {
  it('joins continuation lines that begin with whitespace', () => {
    const evt =
      'BEGIN:VEVENT\r\n' +
      'SUMMARY:Very long title that has been\r\n' +
      ' folded across two lines\r\n' +
      'DTSTART:20260413T080000\r\n' +
      'DTEND:20260413T093000\r\n' +
      'END:VEVENT\r\n'
    const out = parseIcs(ics(evt))
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('Very long title that has beenfolded across two lines')
  })
})

describe('parseIcs — de-duplication', () => {
  it('collapses two identical events into one block', () => {
    const evt =
      'BEGIN:VEVENT\r\n' +
      'SUMMARY:Same Same\r\n' +
      'DTSTART:20260413T100000\r\n' +
      'DTEND:20260413T110000\r\n' +
      'END:VEVENT\r\n'
    const out = parseIcs(ics(evt, evt))
    expect(out).toHaveLength(1)
  })
})
