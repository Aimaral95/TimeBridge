import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import { api } from '../api/client'
import { useToast } from '../context/ToastContext'
import { useSchedule } from '../context/ScheduleContext'
import { Tooltip } from '../components/Tooltip'

const HOURS = Array.from({ length: 17 }, (_, i) => i + 7)        // 7am – 11pm
const DAYS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function getWeekDates(offset = 0) {
  const now = new Date()
  const start = new Date(now)
  start.setDate(now.getDate() - now.getDay() + offset * 7)
  start.setHours(0,0,0,0)
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate()+i); return d })
}

function slotKey(date, hour) {
  const d = new Date(date); d.setHours(hour, 0, 0, 0); return d.toISOString()
}
function fmtHour(h) {
  if (h===12) return '12 PM'; return h>12 ? `${h-12} PM` : `${h} AM`
}
function isToday(d) { return d.toDateString() === new Date().toDateString() }

/* HH:MM → minutes since midnight */
function toMin(hhmm) {
  if (!hhmm) return 0
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

/* Does any schedule block cover (date, hour)?  */
function inScheduleBlock(date, hour, blocks) {
  if (!blocks?.length) return false
  const dayKey = DAYS[date.getDay()]
  const mins = hour * 60
  return blocks.some(b =>
    Array.isArray(b.days) &&
    b.days.includes(dayKey) &&
    toMin(b.start_time) <= mins &&
    mins < toMin(b.end_time)
  )
}

export default function AvailabilityPage() {
  const toast = useToast()
  const { blocks } = useSchedule()
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState(new Set())     // my free slots
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

  const weekDates = getWeekDates(offset)

  // Map of {slotKey -> true} for everything in the visible week that the
  // user's schedule says is busy. Re-computed when blocks/week change.
  const scheduleBusy = useMemo(() => {
    const s = new Set()
    weekDates.forEach(d => HOURS.forEach(h => {
      if (inScheduleBlock(d, h, blocks)) s.add(slotKey(d, h))
    }))
    return s
  }, [blocks, offset]) // weekDates depends on offset

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
          setSelected(new Set(savedSlots))
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
      const k = slotKey(d, h)
      if (!scheduleBusy.has(k)) seed.add(k)
    }))
    setSelected(seed)
    setSeeded(true)
  }, [loadingMine, seeded, scheduleBusy])

  // Whenever the schedule changes after seeding, prune any slot that's now
  // covered by a schedule block from `selected`. The user can still click
  // to manually mark "I'm actually free during this block" if they want.
  useEffect(() => {
    if (!seeded) return
    setSelected(prev => {
      let changed = false
      const next = new Set(prev)
      scheduleBusy.forEach(k => { if (next.has(k)) { next.delete(k); changed = true } })
      return changed ? next : prev
    })
  }, [scheduleBusy, seeded])

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
    dragging.current = true
    dragMode.current = selected.has(key) ? 'remove' : 'add'
    setSelected(p => { const n = new Set(p); dragMode.current==='remove'?n.delete(key):n.add(key); return n })
  }
  function dragOver(key) {
    if (!dragging.current) return
    setSelected(p => { const n = new Set(p); dragMode.current==='remove'?n.delete(key):n.add(key); return n })
  }
  function stopDrag() { dragging.current = false }

  function toggleDay(date) {
    const keys = HOURS.map(h => slotKey(date, h))
    const all = keys.every(k => selected.has(k))
    setSelected(p => { const n = new Set(p); all ? keys.forEach(k=>n.delete(k)) : keys.forEach(k=>n.add(k)); return n })
  }
  function toggleHour(hour) {
    const keys = weekDates.map(d => slotKey(d, hour))
    const all = keys.every(k => selected.has(k))
    setSelected(p => { const n = new Set(p); all ? keys.forEach(k=>n.delete(k)) : keys.forEach(k=>n.add(k)); return n })
  }
  function clearWeek() {
    const keys = weekDates.flatMap(d => HOURS.map(h => slotKey(d, h)))
    setSelected(p => { const n = new Set(p); keys.forEach(k=>n.delete(k)); return n })
  }
  function resetToSchedule() {
    // Re-seed from current schedule for the visible week.
    setSelected(p => {
      const keep = new Set([...p].filter(k => {
        // Keep slots that aren't in this week (other weeks unchanged).
        return !weekDates.some(d => HOURS.some(h => slotKey(d, h) === k))
      }))
      weekDates.forEach(d => HOURS.forEach(h => {
        const k = slotKey(d, h)
        if (!scheduleBusy.has(k)) keep.add(k)
      }))
      return keep
    })
    toast('Reset to schedule', 'Free hours auto-filled around your blocks')
  }

  async function save() {
    setSaving(true)
    try {
      await api.saveAvailability(Array.from(selected))
      toast('Saved', `${selected.size} free slot(s) saved`)
    } catch (e) { toast('Error', e.message) }
    finally { setSaving(false) }
  }

  const weekCount = useMemo(
    () => weekDates.flatMap(d => HOURS.map(h => slotKey(d,h))).filter(k => selected.has(k)).length,
    [weekDates, selected]
  )

  const activeConn = connections.find(c => c.other_id === activeConnId)
  const overlapCount = useMemo(() => {
    if (!activeConnId) return 0
    let n = 0
    selected.forEach(k => { if (theirSlots.has(k)) n++ })
    return n
  }, [activeConnId, selected, theirSlots])

  return (
    <div style={{ maxWidth:960, margin:'0 auto' }} className="page-wrap fade-up">
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
            {weekDates[0].toLocaleDateString([],{month:'short',day:'numeric'})} –{' '}
            {weekDates[6].toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'})}
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
          <button className="btn btn-ghost btn-sm" style={{ fontSize:11 }} onClick={resetToSchedule}>
            <RotateCcw size={12} strokeWidth={2} aria-hidden="true" />
            Reset to schedule
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
              {DAYS[date.getDay()]}
            </div>
            <div className={`cal-day-num ${isToday(date)?'cal-today':''}`}>{date.getDate()}</div>
          </div>
        ))}

        {/* Hour rows */}
        {HOURS.map(hour => (
          <>
            <div key={`t${hour}`} className="cal-hr" onClick={() => toggleHour(hour)}>
              {fmtHour(hour)}
            </div>
            {weekDates.map((date, di) => {
              const key = slotKey(date, hour)
              const mine     = selected.has(key)
              const sched    = scheduleBusy.has(key)
              const theirs   = activeConnId && theirSlots.has(key)
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
                  title={sched && !mine ? 'Busy from schedule (click to override)' : undefined}
                  onMouseDown={() => startDrag(key)}
                  onMouseEnter={() => dragOver(key)}
                />
              )
            })}
          </>
        ))}
      </div>

      <p className="text-xs text-2 mt12" style={{ textAlign:'center' }}>
        Click a day name or hour to toggle the whole row/column · drag across cells to select multiple ·
        red cells = busy from your schedule (click to free yourself)
      </p>

      {loadingMine && (
        <p className="text-xs text-2 mt8" style={{ textAlign:'center' }}>Loading your saved availability…</p>
      )}
    </div>
  )
}
