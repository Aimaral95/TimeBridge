import { describe, it, expect } from 'vitest'
import {
  buildOverlapRows, coalesceRows, connectionAvailableAt, sameFreeSet, scoreWindow, rankWindows, HOUR_MS,
} from '../overlap.js'

const base = new Date('2026-04-30T09:00:00Z')
const mom = { other_id: 1, other_name: 'Mom' }
const dad = { other_id: 2, other_name: 'Dad' }
const sis = { other_id: 3, other_name: 'Sis' }

function row(hourOffset, free) {
  const when = new Date(base.getTime() + hourOffset * HOUR_MS)
  return { iso: when.toISOString(), when, free }
}

describe('sameFreeSet', () => {
  it('returns true for identical sets', () => {
    expect(sameFreeSet([mom, dad], [mom, dad])).toBe(true)
  })
  it('returns true regardless of order', () => {
    expect(sameFreeSet([mom, dad], [dad, mom])).toBe(true)
  })
  it('returns false when sizes differ', () => {
    expect(sameFreeSet([mom], [mom, dad])).toBe(false)
  })
  it('returns false when members differ', () => {
    expect(sameFreeSet([mom, dad], [mom, sis])).toBe(false)
  })
  it('handles empty sets', () => {
    expect(sameFreeSet([], [])).toBe(true)
    expect(sameFreeSet([], [mom])).toBe(false)
  })
})

describe('availability filtering', () => {
  it('filters a connection slot that falls inside that connection quiet hours', () => {
    const iso = '2026-05-08T01:00:00.000Z' // 08:00 in Asia/Hovd
    const jane = {
      other_id: 6,
      other_name: 'Jane',
      other_timezone: 'Asia/Hovd',
      other_quiet_hours: { start: '08:00', end: '09:00' },
    }
    expect(connectionAvailableAt(iso, new Set([iso]), jane)).toBe(false)
  })

  it('buildOverlapRows uses the same quiet-hour filter for both pages', () => {
    const visible = '2026-05-08T01:00:00.000Z' // 20:00 previous day in Chicago, 08:00 in Hovd
    const hidden = '2026-05-08T02:00:00.000Z'  // 09:00 in Hovd, quiet for Aimaral below
    const jane = {
      other_id: 6,
      other_name: 'Jane',
      other_timezone: 'Asia/Hovd',
      other_quiet_hours: { start: '22:00', end: '08:00' },
    }
    const out = buildOverlapRows({
      mine: [visible, hidden],
      connections: [jane],
      theirs: { 6: new Set([visible, hidden]) },
      quiet: { start: '21:00', end: '10:00' },
      userTz: 'America/Chicago',
    })
    expect(out.map(r => r.iso)).toEqual([visible])
  })
})

describe('coalesceRows', () => {
  it('returns empty array for empty input', () => {
    expect(coalesceRows([])).toEqual([])
  })

  it('three contiguous rows with same free-set → one 3-hour window', () => {
    const out = coalesceRows([row(0, [mom]), row(1, [mom]), row(2, [mom])])
    expect(out).toHaveLength(1)
    expect(out[0].hours).toBe(3)
    expect(out[0].when.toISOString()).toBe('2026-04-30T09:00:00.000Z')
    expect(out[0].endTime.toISOString()).toBe('2026-04-30T12:00:00.000Z')
  })

  it('a gap splits into two windows', () => {
    const out = coalesceRows([row(0, [mom]), row(1, [mom]), row(4, [mom])])
    expect(out).toHaveLength(2)
    expect(out[0].hours).toBe(2)
    expect(out[1].hours).toBe(1)
  })

  it('change in free-set splits the window', () => {
    const out = coalesceRows([
      row(0, [mom]),
      row(1, [mom, dad]),
      row(2, [mom, dad]),
    ])
    expect(out).toHaveLength(2)
    expect(out[0].hours).toBe(1)
    expect(out[0].free).toEqual([mom])
    expect(out[1].hours).toBe(2)
    expect(out[1].free).toEqual([mom, dad])
  })

  it('single isolated row → one 1-hour window', () => {
    const out = coalesceRows([row(0, [mom])])
    expect(out).toHaveLength(1)
    expect(out[0].hours).toBe(1)
    expect(out[0].startIso).toBe(out[0].lastIso)
  })

  it('does not mutate the input rows', () => {
    const rows = [row(0, [mom]), row(1, [mom])]
    const before = JSON.stringify(rows.map(r => r.iso))
    coalesceRows(rows)
    const after = JSON.stringify(rows.map(r => r.iso))
    expect(after).toBe(before)
  })

  it('handles many contiguous rows correctly (24h marathon)', () => {
    const rows = []
    for (let i = 0; i < 24; i++) rows.push(row(i, [mom]))
    const out = coalesceRows(rows)
    expect(out).toHaveLength(1)
    expect(out[0].hours).toBe(24)
  })
})

/* ── Ranking ─────────────────────────────────────────────────────── */

/* Reference "now" set BEFORE the test windows (which start at `base` in
   April 2026), so the windows are in the future relative to NOW and the
   past-start penalty in scoreWindow() does NOT fire by default. The one
   test that exercises the past-start penalty supplies its own `now`. */
const REF_NOW = new Date('2020-01-01T00:00:00Z')

function win(hourOffset, hours, free) {
  const when = new Date(base.getTime() + hourOffset * HOUR_MS)
  return {
    startIso: when.toISOString(),
    lastIso: when.toISOString(),
    when,
    endTime: new Date(when.getTime() + hours * HOUR_MS),
    free,
    hours,
  }
}

describe('scoreWindow', () => {
  it('zero people free → zero score', () => {
    expect(scoreWindow(win(0, 1, []), { now: REF_NOW })).toBe(0)
  })

  it('1 person, 1 hour → score 1', () => {
    expect(scoreWindow(win(0, 1, [mom]), { now: REF_NOW })).toBe(1)
  })

  it('doubling people roughly doubles the score', () => {
    const a = scoreWindow(win(0, 1, [mom]),       { now: REF_NOW })
    const b = scoreWindow(win(0, 1, [mom, dad]),  { now: REF_NOW })
    expect(b).toBe(a * 2)
  })

  it('a longer window scores higher but with diminishing returns', () => {
    const oneHour  = scoreWindow(win(0, 1, [mom]), { now: REF_NOW })
    const fourHour = scoreWindow(win(0, 4, [mom]), { now: REF_NOW })
    const eightHr  = scoreWindow(win(0, 8, [mom]), { now: REF_NOW })
    // 4-hour beats 1-hour
    expect(fourHour > oneHour).toBe(true)
    // but 8-hour doesn't beat 4-hour by as much as 4-hour beat 1-hour
    expect(eightHr - fourHour < fourHour - oneHour).toBe(true)
  })

  it('quiet-hours intrusion downweights the score by ~40%', () => {
    // Window that touches 22:00 local → penalised when mom's quiet starts at 22.
    const w = win(0, 1, [mom])
    w.when = new Date('2099-01-01T22:00:00')      // local 22:00
    w.endTime = new Date(w.when.getTime() + HOUR_MS)
    const clean   = scoreWindow(w, { now: REF_NOW, quietWindows: [] })
    const penalty = scoreWindow(w, {
      now: REF_NOW,
      quietWindows: [{ start: '22:00', end: '08:00' }],
    })
    // 0.6 * clean = penalty (allow a tiny rounding tolerance)
    expect(Math.abs(penalty - clean * 0.6) < 0.01).toBe(true)
  })

  it('quiet-hours penalty can evaluate in an explicit timezone', () => {
    const w = win(0, 1, [mom])
    w.when = new Date('2026-05-04T01:00:00.000Z') // 09:00 in Ulaanbaatar
    w.endTime = new Date(w.when.getTime() + HOUR_MS)
    const clean = scoreWindow(w, { now: REF_NOW, quietWindows: [] })
    const penalty = scoreWindow(w, {
      now: REF_NOW,
      quietWindows: [{ start: '09:00', end: '10:00', tzid: 'Asia/Ulaanbaatar' }],
    })
    expect(Math.abs(penalty - clean * 0.6) < 0.01).toBe(true)
  })

  it('past-start gets a small penalty', () => {
    const past   = win(0, 1, [mom])
    const future = win(0, 1, [mom])
    past.when   = new Date('2099-01-01T00:00:00Z')   // before NOW below
    future.when = new Date('2099-12-31T00:00:00Z')   // after NOW
    const NOW = new Date('2099-06-01T00:00:00Z')
    expect(scoreWindow(past,   { now: NOW })).toBe(0.8)
    expect(scoreWindow(future, { now: NOW })).toBe(1)
  })
})

describe('rankWindows', () => {
  it('sorts highest score first and assigns 1-indexed rank', () => {
    const small = win(0, 1, [mom])
    const big   = win(2, 4, [mom, dad, sis])      // more people, longer
    const out   = rankWindows([small, big], { now: REF_NOW })
    expect(out[0]).toMatchObject({ rank: 1, hours: 4 })
    expect(out[1]).toMatchObject({ rank: 2, hours: 1 })
    expect(out[0].score > out[1].score).toBe(true)
  })

  it('ties preserve chronological order (stable sort)', () => {
    const a = win(0, 1, [mom])
    const b = win(2, 1, [mom])
    const out = rankWindows([a, b], { now: REF_NOW })
    expect(out[0].when.getTime()).toBe(a.when.getTime())
    expect(out[1].when.getTime()).toBe(b.when.getTime())
  })

  it('does not mutate the input windows', () => {
    const a = win(0, 1, [mom])
    const out = rankWindows([a], { now: REF_NOW })
    expect('rank'  in a).toBe(false)
    expect('score' in a).toBe(false)
    expect(out[0].rank).toBe(1)
  })

  it('empty input → empty output', () => {
    expect(rankWindows([], { now: REF_NOW })).toEqual([])
  })
})
