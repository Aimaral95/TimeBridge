const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5050'

function getToken() { return localStorage.getItem('tb_token') }

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  let res
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  } catch {
    throw new Error('Cannot reach server. Is your backend running on port 5050?')
  }
  const text = await res.text()
  if (!text) throw new Error('Empty response from server')
  let data
  try { data = JSON.parse(text) } catch { throw new Error(`Bad response: ${text.slice(0, 80)}`) }
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export const api = {
  register:  (b) => request('POST', '/register', b),
  login:     (b) => request('POST', '/login', b),
  getMe:     ()  => request('GET',  '/me'),
  updateMe:  (b) => request('PUT',  '/me', b),
  deleteMe:  ()  => request('DELETE','/me'),

  // Password reset
  forgotPassword: (email) => request('POST', '/forgot-password', { email }),
  resetPassword:  (token, password) => request('POST', '/reset-password', { token, password }),

  createInvite:    ()     => request('POST', '/connections/invite'),
  joinInvite:      (code) => request('POST', '/connections/join', { invite_code: code }),
  getConnections:  ()     => request('GET',  '/connections'),
  deleteConnection: (id)  => request('DELETE', `/connections/${id}`),
  getConnectionAvailability: (otherId) =>
    request('GET', `/connections/${otherId}/availability`),

  saveAvailability: (slots) => request('POST', '/availability', { slots }),
  getAvailability:  ()      => request('GET',  '/availability'),
  getOverlap:       ()      => request('GET',  '/availability/overlap'),

  // Recurring weekly schedule blocks
  getSchedule:    ()  => request('GET',  '/schedule'),
  addScheduleBlock: (b) => request('POST', '/schedule', b),
  removeScheduleBlock: (id) => request('DELETE', `/schedule/${id}`),

  // Account management — newly shipped from the v1.1 "Planned" list
  changePassword: (current_password, new_password) =>
    request('POST', '/change-password', { current_password, new_password }),

  // Data export — GETs JSON; the export endpoint sets a Content-Disposition
  // header so the browser triggers a file download rather than navigating.
  exportDataUrl:  () => `${BASE}/me/export`,

  // Privacy settings
  getPrivacy:     ()  => request('GET', '/privacy'),
  putPrivacy:     (contact_id, settings) =>
    request('PUT', '/privacy', { contact_id, settings }),

  // 2FA (TOTP). Setup returns { secret, otpauth }. Verify enables.
  twofaSetup:     ()  => request('POST', '/2fa/setup'),
  twofaVerify:    (code) => request('POST', '/2fa/verify', { code }),
  twofaDisable:   (current_password) => request('DELETE', '/2fa', { current_password }),

  // Google Calendar integration.
  googleStatus:     ()  => request('GET',    '/integrations/google/status'),
  googleConnect:    ()  => request('GET',    '/integrations/google/connect'),
  googleImport:     ()  => request('POST',   '/integrations/google/import'),
  googleDisconnect: ()  => request('DELETE', '/integrations/google'),

  // Notes — small one-way messages between connected family members.
  sendNote:        (to_user_id, body) => request('POST',   '/notes', { to_user_id, body }),
  getNotes:        ()                 => request('GET',    '/notes'),
  getUnreadCount:  ()                 => request('GET',    '/notes/unread-count'),
  deleteNote:      (id)               => request('DELETE', `/notes/${id}`),
}
