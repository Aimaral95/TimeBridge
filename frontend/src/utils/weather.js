/* ─────────────────────────────────────────────────────────────────
   weather.js — Open-Meteo wrapper.

   Open-Meteo is free, requires no API key, and exposes both:
     - a geocoding endpoint (city/country → latitude/longitude)
     - a forecast endpoint (lat/lng → current temperature, weather code,
                            wind speed, humidity)

   We split the two so we can cache them differently:
     - geocoding result lives forever (city locations don't move)
     - weather TTL is ~10 minutes (don't pummel the API on every render)

   Both caches use localStorage. Keys are namespaced under tb_geo_ and
   tb_wx_ so they don't collide with anything else the app stores.

   The weather code returned by Open-Meteo is the WMO standard:
     https://www.nodc.noaa.gov/archive/arc0021/0002199/1.1/data/0-data/HTML/WMO-CODE/WMO4677.HTM
   We map the codes into a small set of human labels + a Lucide icon
   name so the UI can render a consistent pictogram. */

const GEO_PREFIX = 'tb_geo_'
const WX_PREFIX  = 'tb_wx_'
const WX_TTL_MS  = 10 * 60 * 1000   // 10 minutes
const GEO_URL    = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

/* ── WMO weather code → label + Lucide icon name ─────────────────── */
export function describeWmoCode(code) {
  // Group ranges so the table stays small. Source: WMO 4677.
  if (code === 0)                     return { label: 'Clear',          icon: 'Sun' }
  if (code === 1)                     return { label: 'Mainly clear',   icon: 'Sun' }
  if (code === 2)                     return { label: 'Partly cloudy',  icon: 'CloudSun' }
  if (code === 3)                     return { label: 'Overcast',       icon: 'Cloud' }
  if (code === 45 || code === 48)     return { label: 'Fog',            icon: 'CloudFog' }
  if (code >= 51 && code <= 57)       return { label: 'Drizzle',        icon: 'CloudDrizzle' }
  if (code >= 61 && code <= 67)       return { label: 'Rain',           icon: 'CloudRain' }
  if (code >= 71 && code <= 77)       return { label: 'Snow',           icon: 'CloudSnow' }
  if (code >= 80 && code <= 82)       return { label: 'Rain showers',   icon: 'CloudRain' }
  if (code >= 85 && code <= 86)       return { label: 'Snow showers',   icon: 'CloudSnow' }
  if (code >= 95 && code <= 99)       return { label: 'Thunderstorm',   icon: 'CloudLightning' }
  return { label: 'Unknown', icon: 'Cloud' }
}

/* ── Cache helpers ──────────────────────────────────────────────── */
function _readJson(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null }
  catch { return null }
}
function _writeJson(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}

/* ── Geocoding ──────────────────────────────────────────────────── */

/** Resolve a city/country pair to { latitude, longitude }.
 *  Returns null if Open-Meteo returns no results.
 *  Cached forever (city locations are stable). */
export async function geocode(city, country) {
  if (!city) return null
  const key = `${GEO_PREFIX}${city.toLowerCase()}|${(country || '').toLowerCase()}`
  const cached = _readJson(key)
  if (cached?.latitude != null && cached?.longitude != null) return cached

  const u = new URL(GEO_URL)
  u.searchParams.set('name',  city)
  u.searchParams.set('count', '1')
  u.searchParams.set('language', 'en')
  if (country) u.searchParams.set('countryCode', '')   // hint only — name match is enough
  const r = await fetch(u)
  if (!r.ok) throw new Error(`Geocoding failed (${r.status})`)
  const data = await r.json()
  const top = data?.results?.[0]
  if (!top) return null
  const out = { latitude: top.latitude, longitude: top.longitude, name: top.name, country: top.country }
  _writeJson(key, out)
  return out
}

/* ── Forecast ───────────────────────────────────────────────────── */

/** Fetch current weather for a lat/lng. Cached for 10 minutes per
 *  rounded coordinate so two pages opened in quick succession share
 *  the same fetch. Returns null on network failure (so the UI can
 *  fall back gracefully instead of throwing). */
export async function fetchCurrentWeather(latitude, longitude) {
  if (latitude == null || longitude == null) return null
  // Round to ~1 km so cache hits work across nearby points.
  const lat = Math.round(latitude  * 100) / 100
  const lng = Math.round(longitude * 100) / 100
  const key = `${WX_PREFIX}${lat}|${lng}`
  const cached = _readJson(key)
  if (cached && Date.now() - cached.fetchedAt < WX_TTL_MS) return cached.data

  const u = new URL(FORECAST_URL)
  u.searchParams.set('latitude',         String(lat))
  u.searchParams.set('longitude',        String(lng))
  u.searchParams.set('current',          'temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m,is_day')
  u.searchParams.set('temperature_unit', 'celsius')
  u.searchParams.set('wind_speed_unit',  'kmh')
  u.searchParams.set('timezone',         'auto')
  let data
  try {
    const r = await fetch(u)
    if (!r.ok) return null
    const j = await r.json()
    if (!j?.current) return null
    data = {
      temperature: Math.round(j.current.temperature_2m),
      weatherCode: j.current.weather_code,
      wind:        Math.round(j.current.wind_speed_10m),
      humidity:    j.current.relative_humidity_2m,
      isDay:       j.current.is_day === 1,
    }
  } catch { return null }
  _writeJson(key, { fetchedAt: Date.now(), data })
  return data
}

/** One-shot helper: city/country → { temperature, weatherCode, wind, humidity, isDay }
 *  Returns null on failure (no city, no geocode, no fetch). */
export async function getWeatherFor(city, country) {
  if (!city) return null
  try {
    const loc = await geocode(city, country)
    if (!loc) return null
    return await fetchCurrentWeather(loc.latitude, loc.longitude)
  } catch { return null }
}
