import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { api } from '../api/client'

export default function ResetPasswordPage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [done, setDone]         = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setLoading(true)
    try {
      await api.resetPassword(token, password)
      setDone(true)
      setTimeout(() => navigate('/auth'), 1800)
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
        <p className="auth-tagline">Choose a new password.</p>
        <div className="card">
          {done ? (
            <div className="stack g16">
              <div className="alert alert-success row g8" style={{ alignItems: 'center' }}>
                <CheckCircle2 size={16} strokeWidth={2} aria-hidden="true" />
                Password reset! Redirecting you to sign in…
              </div>
              <Link to="/auth" className="btn btn-primary btn-full">Go to sign in now</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="stack g16">
              <div>
                <div style={{ fontFamily:'Syne,sans-serif', fontSize:18, fontWeight:600, marginBottom:6 }}>
                  Set a new password
                </div>
                <div className="text-sm text-2">
                  Pick something at least 6 characters. After this, your old password stops working.
                </div>
              </div>

              {error && <div className="alert alert-error">{error}</div>}

              <div className="form-group">
                <label className="form-label">New password</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Confirm password</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Type it again"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                />
              </div>

              <button className="btn btn-primary btn-full" disabled={loading}>
                {loading && <span className="spinner"/>}
                {loading ? 'Saving…' : 'Save new password'}
              </button>

              <p style={{ textAlign:'center', fontSize:13, color:'var(--text2)' }}>
                <Link to="/auth" style={{ color:'var(--accent)', fontWeight:500 }}>Back to sign in</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
