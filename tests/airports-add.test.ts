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
})
