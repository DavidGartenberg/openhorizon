/**
 * Which photo/map layer drapes the terrain. USGS (public domain, US only)
 * is the default; the Google layers come from the Google Maps Platform Map
 * Tiles API through the companion server and exist only when the server was
 * started with GOOGLE_MAPS_API_KEY. Pure helpers — unit-tested.
 */
export type ImagerySource = 'usgs' | 'google-satellite' | 'google-hybrid' | 'google-roadmap'

export const IMAGERY_SOURCES: ReadonlyArray<{ id: ImagerySource; label: string; google: boolean }> = [
  { id: 'usgs', label: 'Satellite (USGS)', google: false },
  { id: 'google-satellite', label: 'Google satellite', google: true },
  { id: 'google-hybrid', label: 'Google hybrid (roads + labels)', google: true },
  { id: 'google-roadmap', label: 'Google map', google: true },
]

export function isGoogleSource(s: ImagerySource): boolean {
  return s !== 'usgs'
}

/** Google style name the server route expects (`satellite`, `hybrid`, `roadmap`). */
export function googleStyle(s: ImagerySource): 'satellite' | 'hybrid' | 'roadmap' | null {
  return s === 'google-satellite' ? 'satellite' : s === 'google-hybrid' ? 'hybrid' : s === 'google-roadmap' ? 'roadmap' : null
}

/** Tile path prefix: `${base}/${z}/${x}/${y}`. */
export function imageryBasePath(s: ImagerySource): string {
  const g = googleStyle(s)
  return g ? `/proxy/gmaps/${g}` : '/proxy/imagery'
}

/** Parse a stored/typed value; anything unknown is the USGS default. */
export function parseImagerySource(v: string | null | undefined): ImagerySource {
  const t = (v ?? '').trim().toLowerCase()
  const hit = IMAGERY_SOURCES.find((s) => s.id === t)
  if (hit) return hit.id
  if (t === 'google' || t === 'hybrid' || t === 'google hybrid') return 'google-hybrid'
  if (t === 'map' || t === 'roadmap' || t === 'google map') return 'google-roadmap'
  if (t === 'google satellite') return 'google-satellite'
  return 'usgs'
}

/** Resolve the source to use: a Google choice falls back to USGS when the
 *  server has no key configured. */
export function resolveImagerySource(wanted: ImagerySource, googleAvailable: boolean): ImagerySource {
  return isGoogleSource(wanted) && !googleAvailable ? 'usgs' : wanted
}

/** Lat/lon bounds of a view centred on (lat, lon), for the attribution query. */
export function viewBounds(lat: number, lon: number, halfDeg = 0.25): { north: number; south: number; east: number; west: number } {
  const clampLat = (v: number): number => Math.max(-85, Math.min(85, v))
  const clampLon = (v: number): number => Math.max(-180, Math.min(180, v))
  const k = Math.max(Math.cos((lat * Math.PI) / 180), 0.2)
  return { north: clampLat(lat + halfDeg), south: clampLat(lat - halfDeg), east: clampLon(lon + halfDeg / k), west: clampLon(lon - halfDeg / k) }
}
