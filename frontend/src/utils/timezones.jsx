export const TZ_GROUPS = {
  'Americas': [
    'America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
    'America/Anchorage','America/Honolulu','America/Toronto','America/Vancouver',
    'America/Sao_Paulo','America/Argentina/Buenos_Aires','America/Mexico_City',
    'America/Bogota','America/Lima','America/Santiago','America/Caracas',
    'America/Halifax','America/St_Johns','America/Manaus','America/Montevideo',
  ],
  'Europe': [
    'Europe/London','Europe/Paris','Europe/Berlin','Europe/Madrid','Europe/Rome',
    'Europe/Amsterdam','Europe/Brussels','Europe/Vienna','Europe/Zurich',
    'Europe/Stockholm','Europe/Oslo','Europe/Copenhagen','Europe/Helsinki',
    'Europe/Warsaw','Europe/Prague','Europe/Budapest','Europe/Bucharest',
    'Europe/Athens','Europe/Istanbul','Europe/Moscow','Europe/Kiev','Europe/Lisbon',
    'Europe/Minsk','Europe/Riga','Europe/Tallinn','Europe/Vilnius',
  ],
  'Asia': [
    'Asia/Dubai','Asia/Kolkata','Asia/Kathmandu','Asia/Dhaka','Asia/Bangkok',
    'Asia/Singapore','Asia/Kuala_Lumpur','Asia/Jakarta','Asia/Hong_Kong',
    'Asia/Shanghai','Asia/Tokyo','Asia/Seoul','Asia/Manila','Asia/Karachi',
    'Asia/Tashkent','Asia/Almaty','Asia/Tehran','Asia/Baghdad','Asia/Riyadh',
    'Asia/Jerusalem','Asia/Beirut','Asia/Taipei','Asia/Colombo','Asia/Yangon',
    'Asia/Yekaterinburg','Asia/Novosibirsk','Asia/Krasnoyarsk','Asia/Irkutsk',
    'Asia/Yakutsk','Asia/Vladivostok',
  ],
  'Africa': [
    'Africa/Cairo','Africa/Johannesburg','Africa/Lagos','Africa/Nairobi',
    'Africa/Casablanca','Africa/Accra','Africa/Tunis','Africa/Khartoum',
    'Africa/Addis_Ababa','Africa/Dar_es_Salaam',
  ],
  'Pacific': [
    'Pacific/Auckland','Pacific/Fiji','Pacific/Honolulu','Pacific/Guam',
    'Pacific/Apia','Pacific/Tahiti','Pacific/Noumea',
  ],
  'Australia': [
    'Australia/Sydney','Australia/Melbourne','Australia/Brisbane',
    'Australia/Perth','Australia/Adelaide','Australia/Darwin',
  ],
  'Other': ['UTC'],
}

export function detectTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'UTC' }
}

export function formatTz(tz) {
  try {
    const offset = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || ''
    return `${tz.replace(/_/g, ' ')} (${offset})`
  } catch { return tz.replace(/_/g, ' ') }
}

// TZ searchable dropdown component
import { useState } from 'react'

export function TzSelect({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')

  const allTzs = Object.values(TZ_GROUPS).flat()
  const filtered = q.trim()
    ? allTzs.filter(tz => tz.toLowerCase().includes(q.toLowerCase()))
    : null

  return (
    <div style={{ position: 'relative' }}>
      <div
        className="form-input row sb"
        style={{ cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ color: value ? 'var(--text)' : 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value ? formatTz(value) : 'Select timezone…'}
        </span>
        <span style={{ color: 'var(--text3)', fontSize: 11, flexShrink: 0, marginLeft: 8 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--r2)', boxShadow: 'var(--shadow)',
          maxHeight: 280, overflow: 'hidden', display: 'flex', flexDirection: 'column', marginTop: 4,
        }}>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
            <input autoFocus className="form-input" placeholder="Search city or timezone…"
              value={q} onChange={e => setQ(e.target.value)} onClick={e => e.stopPropagation()}
              style={{ padding: '6px 10px', fontSize: 13 }} />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {(filtered || []).length > 0 || q.trim()
              ? (filtered || []).map(tz => (
                  <TzOpt key={tz} tz={tz} sel={value===tz} onPick={() => { onChange(tz); setOpen(false); setQ('') }} />
                ))
              : Object.entries(TZ_GROUPS).map(([region, tzs]) => (
                  <div key={region}>
                    <div style={{ padding: '7px 14px 3px', fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text3)', background: 'var(--surface2)' }}>{region}</div>
                    {tzs.map(tz => <TzOpt key={tz} tz={tz} sel={value===tz} onPick={() => { onChange(tz); setOpen(false) }} />)}
                  </div>
                ))
            }
          </div>
        </div>
      )}
    </div>
  )
}

function TzOpt({ tz, sel, onPick }) {
  return (
    <div onClick={onPick} style={{
      padding: '8px 14px', cursor: 'pointer', fontSize: 13,
      background: sel ? 'rgba(63,185,80,.12)' : 'transparent',
      color: sel ? 'var(--accent)' : 'var(--text)',
      fontWeight: sel ? 500 : 400,
    }}
    onMouseEnter={e => { if (!sel) e.currentTarget.style.background = 'var(--surface2)' }}
    onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'transparent' }}
    >
      {formatTz(tz)}
    </div>
  )
}
