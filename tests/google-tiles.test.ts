import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain ESM server module
import { createGoogleTiles, cacheLifetimeMs, googleTileBase, GOOGLE_TILE_BASE } from '../server/google-tiles.mjs'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)])

interface Call { url: string; init?: { method?: string; body?: string } }
function mockFetch(opts: { tileStatus?: number[]; cacheControl?: string | null; body?: Buffer; expiry?: number } = {}) {
  const calls: Call[] = []
  const tileStatus = [...(opts.tileStatus ?? [])]
  let sessions = 0
  const fn = async (url: string, init?: Call['init']) => {
    calls.push({ url, init })
    const headers = new Map<string, string>()
    if (url.includes('/v1/createSession')) {
      sessions++
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ session: `s${sessions}`, expiry: String(opts.expiry ?? 2_000_000_000) }) }
    }
    if (url.includes('/tile/v1/viewport')) {
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ copyright: 'Map data ©2026 Google' }) }
    }
    const status = tileStatus.length ? tileStatus.shift()! : 200
    headers.set('content-type', 'image/png')
    if (opts.cacheControl !== null) headers.set('cache-control', opts.cacheControl ?? 'max-age=600')
    const body = opts.body ?? PNG
    return {
      ok: status >= 200 && status < 300, status,
      headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    }
  }
  return { fn, calls, sessions: () => sessions }
}

describe('Google Map Tiles API provider', () => {
  it('is disabled without a key and refuses to fetch', async () => {
    const g = createGoogleTiles({ key: '', fetchImpl: mockFetch().fn })
    expect(g.enabled).toBe(false)
    await expect(g.tile('hybrid', 1, 0, 0)).rejects.toThrow(/GOOGLE_MAPS_API_KEY/)
  })

  it('creates one session per style with the right map type and layers', async () => {
    const m = mockFetch()
    const g = createGoogleTiles({ key: 'K', fetchImpl: m.fn, base: 'https://up' })
    await Promise.all([g.tile('hybrid', 13, 1310, 3166), g.tile('hybrid', 13, 1311, 3166), g.tile('hybrid', 13, 1312, 3166)])
    const created = m.calls.filter(c => c.url.includes('createSession'))
    expect(created).toHaveLength(1) // single-flight
    expect(created[0]!.url).toBe('https://up/v1/createSession?key=K')
    expect(created[0]!.init!.method).toBe('POST')
    expect(JSON.parse(created[0]!.init!.body!)).toMatchObject({ mapType: 'satellite', layerTypes: ['layerRoadmap'] })
    await g.tile('roadmap', 13, 1310, 3166)
    const road = m.calls.filter(c => c.url.includes('createSession'))[1]!
    expect(JSON.parse(road.init!.body!)).toMatchObject({ mapType: 'roadmap' })
    expect(JSON.parse(road.init!.body!).layerTypes).toBeUndefined()
  })

  it('requests tiles with session + key and serves repeats from memory', async () => {
    const m = mockFetch()
    const g = createGoogleTiles({ key: 'K', fetchImpl: m.fn, base: 'https://up' })
    const a = await g.tile('satellite', 14, 2620, 6332)
    expect(a.type).toBe('image/png')
    expect(Buffer.compare(a.buf, PNG)).toBe(0)
    const tileCalls = () => m.calls.filter(c => c.url.includes('/2dtiles/'))
    expect(tileCalls()[0]!.url).toBe('https://up/v1/2dtiles/14/2620/6332?session=s1&key=K')
    await g.tile('satellite', 14, 2620, 6332)
    expect(tileCalls()).toHaveLength(1)
  })

  it('never caches what upstream marks no-store, and expires per max-age', async () => {
    const m = mockFetch({ cacheControl: 'no-store' })
    const g = createGoogleTiles({ key: 'K', fetchImpl: m.fn })
    await g.tile('satellite', 3, 1, 1)
    await g.tile('satellite', 3, 1, 1)
    expect(m.calls.filter(c => c.url.includes('/2dtiles/'))).toHaveLength(2)
    let t = 0
    const m2 = mockFetch({ cacheControl: 'public, max-age=60' })
    const g2 = createGoogleTiles({ key: 'K', fetchImpl: m2.fn, now: () => t })
    await g2.tile('satellite', 3, 1, 1)
    t = 59_000
    await g2.tile('satellite', 3, 1, 1)
    expect(m2.calls.filter(c => c.url.includes('/2dtiles/'))).toHaveLength(1)
    t = 61_000
    await g2.tile('satellite', 3, 1, 1)
    expect(m2.calls.filter(c => c.url.includes('/2dtiles/'))).toHaveLength(2)
  })

  it('re-mints an expired session once, then gives up', async () => {
    const m = mockFetch({ tileStatus: [403, 200] })
    const g = createGoogleTiles({ key: 'K', fetchImpl: m.fn })
    await g.tile('satellite', 2, 1, 1)
    expect(m.sessions()).toBe(2)
    const m2 = mockFetch({ tileStatus: [403, 403] })
    const g2 = createGoogleTiles({ key: 'K', fetchImpl: m2.fn })
    await expect(g2.tile('satellite', 2, 1, 1)).rejects.toThrow(/403/)
  })

  it('remembers missing tiles instead of re-minting sessions for them', async () => {
    const m = mockFetch({ tileStatus: [404] })
    const g = createGoogleTiles({ key: 'K', fetchImpl: m.fn })
    await expect(g.tile('satellite', 18, 1, 1)).rejects.toThrow(/404/)
    await expect(g.tile('satellite', 18, 1, 1)).rejects.toThrow(/cached/)
    expect(m.calls.filter(c => c.url.includes('/2dtiles/'))).toHaveLength(1)
    expect(m.sessions()).toBe(1)
  })

  it('refreshes sessions before they expire', async () => {
    let t = 0
    const m = mockFetch({ expiry: 3600 }) // expires at t = 3600 s
    const g = createGoogleTiles({ key: 'K', fetchImpl: m.fn, now: () => t })
    await g.session('satellite')
    t = 3000_000 // inside the 10-minute margin
    await g.session('satellite')
    expect(m.sessions()).toBe(2)
  })

  it('rejects junk payloads, bad coordinates and unknown styles', async () => {
    const g = createGoogleTiles({ key: 'K', fetchImpl: mockFetch({ body: Buffer.from('<html>quota</html>  ') }).fn })
    await expect(g.tile('satellite', 2, 1, 1)).rejects.toThrow(/non-image/)
    await expect(g.tile('satellite', 2, 4, 0)).rejects.toThrow(RangeError)
    await expect(g.tile('streetview', 2, 1, 1)).rejects.toThrow(RangeError)
  })

  it('keeps the tile cache bounded', async () => {
    const g = createGoogleTiles({ key: 'K', fetchImpl: mockFetch().fn, maxTiles: 5 })
    for (let x = 0; x < 12; x++) await g.tile('satellite', 4, x, 3)
    expect(g.stats().tiles).toBe(5)
  })

  it('returns the viewport copyright for attribution', async () => {
    const m = mockFetch()
    const g = createGoogleTiles({ key: 'K', fetchImpl: m.fn, base: 'https://up' })
    expect(await g.attribution('hybrid', 13, 37.6, 37.4, -122.2, -122.6)).toBe('Map data ©2026 Google')
    const v = m.calls.find(c => c.url.includes('/tile/v1/viewport'))!
    expect(v.url).toBe('https://up/tile/v1/viewport?session=s1&key=K&zoom=13&north=37.600&south=37.400&east=-122.200&west=-122.600')
  })

  it('parses cache lifetimes conservatively', () => {
    expect(cacheLifetimeMs('no-store')).toBe(0)
    expect(cacheLifetimeMs('private, no-cache')).toBe(0)
    expect(cacheLifetimeMs('public, max-age=86400')).toBe(86_400_000)
    expect(cacheLifetimeMs(null)).toBeGreaterThan(0)
  })

  it('only allows a loopback upstream override', () => {
    expect(googleTileBase({})).toBe(GOOGLE_TILE_BASE)
    expect(googleTileBase({ OPENHORIZON_GOOGLE_TILES_BASE: 'http://127.0.0.1:5299' })).toBe('http://127.0.0.1:5299')
    expect(googleTileBase({ OPENHORIZON_GOOGLE_TILES_BASE: 'https://evil.example' })).toBe(GOOGLE_TILE_BASE)
    expect(googleTileBase({ OPENHORIZON_GOOGLE_TILES_BASE: 'http://localhost.evil.example' })).toBe(GOOGLE_TILE_BASE)
  })
})
