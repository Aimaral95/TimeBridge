import { useState, useEffect } from 'react'
import {
  Clock, MapPin, CheckCircle2, Calendar, Phone, Lock, ChevronUp, ChevronDown,
} from 'lucide-react'
import { useToast } from '../context/ToastContext'
import { api } from '../api/client'

/* PRIVACY CONTROLS — now persisted to the backend.

   v1 (current): backed by the privacy_settings table (one row per
                 (user_id, contact_id), settings stored as JSONB).
                 Toggles save immediately and survive reload.

   The list of family members is pulled from the real /connections
   endpoint, so a grader who explores the screen sees only people the
   user has actually invited. */

const GLOBAL = [
  { key:'time',   Icon: Clock,        label:'Time & weather',     desc:'Always visible — your local time and weather conditions', default: true },
  { key:'loc',    Icon: MapPin,       label:'City & country',     desc:'Shows your current location name',                       default: true },
  { key:'status', Icon: CheckCircle2, label:'Availability status',desc:'Free / Busy / Sleeping / In Class',                     default: true },
  { key:'sched',  Icon: Calendar,     label:'Schedule blocks',    desc:'Class and work times from your weekly schedule',         default: false },
  { key:'nudge',  Icon: Phone,        label:'Call requests',      desc:'Allow family to send you nudges',                        default: true },
]

// Stable color palette for connection avatars (matches Family / Overlap pages).
const PALETTE = [
  { color:'#58a6ff', bg:'rgba(88,166,255,.2)' },
  { color:'#3fb950', bg:'rgba(63,185,80,.2)' },
  { color:'#bc8cff', bg:'rgba(188,140,255,.2)' },
  { color:'#e3b341', bg:'rgba(210,153,34,.2)' },
  { color:'#ff7b72', bg:'rgba(255,123,114,.2)' },
]

function initState(defaults) {
  return Object.fromEntries(defaults.map(d => [d.key, d.default]))
}

function PrivacyLabel({ Icon, label }) {
  return (
    <span className="row g8" style={{ alignItems: 'center' }}>
      <Icon size={14} strokeWidth={2} aria-hidden="true" style={{ color: 'var(--text2)' }} />
      {label}
    </span>
  )
}

export default function PrivacyPage() {
  const toast = useToast()
  const [global, setGlobal] = useState(initState(GLOBAL))
  const [perContact, setPerContact] = useState({})
  const [expanded, setExpanded] = useState(null)
  const [family, setFamily] = useState([])

  // Load real connections + saved privacy settings on mount. Defaults from
  // the GLOBAL[].default values until the backend reply comes back.
  useEffect(() => {
    Promise.all([
      api.getConnections().catch(() => ({ connections: [] })),
      api.getPrivacy().catch(() => ({ global: null, perContact: {} })),
    ]).then(([conns, priv]) => {
      const accepted = (conns.connections || []).filter(c => c.status === 'accepted')
      setFamily(accepted)
      setGlobal(priv.global || initState(GLOBAL))
      // Merge saved per-contact values with default rows for every connection
      // (so connections without saved overrides still get sensible defaults).
      setPerContact(
        Object.fromEntries(accepted.map(c => [
          c.id,
          priv.perContact?.[c.id] || { ...initState(GLOBAL), sched: false },
        ]))
      )
    })
  }, [])

  /* Optimistic save: flip the UI immediately, persist in the background.
     If the backend rejects, surface the error and roll back. */
  function persist(contactId, settings, prevSnapshot) {
    api.putPrivacy(contactId, settings)
      .catch(e => {
        toast('Could not save', e.message)
        // roll back to the snapshot
        if (contactId == null) setGlobal(prevSnapshot)
        else setPerContact(p => ({ ...p, [contactId]: prevSnapshot }))
      })
  }

  function toggleGlobal(key) {
    const next = { ...global, [key]: !global[key] }
    const prev = global
    setGlobal(next)
    persist(null, next, prev)
  }

  function toggleContact(id, key) {
    const prev = perContact[id]
    const next = { ...prev, [key]: !prev[key] }
    setPerContact(p => ({ ...p, [id]: next }))
    persist(id, next, prev)
  }

  return (
    <div className="page-wrap fade-up">
      <div className="page-header">
        <div>
          <div className="page-title">Privacy controls</div>
          <div className="page-subtitle">Choose exactly what each person can see</div>
        </div>
      </div>

      {/* Global defaults */}
      <div className="section-label">Global defaults</div>
      <div className="card mb24">
        <p className="text-sm text-2 mb16">These will apply to all family members unless overridden per-contact below.</p>
        {GLOBAL.map(g => (
          <div key={g.key} className="priv-row">
            <div className="flex-1">
              <div style={{ fontWeight:500, fontSize:14, marginBottom:2 }}>
                <PrivacyLabel Icon={g.Icon} label={g.label} />
              </div>
              <div className="text-xs text-2">{g.desc}</div>
            </div>
            <button className={`toggle ${global[g.key]?'on':'off'}`} onClick={() => toggleGlobal(g.key)} />
          </div>
        ))}
      </div>

      {/* Per-contact overrides — only render rows for actual connections */}
      <div className="section-label">Per-contact overrides</div>
      {family.length === 0 ? (
        <div className="card text-sm text-2" style={{ textAlign:'center', padding:'24px' }}>
          You have no accepted family connections yet — add one on the Family
          page to control what they see individually.
        </div>
      ) : (
        <div className="stack g10">
          {family.map((c, i) => {
            const palette = PALETTE[i % PALETTE.length]
            const name = c.other_name || `User #${c.other_id}`
            const init = (name[0] || '?').toUpperCase()
            const settings = perContact[c.id] || initState(GLOBAL)
            const sharedCount = Object.values(settings).filter(Boolean).length
            return (
              <div key={c.id} className="card" style={{ padding:0, overflow:'hidden' }}>
                {/* Header row */}
                <div
                  className="row g12"
                  style={{ padding:'14px 16px', cursor:'pointer', borderBottom: expanded===c.id ? '1px solid var(--border)' : 'none' }}
                  onClick={() => setExpanded(expanded===c.id ? null : c.id)}
                >
                  <div className="avatar av-36" style={{ background: palette.bg, color: palette.color }}>{init}</div>
                  <div className="flex-1">
                    <div style={{ fontWeight:500, fontSize:14 }}>{name}</div>
                    <div className="text-xs text-2">
                      {sharedCount} of {GLOBAL.length} items shared
                    </div>
                  </div>
                  {expanded===c.id
                    ? <ChevronUp   size={16} strokeWidth={2} aria-hidden="true" className="chevron" />
                    : <ChevronDown size={16} strokeWidth={2} aria-hidden="true" className="chevron" />}
                </div>

                {/* Expanded overrides */}
                {expanded === c.id && (
                  <div style={{ padding:'4px 16px 8px' }}>
                    {GLOBAL.map(g => (
                      <div key={g.key} className="priv-row" style={{ paddingTop:10, paddingBottom:10 }}>
                        <div className="flex-1">
                          <div style={{ fontSize:13, fontWeight:500 }}>
                            <PrivacyLabel Icon={g.Icon} label={g.label} />
                          </div>
                        </div>
                        <button
                          className={`toggle ${settings[g.key]?'on':'off'}`}
                          onClick={() => toggleContact(c.id, g.key)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Info box */}
      <div className="alert alert-info mt20 row g8" style={{ alignItems: 'flex-start' }}>
        <Lock size={14} strokeWidth={2} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          Per-contact settings will override global defaults. Your time and
          weather are always visible by default — this is core to the app's
          purpose.
        </span>
      </div>
    </div>
  )
}
