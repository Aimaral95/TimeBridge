import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sun, Moon, Sunrise, Sunset, Wind, Droplet,
  CloudSun, Cloud, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning,
  CheckCircle2, Circle, BookOpen, MoonStar,
  Calendar as CalendarIcon, Link2, Hand, Sparkles,
  ArrowRight, RotateCcw, Check, PartyPopper,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useSchedule, activeBlock, blockToStatus, nextBlock } from '../context/ScheduleContext'
import { api } from '../api/client'
import WeatherPill, { useWeather } from '../components/WeatherPill'
import { describeWmoCode } from '../utils/weather'

/* Status pills get a real Lucide icon component each (rendered inline, not as text). */
const STATUS_OPTS = [
  { key:'free',  Icon: CheckCircle2, label:'Free',     cls:'sel-free' },
  { key:'busy',  Icon: Circle,       label:'Busy',     cls:'sel-busy' },
  { key:'sleep', Icon: Moon,         label:'Sleeping', cls:'sel-sleep' },
  { key:'class', Icon: BookOpen,     label:'In Class', cls:'sel-class' },
  { key:'dnd',   Icon: MoonStar,     label:'Do Not Disturb', cls:'sel-dnd' },
]

// Stable color palette for connection avatars on the dashboard.
const PALETTE = [
  { color:'#58a6ff', bg:'rgba(88,166,255,.2)' },
  { color:'#3fb950', bg:'rgba(63,185,80,.2)' },
  { color:'#bc8cff', bg:'rgba(188,140,255,.2)' },
  { color:'#e3b341', bg:'rgba(210,153,34,.2)' },
  { color:'#ff7b72', bg:'rgba(255,123,114,.2)' },
]

const PLABELS = { free:'Free', busy:'Busy', sleep:'Sleeping', class:'In Class', dnd:'DND' }

function localTime(tz) {
  if (!tz) return ''
  try {
    return new Date().toLocaleTimeString('en', { hour:'2-digit', minute:'2-digit', timeZone: tz, hour12: false })
  } catch { return '' }
}

/* Time-of-day greeting + matching Lucide icon (no emoji in the heading). */
function greetingFor(name) {
  const h = new Date().getHours()
  if (h < 5)  return { text: `Good night, ${name}`,     Icon: Moon }
  if (h < 12) return { text: `Good morning, ${name}`,   Icon: Sunrise }
  if (h < 17) return { text: `Good afternoon, ${name}`, Icon: Sun }
  if (h < 21) return { text: `Good evening, ${name}`,   Icon: Sunset }
  return { text: `Good night, ${name}`, Icon: Moon }
}

export default function Dashboard() {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const { blocks } = useSchedule()

  const [now, setNow] = useState(new Date())
  // null = follow schedule automatically. A string = manual override.
  const [override, setOverride] = useState(null)
  const [qhOn, setQhOn] = useState(true)
  const [time, setTime] = useState(localTime(user?.timezone || 'UTC'))
  const [connections, setConnections] = useState([])
  const [availCount, setAvailCount] = useState(0)
  // Persist "user has visited the Overlap page at least once" so the
  // onboarding checklist remembers it across reloads.
  const visitedOverlapKey = user?.id ? `tb_visited_overlap_${user.id}` : null
  const [visitedOverlap, setVisitedOverlap] = useState(() => {
    if (!visitedOverlapKey) return false
    return localStorage.getItem(visitedOverlapKey) === '1'
  })

  // Pull real connections so the "Family" section reflects who you've actually connected with.
  useEffect(() => {
    api.getConnections()
      .then(d => setConnections((d.connections || []).filter(c => c.status === 'accepted')))
      .catch(() => {})
    api.getAvailability()
      .then(d => setAvailCount((d.slots || []).length))
      .catch(() => {})
  }, [])

  // Mark "visited overlap" when navigating there from the checklist or
  // anywhere else. We persist when the dashboard first finds the flag set
  // by a previous visit, but we also expose a marker function for our own
  // navigation buttons below.
  function goToOverlap(qs) {
    if (visitedOverlapKey) {
      localStorage.setItem(visitedOverlapKey, '1')
      setVisitedOverlap(true)
    }
    navigate(qs ? `/overlap${qs}` : '/overlap')
  }

  // Tick every minute so derived status / "next up" stays fresh.
  useEffect(() => {
    const t = setInterval(() => {
      setNow(new Date())
      setTime(localTime(user?.timezone || 'UTC'))
    }, 30000)
    return () => clearInterval(t)
  }, [user])

  // Derive auto-status from the schedule.
  const current = useMemo(() => activeBlock(blocks, now), [blocks, now])
  const upcoming = useMemo(() => nextBlock(blocks, now), [blocks, now])
  const autoStatus = blockToStatus(current)

  // If a new block starts, auto-clear the manual override so the schedule
  // takes back over. We track the active block id we last "saw".
  useEffect(() => {
    setOverride(null)
  }, [current?.id])

  const status = override || autoStatus

  function pickStatus(key) {
    if (key === autoStatus) {
      // Picking the same as auto = back to auto mode.
      setOverride(null)
      toast('Status synced with schedule', `Currently: ${PLABELS[autoStatus]}`)
    } else {
      setOverride(key)
      const opt = STATUS_OPTS.find(o => o.key === key)
      toast('Status overridden', `Manual: ${opt.label} (until next block)`)
    }
  }

  function clearOverride() {
    setOverride(null)
    toast('Status reset', `Following schedule: ${PLABELS[autoStatus]}`)
  }

  // Real weather for the user's location, via Open-Meteo (no key needed).
  // Falls back to a simple day/night assumption if the user hasn't set their
  // city yet, so the hero never looks empty.
  const wx = useWeather(user?.city, user?.country)
  const wxDesc = wx.data ? describeWmoCode(wx.data.weatherCode) : null
  const wxIsDay = wx.data ? wx.data.isDay : (now.getHours() >= 7 && now.getHours() < 21)
  // Pick a Lucide component for the hero based on the WMO code.
  const HERO_ICONS = {
    Sun, CloudSun, Cloud, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning,
  }
  let HeroWxIcon = wxDesc ? (HERO_ICONS[wxDesc.icon] || Cloud) : (wxIsDay ? Sun : Moon)
  if (wxDesc?.icon === 'Sun' && !wxIsDay) HeroWxIcon = Moon

  const greeting = greetingFor(user?.name?.split(' ')[0] || 'there')
  const GreetIcon = greeting.Icon

  return (
    <div className="page-wrap fade-up">
      <div className="page-header">
        <div>
          <div className="page-title row g8" style={{ display: 'inline-flex', alignItems: 'center' }}>
            <GreetIcon size={20} strokeWidth={1.75} aria-hidden="true" style={{ color: 'var(--amber2)' }} />
            <span>{greeting.text}</span>
          </div>
          <div className="page-subtitle">
            {now.toLocaleDateString('en', { weekday:'long', month:'long', day:'numeric' })}
            {user?.city ? ` · ${user.city}` : ''}
            {user?.country ? `, ${user.country}` : ''}
          </div>
        </div>
        <div className="header-actions">
          <button className="btn btn-outline btn-sm" onClick={() => navigate('/availability')}>
            <CalendarIcon size={14} strokeWidth={2} aria-hidden="true" />
            Availability
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => goToOverlap()}>
            <Link2 size={14} strokeWidth={2} aria-hidden="true" />
            View overlap
          </button>
        </div>
      </div>

      {/* Row 1: Weather + Status */}
      <div className="grid-2 mb16">
        <div className="weather-hero">
          <div className="row sb mb16">
            <div>
              <div className="big-time">{time}</div>
              <div className="text-sm text-2" style={{ marginTop:3 }}>
                {(user?.timezone || 'UTC').replace(/_/g,' ')}
              </div>
            </div>
            <div style={{ textAlign:'right' }}>
              {wx.loading && !wx.data ? (
                <>
                  <span className="skeleton" style={{ width: 100, height: 36, marginBottom: 6, borderRadius: 6 }} />
                  <div><span className="skeleton" style={{ width: 80, height: 11, borderRadius: 6 }} /></div>
                </>
              ) : wx.data ? (
                <>
                  <div className="big-temp">{wx.data.temperature >= 0 ? '+' : ''}{wx.data.temperature}°</div>
                  <div className="text-sm text-2 row g6" style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <HeroWxIcon size={14} strokeWidth={2} />
                    {wxDesc?.label || (wxIsDay ? 'Clear day' : 'Clear night')}
                  </div>
                </>
              ) : (
                <>
                  <div className="big-temp" style={{ opacity: .55 }}>—°</div>
                  <div className="text-sm text-2">
                    {user?.city ? 'Weather unavailable' : 'Set your city in Profile'}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="row g8 wrap">
            <div className="tag">
              {wxIsDay ? <Sun size={11} strokeWidth={2} /> : <Moon size={11} strokeWidth={2} />}
              {wxIsDay ? 'Day' : 'Night'}
            </div>
            {wx.data && (
              <>
                <div className="tag"><Wind size={11} strokeWidth={2} /> {wx.data.wind} km/h</div>
                <div className="tag"><Droplet size={11} strokeWidth={2} /> {wx.data.humidity}%</div>
              </>
            )}
          </div>
        </div>

        <div className="card" style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div className="row sb" style={{ marginBottom:0 }}>
            <span className="section-label" style={{ marginBottom:0 }}>My availability</span>
            <span
              className="text-xs row g4"
              style={{ color: override ? 'var(--amber2)' : 'var(--accent)', fontWeight:500, display: 'inline-flex', alignItems: 'center' }}
            >
              {override
                ? <><Hand size={11} strokeWidth={2} /> Manual override</>
                : <><Sparkles size={11} strokeWidth={2} /> Auto from schedule</>}
            </span>
          </div>

          {/* Active / next block hint from the schedule */}
          <div
            className="text-xs text-2"
            style={{
              padding:'8px 12px', background:'var(--surface2)',
              border:'1px solid var(--border)', borderRadius:'var(--r2)',
              lineHeight:1.5,
            }}
          >
            {current ? (
              <>
                <span style={{ color:'var(--text)' }}>Now:</span> {current.title}
                <span style={{ color:'var(--text3)' }}> · {current.start_time}–{current.end_time}</span>
              </>
            ) : (
              <>
                <span style={{ color:'var(--text)' }}>No block right now.</span>
                {upcoming && <> Next: {upcoming.title} at {upcoming.start_time}.</>}
                {!upcoming && <> Nothing else scheduled today.</>}
              </>
            )}
          </div>

          <div className="avail-grid">
            {STATUS_OPTS.map(opt => {
              const Icon = opt.Icon
              return (
                <div
                  key={opt.key}
                  className={`avail-opt ${status === opt.key ? 'sel ' + opt.cls : ''}`}
                  onClick={() => pickStatus(opt.key)}
                >
                  <div className="av-icon">
                    <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                  </div>
                  <div className="av-label">{opt.label}</div>
                </div>
              )
            })}
          </div>

          {override && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ alignSelf:'flex-start' }}
              onClick={clearOverride}
            >
              <RotateCcw size={13} strokeWidth={2} aria-hidden="true" />
              Reset to schedule ({PLABELS[autoStatus]})
            </button>
          )}

          <div className="qh-row">
            <span className="row g6" style={{ fontSize:13, color:'var(--text2)', flex:1, display: 'inline-flex', alignItems: 'center' }}>
              <Moon size={13} strokeWidth={2} aria-hidden="true" />
              Quiet hours · 22:00–08:00
            </span>
            <button className={`toggle ${qhOn ? 'on' : 'off'}`} onClick={() => {
              setQhOn(!qhOn)
              toast(qhOn ? 'Quiet hours off' : 'Quiet hours on')
            }} />
          </div>
        </div>
      </div>

      {/* Onboarding checklist — disappears once user has done all 4 setup steps. */}
      {(() => {
        const steps = [
          {
            key: 'schedule',
            done: blocks.length > 0,
            label: 'Add a schedule block',
            hint: 'Tell TimeBridge when you have class, work, gym, etc.',
            cta: 'Open schedule',
            go: () => navigate('/schedule'),
          },
          {
            key: 'family',
            done: connections.length > 0,
            label: 'Connect with a family member',
            hint: 'Generate an invite code or join one from someone else.',
            cta: 'Open family',
            go: () => navigate('/family'),
          },
          {
            key: 'avail',
            done: availCount > 0,
            label: 'Set your availability',
            hint: 'Mark the hours you\'re free so we can find shared time.',
            cta: 'Set availability',
            go: () => navigate('/availability'),
          },
          {
            key: 'overlap',
            done: visitedOverlap,
            label: 'See when you\'re free together',
            hint: 'Open the overlap page to see your shared call windows.',
            cta: 'View overlap',
            go: () => goToOverlap(),
          },
        ]
        const doneCount = steps.filter(s => s.done).length
        if (doneCount === steps.length) return null
        return (
          <div
            className="card mb24"
            style={{
              background: 'linear-gradient(135deg, rgba(88,166,255,.07), rgba(63,185,80,.07))',
              border: '1px solid rgba(88,166,255,.25)',
            }}
          >
            <div className="row sb mb12" style={{ alignItems: 'baseline' }}>
              <div>
                <div className="row g8" style={{ fontWeight: 600, fontSize: 15, alignItems: 'center' }}>
                  <PartyPopper size={16} strokeWidth={2} aria-hidden="true" style={{ color: 'var(--accent)' }} />
                  Get set up
                </div>
                <div className="text-xs text-2" style={{ marginTop: 2 }}>
                  Finish these {steps.length} steps to make TimeBridge useful for you.
                </div>
              </div>
              <span className="text-xs text-2">{doneCount} of {steps.length} done</span>
            </div>
            {/* Progress bar */}
            <div
              style={{
                height: 4, borderRadius: 2, background: 'var(--surface2)',
                overflow: 'hidden', marginBottom: 14,
              }}
            >
              <div
                style={{
                  width: `${(doneCount / steps.length) * 100}%`,
                  height: '100%',
                  background: 'var(--accent)',
                  transition: 'width .25s ease',
                }}
              />
            </div>
            <div className="stack g8">
              {steps.map(s => (
                <div
                  key={s.key}
                  className="row g12"
                  style={{
                    padding: '10px 12px',
                    background: 'var(--surface2)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r2)',
                    opacity: s.done ? 0.65 : 1,
                  }}
                >
                  <span
                    style={{
                      width: 22, height: 22, borderRadius: '50%',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: s.done ? 'var(--accent)' : 'transparent',
                      border: s.done ? '1px solid var(--accent)' : '1px solid var(--border)',
                      color: s.done ? 'white' : 'var(--text-2)',
                      flexShrink: 0,
                    }}
                  >
                    {s.done && <Check size={14} strokeWidth={3} aria-hidden="true" />}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14, fontWeight: 500,
                        textDecoration: s.done ? 'line-through' : 'none',
                      }}
                    >
                      {s.label}
                    </div>
                    {!s.done && <div className="text-xs text-2" style={{ marginTop: 2 }}>{s.hint}</div>}
                  </div>
                  {!s.done && (
                    <button className="btn btn-outline btn-sm" onClick={s.go}>{s.cta}</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Family overview — real connections only */}
      <span className="section-label">
        Family · {connections.length} {connections.length === 1 ? 'connection' : 'connections'}
      </span>

      {connections.length === 0 ? (
        <div className="card text-center mb24" style={{ padding:'24px', color:'var(--text-2)' }}>
          You haven't connected with anyone yet.{' '}
          <button
            className="btn btn-ghost btn-sm"
            style={{ display:'inline-flex', padding:'2px 6px' }}
            onClick={() => navigate('/family')}
          >
            Go to Family
            <ArrowRight size={13} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="grid-2 mb24">
          {connections.map((c, i) => {
            const palette = PALETTE[i % PALETTE.length]
            const name = c.other_name || `User #${c.other_id}`
            const init = (name[0] || '?').toUpperCase()
            const tz   = c.other_timezone
            const mTime = localTime(tz)
            return (
              <div key={c.id} className="member-card" onClick={() => navigate('/family')} style={{ position: 'relative' }}>
                {/* Weather pill — pinned to the top-right corner of the card.
                    Null-safe: renders nothing if we don't know their city
                    or the Open-Meteo fetch fails. */}
                <div style={{ position: 'absolute', top: 12, right: 12 }}>
                  <WeatherPill city={c.other_city} country={c.other_country} />
                </div>
                <div className="row g12 mb12">
                  <div className="avatar av-44" style={{ background: palette.bg, color: palette.color }}>
                    {init}
                  </div>
                  <div className="flex-1" style={{ minWidth: 0, paddingRight: 80 /* leave room for the pill */ }}>
                    <div style={{ fontWeight:500, fontSize:14, marginBottom:4 }}>{name}</div>
                    <div className="text-xs text-2">
                      {c.other_email || ''}
                    </div>
                  </div>
                </div>
                <div className="row sb">
                  <div>
                    <div style={{ fontSize:14, fontWeight:500 }}>{mTime || '—'}</div>
                    <div className="text-xs text-2">
                      {[c.other_city, tz ? tz.replace(/_/g,' ') : 'Unknown timezone'].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={e => { e.stopPropagation(); goToOverlap(`?with=${c.other_id}`) }}
                  >
                    See overlap
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
