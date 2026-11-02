import { describe, expect, it } from 'vitest'
import { airportFieldElevationM, airportFlatRadiusM, airportFlatDisk, FLAT_INNER_MARGIN_M, flattenEnds, applyRunwayExtras, applyAirportExtents, MAX_FLAT_RADIUS_M, lowlandRadiusM } from '../src/world/airport-flatten'
import { flattenForRunway } from '../src/math/geo'

const rwy = (l: number, e1: number, e2: number) => ({ li: '1', hi: '19', la1: 0, lo1: 0, la2: 0, lo2: 0, e1, e2, l, w: 150, s: 0, lt: 1 })
const sfo = { i: 'KSFO', n: 'x', la: 37.62, lo: -122.38, e: 13, t: 2, r: [rwy(11870, 5, 9), rwy(11381, 11, 13)] }
const strip = { i: 'X', n: 'x', la: 1, lo: 1, e: 100, t: 0, r: [rwy(3000, 100, 100)] }

describe('airport level ground', () => {
  it('the pavement level is the mean of the runway end elevations', () => {
    expect(airportFieldElevationM(sfo)).toBeCloseTo(((5 + 9 + 11 + 13) / 4) * 0.3048, 6)
    expect(airportFieldElevationM({ r: [], e: 100 })).toBeCloseTo(30.48, 6)
  })
  it('big commercial airports get a large level disk, small fields a small one, tiny strips none', () => {
    const big = airportFlatRadiusM(sfo), small = airportFlatRadiusM(strip)
    expect(big).toBeGreaterThan(1500); expect(big).toBeLessThanOrEqual(2600)
    expect(small).toBeGreaterThanOrEqual(250); expect(small).toBeLessThanOrEqual(700)
    expect(airportFlatRadiusM({ t: 0, r: [rwy(1500, 0, 0)] })).toBeGreaterThan(0)
    expect(airportFlatRadiusM({ t: 0, r: [rwy(300, 0, 0)] })).toBe(0)
    expect(airportFlatDisk({ ...strip, r: [rwy(300, 0, 0)] })).toBeNull()
  })
  it('a disk is a zero-length runway: the ground inside it is the airport level, beyond it the terrain', () => {
    const d = airportFlatDisk(sfo)!
    expect(d.halfWidthM + FLAT_INNER_MARGIN_M).toBeCloseTo(airportFlatRadiusM(sfo), 6)
    const terrain = 50
    const at = (dist: number): number => flattenForRunway(terrain, dist, 0, 0, 0, 0, 0, d.elevM, d.elevM, d.halfWidthM)
    expect(at(0)).toBeCloseTo(d.elevM, 6)
    expect(at(airportFlatRadiusM(sfo) - 10)).toBeCloseTo(d.elevM, 6)       // still inside the level zone
    expect(at(airportFlatRadiusM(sfo) + 60)).toBeGreaterThan(d.elevM)       // blending out
    expect(at(airportFlatRadiusM(sfo) + 60)).toBeLessThan(terrain)
    expect(at(airportFlatRadiusM(sfo) + 400)).toBe(terrain)                 // untouched terrain
  })
})

describe('the level ground reaches the end of a blast pad / overrun', () => {
  // A runway 3 km long due east on the equator (lon 0 → 0.026949°); 1° of longitude is 111,319.5 m there.
  const east = { la1: 0, lo1: 0, la2: 0, lo2: 3000 / 111_319.5 }
  const metres = (a: { la: number; lo: number }, b: { la: number; lo: number }): number => Math.hypot((b.lo - a.lo) * 111_319.5, (b.la - a.la) * 111_319.5)
  it('is the runway itself when there is no overrun, junk, or a degenerate runway', () => {
    expect(flattenEnds(east)).toEqual(east)
    expect(flattenEnds({ ...east, o1: 0, o2: -10 })).toEqual(east)
    expect(flattenEnds({ ...east, o1: NaN, o2: Infinity })).toEqual(east)
    expect(flattenEnds({ la1: 1, lo1: 1, la2: 1, lo2: 1, o1: 100, o2: 100 })).toEqual({ la1: 1, lo1: 1, la2: 1, lo2: 1 })
  })
  it('pushes each end outward along the runway by its own overrun', () => {
    const f = flattenEnds({ ...east, o1: 250, o2: 100 })
    expect(metres({ la: f.la1, lo: f.lo1 }, { la: east.la1, lo: east.lo1 })).toBeCloseTo(250, 1)
    expect(metres({ la: east.la2, lo: east.lo2 }, { la: f.la2, lo: f.lo2 })).toBeCloseTo(100, 1)
    expect(f.lo1).toBeLessThan(east.lo1); expect(f.lo2).toBeGreaterThan(east.lo2); expect(f.la1).toBeCloseTo(0, 9); expect(f.la2).toBeCloseTo(0, 9)
  })
  it('carries the end elevations along the runway slope, so the plane over the runway itself is unchanged', () => {
    const rw = { la1: 0, lo1: 0, la2: 0, lo2: 3000 / 111_319.5, e1M: 2, e2M: 5 }                 // rises 1 m per km
    const f = flattenEnds({ ...rw, o1: 250, o2: 100 })
    expect(f.e1M).toBeCloseTo(2 - 0.25, 6); expect(f.e2M).toBeCloseTo(5 + 0.1, 6)
    // The plane at 1,000 m along the original runway is the same on both.
    const plane = (a: { lo1: number; lo2: number; e1M?: number; e2M?: number }, x: number): number => {
      const x1 = a.lo1 * 111_319.5, x2 = a.lo2 * 111_319.5
      return a.e1M! + ((x - x1) / (x2 - x1)) * (a.e2M! - a.e1M!)
    }
    expect(plane(f as never, 1000)).toBeCloseTo(plane(rw as never, 1000), 6)
    expect(plane(f as never, -200)).toBeCloseTo(2 - 0.2, 6)                                          // and it continues under the overrun
    expect(flattenEnds({ ...rw }).e1M).toBe(2)                                                        // no overrun: untouched
  })
  it('works along any bearing (a north-south runway grows north and south)', () => {
    const f = flattenEnds({ la1: 40, lo1: -100, la2: 40.02, lo2: -100, o1: 111.3195, o2: 0 })
    expect(f.la1).toBeCloseTo(40 - 0.001, 6); expect(f.lo1).toBeCloseTo(-100, 9); expect(f.la2).toBeCloseTo(40.02, 9)
  })
  it('makes the ground beyond the paved end level where it used to be terrain', () => {
    // The runway's far end is 160 m short of the sample point at the origin: that is in the blend-out band (inner 70 m, outer 190 m).
    const rw = { la1: 0, lo1: -3160 / 111_319.5, la2: 0, lo2: -160 / 111_319.5 }
    const level = (r: { la1: number; lo1: number; la2: number; lo2: number }): number =>
      flattenForRunway(80, 0, 0, r.lo1 * 111_319.5, r.la1 * 111_319.5, r.lo2 * 111_319.5, r.la2 * 111_319.5, 10, 10, 30)
    expect(level(rw)).toBeGreaterThan(10)                                   // terrain still shows through
    expect(level(flattenEnds({ ...rw, o2: 250 }))).toBe(10)                // the 250 m overrun covers it
  })
  it('puts the overrun lengths on the matching runway end whichever way round, ignoring junk', () => {
    const ap = { i: 'KSFO', r: [{ ...rwy(11870, 5, 9), li: '10L', hi: '28R' }, { ...rwy(11381, 11, 13), li: '1R', hi: '19L' }] }
    applyRunwayExtras([ap], { KSFO: [['28R', '10L', 100, 250], ['bad'] as never, ['19L', '01R', 0, 55]], KXXX: [['10L', '28R', 9, 9]] })
    const [r0, r1] = ap.r as Array<{ o1?: number; o2?: number }>
    expect(r0).toMatchObject({ o1: 250, o2: 100 })                           // 250 m beyond the 10L end
    expect(r1).toMatchObject({ o1: 55 }); expect(r1!.o2).toBeUndefined()
    expect(() => applyRunwayExtras([ap], null as never)).not.toThrow()
    applyRunwayExtras([ap], { KSFO: [['10L', '28R', 1e9, NaN]] })
    expect(r0!.o1).toBe(600)
  })
})

describe('the level area covers the whole airport X-Plane lays out', () => {
  const mLat = 111_319.5
  const box = (n: number, e: number, s: number, w: number) => [37.62 - s / mLat, -122.38 - w / (mLat * Math.cos((37.62 * Math.PI) / 180)), 37.62 + n / mLat, -122.38 + e / (mLat * Math.cos((37.62 * Math.PI) / 180))] as [number, number, number, number]
  it('without a box the size rule stands; with one the disk reaches the farthest corner plus a margin', () => {
    const base = airportFlatRadiusM(sfo)
    expect(airportFlatRadiusM({ ...sfo, x: undefined })).toBe(base)
    const wide = { ...sfo, x: box(1000, 3500, 1000, 1000) }                 // the pavement reaches 3.5 km east
    const r = airportFlatRadiusM(wide)
    expect(r).toBeGreaterThan(base); expect(r).toBeCloseTo(Math.hypot(3500, 1000) + 150, -1)
  })
  it('a box inside the size rule changes nothing, and the radius is capped', () => {
    expect(airportFlatRadiusM({ ...sfo, x: box(200, 200, 200, 200) })).toBe(airportFlatRadiusM(sfo))
    expect(airportFlatRadiusM({ ...sfo, x: box(20_000, 20_000, 20_000, 20_000) })).toBe(MAX_FLAT_RADIUS_M)
  })
  it('a strip too short for pavement stays on the runway corridor only', () => {
    expect(airportFlatRadiusM({ t: 0, r: [rwy(300, 0, 0)], la: 37.62, lo: -122.38, x: box(2000, 2000, 2000, 2000) })).toBe(0)
  })
  it('the disk follows the radius', () => {
    const d = airportFlatDisk({ ...sfo, x: box(1000, 3500, 1000, 1000) })!
    expect(d.halfWidthM + FLAT_INNER_MARGIN_M).toBeCloseTo(airportFlatRadiusM({ ...sfo, x: box(1000, 3500, 1000, 1000) }), 6)
  })
  it('merges boxes onto airports, ignoring malformed ones', () => {
    const a = [{ i: 'KSFO' } as { i: string; x?: [number, number, number, number] }, { i: 'KBAD' } as { i: string; x?: [number, number, number, number] }, { i: 'KNONE' } as { i: string; x?: [number, number, number, number] }]
    applyAirportExtents(a, { KSFO: [37.6, -122.4, 37.64, -122.35], KBAD: [37.7, -122.4, 37.6, -122.35] })
    expect(a[0]!.x).toEqual([37.6, -122.4, 37.64, -122.35]); expect(a[1]!.x).toBeUndefined(); expect(a[2]!.x).toBeUndefined()
    expect(() => applyAirportExtents(a, null as never)).not.toThrow()
  })
})

describe("X-Plane's runway ends and width replace the old database's", () => {
  it('sets the ends in the database runway\'s own order (forward or reversed), the length and the width', () => {
    const mk = () => ({ i: 'KSFO', r: [{ ...rwy(11000, 5, 9), li: '10R', hi: '28L', la1: 37.6, lo1: -122.4, la2: 37.6, lo2: -122.3, w: 150 }] })
    const row = ['10R', '28L', 0, 0, 37.61, -122.4, 37.61, -122.3, 61] as const
    const a = mk(); applyRunwayExtras([a], { KSFO: [[...row]] })
    expect(a.r[0]).toMatchObject({ la1: 37.61, lo1: -122.4, la2: 37.61, lo2: -122.3 })
    expect(a.r[0]!.w).toBeCloseTo(61 / 0.3048, 6); expect(a.r[0]!.l).toBeCloseTo((0.1 * 111_319.5 * Math.cos((37.61 * Math.PI) / 180)) / 0.3048, 0)
    const b = mk(); applyRunwayExtras([b], { KSFO: [['28L', '10R', 0, 0, 37.61, -122.3, 37.61, -122.4, 61]] })        // listed the other way round
    expect(b.r[0]).toMatchObject({ la1: 37.61, lo1: -122.4, la2: 37.61, lo2: -122.3 })
  })
  it('ignores impossible coordinates and rows without a correction keep the database\'s geometry', () => {
    const a = { i: 'KSFO', r: [{ ...rwy(11000, 5, 9), li: '10R', hi: '28L', la1: 37.6, lo1: -122.4, la2: 37.6, lo2: -122.3 }] }
    applyRunwayExtras([a], { KSFO: [['10R', '28L', 120, 0, 95, -122.4, 37.6, -122.3, 61]] })
    expect(a.r[0]).toMatchObject({ la1: 37.6, la2: 37.6, o1: 120 })
    applyRunwayExtras([a], { KSFO: [['10R', '28L', 0, 0]] }); expect(a.r[0]!.la1).toBe(37.6)
  })
})

describe('the lowland around a field below sea level', () => {
  it('grows with the depth, from 12 km to 40 km', () => {
    expect(lowlandRadiusM(-3.4)).toBeCloseTo(12_000 + 3.4 * 400, 0)          // a polder
    expect(lowlandRadiusM(-64)).toBeCloseTo(12_000 + 64 * 400, 0)            // Death Valley
    expect(lowlandRadiusM(-386)).toBe(40_000)                                // the Dead Sea basin
    expect(lowlandRadiusM(0)).toBe(12_000)
  })
})
