/**
 * Google Maps Platform — Map Tiles API (2D tiles), opt-in.
 *
 * Enabled only when GOOGLE_MAPS_API_KEY is set where the server runs; the
 * key never leaves the server (the client asks /proxy/gmaps/...). Styles:
 *   satellite — Google satellite imagery
 *   hybrid    — satellite + the roadmap layer (roads, labels): "Google Maps"
 *               as people picture it from the air
 *   roadmap   — the classic map layout
 * Sessions come from POST /v1/createSession and are reused until shortly
 * before they expire. Tiles are held in a bounded in-memory cache for no
 * longer than the upstream Cache-Control allows — never written to disk —
 * and the client shows Google's attribution while a Google layer is up.
 * Using the API is subject to the Google Maps Platform terms of the key's
 * owner.
 */

export const GOOGLE_TILE_BASE = 'https://tile.googleapis.com'

/** Upstream base URL. OPENHORIZON_GOOGLE_TILES_BASE exists for local
 *  end-to-end tests against a mock server and is honoured only for loopback
 *  URLs, so a stray setting can never send the API key to another host. */
export function googleTileBase(env = process.env) {
  const o = env.OPENHORIZON_GOOGLE_TILES_BASE
  if (o && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o)) return o
  return GOOGLE_TILE_BASE
}

export const GOOGLE_STYLES = {
  satellite: { mapType: 'satellite' },
  hybrid: { mapType: 'satellite', layerTypes: ['layerRoadmap'] },
  roadmap: { mapType: 'roadmap' },
}

const SESSION_MARGIN_MS = 10 * 60_000
const DEFAULT_TTL_MS = 60 * 60_000
const ATTRIBUTION_TTL_MS = 60_000

/** PNG / JPEG / WebP magic bytes. */
function isImage(buf) {
  if (buf.length < 12) return false
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true
  return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'
}

/** Cache lifetime from a Cache-Control header (ms); 0 = must not cache. */
export function cacheLifetimeMs(header) {
  if (!header) return DEFAULT_TTL_MS
  const h = header.toLowerCase()
  if (/\bno-store\b|\bno-cache\b|\bprivate\b/.test(h) && !/\bmax-age=\d+/.test(h)) return 0
  if (/\bno-store\b/.test(h)) return 0
  const m = h.match(/\bmax-age=(\d+)/)
  return m ? Number(m[1]) * 1000 : DEFAULT_TTL_MS
}

export function createGoogleTiles({
  key = process.env.GOOGLE_MAPS_API_KEY ?? '',
  base = googleTileBase(),
  fetchImpl = (...a) => globalThis.fetch(...a),
  now = () => Date.now(),
  maxTiles = 1500,
  language = 'en-US',
  region = 'US',
} = {}) {
  const sessions = new Map() // style -> { token, expiresAt } | { pending: Promise }
  const tiles = new Map() // "style/z/x/y" -> { buf, type, until }  (insertion order = LRU)
  const attributions = new Map() // query -> { copyright, until }
  const misses = new Map() // "style/z/x/y" -> until  (tiles upstream says do not exist)
  const enabled = typeof key === 'string' && key.length > 0

  function assertEnabled() {
    if (!enabled) throw new Error('Google map layers need GOOGLE_MAPS_API_KEY on the server')
  }
  function assertStyle(style) {
    if (!Object.hasOwn(GOOGLE_STYLES, style)) throw new RangeError(`unknown Google map style: ${style}`)
  }

  async function session(style, { force = false } = {}) {
    assertEnabled()
    assertStyle(style)
    const cur = sessions.get(style)
    if (cur?.pending) return cur.pending
    if (!force && cur && cur.expiresAt - SESSION_MARGIN_MS > now()) return cur.token
    const pending = (async () => {
      const res = await fetchImpl(`${base}/v1/createSession?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...GOOGLE_STYLES[style], language, region }),
      })
      if (!res.ok) throw new Error(`Google createSession (${style}): upstream ${res.status}`)
      const json = await res.json()
      if (!json || typeof json.session !== 'string') throw new Error('Google createSession: no session token')
      // `expiry` is seconds since the epoch, sent as a string.
      const expiresAt = Number(json.expiry) > 0 ? Number(json.expiry) * 1000 : now() + 12 * 3600_000
      sessions.set(style, { token: json.session, expiresAt })
      return json.session
    })()
    sessions.set(style, { pending })
    try {
      return await pending
    } catch (err) {
      sessions.delete(style)
      throw err
    }
  }

  function remember(id, entry) {
    tiles.delete(id)
    tiles.set(id, entry)
    while (tiles.size > maxTiles) tiles.delete(tiles.keys().next().value)
  }

  /** One 256 px tile: { buf, type }. Throws on any upstream failure. */
  async function tile(style, z, x, y) {
    assertEnabled()
    assertStyle(style)
    z = Number(z); x = Number(x); y = Number(y)
    if (![z, x, y].every(Number.isInteger) || z < 0 || z > 22 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
      throw new RangeError(`invalid tile ${z}/${x}/${y}`)
    }
    const id = `${style}/${z}/${x}/${y}`
    const miss = misses.get(id)
    if (miss && miss > now()) throw new Error(`Google tile ${id}: not available (cached)`)
    const hit = tiles.get(id)
    if (hit && hit.until > now()) {
      remember(id, hit)
      return { buf: hit.buf, type: hit.type }
    }
    if (hit) tiles.delete(id)
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await session(style, { force: attempt > 0 })
      const res = await fetchImpl(`${base}/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(token)}&key=${encodeURIComponent(key)}`)
      // An expired or revoked session answers 401/403: mint a new one once.
      // (400/404 also mean "no such tile" — re-minting for those churned sessions.)
      if ((res.status === 401 || res.status === 403) && attempt === 0) continue
      if (res.status === 400 || res.status === 404) {
        misses.set(id, now() + 10 * 60_000)
        if (misses.size > 5000) misses.delete(misses.keys().next().value)
        throw new Error(`Google tile ${id}: upstream ${res.status}`)
      }
      if (!res.ok) throw new Error(`Google tile ${id}: upstream ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (!isImage(buf)) throw new Error(`Google tile ${id}: non-image upstream (${res.headers.get('content-type')}, ${buf.length} B)`)
      const type = res.headers.get('content-type') || (buf[0] === 0x89 ? 'image/png' : 'image/jpeg')
      const ttl = cacheLifetimeMs(res.headers.get('cache-control'))
      if (ttl > 0) remember(id, { buf, type, until: now() + ttl })
      return { buf, type }
    }
    throw new Error(`Google tile ${id}: session rejected`)
  }

  /** Copyright text Google requires for the visible area. */
  async function attribution(style, zoom, north, south, east, west) {
    assertEnabled()
    assertStyle(style)
    const nums = [zoom, north, south, east, west].map(Number)
    if (!nums.every(Number.isFinite)) throw new RangeError('invalid viewport')
    const [z, n, s, e, w] = nums
    const q = `zoom=${Math.round(z)}&north=${n.toFixed(3)}&south=${s.toFixed(3)}&east=${e.toFixed(3)}&west=${w.toFixed(3)}`
    const memo = attributions.get(`${style}?${q}`)
    if (memo && memo.until > now()) return memo.copyright
    const token = await session(style)
    const res = await fetchImpl(`${base}/tile/v1/viewport?session=${encodeURIComponent(token)}&key=${encodeURIComponent(key)}&${q}`)
    if (!res.ok) throw new Error(`Google viewport info: upstream ${res.status}`)
    const json = await res.json()
    const copyright = typeof json?.copyright === 'string' && json.copyright ? json.copyright : 'Map data ©Google'
    attributions.set(`${style}?${q}`, { copyright, until: now() + ATTRIBUTION_TTL_MS })
    return copyright
  }

  return {
    enabled,
    styles: Object.keys(GOOGLE_STYLES),
    session,
    tile,
    attribution,
    /** Test/debug view of the cache sizes. */
    stats: () => ({ tiles: tiles.size, sessions: sessions.size }),
  }
}
