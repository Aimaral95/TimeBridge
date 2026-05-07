/* ─────────────────────────────────────────────────────────────────
   geoLocate — small helpers used by ProfilePage and AuthPage to
   auto-fill city/country/timezone from the browser instead of asking
   the user to type all of it.

   Strategy:
     1. Ask the browser for GPS via navigator.geolocation
     2. Reverse-geocode lat/lon with OpenStreetMap Nominatim (no key)
     3. Always derive timezone from Intl.DateTimeFormat as a fallback

   Nominatim has a courtesy usage policy — for a personal/demo app at
   low volume this is fine. Do NOT remove the email/identifier in the
   URL or move this to a high-traffic production app without setting
   up your own tile server.
   ───────────────────────────────────────────────────────────────── */

const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse'
const OPEN_METEO_SEARCH = 'https://geocoding-api.open-meteo.com/v1/search'

export function detectTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error("This browser doesn't support geolocation."))
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      err => {
        const msg = {
          1: 'Location permission was blocked. Enable it in your browser settings.',
          2: "Couldn't determine your location.",
          3: 'Location request timed out.',
        }[err.code] || 'Could not get your location.'
        reject(new Error(msg))
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 }
    )
  })
}

export async function reverseGeocode(lat, lon) {
  const url = `${NOMINATIM}?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`
  let res
  try {
    res = await fetch(url, { headers: { 'Accept': 'application/json' } })
  } catch {
    throw new Error('Network error while looking up your location.')
  }
  if (!res.ok) throw new Error(`Reverse geocode failed (${res.status})`)
  const data = await res.json()
  const a = data?.address || {}
  // Nominatim spreads the locality across many keys depending on country.
  const city =
    a.city || a.town || a.village || a.municipality ||
    a.hamlet || a.suburb || a.county || ''
  const country = a.country || ''
  return { city, country }
}

export async function searchLocations(query) {
  const q = String(query || '').trim()
  if (q.length < 2) return []

  const url = new URL(OPEN_METEO_SEARCH)
  url.searchParams.set('name', q)
  url.searchParams.set('count', '8')
  url.searchParams.set('language', 'en')
  url.searchParams.set('format', 'json')

  let res
  try {
    res = await fetch(url)
  } catch {
    throw new Error('Network error while searching locations.')
  }
  if (!res.ok) throw new Error(`Location search failed (${res.status})`)

  const data = await res.json()
  return (data?.results || []).map(place => ({
    id: place.id,
    city: place.name || '',
    country: place.country || '',
    admin: [place.admin1, place.admin2].filter(Boolean).join(', '),
    timezone: place.timezone || '',
    latitude: place.latitude,
    longitude: place.longitude,
  })).filter(place => place.city && place.country)
}

/** One-call helper: GPS → reverse geocode → tz fallback. */
export async function detectLocation() {
  const tz = detectTimezone()
  const { lat, lon } = await getCurrentPosition()
  const { city, country } = await reverseGeocode(lat, lon)
  return { city, country, timezone: tz, lat, lon }
}
