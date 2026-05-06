import { useState, useEffect } from 'react'
import Modal from './Modal'
import { api } from '../api/client'
import { useToast } from '../context/ToastContext'
import { useNotes } from '../context/NotesContext'

/* Send-a-note composer. Triggered from FamilyPage member rows.

   Props:
     open       — boolean
     onClose    — fn
     toUser     — { id, name } recipient connection (other_id + other_name from /connections)
     onSent     — optional callback after success
*/

const MAX_LEN = 500

export default function NoteModal({ open, onClose, toUser, onSent }) {
  const toast = useToast()
  const { refreshUnread } = useNotes()
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) { setBody(''); setError(''); setLoading(false) }
  }, [open])

  async function send() {
    const text = body.trim()
    if (!text) { setError('Write something first.'); return }
    if (text.length > MAX_LEN) { setError(`Notes must be ${MAX_LEN} characters or fewer.`); return }
    setLoading(true); setError('')
    try {
      await api.sendNote(toUser.id, text)
      toast('Note sent', `${toUser.name} will see it next time they open TimeBridge.`)
      refreshUnread()
      onSent?.()
      onClose?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Leave a note for ${toUser?.name || ''}`}
      subtitle="A short message they'll see in their inbox. No notifications, no pressure."
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={send} disabled={loading || !body.trim()}>
          {loading && <span className="spinner"/>} Send note
        </button>
      </>}
    >
      <div className="stack g12">
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-group">
          <textarea
            className="form-input"
            rows={5}
            maxLength={MAX_LEN}
            placeholder="Hey, hope your day is going well — can we talk this weekend?"
            value={body}
            onChange={e => setBody(e.target.value)}
            autoFocus
            style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
          />
          <div className="row sb mt8">
            <span className="text-xs text-2">Plain text. No formatting yet.</span>
            <span className="text-xs text-2">{body.length}/{MAX_LEN}</span>
          </div>
        </div>
      </div>
    </Modal>
  )
}
