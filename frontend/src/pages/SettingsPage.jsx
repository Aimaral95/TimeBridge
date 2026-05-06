import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Sparkles, Sun, Moon, Clock, Download, KeyRound, ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { usePrefs } from '../context/PrefsContext'
import PasswordChangeModal from '../components/PasswordChangeModal'
import TwoFactorModal from '../components/TwoFactorModal'
import GoogleCalendarRow from '../components/GoogleCalendarRow'
import { api } from '../api/client'

/* SETTINGS — three buckets:

     1) Working today  → real navigation / real backend hits
     2) Preferences    → in-place toggles (theme, time format)
     3) Planned for v1.1 → only the genuinely-not-shipped items remain
                            (Apple/Google two-way sync, etc.)
     4) Account actions → sign out / delete

   Items previously in §3 that *did* ship (password change, 2FA enrollment,
   light theme, 12/24-hour, data export) have moved up. The "Planned" pill
   is reserved for things still genuinely unbuilt. */

export default function SettingsPage() {
  const { logout } = useAuth()
  const { theme, timeFormat, toggleTheme, toggleTimeFormat } = usePrefs()
  const navigate = useNavigate()
  const toast = useToast()

  const [pwOpen, setPwOpen] = useState(false)
  const [twofaOpen, setTwofaOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  function handleLogout() {
    logout()
    navigate('/auth')
  }

  /* Trigger a file download of the user's full data export. We hit the
     authenticated endpoint via fetch (so the JWT header is set), wrap the
     response in a Blob, and synthesise a click on a temporary <a>. */
  async function exportMyData() {
    setExporting(true)
    try {
      const token = localStorage.getItem('tb_token')
      const res = await fetch(api.exportDataUrl(), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`)
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = `timebridge-export-${new Date().toISOString().slice(0,10)}.json`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      toast('Export downloaded', 'Your data was saved as a JSON file.')
    } catch (e) {
      toast('Export failed', e.message)
    } finally {
      setExporting(false)
    }
  }

  const Section = ({ label, children, hint }) => (
    <div className="mb24">
      <div className="row sb" style={{ alignItems: 'baseline' }}>
        <div className="section-label">{label}</div>
        {hint}
      </div>
      <div>{children}</div>
    </div>
  )

  /* Standard navigation/action row. */
  const Row = ({ label, value, onClick, danger, leftIcon: LeftIcon }) => (
    <div className="set-row" onClick={onClick}>
      <span className="row g8" style={{ alignItems: 'center', fontSize:14, color: danger ? 'var(--red)' : 'var(--text)' }}>
        {LeftIcon && <LeftIcon size={14} strokeWidth={2} aria-hidden="true" style={{ color: danger ? 'var(--red)' : 'var(--text2)' }} />}
        {label}
      </span>
      <div className="row g8" style={{ alignItems: 'center' }}>
        {value && <span className="set-val">{value}</span>}
        <ChevronRight size={14} strokeWidth={2} className="chevron" aria-hidden="true" />
      </div>
    </div>
  )

  /* Inline-toggle row (theme, 12/24h). */
  const ToggleRow = ({ label, value, onClick, leftIcon: LeftIcon }) => (
    <div className="set-row" onClick={onClick}>
      <span className="row g8" style={{ alignItems: 'center', fontSize:14 }}>
        {LeftIcon && <LeftIcon size={14} strokeWidth={2} aria-hidden="true" style={{ color: 'var(--text2)' }} />}
        {label}
      </span>
      <div className="row g8" style={{ alignItems: 'center' }}>
        <span className="set-val">{value}</span>
      </div>
    </div>
  )

  const PlannedPill = () => (
    <span className="tag" style={{ color: 'var(--amber2)', borderColor: 'rgba(227,179,65,.4)', background: 'rgba(227,179,65,.08)' }}>
      <Sparkles size={10} strokeWidth={2} aria-hidden="true" />
      Planned
    </span>
  )
  const PlannedRow = ({ label, onClick }) => (
    <div className="set-row" onClick={onClick}>
      <span style={{ fontSize:14, color:'var(--text)' }}>{label}</span>
      <div className="row g8" style={{ alignItems: 'center' }}>
        <PlannedPill />
        <ChevronRight size={14} strokeWidth={2} className="chevron" aria-hidden="true" />
      </div>
    </div>
  )

  const isLight = theme === 'light'
  const is12h   = timeFormat === '12h'

  return (
    <div className="page-wrap fade-up" style={{ maxWidth: 560 }}>
      <div className="page-header">
        <div><div className="page-title">Settings</div></div>
      </div>

      {/* ── Account ──────────────────────────────────────────── */}
      <Section label="Account">
        <Row label="Profile" onClick={() => navigate('/profile')} />
        <Row label="Change password"            leftIcon={KeyRound}    onClick={() => setPwOpen(true)} />
        <Row label="Two-factor authentication"  leftIcon={ShieldCheck} value="Beta" onClick={() => setTwofaOpen(true)} />
      </Section>

      {/* ── Preferences ──────────────────────────────────────── */}
      <Section label="Preferences">
        <ToggleRow
          label="Theme"
          leftIcon={isLight ? Sun : Moon}
          value={isLight ? 'Light' : 'Dark'}
          onClick={() => { toggleTheme(); toast('Theme updated', isLight ? 'Switched to dark.' : 'Switched to light.') }}
        />
        <ToggleRow
          label="Time format"
          leftIcon={Clock}
          value={is12h ? '12-hour' : '24-hour'}
          onClick={() => { toggleTimeFormat(); toast('Time format updated', is12h ? 'Switched to 24-hour.' : 'Switched to 12-hour.') }}
        />
        <Row label="Timezone" value="Auto-detect" onClick={() => navigate('/profile')} />
      </Section>

      {/* ── Integrations ────────────────────────────────────── */}
      <Section label="Integrations">
        <Row label="Import iCal / .ics" value="Available" onClick={() => navigate('/schedule')} />
        <GoogleCalendarRow />
        {/* Apple Calendar is *deliberately* not a button. The only realistic
            implementation paths are CalDAV (requires the user's Apple ID
            app-specific password — bad UX for a senior-design demo) or
            EventKit (iOS native, not applicable for a web app). The .ics
            export from Calendar.app already covers the common one-shot case. */}
        <div className="set-row" style={{ cursor: 'default' }}>
          <span style={{ fontSize:14, color:'var(--text)' }}>Apple Calendar</span>
          <span className="text-xs text-2" title="Apple has no public read-only Calendar API. In Calendar.app: File → Export → .ics, then Import on the Schedule page.">
            Use .ics export
          </span>
        </div>
      </Section>

      {/* ── Privacy ─────────────────────────────────────────── */}
      <Section label="Privacy">
        <Row label="Privacy controls" onClick={() => navigate('/privacy')} />
        <Row
          label={exporting ? 'Preparing export…' : 'Download my data'}
          leftIcon={Download}
          onClick={exporting ? undefined : exportMyData}
        />
      </Section>

      {/* ── About ───────────────────────────────────────────── */}
      <Section label="About">
        <Row label="Version" value="1.0.0" onClick={() => {}} />
      </Section>

      {/* ── Planned for v1.1 (only the genuinely-unbuilt items remain) ──
           Items previously listed here that have now SHIPPED in v1:
             • Google Calendar (read-only OAuth import) — see Integrations above
             • 2FA login enforcement — /login now requires the TOTP code when enabled
           The remaining items are deferred for principled reasons:
             • Two-way Google sync — write access is a different threat model
             • Apple CalDAV       — would require user's Apple ID password
       */}
      <Section
        label="Planned for v1.1"
        hint={<span className="text-xs text-2">Not in this release</span>}
      >
        <PlannedRow
          label="Google Calendar two-way sync (write)"
          onClick={() => toast('Planned for v1.1', 'v1 ships read-only OAuth import. Two-way sync (writing schedule_blocks back to Google) is a different threat model — deferred.', 'info')}
        />
      </Section>

      {/* ── Account actions ─────────────────────────────────── */}
      <Section label="Account actions">
        <Row label="Sign out" onClick={handleLogout} />
        <Row label="Delete account" danger onClick={() => navigate('/profile')} />
      </Section>

      {/* Modals */}
      <PasswordChangeModal open={pwOpen}     onClose={() => setPwOpen(false)} />
      <TwoFactorModal      open={twofaOpen}  onClose={() => setTwofaOpen(false)} />
    </div>
  )
}
