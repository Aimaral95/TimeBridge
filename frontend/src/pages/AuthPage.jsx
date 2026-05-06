import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { MapPin } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { TzSelect, detectTz } from '../utils/timezones'
import { detectLocation } from '../utils/geoLocate'

function LoginForm({ onSwitch }) {
  const [form, setForm] = useState({ email: '', password: '', twofa_code: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // 2FA flow state. When the backend says twofa_required, we keep the email
  // + password locked in and reveal a 6-digit code field. The user re-submits
  // to complete the login.
  const [twofaStage, setTwofaStage] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  async function submit(e) {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const d = await api.login(form)
      // Backend tells us "password OK, give me the TOTP code".
      if (d.twofa_required) {
        setTwofaStage(true)
        setLoading(false)
        return
      }
      // Normal success.
      login(d.token, d.user)
      toast('Welcome back', d.user.name)
      navigate('/')
    } catch (err) { setError(err.message); setLoading(false) }
  }

  function backToPassword() {
    setTwofaStage(false)
    setForm(f => ({ ...f, twofa_code: '' }))
    setError('')
  }

  return (
    <form onSubmit={submit} className="stack g20">
      {error && <div className="alert alert-error">{error}</div>}

      {!twofaStage && (
        <>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input type="email" className="form-input" placeholder="you@example.com"
              value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} required />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input type="password" className="form-input" placeholder="••••••••"
              value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))} required />
          </div>
        </>
      )}

      {twofaStage && (
        <>
          <div className="alert alert-info text-sm">
            This account has two-factor authentication enabled. Enter the 6-digit
            code from your authenticator app to finish signing in as
            <strong> {form.email}</strong>.
          </div>
          <div className="form-group">
            <label className="form-label">6-digit code</label>
            <input
              className="form-input"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              placeholder="000000"
              style={{ fontFamily: 'monospace', letterSpacing: '.3em', fontSize: 18, textAlign: 'center' }}
              value={form.twofa_code}
              onChange={e => setForm(f => ({ ...f, twofa_code: e.target.value.replace(/\D/g, '').slice(0,6) }))}
              autoFocus
              required
            />
          </div>
        </>
      )}

      <button className="btn btn-primary btn-full" disabled={loading}>
        {loading && <span className="spinner"/>}
        {loading ? 'Signing in…' : (twofaStage ? 'Verify & sign in' : 'Sign in')}
      </button>

      {twofaStage ? (
        <p style={{ textAlign:'center', fontSize:13 }}>
          <button type="button" onClick={backToPassword} style={{ background:'none',border:'none',cursor:'pointer',color:'var(--blue)',fontWeight:500 }}>
            ← Use a different account
          </button>
        </p>
      ) : (
        <>
          <p style={{ textAlign:'center', fontSize:13 }}>
            <Link to="/forgot-password" style={{ color:'var(--blue)', fontWeight:500 }}>
              Forgot your password?
            </Link>
          </p>
          <p style={{ textAlign:'center', fontSize:13, color:'var(--text2)' }}>
            No account?{' '}
            <button type="button" onClick={onSwitch} style={{ background:'none',border:'none',cursor:'pointer',color:'var(--accent)',fontWeight:500 }}>
              Create one
            </button>
          </p>
        </>
      )}
    </form>
  )
}

function RegisterForm({ onSwitch }) {
  const detected = detectTz()
  const [form, setForm] = useState({
    name: '', email: '', password: '', timezone: detected,
    city: '', country: '',
  })
  const [loading, setLoading] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState('')
  const { login } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  async function submit(e) {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      // Send city/country at registration so the backend persists them — that's
      // what powers the Dashboard weather hero on first login.
      await api.register({
        name: form.name, email: form.email, password: form.password,
        timezone: form.timezone, city: form.city, country: form.country,
      })
      const d = await api.login({ email: form.email, password: form.password })
      // Backend now returns city/country on login too, so trust d.user. Fall
      // back to the form values just in case the backend hasn't been restarted
      // since the schema additions.
      login(d.token, { city: form.city, country: form.country, ...d.user })
      toast('Welcome to TimeBridge', 'Account created successfully')
      navigate('/')
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  async function autoDetect() {
    setDetecting(true)
    try {
      const loc = await detectLocation()
      setForm(f => ({
        ...f,
        city: loc.city || f.city,
        country: loc.country || f.country,
        timezone: loc.timezone || f.timezone,
      }))
      toast('Detected', `${loc.city || 'Unknown'}, ${loc.country || ''}`)
    } catch (err) {
      toast('Could not detect', err.message)
    } finally {
      setDetecting(false)
    }
  }

  const set = k => e => setForm(f => ({...f, [k]: e.target.value}))

  return (
    <form onSubmit={submit} className="stack g16">
      {error && <div className="alert alert-error">{error}</div>}
      <div className="form-group">
        <label className="form-label">Full name</label>
        <input type="text" className="form-input" placeholder="Jane Smith"
          value={form.name} onChange={set('name')} required />
      </div>
      <div className="form-group">
        <label className="form-label">Email</label>
        <input type="email" className="form-input" placeholder="you@example.com"
          value={form.email} onChange={set('email')} required />
      </div>
      <div className="form-group">
        <label className="form-label">Password</label>
        <input type="password" className="form-input" placeholder="At least 8 characters"
          value={form.password} onChange={set('password')} required />
      </div>
      <div>
        <div className="row sb mb4" style={{ alignItems:'center' }}>
          <label className="form-label" style={{ marginBottom:0 }}>Location</label>
          <button
            type="button"
            onClick={autoDetect}
            disabled={detecting}
            style={{
              background:'none', border:'none', cursor:'pointer',
              color:'var(--accent)', fontWeight:500, fontSize:12,
              display:'inline-flex', alignItems:'center', gap:4,
            }}
            title="Detect city, country, and timezone from your browser"
          >
            {detecting ? <span className="spinner"/> : <MapPin size={12} strokeWidth={2} aria-hidden="true" />} Auto-detect
          </button>
        </div>
        <div className="grid-2" style={{ gap:10 }}>
          <div className="form-group">
            <input type="text" className="form-input" placeholder="City (e.g. Almaty)"
              value={form.city} onChange={set('city')} />
          </div>
          <div className="form-group">
            <input type="text" className="form-input" placeholder="Country (e.g. Kazakhstan)"
              value={form.country} onChange={set('country')} />
          </div>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">
          Timezone
          <span style={{ color:'var(--accent)',fontSize:11,fontWeight:400,marginLeft:6 }}>
            ● Auto-detected: {detected.replace(/_/g,' ')}
          </span>
        </label>
        <TzSelect value={form.timezone} onChange={tz => setForm(f => ({...f, timezone: tz}))} />
      </div>
      <button className="btn btn-primary btn-full" disabled={loading} style={{ marginTop:4 }}>
        {loading && <span className="spinner"/>} {loading ? 'Creating account…' : 'Create account'}
      </button>
      <p style={{ textAlign:'center', fontSize:13, color:'var(--text2)' }}>
        Already have an account?{' '}
        <button type="button" onClick={onSwitch} style={{ background:'none',border:'none',cursor:'pointer',color:'var(--accent)',fontWeight:500 }}>
          Sign in
        </button>
      </p>
    </form>
  )
}

export default function AuthPage() {
  const [tab, setTab] = useState('login')
  return (
    <div className="auth-page">
      <div className="auth-card fade-up">
        <div className="auth-logo">Time<span>Bridge</span></div>
        <p className="auth-tagline">Stay connected with family across every timezone.</p>
        <div className="card">
          <div className="tab-bar">
            <button className={`tab-btn ${tab==='login'?'active':''}`} onClick={() => setTab('login')}>Sign in</button>
            <button className={`tab-btn ${tab==='register'?'active':''}`} onClick={() => setTab('register')}>Create account</button>
          </div>
          {tab === 'login'
            ? <LoginForm onSwitch={() => setTab('register')} />
            : <RegisterForm onSwitch={() => setTab('login')} />}
        </div>
      </div>
    </div>
  )
}
