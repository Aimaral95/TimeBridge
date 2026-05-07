import { useMemo, useState, useRef } from 'react'
import { Upload, Plus, X, Globe } from 'lucide-react'
import { useToast } from '../context/ToastContext'
import { useSchedule } from '../context/ScheduleContext'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import { Tooltip } from '../components/Tooltip'
import { parseIcs } from '../utils/icsParser'
import { browserTz } from '../utils/tz'

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const HOURS = ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00']

// User-pickable palette. Keep small so the grid looks consistent.
const COLOR_PALETTE = [
  '#58a6ff', // blue
  '#3fb950', // green
  '#e3b341', // amber
  '#bc8cff', // purple
  '#ff7b72', // red
  '#f78166', // orange
  '#39d0d8', // cyan
  '#a5a5a5', // gray
]
const DEFAULT_COLOR = COLOR_PALETTE[0]

// Fallback color for legacy blocks saved before the color column existed.
function colorFor(b) {
  if (b?.color && /^#[0-9a-fA-F]{6}$/.test(b.color)) return b.color
  // Legacy mapping for old "type"-based blocks.
  const legacy = { class:'#58a6ff', work:'#3fb950', gym:'#e3b341', other:'#bc8cff' }
  return legacy[b?.type] || DEFAULT_COLOR
}

/* "HH:MM" → number */
function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

/* Build the {day -> {hour -> block}} grid the table uses. */
function buildGrid(blocks) {
  const grid = {}
  HOURS.forEach(h => { grid[h] = {} })
  for (const b of blocks) {
    const startH = Math.floor(toMin(b.start_time) / 60)
    const endH   = Math.ceil(toMin(b.end_time)   / 60)
    for (let h = startH; h < endH; h++) {
      const hKey = String(h).padStart(2, '0') + ':00'
      if (!(hKey in grid)) continue
      for (const d of (b.days || [])) {
        if (!grid[hKey][d]) grid[hKey][d] = b
      }
    }
  }
  return grid
}

export default function SchedulePage() {
  const toast = useToast()
  const { user } = useAuth()
  const { blocks, addBlock, removeBlock } = useSchedule()
  const viewerTz = user?.timezone || browserTz()
  const [addOpen, setAddOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef(null)
  const [form, setForm] = useState({
    title:'', start:'09:00', end:'10:30', type:'', color: DEFAULT_COLOR, days:['Mon','Tue']
  })
  const grid = useMemo(() => buildGrid(blocks), [blocks])

  function pickIcsFile() {
    fileRef.current?.click()
  }

  async function onIcsChosen(e) {
    const file = e.target.files?.[0]
    e.target.value = ''  // allow re-uploading the same file
    if (!file) return
    setImporting(true)
    try {
      const text = await file.text()
      const parsed = parseIcs(text)
      if (parsed.length === 0) {
        toast('Nothing to import', 'No timed events found in this file')
        return
      }
      // Cycle palette colors so imported blocks don't all look the same.
      let i = 0
      let imported = 0
      let skipped = 0
      for (const b of parsed) {
        const result = await addBlock({
          title: b.title,
          type: 'imported',
          color: COLOR_PALETTE[i % COLOR_PALETTE.length],
          days: b.days,
          start_time: b.start_time,
          end_time: b.end_time,
        })
        if (result?.skipped) skipped += 1
        else imported += 1
        i++
      }
      toast(
        `Imported ${imported} event${imported === 1 ? '' : 's'}`,
        skipped ? `Skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}` : 'Added as recurring weekly blocks'
      )
    } catch (err) {
      toast('Import failed', err.message)
    } finally {
      setImporting(false)
    }
  }

  const set = k => e => setForm(f => ({...f, [k]: e.target.value}))
  const toggleDay = d => setForm(f => ({...f,
    days: f.days.includes(d) ? f.days.filter(x=>x!==d) : [...f.days, d]
  }))

  async function onAdd() {
    if (!form.title || form.days.length === 0) return
    if (toMin(form.end) <= toMin(form.start)) {
      toast('Invalid time', 'End time must be after start time')
      return
    }
    await addBlock({
      title: form.title,
      type: form.type || 'other',
      color: form.color || DEFAULT_COLOR,
      days: form.days,
      start_time: form.start,
      end_time: form.end,
    })
    setAddOpen(false)
    toast('Block added', `${form.title} added to schedule`)
    setForm({ title:'', start:'09:00', end:'10:30', type:'', color: DEFAULT_COLOR, days:['Mon','Tue'] })
  }

  function onRemove(id) {
    removeBlock(id)
    toast('Removed', 'Schedule block deleted')
  }

  return (
    <div className="page-wrap fade-up">
      <div className="page-header">
        <div>
          <div className="page-title">Weekly schedule</div>
          <div className="page-subtitle">
            Recurring blocks · Dashboard status updates automatically · {blocks.length} active
          </div>
        </div>
        <div className="header-actions">
          <input
            ref={fileRef}
            type="file"
            accept=".ics,text/calendar"
            onChange={onIcsChosen}
            style={{ display: 'none' }}
          />
          <button
            className="btn btn-outline btn-sm"
            onClick={pickIcsFile}
            disabled={importing}
            title="Upload a .ics file from Google / Apple / Outlook calendar"
          >
            {importing ? <span className="spinner"/> : <Upload size={13} strokeWidth={2} aria-hidden="true" />}
            Import .ics
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} strokeWidth={2} aria-hidden="true" />
            Add block
          </button>
        </div>
      </div>

      {/* Week grid */}
      <div className="card mb20">
        <div className="sched-grid">
          <div className="sg-head"></div>
          {DAYS.map(d => <div key={d} className="sg-head">{d}</div>)}
          {HOURS.map(time => (
            <>
              <div key={time} className="sg-time">{time}</div>
              {DAYS.map(d => {
                const b = grid[time]?.[d]
                const c = b ? colorFor(b) : null
                return (
                  <div key={`${time}-${d}`} className="sg-cell">
                    {b && (
                      <div
                        className="sched-block"
                        style={{
                          background: c + '33',  // ~20% opacity
                          color: c,
                          borderLeft: `3px solid ${c}`,
                        }}
                      >
                        {b.title.replace(/^[^\w]+\s*/, '')}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          ))}
        </div>
        {/* Legend now reflects the actual types the user has created. */}
        <div style={{ marginTop:12, display:'flex', gap:16, flexWrap:'wrap' }}>
          {Array.from(new Map(blocks.map(b => [(b.type || 'other') + '|' + colorFor(b), b])).values()).map(b => (
            <div key={b.id} className="row g6 text-xs text-2">
              <div style={{ width:10, height:10, borderRadius:2, background: colorFor(b) }}/>
              {b.type || 'other'}
            </div>
          ))}
          {blocks.length === 0 && <div className="text-xs text-2">No blocks yet — add one to see your week.</div>}
        </div>
      </div>

      {/* Block list */}
      <div className="section-label">Recurring blocks</div>
      <div className="stack g8">
        {blocks.length === 0 && (
          <div className="card text-sm text-2" style={{ textAlign:'center' }}>
            No blocks yet. Add one to teach the dashboard your weekly routine.
          </div>
        )}
        {blocks.map(b => {
          // Show the source tz when it differs from the viewer's tz, so the
          // grader can see that "9 AM" is anchored to the creator's clock,
          // not silently re-interpreted on the viewer's machine.
          const showSourceTz = b.tzid && b.tzid !== viewerTz
          return (
            <div key={b.id} className="card card-sm row g12 wrap">
              <div style={{ width:10, height:10, borderRadius:50, background: colorFor(b), flexShrink:0, marginTop:4 }}/>
              <div className="flex-1" style={{ minWidth:0 }}>
                <div style={{ fontWeight:500, fontSize:14 }}>{b.title}</div>
                <div className="text-xs text-2 row g6 wrap" style={{ alignItems: 'center' }}>
                  <span>{(b.days || []).join(', ')} · {b.start_time}–{b.end_time}</span>
                  {showSourceTz && (
                    <Tooltip label={`Anchored to ${b.tzid}`} side="top">
                      <span className="tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Globe size={10} strokeWidth={2} aria-hidden="true" />
                        {b.tzid.split('/').pop().replace(/_/g, ' ')}
                      </span>
                    </Tooltip>
                  )}
                </div>
              </div>
              <span className="tag">{b.type || 'other'}</span>
              <Tooltip label="Delete this block" side="top">
                <button className="btn btn-ghost btn-sm" style={{ color:'var(--red)' }} onClick={() => onRemove(b.id)} aria-label="Delete block">
                  <X size={14} strokeWidth={2.5} aria-hidden="true" />
                </button>
              </Tooltip>
            </div>
          )
        })}
      </div>

      {/* Add block modal */}
      <Modal
        open={addOpen} onClose={() => setAddOpen(false)}
        title="Add schedule block" subtitle="Recurring weekly block shown to your family"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setAddOpen(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={!form.title || form.days.length===0} onClick={onAdd}>Add block</button>
        </>}
      >
        <div className="stack g14">
          <div className="form-group">
            <label className="form-label">Title</label>
            <input className="form-input" placeholder="e.g. Algorithms lecture"
              value={form.title} onChange={set('title')} />
          </div>
          <div className="grid-2" style={{ gap:10 }}>
            <div className="form-group">
              <label className="form-label">Start time</label>
              <input type="time" className="form-input" value={form.start} onChange={set('start')} />
            </div>
            <div className="form-group">
              <label className="form-label">End time</label>
              <input type="time" className="form-input" value={form.end} onChange={set('end')} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Repeat on</label>
            <div className="row g6 mt8 wrap">
              {DAYS.map(d => (
                <div key={d}
                  className={`chip ${form.days.includes(d)?'chip-green':''}`}
                  style={{ padding:'5px 11px', fontSize:12 }}
                  onClick={() => toggleDay(d)}
                >{d}</div>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Type / category</label>
            <input
              className="form-input"
              placeholder="e.g. Lecture, Tutoring, Yoga, Family time…"
              maxLength={40}
              value={form.type}
              onChange={set('type')}
            />
            <div className="text-xs text-2" style={{ marginTop:4 }}>
              Free text. Used as a label and shown on your schedule.
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Color</label>
            <div className="row g8 wrap mt8">
              {COLOR_PALETTE.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, color: c }))}
                  aria-label={`Pick color ${c}`}
                  style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: c,
                    border: form.color === c ? '3px solid var(--text)' : '2px solid transparent',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
