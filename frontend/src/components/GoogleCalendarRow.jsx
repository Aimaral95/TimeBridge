import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronRight, Calendar, RefreshCw, Unlink } from 'lucide-react'
import { api } from '../api/client'
import { useToast } from '../context/ToastContext'

/* GoogleCalendarRow — drop-in row for SettingsPage that surfaces:

     - Setup required  → operator hasn't set GOOGLE_CLIENT_ID etc.
                         (read-only, with a hint pointing at the README)
     - Disconnected    → "Connect Google Calendar" → opens auth URL
     - Connected       → shows connected timestamp + Import / Disconnect

   The OAuth flow returns to /settings?google=connected (or =denied / =error).
   We watch for those params and toast accordingly. */

export default function GoogleCalendarRow() {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [status, setStatus]   = useState({ configured: false, connected: false })
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)

  async function refresh() {
    try {
      const s = await api.googleStatus()
      setStatus(s)
    } catch (e) { /* leave defaults */ }
    finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [])

  // Toast on return from the OAuth round-trip, then strip the query param so
  // a refresh doesn't re-fire the toast.
  useEffect(() => {
    const flag = params.get('google')
    if (!flag) return
    if (flag === 'connected')   toast('Google Calendar connected', 'You can import your events now.')
    else if (flag === 'denied') toast('Connection cancelled', 'You declined the Google permission prompt.')
    else                        toast('Google connection failed', params.get('msg') || flag)
    const next = new URLSearchParams(params)
    next.delete('google'); next.delete('msg')
    setParams(next, { replace: true })
    refresh()
  }, [params, setParams, toast])

  async function connect() {
    try {
      const r = await api.googleConnect()
      if (!r.configured) {
        toast('Setup required', r.message || 'See README → Integrations.', 'info')
        return
      }
      // Send the user to Google. They'll come back to /settings?google=...
      window.location.assign(r.url)
    } catch (e) { toast('Could not start connect', e.message) }
  }

  async function importNow() {
    setImporting(true)
    try {
      const r = await api.googleImport()
      toast(`Imported ${r.imported} event${r.imported === 1 ? '' : 's'}`,
            r.skipped_duplicates
              ? `Skipped ${r.skipped_duplicates} duplicate${r.skipped_duplicates === 1 ? '' : 's'} from ${r.total_events || 0} upcoming events.`
              : `Reviewed ${r.total_events || 0} upcoming events from Google.`)
    } catch (e) { toast('Import failed', e.message) }
    finally { setImporting(false) }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect Google Calendar?\n\nWe will forget your tokens. Already-imported blocks remain on your schedule.')) return
    try {
      await api.googleDisconnect()
      toast('Disconnected', 'Google Calendar tokens removed.')
      refresh()
    } catch (e) { toast('Could not disconnect', e.message) }
  }

  /* Render variants ───────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="set-row">
        <span className="row g8" style={{ alignItems: 'center', fontSize:14 }}>
          <Calendar size={14} strokeWidth={2} aria-hidden="true" style={{ color: 'var(--text2)' }} />
          Google Calendar
        </span>
        <span className="text-xs text-2">Loading…</span>
      </div>
    )
  }

  if (!status.configured) {
    return (
      <div className="set-row" style={{ cursor: 'default' }}>
        <span className="row g8" style={{ alignItems: 'center', fontSize:14 }}>
          <Calendar size={14} strokeWidth={2} aria-hidden="true" style={{ color: 'var(--text2)' }} />
          Google Calendar
        </span>
        <div className="row g8" style={{ alignItems: 'center' }}>
          <span className="tag" style={{ color: 'var(--amber2)', borderColor: 'rgba(227,179,65,.4)', background: 'rgba(227,179,65,.08)' }}>
            Setup required
          </span>
          <span className="text-xs text-2" title="The operator must set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in .env.">
            Operator config
          </span>
        </div>
      </div>
    )
  }

  if (!status.connected) {
    return (
      <div className="set-row" onClick={connect}>
        <span className="row g8" style={{ alignItems: 'center', fontSize:14 }}>
          <Calendar size={14} strokeWidth={2} aria-hidden="true" style={{ color: 'var(--text2)' }} />
          Connect Google Calendar
        </span>
        <ChevronRight size={14} strokeWidth={2} className="chevron" aria-hidden="true" />
      </div>
    )
  }

  // Connected — render two rows: Import + Disconnect.
  const since = status.connected_at ? new Date(status.connected_at).toLocaleDateString() : ''
  return (
    <>
      <div className="set-row" onClick={importing ? undefined : importNow}>
        <span className="row g8" style={{ alignItems: 'center', fontSize:14 }}>
          <Calendar size={14} strokeWidth={2} aria-hidden="true" style={{ color: 'var(--text2)' }} />
          Google Calendar
          <span className="tag" style={{ color: 'var(--accent)', borderColor: 'rgba(63,185,80,.4)', background: 'rgba(63,185,80,.08)' }}>
            Connected{since ? ` · ${since}` : ''}
          </span>
        </span>
        <span className="row g8" style={{ alignItems: 'center' }}>
          <span className="text-xs text-2 row g4" style={{ alignItems: 'center' }}>
            {importing && <span className="spinner" />}
            <RefreshCw size={12} strokeWidth={2} aria-hidden="true" />
            {importing ? 'Importing…' : 'Import next 30 days'}
          </span>
          <ChevronRight size={14} strokeWidth={2} className="chevron" aria-hidden="true" />
        </span>
      </div>
      <div className="set-row" onClick={disconnect}>
        <span className="row g8" style={{ alignItems: 'center', fontSize:14, color: 'var(--red)' }}>
          <Unlink size={14} strokeWidth={2} aria-hidden="true" />
          Disconnect Google Calendar
        </span>
        <ChevronRight size={14} strokeWidth={2} className="chevron" aria-hidden="true" />
      </div>
    </>
  )
}
