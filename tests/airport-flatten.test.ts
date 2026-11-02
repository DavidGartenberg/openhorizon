import { describe, expect, it } from 'vitest'
import { airportFieldElevationM, airportFlatRadiusM, airportFlatDisk, FLAT_INNER_MARGIN_M } from '../src/world/airport-flatten'
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
