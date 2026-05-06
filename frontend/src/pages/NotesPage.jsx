import { useState, useEffect } from 'react'
import { Inbox, Send, Trash2, MessageCircle } from 'lucide-react'
import { api } from '../api/client'
import { useToast } from '../context/ToastContext'
import { useNotes } from '../context/NotesContext'

/* Notes page — inbox (received) + sent (your outgoing).

   On mount we hit GET /notes which:
     1. returns both lists
     2. server-side flips read_at to NOW() on every previously-unread inbox row
   So the act of opening this page also clears the unread badge. */

function fmtRelative(iso) {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000)            return 'just now'
  if (diff < 3600_000)          return `${Math.floor(diff / 60_000)} min ago`
  if (diff < 86_400_000)        return `${Math.floor(diff / 3600_000)} hr ago`
  if (diff < 7 * 86_400_000)    return `${Math.floor(diff / 86_400_000)} days ago`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

const PALETTE = [
  { color:'#58a6ff', bg:'rgba(88,166,255,.2)' },
  { color:'#3fb950', bg:'rgba(63,185,80,.2)' },
  { color:'#bc8cff', bg:'rgba(188,140,255,.2)' },
  { color:'#e3b341', bg:'rgba(210,153,34,.2)' },
  { color:'#ff7b72', bg:'rgba(255,123,114,.2)' },
]

function Avatar({ name, idx }) {
  const init = (name?.[0] || '?').toUpperCase()
  const p = PALETTE[Math.abs(idx) % PALETTE.length]
  return (
    <div className="avatar av-36" style={{ background: p.bg, color: p.color }}>{init}</div>
  )
}

export default function NotesPage() {
  const toast = useToast()
  const { markAllRead, refreshUnread } = useNotes()
  const [tab, setTab] = useState('inbox')          // 'inbox' | 'sent'
  const [inbox, setInbox] = useState([])
  const [sent, setSent]   = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const d = await api.getNotes()
      setInbox(d.inbox || [])
      setSent(d.sent  || [])
      // The endpoint just flipped read_at server-side; mirror it locally.
      markAllRead()
      refreshUnread()
    } catch (e) {
      toast('Could not load notes', e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function deleteNote(id) {
    if (!window.confirm('Delete this note? This cannot be undone.')) return
    try {
      await api.deleteNote(id)
      setInbox(p => p.filter(n => n.id !== id))
      setSent (p => p.filter(n => n.id !== id))
      toast('Note deleted')
    } catch (e) { toast('Could not delete', e.message) }
  }

  const list = tab === 'inbox' ? inbox : sent

  return (
    <div className="page-wrap fade-up" style={{ maxWidth: 720, margin: '0 auto', width: '100%' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Notes</div>
          <div className="page-subtitle">Short messages between you and your family.</div>
        </div>
      </div>

      <div className="tab-bar mb16">
        <button className={`tab-btn ${tab === 'inbox' ? 'active' : ''}`} onClick={() => setTab('inbox')}>
          <span className="row g6" style={{ display: 'inline-flex', alignItems: 'center' }}>
            <Inbox size={14} strokeWidth={2} aria-hidden="true" />
            Inbox {inbox.length > 0 && <span className="text-xs text-2">({inbox.length})</span>}
          </span>
        </button>
        <button className={`tab-btn ${tab === 'sent' ? 'active' : ''}`} onClick={() => setTab('sent')}>
          <span className="row g6" style={{ display: 'inline-flex', alignItems: 'center' }}>
            <Send size={14} strokeWidth={2} aria-hidden="true" />
            Sent {sent.length > 0 && <span className="text-xs text-2">({sent.length})</span>}
          </span>
        </button>
      </div>

      {loading && (
        <div className="stack g8">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card card-sm row g12">
              <span className="skeleton" style={{ width: 36, height: 36, borderRadius: '50%' }} />
              <div style={{ flex: 1 }}>
                <span className="skeleton" style={{ width: '40%', height: 12, marginBottom: 6 }} />
                <span className="skeleton" style={{ width: '90%', height: 10 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && list.length === 0 && (
        <div className="empty-state card">
          <div className="empty-icon"><MessageCircle size={40} strokeWidth={1.5} aria-hidden="true" /></div>
          <div className="empty-title">
            {tab === 'inbox' ? 'No notes yet' : 'You haven\'t sent any notes'}
          </div>
          <p className="text-sm text-2">
            {tab === 'inbox'
              ? 'When a family member leaves you a note, it shows up here.'
              : 'Open Family and click "Leave a note" on someone\'s card to send your first one.'}
          </p>
        </div>
      )}

      {!loading && list.length > 0 && (
        <div className="stack g8">
          {list.map(n => {
            const otherName = tab === 'inbox' ? n.from_name : n.to_name
            return (
              <div key={n.id} className="card card-sm">
                <div className="row g12 mb8">
                  <Avatar name={otherName} idx={tab === 'inbox' ? n.from_user_id : n.to_user_id} />
                  <div className="flex-1">
                    <div className="row g8 wrap">
                      <span style={{ fontWeight: 500, fontSize: 14 }}>
                        {tab === 'inbox' ? otherName : `To ${otherName}`}
                      </span>
                      <span className="text-xs text-2">{fmtRelative(n.created_at)}</span>
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--red)' }}
                    onClick={() => deleteNote(n.id)}
                    aria-label="Delete note"
                  >
                    <Trash2 size={13} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', paddingLeft: 48 }}>
                  {n.body}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
