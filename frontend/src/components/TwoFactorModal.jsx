import { useState, useEffect } from 'react'
import { Copy, ExternalLink } from 'lucide-react'
import Modal from './Modal'
import { api } from '../api/client'
import { useToast } from '../context/ToastContext'

/* Two-step TOTP enrollment:

     1. /2fa/setup → backend issues a fresh secret + otpauth:// URL
     2. user scans the URL into Google Authenticator / 1Password / etc.
     3. user enters the 6-digit code → /2fa/verify enables 2FA

   Note (mentioned on the screen and in the Settings row): twofa_enabled is
   stored on the user but the backend does NOT yet require the second
   factor at /login — that hardening is planned for v1.1. We surface the
   beta status honestly. */

export default function TwoFactorModal({ open, onClose }) {
  const toast = useToast()
  const [stage, setStage] = useState('setup')      // 'setup' | 'verify' | 'done'
  const [secret, setSecret] = useState('')
  const [otpauth, setOtpauth] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Kick off enrollment on first open.
  useEffect(() => {
    if (!open) return
    setStage('setup'); setError(''); setCode(''); setSecret(''); setOtpauth('')
    setLoading(true)
    api.twofaSetup()
      .then(d => { setSecret(d.secret); setOtpauth(d.otpauth); setStage('verify') })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [open])

  async function verify(e) {
    e?.preventDefault?.()
    if (!/^\d{6}$/.test(code)) { setError('Enter the 6-digit code from your authenticator app.'); return }
    setError(''); setLoading(true)
    try {
      await api.twofaVerify(code)
      setStage('done')
      toast('2FA enabled', 'Beta — your account stores the secret, but the login challenge ships in v1.1.')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function copy(text, label) {
    navigator.clipboard?.writeText(text)
    toast(`${label} copied`)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Set up two-factor authentication"
      subtitle="Beta — enrollment works end-to-end. Login enforcement ships in v1.1."
      footer={
        stage === 'done' ? (
          <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
            {stage === 'verify' && (
              <button type="button" className="btn btn-primary" onClick={verify} disabled={loading}>
                {loading && <span className="spinner"/>} Verify & enable
              </button>
            )}
          </>
        )
      }
    >
      {stage === 'setup' && loading && (
        <div className="text-sm text-2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="spinner" /> Generating a fresh secret…
        </div>
      )}

      {stage === 'verify' && (
        <div className="stack g14">
          {error && <div className="alert alert-error">{error}</div>}

          <div className="text-sm text-2">
            1. Open Google Authenticator (or 1Password / Authy / Bitwarden) and add a new entry.
          </div>

          {/* otpauth:// URL — the easiest cross-app way to add the code. */}
          <div className="form-group">
            <label className="form-label">otpauth:// URL</label>
            <div className="row g8">
              <input className="form-input flex-1" value={otpauth} readOnly
                style={{ fontFamily: 'monospace', fontSize: 12 }}/>
              <button type="button" className="btn btn-ghost btn-sm"
                onClick={() => copy(otpauth, 'URL')}>
                <Copy size={13} strokeWidth={2} aria-hidden="true" /> Copy
              </button>
            </div>
            <div className="text-xs text-2" style={{ marginTop: 4 }}>
              Some authenticator apps accept the URL directly (e.g. paste into 1Password's URL field).
            </div>
          </div>

          {/* Plain secret — apps without URL paste support take this. */}
          <div className="form-group">
            <label className="form-label">Or enter this secret manually</label>
            <div className="row g8">
              <input className="form-input flex-1" value={secret} readOnly
                style={{ fontFamily: 'monospace', letterSpacing: '.1em' }}/>
              <button type="button" className="btn btn-ghost btn-sm"
                onClick={() => copy(secret, 'Secret')}>
                <Copy size={13} strokeWidth={2} aria-hidden="true" /> Copy
              </button>
            </div>
            <div className="text-xs text-2" style={{ marginTop: 4 }}>
              Algorithm: SHA1 · Digits: 6 · Period: 30s
            </div>
          </div>

          <div className="text-sm text-2">
            2. Once added, your authenticator will show a 6-digit code that
            rotates every 30 seconds. Enter the current code below to confirm.
          </div>

          <form onSubmit={verify}>
            <div className="form-group">
              <label className="form-label">6-digit code</label>
              <input
                className="form-input"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                placeholder="000000"
                style={{ fontFamily: 'monospace', letterSpacing: '.3em', fontSize: 18, textAlign: 'center' }}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0,6))}
                autoFocus
              />
            </div>
            <button type="submit" style={{ display: 'none' }} aria-hidden="true" />
          </form>
        </div>
      )}

      {stage === 'done' && (
        <div className="alert alert-success">
          <strong>2FA enrolled.</strong> Your authenticator is paired with this account. Login
          enforcement is on the v1.1 roadmap; until then 2FA is stored but not yet challenged
          at sign-in.
        </div>
      )}

      {error && stage === 'setup' && <div className="alert alert-error">{error}</div>}
    </Modal>
  )
}
