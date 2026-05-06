import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError(''); setMsg(''); setLoading(true)
    try {
      const r = await api.forgotPassword(email)
      setMsg(r.message || 'Check your email for a reset link.')
      setSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card fade-up">
        <div className="auth-logo">Time<span>Bridge</span></div>
        <p className="auth-tagline">Reset your password — we'll email you a link.</p>
        <div className="card">
          <form onSubmit={submit} className="stack g16">
            <div>
              <div style={{ fontFamily:'Syne,sans-serif', fontSize:18, fontWeight:600, marginBottom:6 }}>
                Forgot your password?
              </div>
              <div className="text-sm text-2">
                Type the email you used to sign up. If we find an account, we'll send a reset link valid for 30 minutes.
              </div>
            </div>

            {error && <div className="alert alert-error">{error}</div>}
            {msg   && <div className="alert alert-success">{msg}</div>}

            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-input"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={sent}
              />
            </div>

            {!sent && (
              <button className="btn btn-primary btn-full" disabled={loading}>
                {loading && <span className="spinner"/>}
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            )}

            {sent && (
              <button
                type="button"
                className="btn btn-outline btn-full"
                onClick={() => { setSent(false); setMsg(''); setEmail('') }}
              >
                Send to another email
              </button>
            )}

            <p style={{ textAlign:'center', fontSize:13, color:'var(--text2)' }}>
              Remembered it?{' '}
              <Link to="/auth" style={{ color:'var(--accent)', fontWeight:500 }}>Back to sign in</Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
