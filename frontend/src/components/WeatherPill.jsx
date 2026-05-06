import { useEffect, useState } from 'react'
import {
  Sun, CloudSun, Cloud, CloudFog, CloudDrizzle, CloudRain,
  CloudSnow, CloudLightning, Moon,
} from 'lucide-react'
import { getWeatherFor, describeWmoCode } from '../utils/weather'

/* Map the icon names returned by describeWmoCode() to actual components.
   Kept here (not in utils/weather) because utils stays React-free so it's
   importable from the mobile app too. */
const ICONS = {
  Sun, CloudSun, Cloud, CloudFog, CloudDrizzle, CloudRain,
  CloudSnow, CloudLightning,
}

/* useWeather — small hook that fetches weather for a (city, country)
   and re-fires whenever those change. Returns { data, loading, error }.
   The util layer caches per-coordinate, so two pills for the same city
   share one request. */
export function useWeather(city, country) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    if (!city) { setData(null); return }
    setLoading(true); setError(null)
    getWeatherFor(city, country)
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [city, country])

  return { data, loading, error }
}

/* Compact pill: <icon> 22°C — used on family cards. Returns null when
   we can't compute weather (no city, fetch failed, etc.) so the calling
   row simply doesn't render the pill. */
export default function WeatherPill({ city, country, size = 'sm' }) {
  const { data, loading } = useWeather(city, country)

  if (!city) return null
  if (loading) {
    return <span className="skeleton" style={{ width: 56, height: 18, borderRadius: 100 }} />
  }
  if (!data) return null

  const desc = describeWmoCode(data.weatherCode)
  // Night clear → use Moon instead of Sun.
  let Icon = ICONS[desc.icon] || Cloud
  if (desc.icon === 'Sun' && !data.isDay) Icon = Moon

  const pillStyle = size === 'lg'
    ? { fontSize: 14, padding: '4px 10px' }
    : { fontSize: 11, padding: '2px 8px' }

  return (
    <span className="tag" title={`${desc.label} · ${data.wind} km/h · ${data.humidity}%`} style={pillStyle}>
      <Icon size={size === 'lg' ? 14 : 11} strokeWidth={2} aria-hidden="true" />
      {data.temperature}°C
    </span>
  )
}
