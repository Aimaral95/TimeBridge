import { describe, it, expect } from 'vitest'
import { wallClockInTz, browserTz, zonedTimeToUtc } from '../tz.js'

/* All tests use UTC instants chosen so the answer is unambiguous regardless
   of the test runner's local clock. The point of these tests is to verify
   the Intl-based wall-clock projection — they are NOT affected by daylight
   saving as long as we pick instants firmly inside one DST regime. */

describe('wallClockInTz', () => {
  // 2026-04-30 was a Thursday in every timezone in the world.
  // 12:00 UTC corresponds to:
  //   - America/Los_Angeles (UTC-7 in DST):  05:00 Thu
  //   - Asia/Almaty         (UTC+5):         17:00 Thu
  //   - Europe/Paris        (UTC+2 in DST):  14:00 Thu
  const NOON_UTC = new Date('2026-04-30T12:00:00Z')

  it('projects UTC noon into LA wall clock', () => {
    expect(wallClockInTz(NOON_UTC, 'America/Los_Angeles'))
      .toEqual({ dayKey: 'Thu', minutes: 5 * 60 })
  })

  it('projects UTC noon into Almaty wall clock', () => {
    expect(wallClockInTz(NOON_UTC, 'Asia/Almaty'))
      .toEqual({ dayKey: 'Thu', minutes: 17 * 60 })
  })

  it('projects UTC noon into Paris wall clock', () => {
    expect(wallClockInTz(NOON_UTC, 'Europe/Paris'))
      .toEqual({ dayKey: 'Thu', minutes: 14 * 60 })
  })

  it('weekday rolls forward when the projection crosses midnight', () => {
    // 23:30 UTC on a Thursday is already Friday in Almaty (UTC+5 → 04:30 Fri).
    const lateThu = new Date('2026-04-30T23:30:00Z')
    expect(wallClockInTz(lateThu, 'Asia/Almaty'))
      .toEqual({ dayKey: 'Fri', minutes: 4 * 60 + 30 })
  })

  it('weekday rolls backward when the projection crosses midnight the other way', () => {
    // 00:30 UTC on a Friday is still Thursday in LA (UTC-7 → 17:30 Thu).
    const earlyFri = new Date('2026-05-01T00:30:00Z')
    expect(wallClockInTz(earlyFri, 'America/Los_Angeles'))
      .toEqual({ dayKey: 'Thu', minutes: 17 * 60 + 30 })
  })

  it('falls back to local clock when tzid is missing', () => {
    const d = new Date('2026-04-30T12:00:00Z')
    const out = wallClockInTz(d, null)
    // We can't predict the test machine's tz, so we just sanity-check that
    // the shape is right and the values are in range.
    expect(typeof out.dayKey).toBe('string')
    expect(out.minutes >= 0 && out.minutes < 24 * 60).toBe(true)
  })

  it('accepts an ISO string as well as a Date', () => {
    const a = wallClockInTz(new Date('2026-04-30T12:00:00Z'), 'Europe/Paris')
    const b = wallClockInTz('2026-04-30T12:00:00Z',           'Europe/Paris')
    expect(a).toEqual(b)
  })
})

describe('browserTz', () => {
  it('returns a non-empty string', () => {
    const tz = browserTz()
    expect(typeof tz).toBe('string')
    expect(tz.length > 0).toBe(true)
  })
})

describe('zonedTimeToUtc', () => {
  it('anchors Houston 9 AM to Houston time, not the browser timezone', () => {
    expect(zonedTimeToUtc(2026, 5, 4, 9, 0, 'America/Chicago').toISOString())
      .toBe('2026-05-04T14:00:00.000Z')
  })

  it('anchors Mongolia 9 AM to Mongolia time, not the browser timezone', () => {
    expect(zonedTimeToUtc(2026, 5, 4, 9, 0, 'Asia/Ulaanbaatar').toISOString())
      .toBe('2026-05-04T01:00:00.000Z')
  })
})
