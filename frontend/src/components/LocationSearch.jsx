import { useEffect, useRef, useState } from 'react'
import { MapPin } from 'lucide-react'
import { searchLocations } from '../utils/geoLocate'

export default function LocationSearch({ city, country, onSelect }) {
  const [query, setQuery] = useState([city, country].filter(Boolean).join(', '))
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const lastSelected = useRef(query)

  useEffect(() => {
    const next = [city, country].filter(Boolean).join(', ')
    if (next && next !== lastSelected.current) {
      lastSelected.current = next
      setQuery(next)
    }
  }, [city, country])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2 || q === lastSelected.current) {
      setResults([])
      setError('')
      return
    }

    let cancelled = false
    setLoading(true)
    setError('')
    const t = setTimeout(() => {
      searchLocations(q)
        .then(list => {
          if (cancelled) return
          setResults(list)
          setOpen(true)
        })
        .catch(e => {
          if (cancelled) return
          setResults([])
          setError(e.message)
        })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  function choose(place) {
    const label = [place.city, place.country].filter(Boolean).join(', ')
    lastSelected.current = label
    setQuery(label)
    setOpen(false)
    setResults([])
    onSelect({
      city: place.city,
      country: place.country,
      timezone: place.timezone,
    })
  }

  return (
    <div className="loc-search">
      <input
        type="text"
        className="form-input"
        placeholder="Search city or country..."
        value={query}
        onChange={e => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => { if (results.length) setOpen(true) }}
        autoComplete="off"
      />
      {loading && <span className="loc-search-spin spinner" />}
      {open && results.length > 0 && (
        <div className="loc-menu">
          {results.map(place => (
            <button
              key={`${place.id}-${place.city}-${place.country}`}
              type="button"
              className="loc-option"
              onMouseDown={e => e.preventDefault()}
              onClick={() => choose(place)}
            >
              <MapPin size={14} strokeWidth={2} aria-hidden="true" />
              <span>
                <span className="loc-main">{place.city}, {place.country}</span>
                {place.admin && <span className="loc-sub">{place.admin}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      {error && <div className="text-xs" style={{ color: 'var(--red)', marginTop: 6 }}>{error}</div>}
    </div>
  )
}
