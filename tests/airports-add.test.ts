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
})
