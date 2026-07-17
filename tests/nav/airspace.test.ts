import { describe, expect, it } from 'vitest'
import {
  AirspaceKind,
  CEILING_UNLIMITED_FT,
  airspacesContaining,
  altitudeInRange,
  pointInPolygonRings,
  type AirspacePolygon,
} from '../../src/sim/nav/airspace'

// A simple synthetic 1deg x 1deg rectangle, [0,0] to [1,1] (lon,lat) — not
// real airspace data, a hand-built fixture per this task's TDD-against-
// fixtures convention (mirrors Task 4's CIFP leg-interpreter fixtures).
const RECT: readonly [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [0, 0],
]

describe('pointInPolygonRings (even-odd ray-casting rule)', () => {
  it('is true for a point clearly inside the rectangle', () => {
    expect(pointInPolygonRings(0.5, 0.5, [RECT])).toBe(true)
  })

  it('is false for a point clearly outside the rectangle', () => {
    expect(pointInPolygonRings(2, 2, [RECT])).toBe(false)
    expect(pointInPolygonRings(-1, 0.5, [RECT])).toBe(false)
    expect(pointInPolygonRings(0.5, -1, [RECT])).toBe(false)
  })

  it('handles a point exactly on an edge as an allowed-either-way boundary case (even-odd rule property, not a bug)', () => {
    // Documented in the header comment: on-edge results are implementation
    // -defined by the even-odd rule. We only assert it doesn't throw and
    // returns a boolean, not a specific true/false.
    expect(typeof pointInPolygonRings(0.5, 0, [RECT])).toBe('boolean')
    expect(typeof pointInPolygonRings(0, 0.5, [RECT])).toBe('boolean')
  })

  it('returns false for an empty ring set', () => {
    expect(pointInPolygonRings(0.5, 0.5, [])).toBe(false)
  })

  it('excludes points inside a hole (second ring)', () => {
    const hole: readonly [number, number][] = [
      [0.4, 0.4],
      [0.6, 0.4],
      [0.6, 0.6],
      [0.4, 0.6],
      [0.4, 0.4],
    ]
    expect(pointInPolygonRings(0.5, 0.5, [RECT, hole])).toBe(false) // inside the hole
    expect(pointInPolygonRings(0.1, 0.1, [RECT, hole])).toBe(true) // inside the shape but outside the hole
  })

  it('handles a non-axis-aligned quadrilateral (not just the trivial rectangle case)', () => {
    const diamond: readonly [number, number][] = [
      [1, 0],
      [2, 1],
      [1, 2],
      [0, 1],
      [1, 0],
    ]
    expect(pointInPolygonRings(1, 1, [diamond])).toBe(true) // center
    expect(pointInPolygonRings(0.1, 0.1, [diamond])).toBe(false) // outside a corner cut-off
  })
})

describe('altitudeInRange', () => {
  it('is true within [floor, ceiling], inclusive of both bounds', () => {
    expect(altitudeInRange(5000, 0, 10000)).toBe(true)
    expect(altitudeInRange(0, 0, 10000)).toBe(true)
    expect(altitudeInRange(10000, 0, 10000)).toBe(true)
  })

  it('is false below floor or above ceiling', () => {
    expect(altitudeInRange(-1, 0, 10000)).toBe(false)
    expect(altitudeInRange(10001, 0, 10000)).toBe(false)
  })

  it('treats CEILING_UNLIMITED_FT as effectively no ceiling for realistic altitudes', () => {
    expect(altitudeInRange(45000, 18000, CEILING_UNLIMITED_FT)).toBe(true)
  })
})

describe('airspacesContaining', () => {
  const classBShelf: AirspacePolygon = {
    n: 'TEST CLASS B',
    k: AirspaceKind.ClassB,
    fl: 0,
    ce: 10000,
    i: 'KTST',
    se: 'AREA A',
    r: [RECT],
  }
  const classEsfc: AirspacePolygon = {
    n: 'TEST CLASS E2',
    k: AirspaceKind.ClassESfc,
    fl: 0,
    ce: CEILING_UNLIMITED_FT,
    r: [RECT],
  }
  const restricted: AirspacePolygon = {
    n: 'R-TEST',
    k: AirspaceKind.Restricted,
    fl: 5000,
    ce: 15000,
    r: [RECT],
  }

  it('returns no matches for a point outside every polygon', () => {
    expect(airspacesContaining({ lat: 5, lon: 5 }, 3000, [classBShelf, classEsfc, restricted])).toEqual([])
  })

  it('returns no match when inside the polygon but outside its altitude range', () => {
    expect(airspacesContaining({ lat: 0.5, lon: 0.5 }, 20000, [classBShelf])).toEqual([])
  })

  it('returns exactly the polygon that matches both position and altitude', () => {
    const matches = airspacesContaining({ lat: 0.5, lon: 0.5 }, 3000, [classBShelf, restricted])
    expect(matches).toEqual([classBShelf]) // restricted's floor is 5000, this altitude is below it
  })

  it('returns all overlapping airspaces at a position/altitude inside multiple shelves at once', () => {
    const matches = airspacesContaining({ lat: 0.5, lon: 0.5 }, 6000, [classBShelf, classEsfc, restricted])
    expect(matches).toHaveLength(3)
    expect(matches).toContain(classBShelf)
    expect(matches).toContain(classEsfc)
    expect(matches).toContain(restricted)
  })

  it('returns an empty array (not undefined) when given no polygons', () => {
    expect(airspacesContaining({ lat: 0.5, lon: 0.5 }, 3000, [])).toEqual([])
  })
})
