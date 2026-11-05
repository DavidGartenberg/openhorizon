import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { Airports, type AirportData } from '../src/world/airports'

const ap = (i: string, la: number, lo: number): AirportData => ({ i, n: i, la, lo, e: 100, t: 0, xo: true, r: [{ li: '9', hi: '27', la1: la, lo1: lo - 0.01, la2: la, lo2: lo + 0.01, e1: 100, e2: 100, l: 7000, w: 100, s: 0, lt: 0 }] })

describe('adding X-Plane-only airports to the database', () => {
  const make = () => new Airports(new THREE.Scene(), {} as never)
  it('adds new airports, skips ones it has, malformed ones and ones without runways, and makes them findable by position', () => {
    const a = make()
    expect(a.addAirports([ap('AAA1', 37.5, -122.25), ap('AAA2', 40, -100), { ...ap('BAD', 1, 1), r: [] }, { i: 5 } as never])).toBe(2)
    expect(a.addAirports([ap('AAA1', 37.5, -122.25), ap('AAA3', 37.51, -122.2)])).toBe(1)
    expect(a.near(37.5, -122.25, 10_000).map((x) => x.i).sort()).toEqual(['AAA1', 'AAA3'])
    expect(a.find('AAA2')?.i).toBe('AAA2')
  })
  it('puts X-Plane\'s overruns and pavement box on the airports it adds', () => {
    const a = make()
    ;(a as unknown as { runwayExtras: unknown }).runwayExtras = { AAA1: [['9', '27', 120, 0]] }
    ;(a as unknown as { airportExtents: unknown }).airportExtents = { AAA1: [37.49, -122.27, 37.51, -122.23] }
    a.addAirports([ap('AAA1', 37.5, -122.25)])
    const added = a.find('AAA1')!
    expect(added.r[0]!.o1).toBe(120); expect(added.x).toEqual([37.49, -122.27, 37.51, -122.23])
  })
  it('adds the runways X-Plane lists that the airport lacks, and leaves matching ones alone', async () => {
    const { applyRunwayExtras } = await import('../src/world/airport-flatten')
    const base = ap('KDB', 40, -100); base.r[0]!.li = '9'; base.r[0]!.hi = '27'
    const list = [base]
    applyRunwayExtras(list, { KDB: [['09', '27', 0, 0], ['4', '22', 0, 0, 39.99, -100.01, 40.01, -99.99, 30, 3, 1], ['1', '19', 0, 0, 40.2, -100, 40.2002, -100, 30, 1, 0]] })
    expect(list[0]!.r.map((r) => r.li)).toEqual(['9', '4'])           // the 22 m strip is not added
    expect(list[0]!.r[1]).toMatchObject({ hi: '22', s: 1, lt: 1, e1: 100 })
    expect(list[0]!.r[1]!.w).toBeCloseTo(98.4, 0); expect(list[0]!.r[1]!.l).toBeGreaterThan(7000)
  })
  it('asks for the X-Plane-only airports once near a place, and not again every frame when the server fails', async () => {
    const a = make() as unknown as { loaded: boolean; ensureXplaneOnlyNear(la: number, lo: number): Promise<void> }
    a.loaded = true
    let calls = 0
    const real = globalThis.fetch
    globalThis.fetch = (async () => { calls++; return { ok: false } }) as never
    try {
      await a.ensureXplaneOnlyNear(40, -100); await a.ensureXplaneOnlyNear(40, -100); await a.ensureXplaneOnlyNear(40, -100)
      expect(calls).toBe(1)
    } finally { globalThis.fetch = real }
  })
  it('replaces the database\'s hard / soft and edge-light flags where X-Plane\'s row carries its own', async () => {
    const { applyRunwayExtras } = await import('../src/world/airport-flatten')
    const base = ap('KDB', 40, -100); base.r[0]!.li = '9'; base.r[0]!.hi = '27'; base.r[0]!.s = 0; base.r[0]!.lt = 1
    const list = [base]
    applyRunwayExtras(list, { KDB: [['9', '27', 0, 0, 40, -100.01, 40, -99.99, 30, 1, 0]] })
    expect(list[0]!.r[0]).toMatchObject({ s: 1, lt: 0 })
  })
  it('lists the fields below sea level near a point, nearest first, and not the ones above it', () => {
    const a = make()
    const low = ap('LOW1', 36.46, -116.88); low.r[0]!.e1 = -200; low.r[0]!.e2 = -200; low.e = -200
    const low2 = ap('LOW2', 36.6, -116.88); low2.r[0]!.e1 = -100; low2.r[0]!.e2 = -100; low2.e = -100
    const high = ap('HIGH', 36.5, -116.88); high.r[0]!.e1 = 1500; high.r[0]!.e2 = 1500; high.e = 1500
    a.addAirports([low2, high, low])
    expect(a.belowSeaFields(36.45, -116.88, 50_000).map((f) => f.lat)).toEqual([36.46, 36.6])
    expect(a.belowSeaFields(40, -100, 50_000)).toEqual([])
  })
  it('removes the runways X-Plane disproves, keeping the last one', async () => {
    const { applyRunwayExtras } = await import('../src/world/airport-flatten')
    const base = ap('KDB', 40, -100); base.r[0]!.li = '9'; base.r[0]!.hi = '27'
    const second = { ...base.r[0]!, li: '15', hi: '33' }
    const list = [{ ...base, r: [base.r[0]!, second] }]
    applyRunwayExtras(list, { KDB: [['15', '33', -1, -1], ['09', '27', -1, -1]] })
    expect(list[0]!.r.map((r) => r.li)).toEqual(['9'])
  })
  it('takes land masks for the airports it has, once, and tells the terrain to rebuild there', () => {
    const a = make()
    a.addAirports([ap('LOW2', 22.3, 113.9)])
    const calls: number[][] = []
    ;(a as unknown as { onLandMask: (la: number, lo: number, r: number) => void }).onLandMask = (la, lo, r) => calls.push([la, lo, r])
    expect(a.applyLandMasks({ LOW2: [[22.3, 113.89, 22.3, 113.91], [1, 2, 3]], NONE: [[1, 1, 1, 1]], BAD: 5 } as never)).toBe(1)
    expect(a.applyLandMasks({ LOW2: [[22.3, 113.89, 22.3, 113.91]] })).toBe(0)                    // already has one
    expect(calls).toEqual([[22.3, 113.9, 6000]])
    expect(a.find('LOW2')!.land).toEqual([[22.3, 113.89, 22.3, 113.91]])                              // the malformed run is dropped
  })
  it('asks for the terrain to be rebuilt only where the loaded terrain under a mask is sea', () => {
    const a = make() as unknown as Airports & { onLandMask: (la: number, lo: number, r: number) => void }
    a.addAirports([ap('DRY1', 10, 10), ap('WET1', 20, 20)])
    const calls: string[] = []
    a.onLandMask = (la) => calls.push(String(la))
    a.terrainReady = () => true
    a.terrainAt = (la) => (la === 20 ? 0 : 50)                                                // land at DRY1, sea at WET1
    a.applyLandMasks({ DRY1: [[10, 10, 10, 10.01]], WET1: [[20, 20, 20, 20.01]] })
    expect(calls).toEqual(['20'])
    a.addAirports([ap('NEW1', 30, 30)])
    a.terrainReady = () => false                                                              // not loaded yet: build it again when it is
    a.applyLandMasks({ NEW1: [[30, 30, 30, 30.01]] })
    expect(calls).toEqual(['20', '30'])
  })
  it('hands the terrain the land runs and the lowland circle of a field below sea level, and levels sea cells at a reclaimed field', () => {
    const a = make()
    const reclaimed = ap('RECL', 22.3, 113.9); reclaimed.r[0]!.e1 = 25; reclaimed.r[0]!.e2 = 25; reclaimed.e = 25
    const polder = ap('POLD', 52.3, 4.76); polder.r[0]!.e1 = -11; polder.r[0]!.e2 = -11; polder.e = -11
    a.addAirports([reclaimed, polder])
    a.applyLandMasks({ RECL: [[22.3, 113.9, 22.3, 113.91]] })
    const near = a.runwaysInBounds(22.2, 22.4, 113.8, 114.0)
    expect(near.filter((r) => r.land)).toHaveLength(1)
    expect(near.some((r) => r.lowland)).toBe(false)
    const low = a.runwaysInBounds(52.2, 52.4, 4.7, 4.9)
    expect(low.filter((r) => r.lowland)).toHaveLength(1); expect(low.find((r) => r.lowland)!.halfWidthM).toBeCloseTo(12_000 + 11 * 0.3048 * 400, 0)
    expect(a.flattenElevation(0, 22.3, 113.905)).toBeCloseTo(7.6, 0)                                  // sea at the run: 25 ft of land
    expect(a.flattenElevation(0, 22.4, 113.905)).toBe(0)                                              // sea far from it stays sea
    expect(a.belowSeaFields(52.3, 4.76, 20_000)).toEqual([{ lat: 52.3, lon: 4.76, radiusM: 12_000 + 11 * 0.3048 * 400 }]); expect(a.belowSeaFields(22.3, 113.9, 20_000)).toEqual([])
  })
  it('finds the field whose runway is nearest, never a helipad, and lists runways without pads', () => {
    const a = make()
    // A long runway centred 3 km north of the query point, a small strip 1.5 km east, and a heliport 200 m south.
    const big = ap('BIGF', 40.027, -100); big.r[0]!.lo1 = -100.02; big.r[0]!.lo2 = -99.98
    const strip = ap('STRP', 40, -99.9825); strip.r[0]!.lo1 = -99.9835; strip.r[0]!.lo2 = -99.9815; strip.r[0]!.la1 = 40; strip.r[0]!.la2 = 40
    const heli = ap('HELI', 39.9982, -100); heli.r = [{ ...heli.r[0]!, li: 'H1', hi: 'H1', la1: 39.9982, la2: 39.9982, lo1: -100.0001, lo2: -99.9999, l: 40, w: 40, pad: true }]
    a.addAirports([heli, big, strip])
    expect(a.nearestField(40, -100, 5000)?.i).toBe('STRP')                                      // 1.5 km beats 3 km; the nearer heliport is not a field
    expect(a.nearestField(40, -100, 1000)).toBeUndefined()
    expect(a.runwaysNear(40, -100, 5000).map((r) => r.li).sort()).toEqual(['9', '9'])           // the two airfields' runways, not H1
  })
  it('neither levels nor draws a water lane, and gives a seaplane base no level area', async () => {
    const { airportFlatRadiusM } = await import('../src/world/airport-flatten')
    const a = make()
    const lake = ap('LAKE', 61.5, -149.5)
    lake.r = [{ ...lake.r[0]!, li: '17', hi: '35', la1: 61.495, la2: 61.505, lo1: -149.5, lo2: -149.5, l: 3600, w: 150, e1: 300, e2: 300, pad: true, water: true }]
    a.addAirports([lake])
    expect(a.runwaysInBounds(61.4, 61.6, -149.6, -149.4)).toEqual([])                          // no disk, no corridor
    expect(airportFlatRadiusM(lake)).toBe(0)
    expect(a.flattenElevation(10, 61.5, -149.5)).toBe(10)
  })
})
