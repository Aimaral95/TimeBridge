import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import { api } from '../api/client'
import { useToast } from '../context/ToastContext'
import { useSchedule } from '../context/ScheduleContext'
import { useAuth } from '../context/AuthContext'
import { Tooltip } from '../components/Tooltip'
import { loadQuietHours } from '../utils/quietHours'
import { connectionAvailableAt } from '../utils/overlap'
import { datePartsInTz, wallClockInTz, weekStartDatesInTz, zonedTimeToUtc } from '../utils/tz'

const HOURS = Array.from({ length: 24 }, (_, i) => i)            // 12am – 11pm

function getWeekDates(offset = 0, tzid) {
  return weekStartDatesInTz(offset, tzid)
}

function slotKey(date, hour, tzid) {
  const p = datePartsInTz(date, tzid)
  return zonedTimeToUtc(p.year, p.month, p.day, hour, 0, tzid).toISOString()
}
function fmtHour(h) {
  if (h === 0) return '12 AM'
  if (h === 12) return '12 PM'
  return h > 12 ? `${h - 12} PM` : `${h} AM`
}
function isToday(d, tzid) {
  const a = datePartsInTz(d, tzid)
  const b = datePartsInTz(new Date(), tzid)
  return a.year === b.year && a.month === b.month && a.day === b.day
}

/* HH:MM → minutes since midnight */
function toMin(hhmm) {
  if (!hhmm) return 0
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

/* Does any schedule block cover (date, hour)?  */
function inScheduleBlock(date, hour, blocks, userTz) {
  if (!blocks?.length) return false
  const p = datePartsInTz(date, userTz)
  const instant = zonedTimeToUtc(p.year, p.month, p.day, hour, 0, userTz)
  return blocks.some(b => {
    if (!Array.isArray(b.days)) return false
    const { dayKey, minutes } = wallClockInTz(instant, b.tzid || userTz)
    return b.days.includes(dayKey) &&
      toMin(b.start_time) <= minutes &&
      minutes < toMin(b.end_time)
  })
}

function inQuietHoursInTz(iso, qh, tzid) {
  if (!qh) return false
  const { minutes } = wallClockInTz(iso, tzid)
  const s = toMin(qh.start)
  const e = toMin(qh.end)
  if (s === e) return false
  if (s < e) return minutes >= s && minutes < e
  return minutes >= s || minutes < e
}

export default function AvailabilityPage() {
  const toast = useToast()
  const { user } = useAuth()
  const { blocks, loading: scheduleLoading } = useSchedule()
  const userTz = user?.timezone || 'UTC'
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState(new Set())     // my free slots
  const selectedRef = useRef(selected)
  const [saving, setSaving] = useState(false)
  const [loadingMine, setLoadingMine] = useState(true)
  const [seeded, setSeeded] = useState(false)             // have we auto-seeded yet?

  // Connection compare state
  const [connections, setConnections] = useState([])
  const [activeConnId, setActiveConnId] = useState(null)  // the OTHER user's id
  const [theirSlots, setTheirSlots] = useState(new Set())
  const [loadingTheirs, setLoadingTheirs] = useState(false)

  const dragging = useRef(false)
  const dragMode = useRef(null)
  const autoDerivedKey = useRef('')

  function replaceSelected(next) {
    selectedRef.current = next
    setSelected(next)
  }

  function updateSelected(fn) {
    replaceSelected(fn(selectedRef.current))
  }

  function buildScheduleSelection(base = selectedRef.current) {
    const visible = new Set(weekDates.flatMap(d => HOURS.map(h => slotKey(d, h, userTz))))
    const next = new Set([...base].filter(k => !visible.has(k)))
    weekDates.forEach(d => HOURS.forEach(h => {
      const k = slotKey(d, h, userTz)
      if (!scheduleBusy.has(k) && !quietBusy.has(k)) next.add(k)
    }))
    return next
  }

  function sameSet(a, b) {
    if (a.size !== b.size) return false
    for (const x of a) if (!b.has(x)) return false
    return true
  }

  const weekDates = useMemo(() => getWeekDates(offset, userTz), [offset, userTz])
  const quiet = useMemo(() => user?.quiet_hours || loadQuietHours(user?.id), [user?.id, user?.quiet_hours])

  const quietBusy = useMemo(() => {
    const s = new Set()
    weekDates.forEach(d => HOURS.forEach(h => {
      const key = slotKey(d, h, userTz)
      if (inQuietHoursInTz(key, quiet, userTz)) s.add(key)
    }))
    return s
  }, [quiet, userTz, weekDates])

  // Map of {slotKey -> true} for everything in the visible week that the
  // user's schedule says is busy. Re-computed when blocks/week change.
  const scheduleBusy = useMemo(() => {
    const s = new Set()
    weekDates.forEach(d => HOURS.forEach(h => {
      const key = slotKey(d, h, userTz)
      if (inScheduleBlock(d, h, blocks, userTz)) s.add(key)
    }))
    return s
  }, [blocks, userTz, weekDates])

  // Load my saved availability + my connections on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [mine, conns] = await Promise.all([
          api.getAvailability().catch(() => ({ slots: [] })),
          api.getConnections().catch(() => ({ connections: [] })),
        ])
        if (cancelled) return
        const savedSlots = mine.slots || []
        if (savedSlots.length > 0) {
          replaceSelected(new Set(savedSlots))
          setSeeded(true) // user has made choices before, don't override
        }
        const accepted = (conns.connections || []).filter(c => c.status === 'accepted')
        setConnections(accepted)
      } finally {
        if (!cancelled) setLoadingMine(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // First-time auto-seed: if the user has NO saved availability yet, fill in
  // every non-busy waking hour for the visible week as "free". This is the
  // "availability auto-derived from schedule" behavior — happens once.
  useEffect(() => {
    if (loadingMine || seeded) return
    const seed = new Set()
    weekDates.forEach(d => HOURS.forEach(h => {
      const k = slotKey(d, h, userTz)
      if (!scheduleBusy.has(k) && !quietBusy.has(k)) seed.add(k)
    }))
    replaceSelected(seed)
    setSeeded(true)
  }, [loadingMine, quietBusy, scheduleBusy, seeded, userTz, weekDates])

  // Whenever the schedule changes after seeding, prune any slot that's now
  // covered by a schedule block or quiet hours from `selected`.
  useEffect(() => {
    if (!seeded) return
    updateSelected(prev => {
      let changed = false
      const next = new Set(prev)
      scheduleBusy.forEach(k => { if (next.has(k)) { next.delete(k); changed = true } })
      quietBusy.forEach(k => { if (next.has(k)) { next.delete(k); changed = true } })
      return changed ? next : prev
    })
  }, [quietBusy, scheduleBusy, seeded])

  // Keep the visible week schedule-derived on page load/refresh. Older saved
  // availability was created with browser-local timezone logic, so simply
  // loading those rows can make the page snap back to stale green cells.
  useEffect(() => {
    if (loadingMine || scheduleLoading || !seeded) return
    const key = [
      user?.id || 'anon',
      userTz,
      offset,
      blocks.map(b => `${b.id}:${b.days?.join(',')}:${b.start_time}-${b.end_time}:${b.tzid || userTz}`).join('|'),
      quiet.start,
      quiet.end,
    ].join('::')
    if (autoDerivedKey.current === key) return
    autoDerivedKey.current = key

    const next = buildScheduleSelection(selectedRef.current)
    if (sameSet(next, selectedRef.current)) return

    replaceSelected(next)
    const cleanSlots = Array.from(next).filter(k => !quietBusy.has(k))
    api.saveAvailability(cleanSlots)
      .then(() => replaceSelected(new Set(cleanSlots)))
      .catch(e => toast('Could not auto-save availability', e.message))
  }, [blocks, loadingMine, offset, quiet, quietBusy, scheduleLoading, seeded, user?.id, userTz])

  // Load the selected connection's slots whenever the chip changes.
  useEffect(() => {
    if (!activeConnId) { setTheirSlots(new Set()); return }
    let cancelled = false
    setLoadingTheirs(true)
    api.getConnectionAvailability(activeConnId)
      .then(d => { if (!cancelled) setTheirSlots(new Set(d.slots || [])) })
      .catch(e => { if (!cancelled) toast('Could not load their availability', e.message) })
      .finally(() => { if (!cancelled) setLoadingTheirs(false) })
    return () => { cancelled = true }
  }, [activeConnId])

  /* ── slot interactions: click & drag toggles selected ──────── */
  function startDrag(key) {
    if (quietBusy.has(key)) return
    dragging.current = true
    dragMode.current = selectedRef.current.has(key) ? 'remove' : 'add'
    updateSelected(p => { const n = new Set(p); dragMode.current==='remove'?n.delete(key):n.add(key); return n })
  }
  function dragOver(key) {
    if (!dragging.current) return
    if (quietBusy.has(key)) return
    updateSelected(p => { const n = new Set(p); dragMode.current==='remove'?n.delete(key):n.add(key); return n })
  }
  function stopDrag() { dragging.current = false }

  function toggleDay(date) {
    const keys = HOURS.map(h => slotKey(date, h, userTz))
    const all = keys.every(k => selectedRef.current.has(k))
    updateSelected(p => {
      const n = new Set(p)
      all ? keys.forEach(k=>n.delete(k)) : keys.forEach(k=>{ if (!quietBusy.has(k)) n.add(k) })
      return n
    })
  }
  function toggleHour(hour) {
    const keys = weekDates.map(d => slotKey(d, hour, userTz))
    const all = keys.every(k => selectedRef.current.has(k))
    updateSelected(p => {
      const n = new Set(p)
      all ? keys.forEach(k=>n.delete(k)) : keys.forEach(k=>{ if (!quietBusy.has(k)) n.add(k) })
      return n
    })
  }
  function clearWeek() {
    const keys = weekDates.flatMap(d => HOURS.map(h => slotKey(d, h, userTz)))
    updateSelected(p => { const n = new Set(p); keys.forEach(k=>n.delete(k)); return n })
  }
  async function resetToSchedule() {
    const next = buildScheduleSelection()
    replaceSelected(next)
    setSaving(true)
    try {
      const cleanSlots = Array.from(next).filter(k => !quietBusy.has(k))
      await api.saveAvailability(cleanSlots)
      replaceSelected(new Set(cleanSlots))
      toast('Reset and saved', `${cleanSlots.length} free slot(s) saved from your schedule`)
    } catch (e) {
      toast('Reset locally', `Could not save yet: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function save() {
    setSaving(true)
    try {
      const cleanSlots = Array.from(selectedRef.current).filter(k => !quietBusy.has(k))
      await api.saveAvailability(cleanSlots)
      replaceSelected(new Set(cleanSlots))
      toast('Saved', `${cleanSlots.length} free slot(s) saved`)
    } catch (e) { toast('Error', e.message) }
    finally { setSaving(false) }
  }

  const weekCount = useMemo(
    () => weekDates.flatMap(d => HOURS.map(h => slotKey(d, h, userTz))).filter(k => selected.has(k)).length,
    [weekDates, selected, userTz]
  )

  const activeConn = connections.find(c => c.other_id === activeConnId)
  function connectionFreeAt(iso) {
    if (!activeConnId) return false
    return connectionAvailableAt(iso, theirSlots, activeConn, { hideQuiet: true })
  }

  const overlapCount = useMemo(() => {
    if (!activeConnId) return 0
    let n = 0
    selected.forEach(k => { if (connectionFreeAt(k)) n++ })
    return n
  }, [activeConn, activeConnId, selected, theirSlots])

  return (
    <div style={{ maxWidth:960, margin:'0 auto' }} className="page-wrap fade-up availability-page">
      <div className="page-header">
        <div>
          <div className="page-title">Availability</div>
          <div className="page-subtitle">
            Auto-derived from your schedule. Click any cell to override.
            {blocks.length > 0 && ` · ${blocks.length} schedule block(s) applied`}
          </div>
        </div>
      </div>

      {/* Connection compare picker */}
      <div className="card mb16" style={{ padding:'12px 16px' }}>
        <div className="row sb mb8 wrap g8">
          <span className="section-label" style={{ marginBottom:0 }}>Compare with</span>
          {activeConn && (
            <span className="text-xs text-2">
              {loadingTheirs
                ? 'Loading their slots…'
                : `${theirSlots.size} of their slots · ${overlapCount} overlap with yours`}
            </span>
          )}
        </div>
        <div className="row g8 wrap">
          <div
            className={`chip ${!activeConnId ? 'chip-green' : ''}`}
            onClick={() => setActiveConnId(null)}
          >
            None (just my schedule)
          </div>
          {connections.length === 0 && (
            <span className="text-xs text-2">
              No accepted connections yet. Add one from the Family page to compare schedules.
            </span>
          )}
          {connections.map(c => (
            <div
              key={c.id}
              className={`chip ${activeConnId === c.other_id ? 'chip-blue' : ''}`}
              onClick={() => setActiveConnId(c.other_id)}
              title={c.other_email || ''}
            >
              {c.other_name || `User #${c.other_id}`}
            </div>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="row sb wrap g8" style={{
        background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--r2)',
        padding:'10px 16px', marginBottom:16, position:'sticky', top:0, zIndex:10, boxShadow:'var(--shadow-sm)',
      }}>
        <div className="row g8 wrap">
          <Tooltip label="Previous week" side="top">
            <button className="btn btn-ghost btn-sm" onClick={() => setOffset(o=>o-1)} aria-label="Previous week">
              <ChevronLeft size={14} strokeWidth={2.5} aria-hidden="true" />
            </button>
          </Tooltip>
          <span className="text-sm fw5">
            {weekDates[0].toLocaleDateString([], { month:'short', day:'numeric', timeZone: userTz })} –{' '}
            {weekDates[6].toLocaleDateString([], { month:'short', day:'numeric', year:'numeric', timeZone: userTz })}
          </span>
          <Tooltip label="Next week" side="top">
            <button className="btn btn-ghost btn-sm" onClick={() => setOffset(o=>o+1)} aria-label="Next week">
              <ChevronRight size={14} strokeWidth={2.5} aria-hidden="true" />
            </button>
          </Tooltip>
          <button className="btn btn-ghost btn-sm" style={{ fontSize:11 }} onClick={() => setOffset(0)}>Today</button>
        </div>
        <div className="row g8 wrap">
          <span className="text-xs text-2">{weekCount} free this week · {selected.size} total</span>
          <button className="btn btn-ghost btn-sm" style={{ fontSize:11 }} onClick={resetToSchedule} disabled={saving}>
            <RotateCcw size={12} strokeWidth={2} aria-hidden="true" />
            Reset and save
          </button>
          <button className="btn btn-ghost btn-sm" style={{ fontSize:11 }} onClick={clearWeek}>Clear week</button>
          <button className="btn btn-primary btn-sm" disabled={saving} onClick={save}>
            {saving && <span className="spinner"/>} Save
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="row g16 mb12 wrap">
        <div className="row g6 text-xs text-2">
          <div style={{ width:14,height:14,borderRadius:3,background:'rgba(63,185,80,.25)', border:'1px solid rgba(63,185,80,.6)' }}/>
          You're free
        </div>
        <div className="row g6 text-xs text-2">
          <div style={{ width:14,height:14,borderRadius:3,background:'rgba(255,123,114,.20)', border:'1px solid rgba(255,123,114,.5)' }}/>
          Busy (from schedule)
        </div>
        <div className="row g6 text-xs text-2">
          <div style={{ width:14,height:14,borderRadius:3,background:'var(--surface)', border:'1px solid var(--border)' }}/>
          Busy (manual)
        </div>
        {activeConn && (
          <>
            <div className="row g6 text-xs text-2">
              <div style={{ width:14,height:14,borderRadius:3,background:'rgba(88,166,255,.25)', border:'1px dashed rgba(88,166,255,.7)' }}/>
              {activeConn.other_name || 'They'} free
            </div>
            <div className="row g6 text-xs text-2">
              <div style={{ width:14,height:14,borderRadius:3,background:'rgba(63,185,80,.6)', border:'1.5px solid #fff' }}/>
              Both free (overlap)
            </div>
          </>
        )}
      </div>

      {/* Calendar */}
      <div className="grid-scroll">
        <div
          className="cal-grid"
          onMouseUp={stopDrag}
          onMouseLeave={stopDrag}
          style={{ userSelect:'none' }}
        >
          {/* Corner */}
          <div style={{ background:'var(--surface2)' }}/>
          {/* Day headers */}
          {weekDates.map((date, i) => (
            <div key={i} className="cal-head" onClick={() => toggleDay(date)}>
              <div className="text-xs text-2" style={{ textTransform:'uppercase', letterSpacing:'.05em', marginBottom:3 }}>
                {wallClockInTz(date, userTz).dayKey}
              </div>
              <div className={`cal-day-num ${isToday(date, userTz)?'cal-today':''}`}>
                {datePartsInTz(date, userTz).day}
              </div>
            </div>
          ))}

          {/* Hour rows */}
          {HOURS.map(hour => (
            <>
              <div key={`t${hour}`} className="cal-hr" onClick={() => toggleHour(hour)}>
                {fmtHour(hour)}
              </div>
              {weekDates.map((date, di) => {
                const key = slotKey(date, hour, userTz)
                const mine     = selected.has(key)
                const quietSlot = quietBusy.has(key)
                const sched    = scheduleBusy.has(key) || quietSlot
                const theirs   = connectionFreeAt(key)
                const both     = mine && theirs

                // Slot styling layers — `both` wins, then `theirs`, then mine, then schedule-busy.
                const cls = [
                  'cal-slot',
                  mine && !theirs ? 'free' : '',
                  theirs && !mine ? 'theirs' : '',
                  both ? 'both' : '',
                  !mine && sched ? 'sched-busy' : '',
                ].filter(Boolean).join(' ')

                return (
                  <div
                    key={`${hour}-${di}`}
                    className={cls}
                    title={quietSlot ? 'Quiet hours' : (sched && !mine ? 'Busy from schedule (click to override)' : undefined)}
                    onMouseDown={() => startDrag(key)}
                    onMouseEnter={() => dragOver(key)}
                  />
                )
              })}
            </>
          ))}
        </div>
      </div>

      <p className="text-xs text-2 mt12 calendar-help">
        Click a day name or hour to toggle the whole row/column · drag across cells to select multiple ·
        red cells = busy from your schedule or quiet hours
      </p>

      {loadingMine && (
        <p className="text-xs text-2 mt8" style={{ textAlign:'center' }}>Loading your saved availability…</p>
      )}
    </div>
  )
}
