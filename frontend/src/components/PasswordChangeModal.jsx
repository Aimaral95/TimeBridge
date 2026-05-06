import { useState } from 'react'
import Modal from './Modal'
import { api } from '../api/client'
import { useToast } from '../context/ToastContext'

/* Triggered from SettingsPage. Submits to POST /change-password.

   Backend rules (mirrored here for fast feedback):
     - new password >= 6 chars
     - new password != current password
     - current password verified server-side via bcrypt.compare */

export default function PasswordChangeModal({ open, onClose }) {
  const toast = useToast()
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function reset() {
    setForm({ current: '', next: '', confirm: '' })
    setError('')
  }
  function close() { reset(); onClose?.() }

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (form.next.length < 6)        return setError('New password must be at least 6 characters.')
    if (form.next === form.current)  return setError('New password must differ from your current one.')
    if (form.next !== form.confirm)  return setError('New passwords do not match.')
    setLoading(true)
    try {
      await api.changePassword(form.current, form.next)
      toast('Password updated', 'Use the new password next time you sign in.')
      close()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Change password"
      subtitle="Enter your current password, then choose a new one."
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={close} disabled={loading}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={loading}>
          {loading && <span className="spinner"/>} Update password
        </button>
      </>}
    >
      <form onSubmit={submit} className="stack g14">
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-group">
          <label className="form-label">Current password</label>
          <input
            type="password"
            className="form-input"
            value={form.current}
            onChange={e => setForm(f => ({ ...f, current: e.target.value }))}
            autoFocus
            required
          />
        </div>
        <div className="form-group">
          <label className="form-label">New password</label>
          <input
            type="password"
            className="form-input"
            placeholder="At least 6 characters"
            value={form.next}
            onChange={e => setForm(f => ({ ...f, next: e.target.value }))}
            required
          />
        </div>
        <div className="form-group">
          <label className="form-label">Confirm new password</label>
          <input
            type="password"
            className="form-input"
            value={form.confirm}
            onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
            required
          />
        </div>
        {/* Hidden submit so pressing Enter in any field submits the form. */}
        <button type="submit" style={{ display: 'none' }} aria-hidden="true" />
      </form>
    </Modal>
  )
}
