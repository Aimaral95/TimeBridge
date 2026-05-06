import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapPin, Moon } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { TzSelect, detectTz } from '../utils/timezones'
import { detectLocation } from '../utils/geoLocate'
import { loadQuietHours, saveQuietHours, DEFAULT_QUIET } from '../utils/quietHours'

export default function ProfilePage() {
  const { user, updateUser, logout } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [profile, setProfile] = useState(null)
  const [form, setForm] = useState({ name:'', timezone:'', city:'', country:'' })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [quiet, setQuiet] = useState(DEFAULT_QUIET)

  async function detectMyLocation() {
    setDetecting(true)
    try {
      const loc = await detectLocation()
      setForm(f => ({
        ...f,
        city: loc.city || f.city,
        country: loc.country || f.country,
        timezone: loc.timezone || f.timezone,
      }))
      toast('Detected', `${loc.city || 'Unknown'}, ${loc.country || ''} (${loc.timezone})`)
    } catch (e) {
      toast('Could not detect', e.message)
    } finally {
      setDetecting(false)
    }
  }

  useEffect(() => {
    api.getMe().then(d => {
      setProfile(d.user)
      setForm({
        name: d.user.name,
        timezone: d.user.timezone || detectTz(),
        city: user?.city || '',
        country: user?.country || '',
      })
      setQuiet(loadQuietHours(d.user.id))
    }).catch(e => toast('Error', e.message))
  }, [])

  function setQuietField(k) {
    return e => {
      const v = e.target.value
      setQuiet(q => {
        const next = { ...q, [k]: v }
        if (profile?.id) saveQuietHours(profile.id, next)
        return next
      })
    }
  }

  async function save(e) {
    e.preventDefault(); setSaving(true)
    try {
      // Send city + country to the backend so they persist across re-login —
      // previously they only lived in client-side state, which is why weather
      // disappeared after signing out.
      const d = await api.updateMe({
        name: form.name, timezone: form.timezone,
        city: form.city, country: form.country,
      })
      setProfile(d.user)
      updateUser({ ...d.user, city: form.city, country: form.country })
      toast('Profile updated', 'Changes saved successfully')
    } catch (e) { toast('Error', e.message) }
    finally { setSaving(false) }
  }

  async function deleteAccount() {
    setDeleting(true)
    try {
      await api.deleteMe()
      logout(); navigate('/auth')
    } catch (e) { toast('Error', e.message); setDeleting(false) }
  }

  const set = k => e => setForm(f => ({...f, [k]: e.target.value}))

  if (!profile) return (
    <div className="page-wrap fade-up" style={{ maxWidth: 560 }}>
      <div className="page-header">
        <div><div className="page-title">Profile</div></div>
      </div>
      {/* Skeleton mirroring the eventual avatar + 4 input rows. */}
      <div className="card mb20">
        <div className="row g16 mb24">
          <span className="skeleton" style={{ width: 64, height: 64, borderRadius: '50%' }} />
          <div style={{ flex: 1 }}>
            <span className="skeleton" style={{ width: 140, height: 14, marginBottom: 6 }} />
            <span className="skeleton" style={{ width: 200, height: 11 }} />
          </div>
        </div>
        {[0,1,2,3].map(i => (
          <div key={i} className="form-group" style={{ marginBottom: 14 }}>
            <span className="skeleton" style={{ width: 80,  height: 10, marginBottom: 6 }} />
            <span className="skeleton" style={{ width: '100%', height: 36, borderRadius: 'var(--r2)' }} />
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="page-wrap fade-up" style={{ maxWidth:560 }}>
      <div className="page-header">
        <div><div className="page-title">Profile</div></div>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
          {saving && <span className="spinner"/>} Save changes
        </button>
      </div>

      {/* Avatar row */}
      <div className="card mb20">
        <div className="row g16 mb24">
          <div className="avatar av-64" style={{ background:'linear-gradient(135deg,rgba(63,185,80,.3),rgba(88,166,255,.3))', color:'var(--blue)', fontSize:22, fontWeight:600 }}>
            {profile.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:18, fontWeight:600 }}>{profile.name}</div>
            <div className="text-sm text-2">{profile.email}</div>
            <div className="text-xs text-2 mt8">Member since {new Date(profile.created_at).toLocaleDateString([],{month:'long',year:'numeric'})}</div>
          </div>
        </div>

        <form onSubmit={save} className="stack g16">
          <div className="form-group">
            <label className="form-label">Full name</label>
            <input className="form-input" value={form.name} onChange={set('name')} required />
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" value={profile.email} disabled />
          </div>
          <div>
            <div className="row sb mb4" style={{ alignItems: 'center' }}>
              <label className="form-label" style={{ marginBottom: 0 }}>Location</label>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={detectMyLocation}
                disabled={detecting}
                title="Use your browser to detect city, country and timezone"
              >
                {detecting ? <span className="spinner"/> : <MapPin size={13} strokeWidth={2} aria-hidden="true" />} Detect
              </button>
            </div>
            <div className="grid-2" style={{ gap:10 }}>
              <div className="form-group">
                <input className="form-input" placeholder="City (e.g. Almaty)" value={form.city} onChange={set('city')} />
              </div>
              <div className="form-group">
                <input className="form-input" placeholder="Country (e.g. Kazakhstan)" value={form.country} onChange={set('country')} />
              </div>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">
              Timezone
              <span style={{ color:'var(--accent)', fontSize:11, fontWeight:400, marginLeft:6 }}>
                ● Detected: {detectTz().replace(/_/g,' ')}
              </span>
            </label>
            <TzSelect value={form.timezone} onChange={tz => setForm(f=>({...f,timezone:tz}))} />
          </div>
        </form>
      </div>

      {/* Quiet hours */}
      <div className="section-label">Quiet hours</div>
      <div className="card mb20">
        <p className="text-sm text-2 mb12 row g6" style={{ alignItems: 'flex-start' }}>
          <Moon size={14} strokeWidth={2} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            Times when you don't want family to suggest a call. Overlap rows in
            your quiet window will be hidden.
          </span>
        </p>
        <div className="grid-2" style={{ gap: 10 }}>
          <div className="form-group">
            <label className="form-label">Start</label>
            <input
              type="time"
              className="form-input"
              value={quiet.start}
              onChange={setQuietField('start')}
            />
          </div>
          <div className="form-group">
            <label className="form-label">End</label>
            <input
              type="time"
              className="form-input"
              value={quiet.end}
              onChange={setQuietField('end')}
            />
          </div>
        </div>
        <div className="text-xs text-2" style={{ marginTop: 4 }}>
          Currently: {quiet.start} → {quiet.end}
          {quiet.start > quiet.end ? ' (wraps midnight)' : ''}
        </div>
      </div>

      {/* Account info */}
      <div className="section-label">Account info</div>
      <div className="card mb20">
        {[
          ['User ID', `#${profile.id}`],
          ['Email', profile.email],
          ['Timezone', profile.timezone?.replace(/_/g,' ')],
          ['Member since', new Date(profile.created_at).toLocaleDateString([],{dateStyle:'long'})],
        ].map(([k,v]) => (
          <div key={k} className="row sb" style={{ padding:'10px 0', borderBottom:'1px solid var(--border)' }}>
            <span className="text-xs text-2" style={{ textTransform:'uppercase', letterSpacing:'.05em' }}>{k}</span>
            <span className="text-sm">{v}</span>
          </div>
        ))}
      </div>

      {/* Danger zone */}
      <div className="section-label" style={{ color:'var(--red)' }}>Danger zone</div>
      <div className="card" style={{ border:'1px solid rgba(248,81,73,.25)' }}>
        {!confirmDelete ? (
          <div className="row sb">
            <div>
              <div style={{ fontWeight:500, fontSize:14, marginBottom:2 }}>Delete account</div>
              <div className="text-xs text-2">Removes your account, all connections and availability data permanently.</div>
            </div>
            <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>Delete</button>
          </div>
        ) : (
          <div className="stack g12">
            <div className="alert alert-error">
              <div style={{ fontWeight:500, marginBottom:3 }}>Are you absolutely sure?</div>
              <div className="text-xs">This cannot be undone. All your data will be permanently deleted.</div>
            </div>
            <div className="row g8">
              <button className="btn btn-danger btn-sm" onClick={deleteAccount} disabled={deleting}>
                {deleting && <span className="spinner"/>} Yes, delete my account
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
