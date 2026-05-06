import { useState, useEffect, useCallback } from 'react'
import { Copy, Trash2, EyeOff, Eye, Mail, Clock, UserMinus, MessageCircle } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import NoteModal from '../components/NoteModal'
import WeatherPill from '../components/WeatherPill'

const PLABELS = { free:'Free', busy:'Busy', sleep:'Sleeping', class:'In Class', dnd:'DND' }

// Stable color palette for connection avatars.
const PALETTE = [
  { color:'#58a6ff', bg:'rgba(88,166,255,.2)' },
  { color:'#3fb950', bg:'rgba(63,185,80,.2)' },
  { color:'#bc8cff', bg:'rgba(188,140,255,.2)' },
  { color:'#e3b341', bg:'rgba(210,153,34,.2)' },
  { color:'#ff7b72', bg:'rgba(255,123,114,.2)' },
]

function localTime(tz) {
  if (!tz) return ''
  try {
    return new Date().toLocaleTimeString('en', { hour:'2-digit', minute:'2-digit', timeZone: tz, hour12: false })
  } catch { return '' }
}

// User-scoped storage key for invites the user has dismissed locally.
// Backend has no withdraw endpoint, so "Hide" must be remembered client-side
// — otherwise the next reload (which fires every time you generate / join a
// code) re-fetches them and they pop right back.
function hiddenKey(userId) { return `tb_hidden_invites_${userId}` }
function loadHidden(userId) {
  if (!userId) return new Set()
  try {
    const raw = localStorage.getItem(hiddenKey(userId))
    return new Set(raw ? JSON.parse(raw) : [])
  } catch { return new Set() }
}
function saveHidden(userId, set) {
  if (!userId) return
  try { localStorage.setItem(hiddenKey(userId), JSON.stringify([...set])) } catch {}
}

export default function FamilyPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [connections, setConnections] = useState([])
  const [joinCode, setJoinCode] = useState('')
  const [newCode, setNewCode] = useState('')
  const [generating, setGenerating] = useState(false)
  const [joining, setJoining] = useState(false)
  const [hidden, setHidden] = useState(() => loadHidden(user?.id))
  // Note-modal state — null when closed, otherwise the recipient connection.
  const [noteTo, setNoteTo] = useState(null)

  const reload = useCallback(async () => {
    try {
      const d = await api.getConnections()
      setConnections(d.connections || [])
    } catch (e) {
      toast('Could not load connections', e.message)
    }
  }, [toast])

  useEffect(() => { reload() }, [reload])

  // Re-hydrate hidden set when the user changes (account switch).
  useEffect(() => { setHidden(loadHidden(user?.id)) }, [user?.id])

  // Auto-prune hidden IDs that no longer exist on the server (e.g. invite was
  // accepted and is now a real connection — no need to remember it as hidden).
  useEffect(() => {
    if (!user?.id || hidden.size === 0) return
    const live = new Set(connections.map(c => c.id))
    let changed = false
    const next = new Set()
    for (const id of hidden) {
      if (live.has(id)) next.add(id); else changed = true
    }
    if (changed) {
      setHidden(next)
      saveHidden(user.id, next)
    }
  }, [connections, hidden, user?.id])

  // Split into "accepted" (real connections) and "pending invites I created"
  const accepted = connections.filter(c => c.status === 'accepted')
  const pendingMine = connections.filter(
    c => c.status === 'pending' && c.user_id === user?.id && !hidden.has(c.id)
  )

  async function generateInvite() {
    setGenerating(true)
    try {
      const d = await api.createInvite()
      setNewCode(d.connection.invite_code)
      toast('Code generated', 'Share this with your family member')
      reload()
    } catch (e) { toast('Error', e.message) }
    finally { setGenerating(false) }
  }

  async function joinInvite(e) {
    e.preventDefault(); setJoining(true)
    try {
      await api.joinInvite(joinCode.toUpperCase())
      toast('Connected', 'You can now see each other')
      setJoinCode('')
      reload()
    } catch (e) { toast('Error', e.message) }
    finally { setJoining(false) }
  }

  async function withdrawPending(id, code) {
    // Local-only hide. The code still works on the backend until someone joins
    // (or until the user clicks Delete, which actually revokes it).
    setHidden(prev => {
      const next = new Set(prev)
      next.add(id)
      saveHidden(user?.id, next)
      return next
    })
    toast('Hidden', `Code ${code} still works on the backend. Click Delete to revoke it permanently.`)
  }

  /* Permanently revoke a generated invite code on the server.
     After this, no one can join with it. */
  async function deletePending(id, code) {
    const ok = window.confirm(
      `Delete invite code ${code}?\n\nNo one will be able to join with this code anymore. This can't be undone.`
    )
    if (!ok) return
    try {
      await api.deleteConnection(id)
      // If we were still showing this code as the "newly generated" one, clear it.
      if (newCode && code === newCode) setNewCode('')
      // Drop it from the hidden set too — no need to remember a row that's gone.
      setHidden(prev => {
        if (!prev.has(id)) return prev
        const next = new Set(prev); next.delete(id); saveHidden(user?.id, next); return next
      })
      toast('Code deleted', `${code} has been revoked. No one can join with it now.`)
      reload()
    } catch (e) {
      toast('Could not delete', e.message)
    }
  }

  /* Remove an accepted family connection on both sides. */
  async function removeAccepted(id, name) {
    const ok = window.confirm(
      `Remove ${name} from your family?\n\nYou'll lose access to each other's availability. You can reconnect later with a new invite code.`
    )
    if (!ok) return
    try {
      await api.deleteConnection(id)
      toast('Removed', `${name} is no longer connected with you.`)
      reload()
    } catch (e) {
      toast('Could not remove', e.message)
    }
  }

  function unhideAll() {
    setHidden(new Set())
    saveHidden(user?.id, new Set())
    toast('Restored', 'Showing all hidden invites again')
  }

  // Are there pending invites that are currently filtered out by `hidden`?
  const hasHidden = connections.some(
    c => c.status === 'pending' && c.user_id === user?.id && hidden.has(c.id)
  )

  return (
    <div className="page-wrap fade-up">
      <div className="page-header">
        <div>
          <div className="page-title">Family</div>
          <div className="page-subtitle">{accepted.length} connected · {pendingMine.length} pending</div>
        </div>
      </div>

      {/* Invite / join */}
      <div className="grid-2 mb24">
        <div className="card">
          <div className="section-label">Generate invite code</div>
          <p className="text-sm text-2 mb12">Share the code with a family member. They join with it — no account needed first.</p>
          <button className="btn btn-outline btn-sm" onClick={generateInvite} disabled={generating}>
            {generating && <span className="spinner"/>} Generate code
          </button>
          {newCode && (() => {
            // Find the freshly created pending row so we can wire its Delete button.
            const fresh = connections.find(
              c => c.invite_code === newCode && c.status === 'pending' && c.user_id === user?.id
            )
            return (
              <div className="mt12">
                <div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:'var(--r2)', padding:'12px 16px', fontFamily:'monospace', fontSize:18, fontWeight:700, letterSpacing:'.15em', color:'var(--accent)', textAlign:'center' }}>
                  {newCode}
                </div>
                <div className="row g8 mt8">
                  <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(newCode); toast('Copied') }}>
                    <Copy size={13} strokeWidth={2} aria-hidden="true" />
                    Copy
                  </button>
                  {fresh && (
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--red)' }}
                      onClick={() => deletePending(fresh.id, newCode)}
                    >
                      <Trash2 size={13} strokeWidth={2} aria-hidden="true" />
                      Delete code
                    </button>
                  )}
                </div>
              </div>
            )
          })()}
        </div>
        <div className="card">
          <div className="section-label">Join with a code</div>
          <p className="text-sm text-2 mb12">Got a code from a family member? Enter it here to connect.</p>
          <form onSubmit={joinInvite} className="row g8">
            <input className="form-input flex-1" placeholder="AB12CD34"
              value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} maxLength={8}
              style={{ fontFamily:'monospace', letterSpacing:'.1em' }} />
            <button className="btn btn-primary btn-sm" disabled={joining || !joinCode.trim()}>
              {joining ? <span className="spinner"/> : 'Join'}
            </button>
          </form>
        </div>
      </div>

      {/* "Show hidden" link — visible whenever there's at least one hidden
          pending invite, even if the visible list is empty. */}
      {hasHidden && pendingMine.length === 0 && (
        <div className="row sb mb12" style={{ alignItems: 'center' }}>
          <span className="text-xs text-2">Some pending invites are hidden.</span>
          <button className="btn btn-ghost btn-sm" onClick={unhideAll}>
            <Eye size={13} strokeWidth={2} aria-hidden="true" />
            Show hidden invites
          </button>
        </div>
      )}

      {/* Pending invites I created */}
      {pendingMine.length > 0 && <>
        <div className="row sb" style={{ alignItems: 'baseline' }}>
          <div className="section-label">Pending invites you created</div>
          {hasHidden && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginBottom: 6 }}
              onClick={unhideAll}
            >
              <Eye size={13} strokeWidth={2} aria-hidden="true" />
              Show hidden
            </button>
          )}
        </div>
        <div className="card mb20">
          {pendingMine.map(p => (
            <div key={p.id} className="row g12" style={{ padding:'12px 0', borderBottom:'1px solid var(--border)' }}>
              <div className="avatar av-36" style={{ background:'rgba(210,153,34,.2)', color:'#e3b341' }}>?</div>
              <div className="flex-1">
                <div style={{ fontWeight:500, fontSize:14 }}>Waiting for someone to join</div>
                <div className="text-xs text-2" style={{ fontFamily:'monospace', letterSpacing:'.1em' }}>
                  Code: {p.invite_code}
                </div>
              </div>
              <button
                className="btn btn-sm btn-outline"
                onClick={() => { navigator.clipboard?.writeText(p.invite_code); toast('Copied') }}
              >
                <Copy size={12} strokeWidth={2} aria-hidden="true" />
                Copy
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => withdrawPending(p.id, p.invite_code)}
                title="Hide locally — code still works on the backend"
              >
                <EyeOff size={12} strokeWidth={2} aria-hidden="true" />
                Hide
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={() => deletePending(p.id, p.invite_code)}
                title="Permanently revoke this code — no one can join with it"
              >
                <Trash2 size={12} strokeWidth={2} aria-hidden="true" />
                Delete
              </button>
            </div>
          ))}
        </div>
      </>}

      {/* Connected */}
      <div className="section-label">Connected members</div>
      {accepted.length === 0 ? (
        <div className="card text-center" style={{ padding:'24px', color:'var(--text-2)' }}>
          No one yet. Generate a code above and share it with a family member,
          or paste theirs into "Join with a code".
        </div>
      ) : (
        <div className="stack g10">
          {accepted.map((c, i) => {
            const palette = PALETTE[i % PALETTE.length]
            const name = c.other_name || `User #${c.other_id}`
            const init = (name[0] || '?').toUpperCase()
            return (
              <div key={c.id} className="card card-sm" style={{ display:'flex', alignItems:'center', gap:14, position:'relative' }}>
                {/* Weather pill — pinned to the top-right corner of the card,
                    matching the Dashboard layout. Null-safe: shows nothing
                    if we don't know the connection's city. */}
                <div style={{ position: 'absolute', top: 10, right: 12 }}>
                  <WeatherPill city={c.other_city} country={c.other_country} />
                </div>
                <div className="avatar av-44" style={{ background:palette.bg, color:palette.color }}>{init}</div>
                <div className="flex-1">
                  <div className="row g8 mb4">
                    <span style={{ fontWeight:500, fontSize:14 }}>{name}</span>
                  </div>
                  <div className="text-xs text-2 row g8 wrap" style={{ display: 'inline-flex', alignItems: 'center' }}>
                    {c.other_email && (
                      <span className="row g4" style={{ display: 'inline-flex', alignItems: 'center' }}>
                        <Mail size={11} strokeWidth={2} aria-hidden="true" />
                        {c.other_email}
                      </span>
                    )}
                    {c.other_timezone && (
                      <span className="row g4" style={{ display: 'inline-flex', alignItems: 'center' }}>
                        <Clock size={11} strokeWidth={2} aria-hidden="true" />
                        {localTime(c.other_timezone)} ({c.other_timezone.replace(/_/g,' ')})
                      </span>
                    )}
                  </div>
                </div>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => setNoteTo({ id: c.other_id, name })}
                  title="Leave a short note"
                >
                  <MessageCircle size={13} strokeWidth={2} aria-hidden="true" />
                  Leave a note
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--red)' }}
                  onClick={() => removeAccepted(c.id, name)}
                  title="Remove this connection"
                >
                  <UserMinus size={13} strokeWidth={2} aria-hidden="true" />
                  Remove
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Note composer — opens when the user clicks "Leave a note". */}
      <NoteModal
        open={!!noteTo}
        onClose={() => setNoteTo(null)}
        toUser={noteTo || { id: 0, name: '' }}
      />
    </div>
  )
}
