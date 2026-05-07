import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Moon, Sun, Users, Clock, AlertTriangle, SearchX, Check, ArrowRight, Sparkles } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { loadQuietHours, inQuietHours } from '../utils/quietHours'
import { coalesceRows, rankWindows } from '../utils/overlap'

/* ─────────────────────────────────────────────────────────────────
   OverlapPage — "When can I actually call my mom?"

   The original backend endpoint /availability/overlap only compares
   you with ONE arbitrary accepted connection (LIMIT 1), which made
   the page lie when the user has more than one family member.

   This page now does the right thing client-side:
     • fetches MY availability slots
     • fetches every accepted connection's availability slots
     • computes per-slot "who else is free"
     • renders slots grouped by day with the available family members'
       avatars on the right of each suggested call slot

   A "?with=<otherId>" query param pre-filters to one specific person,
   so the "See overlap" buttons on Dashboard / Family open exactly that
   person's overlap.
   ───────────────────────────────────────────────────────────────── */

const PALETTE = [
  { color: '#58a6ff', bg: 'rgba(88,166,255,.2)' },
  { color: '#3fb950', bg: 'rgba(63,185,80,.2)' },
  { color: '#bc8cff', bg: 'rgba(188,140,255,.2)' },
  { color: '#e3b341', bg: 'rgba(210,153,34,.2)' },
  { color: '#ff7b72', bg: 'rgba(255,123,114,.2)' },
  { color: '#39d0d8', bg: 'rgba(57,208,216,.2)' },
]

function fmtTime(d) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/* Same instant rendered in another time zone — used to show
   "06:00 mom's time" alongside our local 10:00. */
function fmtTimeInTz(d, tz) {
  if (!tz) return ''
  try {
    return d.toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', timeZone: tz, hour12: false,
    })
  } catch { return '' }
}

/* Short tz label e.g. "America/Los_Angeles" -> "Los Angeles" */
function tzShort(tz) {
  if (!tz) return ''
  const parts = tz.split('/')
  return (parts[parts.length - 1] || tz).replace(/_/g, ' ')
}

function fmtDay(s) {
  const d = new Date(s)
  const t = new Date()
  const tm = new Date(t); tm.setDate(t.getDate() + 1)
  if (d.toDateString() === t.toDateString()) return 'Today'
  if (d.toDateString() === tm.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
}

function localTime(tz) {
  if (!tz) return ''
  try {
    return new Date().toLocaleTimeString('en', {
      hour: '2-digit', minute: '2-digit', timeZone: tz, hour12: false,
    })
  } catch { return '' }
}

/* Coalesce / sameFreeSet helpers extracted to ../utils/overlap for testing. */

function avatarFor(name, idx) {
  const init = (name?.[0] || '?').toUpperCase()
  const p = PALETTE[idx % PALETTE.length]
  return { init, color: p.color, bg: p.bg }
}

export default function OverlapPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const filterWith = params.get('with') ? Number(params.get('with')) : null

  const [mine, setMine] = useState([])              // string[] iso
  const [connections, setConnections] = useState([]) // [{ other_id, other_name, ... }]
  const [theirs, setTheirs] = useState({})          // { otherId: Set<iso> }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hideQuiet, setHideQuiet] = useState(true)
  const quiet = useMemo(() => loadQuietHours(user?.id), [user?.id])

  // Mark "user has visited the overlap page" so the Dashboard onboarding
  // checklist can tick this step off, regardless of how they arrived here.
  useEffect(() => {
    if (user?.id) {
      try { localStorage.setItem(`tb_visited_overlap_${user.id}`, '1') } catch {}
    }
  }, [user?.id])

  // Initial load: my availability + accepted connections + each connection's availability.
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError('')
      try {
        const [m, c] = await Promise.all([
          api.getAvailability().catch(() => ({ slots: [] })),
          api.getConnections().catch(() => ({ connections: [] })),
        ])
        if (cancelled) return
        const mySlots = m.slots || []
        const accepted = (c.connections || []).filter(x => x.status === 'accepted')
        setMine(mySlots)
        setConnections(accepted)

        // Fetch each connection's slots in parallel.
        const results = await Promise.all(
          accepted.map(conn =>
            api.getConnectionAvailability(conn.other_id)
              .then(r => [conn.other_id, new Set(r.slots || [])])
              .catch(() => [conn.other_id, new Set()])
          )
        )
        if (cancelled) return
        const map = {}
        results.forEach(([id, set]) => { map[id] = set })
        setTheirs(map)
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Build the list of slots to show, with who's free at each.
  // mode: showAll = "any family member free" (default), or filtered to one connection.
  const rows = useMemo(() => {
    if (!mine.length) return []
    const rows = []
    for (const iso of mine) {
      const when = new Date(iso)
      // Hide times that fall in MY quiet hours (when toggle is on).
      if (hideQuiet && inQuietHours(when, quiet)) continue
      // Who else is free at this exact slot?
      const free = []
      for (const c of connections) {
        if (filterWith && c.other_id !== filterWith) continue
        if (theirs[c.other_id]?.has(iso)) free.push(c)
      }
      // Only show slots where at least one (filtered) family member is also free.
      if (free.length === 0) continue
      rows.push({ iso, when, free })
    }
    rows.sort((a, b) => a.when - b.when)
    return rows
  }, [mine, theirs, connections, filterWith, hideQuiet, quiet])

  // Coalesce contiguous rows with identical free-set into windows, then rank.
  const windows = useMemo(() => coalesceRows(rows), [rows])
  const ranked  = useMemo(
    // We pass MY quiet hours as the only quiet window for the ranking penalty.
    // (When privacy/preferences across users land in v1.1, this becomes a list.)
    () => rankWindows(windows, { now: new Date(), quietWindows: [quiet] }),
    [windows, quiet]
  )
  // The single best window — rendered with a "Best" badge in the list below.
  const bestStartIso = ranked[0]?.startIso

  // Group windows by day for the visual sectioning. We render in chronological
  // order (so days flow left-to-right in the user's mental model) but tag the
  // top-ranked window with rank info from `ranked`.
  const grouped = useMemo(() => {
    const rankByStart = new Map(ranked.map(w => [w.startIso, { rank: w.rank, score: w.score }]))
    const g = {}
    for (const w of windows) {
      const k = w.when.toDateString()
      if (!g[k]) g[k] = []
      g[k].push({ ...w, ...rankByStart.get(w.startIso) })
    }
    return g
  }, [windows, ranked])

  function pickFilter(otherId) {
    const next = new URLSearchParams(params)
    if (otherId) next.set('with', String(otherId))
    else next.delete('with')
    setParams(next, { replace: true })
  }

  // Pre-compute palette index per connection so the same person always has the
  // same color across the page (in chips and in row avatars).
  const idxFor = useMemo(() => {
    const m = {}
    connections.forEach((c, i) => { m[c.other_id] = i })
    return m
  }, [connections])

  if (loading) return (
    <div className="page-wrap fade-up overlap-page">
      <div className="page-header">
        <div>
          <div className="page-title">When can we talk?</div>
          <div className="page-subtitle">Loading your shared free time…</div>
        </div>
      </div>
      {/* Skeleton placeholders that hint at the eventual layout — feels less
          like "the app froze" than a spinner does. */}
      <div className="card mb20" style={{ padding: '12px 14px' }}>
        <span className="skeleton" style={{ width: 120, height: 10, marginBottom: 8 }} />
        <div className="row g8 wrap">
          <span className="skeleton" style={{ width: 80,  height: 26, borderRadius: 100 }} />
          <span className="skeleton" style={{ width: 110, height: 26, borderRadius: 100 }} />
          <span className="skeleton" style={{ width: 90,  height: 26, borderRadius: 100 }} />
        </div>
      </div>
      <div className="stack g8">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="ov-slot" style={{ padding: '14px 16px' }}>
            <span className="skeleton" style={{ width: 8, height: 8, borderRadius: '50%' }} />
            <div style={{ flex: 1, marginLeft: 12 }}>
              <span className="skeleton" style={{ width: '40%', height: 12, marginBottom: 6 }} />
              <span className="skeleton" style={{ width: '25%', height: 10 }} />
            </div>
            <span className="skeleton" style={{ width: 56, height: 28, borderRadius: '50%' }} />
          </div>
        ))}
      </div>
    </div>
  )

  const noConnections = connections.length === 0
  const filteredName = filterWith
    ? (connections.find(c => c.other_id === filterWith)?.other_name || `User #${filterWith}`)
    : null

  return (
    <div className="page-wrap fade-up overlap-page">
      <div className="page-header">
        <div>
          <div className="page-title">When can we talk?</div>
          <div className="page-subtitle">
            {filteredName
              ? `Times when both you and ${filteredName} are free`
              : `Times when you and your family are free at the same time`}
          </div>
        </div>
        <div className="header-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setHideQuiet(v => !v)}
            title={`Quiet hours: ${quiet.start} → ${quiet.end}`}
          >
            {hideQuiet
              ? <><Moon size={13} strokeWidth={2} aria-hidden="true" /> Quiet hours on</>
              : <><Sun  size={13} strokeWidth={2} aria-hidden="true" /> Quiet hours off</>}
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => navigate('/availability')}>
            Update my availability
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <AlertTriangle size={32} strokeWidth={1.5} aria-hidden="true" style={{ color: 'var(--red)', marginBottom: 10 }} />
          <p className="text-sm text-2 mb12">{error}</p>
        </div>
      )}

      {/* Filter chips: "Everyone" + one chip per family member */}
      {!noConnections && (
        <div className="card mb20" style={{ padding: '12px 14px' }}>
          <div className="text-xs text-2 mb8" style={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Show overlap with
          </div>
          <div className="row g8 wrap">
            <button
              className={`chip ${!filterWith ? 'chip-green' : ''}`}
              style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() => pickFilter(null)}
            >
              <Users size={13} strokeWidth={2} aria-hidden="true" />
              Everyone
            </button>
            {connections.map(c => {
              const a = avatarFor(c.other_name, idxFor[c.other_id])
              const sel = filterWith === c.other_id
              return (
                <button
                  key={c.id}
                  className={`chip ${sel ? 'chip-green' : ''}`}
                  style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  onClick={() => pickFilter(c.other_id)}
                >
                  <span
                    className="avatar"
                    style={{
                      width: 18, height: 18, fontSize: 10, fontWeight: 600,
                      background: a.bg, color: a.color, borderRadius: '50%',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >{a.init}</span>
                  {c.other_name || `User #${c.other_id}`}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {noConnections && (
        <div className="empty-state card">
          <div className="empty-icon"><Users size={40} strokeWidth={1.5} aria-hidden="true" /></div>
          <div className="empty-title">No family yet</div>
          <p className="text-sm text-2 mb20">Connect with someone to see when you're both free.</p>
          <button className="btn btn-primary" onClick={() => navigate('/family')}>
            Go to Family
            <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}

      {!noConnections && !mine.length && (
        <div className="empty-state card">
          <div className="empty-icon"><Clock size={40} strokeWidth={1.5} aria-hidden="true" /></div>
          <div className="empty-title">You haven't set your availability</div>
          <p className="text-sm text-2 mb20">Tell TimeBridge when you're free so we can find shared times.</p>
          <button className="btn btn-primary" onClick={() => navigate('/availability')}>Set my availability</button>
        </div>
      )}

      {!noConnections && mine.length > 0 && rows.length === 0 && (
        <div className="empty-state card">
          <div className="empty-icon"><SearchX size={40} strokeWidth={1.5} aria-hidden="true" /></div>
          <div className="empty-title">No overlapping times</div>
          <p className="text-sm text-2 mb20">
            {filteredName
              ? `${filteredName} hasn't set availability that overlaps with yours.`
              : `No family members have set availability that overlaps with yours yet.`}
          </p>
          <button className="btn btn-outline" onClick={() => navigate('/family')}>
            View family
            <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}

      {windows.length > 0 && (
        <>
          <div className="card mb20" style={{ background: 'rgba(63,185,80,.08)', border: '1px solid rgba(63,185,80,.25)' }}>
            <div className="row g12">
              <div style={{
                width: 44, height: 44, borderRadius: '50%', background: 'var(--accent2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                color: '#fff',
              }}>
                <Check size={22} strokeWidth={2.5} aria-hidden="true" />
              </div>
              <div>
                <div style={{ fontWeight: 500 }}>
                  {windows.length} shared window{windows.length !== 1 ? 's' : ''} found
                  <span className="text-sm text-2" style={{ marginLeft: 8 }}>
                    ({rows.length} hour{rows.length !== 1 ? 's' : ''} total)
                  </span>
                </div>
                <div className="text-sm text-2">
                  Across {Object.keys(grouped).length} day{Object.keys(grouped).length !== 1 ? 's' : ''}
                  {!filterWith && ` · ${connections.length} family member${connections.length !== 1 ? 's' : ''}`}
                </div>
              </div>
            </div>
          </div>

          <div className="stack g24">
            {Object.entries(grouped).map(([dayStr, slots]) => (
              <div key={dayStr}>
                <div className="section-label">{fmtDay(dayStr)}</div>
                <div className="stack g8">
                  {slots.map(w => {
                    const isWindow = w.hours > 1
                    const timeLabel = isWindow
                      ? `${fmtTime(w.when)} – ${fmtTime(w.endTime)}`
                      : fmtTime(w.when)
                    const subLabel = isWindow ? `${w.hours}-hour window` : '1 hour block'

                    // For each free family member, show what time the window is for them.
                    const tzLines = w.free
                      .filter(c => c.other_timezone)
                      .map(c => {
                        const start = fmtTimeInTz(w.when, c.other_timezone)
                        const end   = isWindow ? fmtTimeInTz(w.endTime, c.other_timezone) : null
                        const range = end ? `${start}–${end}` : start
                        const name = (c.other_name || `User #${c.other_id}`).split(' ')[0]
                        return `${range} ${name}'s time`
                      })

                    const isBest = w.startIso === bestStartIso
                    return (
                      <div
                        key={w.startIso}
                        className="ov-slot"
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px',
                          // Highlight the top-ranked window with a green border + faint glow.
                          ...(isBest ? {
                            borderColor: 'rgba(63,185,80,.5)',
                            boxShadow: '0 0 0 1px rgba(63,185,80,.25), 0 0 16px rgba(63,185,80,.1)',
                          } : {}),
                        }}
                      >
                        <div className="ov-dot" style={{ marginTop: 6 }}/>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="row g8" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 14, fontWeight: 500 }}>{timeLabel}</span>
                            <span className="text-xs text-2">your time · {subLabel}</span>
                            {isBest && (
                              <span
                                className="tag"
                                title={`Top-ranked window (score ${w.score})`}
                                style={{
                                  color: 'var(--accent)',
                                  borderColor: 'rgba(63,185,80,.4)',
                                  background: 'rgba(63,185,80,.08)',
                                }}
                              >
                                <Sparkles size={10} strokeWidth={2} aria-hidden="true" />
                                Best
                              </span>
                            )}
                          </div>
                          {tzLines.length > 0 && (
                            <div className="text-xs text-2" style={{ marginTop: 3, lineHeight: 1.5 }}>
                              {tzLines.join(' · ')}
                            </div>
                          )}
                        </div>

                        {/* Who's free — avatars on the right */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            {w.free.map((c, i) => {
                              const a = avatarFor(c.other_name, idxFor[c.other_id])
                              const tip = c.other_timezone
                                ? `${c.other_name || `User #${c.other_id}`} · currently ${localTime(c.other_timezone)} in ${tzShort(c.other_timezone)}`
                                : (c.other_name || `User #${c.other_id}`)
                              return (
                                <span
                                  key={c.other_id}
                                  title={tip}
                                  style={{
                                    width: 28, height: 28, borderRadius: '50%',
                                    background: a.bg, color: a.color,
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    fontWeight: 600, fontSize: 12,
                                    border: '2px solid var(--surface)',
                                    marginLeft: i === 0 ? 0 : -6,
                                  }}
                                >{a.init}</span>
                              )
                            })}
                          </div>
                          <span className="text-xs text-2" style={{ minWidth: 50 }}>
                            {w.free.length} free
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
