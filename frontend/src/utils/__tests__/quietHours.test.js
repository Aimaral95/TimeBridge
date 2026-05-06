import { describe, it, expect, beforeEach } from 'vitest'
import {
  inQuietHours,
  loadQuietHours,
  saveQuietHours,
  DEFAULT_QUIET,
} from '../quietHours.js'

/* `inQuietHours` is the trickiest function in the project because the window
   can wrap past midnight (e.g. start=22:00, end=08:00). These tests pin down
   that behaviour so a regression is caught immediately. */

function at(h, m = 0) {
  const d = new Date('2026-04-30T00:00:00')
  d.setHours(h, m, 0, 0)
  return d
}

describe('inQuietHours — wrapping window (22:00 → 08:00)', () => {
  const qh = { start: '22:00', end: '08:00' }

  it('late evening (23:30) is quiet', () => {
    expect(inQuietHours(at(23, 30), qh)).toBe(true)
  })
  it('past midnight (02:00) is quiet', () => {
    expect(inQuietHours(at(2), qh)).toBe(true)
  })
  it('early morning (07:59) is quiet', () => {
    expect(inQuietHours(at(7, 59), qh)).toBe(true)
  })
  it('exactly at end (08:00) is NOT quiet', () => {
    expect(inQuietHours(at(8), qh)).toBe(false)
  })
  it('exactly at start (22:00) IS quiet', () => {
    expect(inQuietHours(at(22), qh)).toBe(true)
  })
  it('noon (12:00) is NOT quiet', () => {
    expect(inQuietHours(at(12), qh)).toBe(false)
  })
})

describe('inQuietHours — same-day window (09:00 → 17:00)', () => {
  const qh = { start: '09:00', end: '17:00' }

  it('inside window (12:30) is quiet', () => {
    expect(inQuietHours(at(12, 30), qh)).toBe(true)
  })
  it('before window (08:00) is NOT quiet', () => {
    expect(inQuietHours(at(8), qh)).toBe(false)
  })
  it('after window (17:30) is NOT quiet', () => {
    expect(inQuietHours(at(17, 30), qh)).toBe(false)
  })
})

describe('inQuietHours — disabled (start == end)', () => {
  it('returns false for any time when window is empty', () => {
    const qh = { start: '00:00', end: '00:00' }
    expect(inQuietHours(at(3), qh)).toBe(false)
    expect(inQuietHours(at(15), qh)).toBe(false)
  })
})

describe('loadQuietHours / saveQuietHours', () => {
  // Provide a tiny in-memory localStorage shim so tests don't need jsdom.
  beforeEach(() => {
    const store = new Map()
    globalThis.localStorage = {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
      clear: () => store.clear(),
    }
  })

  it('returns DEFAULT_QUIET when nothing is saved', () => {
    expect(loadQuietHours(42)).toEqual(DEFAULT_QUIET)
  })

  it('round-trips a saved value', () => {
    saveQuietHours(42, { start: '23:30', end: '06:30' })
    expect(loadQuietHours(42)).toEqual({ start: '23:30', end: '06:30' })
  })

  it('keeps separate values per user', () => {
    saveQuietHours(1, { start: '21:00', end: '07:00' })
    saveQuietHours(2, { start: '22:30', end: '08:30' })
    expect(loadQuietHours(1)).toEqual({ start: '21:00', end: '07:00' })
    expect(loadQuietHours(2)).toEqual({ start: '22:30', end: '08:30' })
  })

  it('returns DEFAULT_QUIET when no userId is provided', () => {
    expect(loadQuietHours(null)).toEqual(DEFAULT_QUIET)
    expect(loadQuietHours(undefined)).toEqual(DEFAULT_QUIET)
  })
})
