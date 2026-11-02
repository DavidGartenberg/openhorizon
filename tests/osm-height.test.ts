import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ES module without types (server code)
import { osmHeightM } from '../server/handlers.mjs'

describe('building height from OSM tags', () => {
  it('reads height in metres (with units or a decimal comma) and falls back to levels × 3.6 m', () => {
    expect(osmHeightM({ height: '18' })).toBe(18); expect(osmHeightM({ height: '12.5 m' })).toBe(12.5); expect(osmHeightM({ height: '9,5' })).toBe(9.5)
    expect(osmHeightM({ 'building:levels': '3' })).toBe(10.8); expect(osmHeightM({ height: '20', 'building:levels': '2' })).toBe(20)
  })
  it('is null for nothing, junk or absurd values', () => {
    expect(osmHeightM({})).toBeNull(); expect(osmHeightM(undefined)).toBeNull(); expect(osmHeightM({ height: 'tall' })).toBeNull()
    expect(osmHeightM({ height: '2' })).toBeNull(); expect(osmHeightM({ height: '9000' })).toBeNull(); expect(osmHeightM({ 'building:levels': '500' })).toBeNull()
  })
})

import { normalizedLayout } from '../src/world/osm-layout'
describe('terminal heights through the client layout', () => {
  const sq = (o: number): [number, number][] => [[o, o], [o, o + 0.001], [o + 0.001, o + 0.001], [o + 0.001, o]]
  it('stay with their own polygon when a malformed one is dropped, and are clamped', () => {
    const l = normalizedLayout({ tm: [sq(1), [[1, 1]], sq(3), sq(5)], th: [20, 15, null, 900] })
    expect(l.tm).toHaveLength(3)
    expect(l.tmh.get(l.tm[0]!)).toBe(20)          // the malformed second polygon's 15 is not given to the third
    expect(l.tmh.get(l.tm[1]!)).toBeUndefined()   // untagged: the caller uses its estimate
    expect(l.tmh.get(l.tm[2]!)).toBe(80)          // absurd heights are capped
  })
  it('is fine without any heights (an airport cached before they were kept)', () => {
    const l = normalizedLayout({ tm: [sq(1)] })
    expect(l.tm).toHaveLength(1); expect(l.tmh.get(l.tm[0]!)).toBeUndefined()
  })
})

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, vi } from 'vitest'
// @ts-expect-error plain ES module without types (server code)
import { osmAirport } from '../server/handlers.mjs'

describe('the OSM airport route keeps terminal heights (Overpass mocked)', () => {
  const cacheFile = path.join(process.cwd(), 'server', 'cache', 'osm-ZZT9.json')
  afterEach(() => { vi.unstubAllGlobals(); fs.rmSync(cacheFile, { force: true }) })
  const way = (tags: Record<string, string>) => ({ geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 1.001 }, { lat: 1.001, lon: 1.001 }, { lat: 1.001, lon: 1 }], tags: { aeroway: 'terminal', ...tags } })
  it('fetches an airport cached without heights once more and stores them next to its terminals', async () => {
    fs.writeFileSync(cacheFile, JSON.stringify({ tw: [], ap: [], tm: [[[1, 1], [1, 1.001], [1.001, 1.001]]], st: [] }))     // an old cache: terminals, no `th`
    const fetched = vi.fn(async () => ({ ok: true, json: async () => ({ elements: [way({ height: '24' }), way({ 'building:levels': '2' }), way({})] }) }))
    vi.stubGlobal('fetch', fetched)
    const out = JSON.parse(await osmAirport('ZZT9', 1, 1))
    expect(fetched).toHaveBeenCalledTimes(1)
    expect(out.tm).toHaveLength(3); expect(out.th).toEqual([24, 7.2, null])
    expect(JSON.parse(fs.readFileSync(cacheFile, 'utf8')).th).toEqual([24, 7.2, null])
  })
  it('keeps the old cache when the network is down, and never refetches one that has heights', async () => {
    fs.writeFileSync(cacheFile, JSON.stringify({ tw: [], ap: [], tm: [[[1, 1], [1, 1.001], [1.001, 1.001]]], st: [] }))
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    // The route memoises per process: use a fresh module for each case.
    vi.resetModules()
    const m1 = (await import(/* @vite-ignore */ '../server/' + 'handlers.mjs')) as { osmAirport: (i: string, a: number, b: number) => Promise<string> }
    expect(JSON.parse(await m1.osmAirport('ZZT9', 1, 1)).tm).toHaveLength(1)
    fs.writeFileSync(cacheFile, JSON.stringify({ tw: [], ap: [], tm: [[[1, 1], [1, 1.001], [1.001, 1.001]]], th: [12], st: [] }))
    const fetched = vi.fn(async () => { throw new Error('should not be called') })
    vi.stubGlobal('fetch', fetched)
    vi.resetModules()
    const m2 = (await import(/* @vite-ignore */ '../server/' + 'handlers.mjs')) as { osmAirport: (i: string, a: number, b: number) => Promise<string> }
    expect(JSON.parse(await m2.osmAirport('ZZT9', 1, 1)).th).toEqual([12]); expect(fetched).not.toHaveBeenCalled()
  })
})
