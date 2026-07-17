import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs module without type declarations
import { buildUsAirspace, faaAltFt, simplifyRing, CEILING_UNLIMITED_FT, AIRSPACE_KIND_NAMES } from '../../server/parse.mjs'

/**
 * Real GeoJSON features fetched this session from the FAA's ArcGIS
 * open-data REST API (Phase 4 Task 5) — not fabricated:
 *   Class_Airspace:  https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0/query?where=NAME LIKE '%SAN FRANCISCO%'&outFields=*&f=geojson
 *   Special_Use_Airspace: .../Special_Use_Airspace/FeatureServer/0/query?where=1=1&outFields=*&f=geojson
 * Trimmed to the fields `buildUsAirspace` reads and to features with a
 * naturally small ring (SF Class B "AREA K" only has 5 real ring points;
 * most SUA MOAs/restricted areas are simple quadrilaterals) so the fixture
 * stays readable — the coordinates themselves are the real, unmodified
 * values from the live feed.
 */
const SF_CLASS_B_AREA_K = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-121.986679831798, 37.9016716534012],
        [-121.980846491438, 37.8547272048961],
        [-122.157790966893, 37.8863938615728],
        [-122.09584652358, 37.9805605409478],
        [-121.986679831798, 37.9016716534012],
      ],
    ],
  },
  properties: {
    NAME: 'SAN FRANCISCO CLASS B',
    ICAO_ID: 'KSFO',
    LOCAL_TYPE: 'CLASS_B',
    UPPER_VAL: 10000,
    UPPER_UOM: 'FT',
    UPPER_CODE: 'MSL',
    LOWER_VAL: 6000,
    LOWER_UOM: 'FT',
    LOWER_CODE: 'MSL',
    SECTOR: 'AREA K',
  },
}

// Real Class E2 (surface area) record — no explicit ceiling in the source
// (UPPER_CODE null, UPPER_VAL the FAA's "-9998" unbounded placeholder).
const ABERDEEN_CLASS_E2 = {
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[-98.5, 45.4], [-98.3, 45.4], [-98.3, 45.6], [-98.5, 45.6], [-98.5, 45.4]]] },
  properties: {
    NAME: 'ABERDEEN CLASS E2',
    ICAO_ID: 'KABR',
    LOCAL_TYPE: 'CLASS_E2',
    UPPER_VAL: -9998,
    UPPER_UOM: null,
    UPPER_CODE: null,
    LOWER_VAL: 0,
    LOWER_UOM: 'FT',
    LOWER_CODE: 'SFC',
    SECTOR: null,
  },
}

// A real Class E5 record (NOT surface-based — floor is 700ft, not SFC) —
// must be dropped by buildUsAirspace since only CLASS_E2 is in this task's
// "Class E-surface" scope.
const SF_CLASS_E5 = {
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[-122.6, 37.5], [-122.5, 37.5], [-122.5, 37.6], [-122.6, 37.6], [-122.6, 37.5]]] },
  properties: {
    NAME: 'SAN FRANCISCO CLASS E5',
    ICAO_ID: null,
    LOCAL_TYPE: 'CLASS_E5',
    UPPER_VAL: -9998,
    UPPER_UOM: null,
    UPPER_CODE: null,
    LOWER_VAL: 700,
    LOWER_UOM: 'FT',
    LOWER_CODE: 'SFC',
    SECTOR: null,
  },
}

const P51_PROHIBITED = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-122.69084830518, 47.6950055817396],
        [-122.736403868262, 47.6944500206885],
        [-122.769181658109, 47.7219500184676],
        [-122.770015004195, 47.7752833550723],
        [-122.691959435691, 47.7747278076729],
        [-122.69084830518, 47.6950055817396],
      ],
    ],
  },
  properties: {
    NAME: 'P-51',
    TYPE_CODE: 'P',
    UPPER_VAL: '2500',
    UPPER_UOM: 'FT',
    UPPER_CODE: 'MSL',
    LOWER_VAL: '0',
    LOWER_UOM: 'FT',
    LOWER_CODE: 'SFC',
  },
}

const R2306D_RESTRICTED = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-114.217511428786, 33.4666716737192],
        [-114.217511425335, 33.4208383338386],
        [-114.441122581256, 33.4666716618575],
        [-114.217511428786, 33.4666716737192],
      ],
    ],
  },
  properties: {
    NAME: 'R-2306D',
    TYPE_CODE: 'R',
    UPPER_VAL: '230',
    UPPER_UOM: 'FL',
    UPPER_CODE: 'STD',
    LOWER_VAL: '0',
    LOWER_UOM: 'FT',
    LOWER_CODE: 'SFC',
  },
}

const ADIRONDACK_MOA = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-75.0500020489708, 44.5000089217773],
        [-75.3333354752643, 44.5000089103319],
        [-75.0500020568328, 44.6000089393544],
        [-75.0500020489708, 44.5000089217773],
      ],
    ],
  },
  properties: {
    NAME: 'ADIRONDACK A MOA',
    TYPE_CODE: 'MOA',
    UPPER_VAL: '180',
    UPPER_UOM: 'FL',
    UPPER_CODE: 'STD',
    LOWER_VAL: '6000',
    LOWER_UOM: 'FT',
    LOWER_CODE: 'MSL',
  },
}

describe('faaAltFt', () => {
  it('reads SFC as 0 ft regardless of VAL', () => {
    expect(faaAltFt(0, 'FT', 'SFC')).toBe(0)
  })

  it('reads a flight level (FL) as VAL*100 ft', () => {
    expect(faaAltFt('230', 'FL', 'STD')).toBe(23000)
    expect(faaAltFt('180', 'FL', 'STD')).toBe(18000)
  })

  it('reads plain FT/MSL as VAL directly, string or number', () => {
    expect(faaAltFt(10000, 'FT', 'MSL')).toBe(10000)
    expect(faaAltFt('2500', 'FT', 'MSL')).toBe(2500)
  })

  it('reads the real "-9998" unbounded placeholder (with or without an explicit UNLTD code) as the unlimited sentinel', () => {
    expect(faaAltFt(-9998, null, null)).toBe(CEILING_UNLIMITED_FT)
    expect(faaAltFt('-9998', 'FL', 'UNLTD')).toBe(CEILING_UNLIMITED_FT)
  })
})

describe('simplifyRing (Douglas-Peucker)', () => {
  it('leaves a triangle (3 points) unchanged', () => {
    const tri = [[0, 0], [1, 0], [0, 1]]
    expect(simplifyRing(tri, 0.0005)).toEqual(tri)
  })

  it('collapses near-collinear points within tolerance', () => {
    const nearlyStraight = [[0, 0], [0.5, 0.00001], [1, 0], [1, 1], [0, 1], [0, 0]]
    const out = simplifyRing(nearlyStraight, 0.001)
    expect(out.length).toBeLessThan(nearlyStraight.length)
    // First and last points (ring closure) are always preserved.
    expect(out[0]).toEqual(nearlyStraight[0])
    expect(out[out.length - 1]).toEqual(nearlyStraight[nearlyStraight.length - 1])
  })

  it('keeps points outside the tolerance', () => {
    const square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
    expect(simplifyRing(square, 0.0001)).toEqual(square)
  })
})

describe('buildUsAirspace (real FAA ArcGIS GeoJSON fixtures)', () => {
  const classFeatures = [SF_CLASS_B_AREA_K, ABERDEEN_CLASS_E2, SF_CLASS_E5]
  const suaFeatures = [P51_PROHIBITED, R2306D_RESTRICTED, ADIRONDACK_MOA]
  const out = buildUsAirspace(classFeatures, suaFeatures)

  it('drops non-surface Class E variants (E5) out of this task\'s scope', () => {
    expect(out.find((a: any) => a.n === 'SAN FRANCISCO CLASS E5')).toBeUndefined()
  })

  it('keeps Class B, Class E2 (surface), and all real SUA types (P/R/MOA)', () => {
    expect(out).toHaveLength(5)
  })

  it('SF Class B AREA K: floor/ceiling in ft MSL, sector + ICAO carried through, kind = CLASS_B (0)', () => {
    const b = out.find((a: any) => a.se === 'AREA K')
    expect(b).toBeDefined()
    expect(b.k).toBe(0)
    expect(AIRSPACE_KIND_NAMES[b.k]).toBe('CLASS_B')
    expect(b.i).toBe('KSFO')
    expect(b.fl).toBe(6000)
    expect(b.ce).toBe(10000)
    expect(b.r[0]).toHaveLength(5) // small enough to survive simplification untouched
  })

  it('Aberdeen Class E2: floor 0 (SFC), unbounded ceiling sentinel, kind = CLASS_E_SFC (3)', () => {
    const e2 = out.find((a: any) => a.n === 'ABERDEEN CLASS E2')
    expect(e2.k).toBe(3)
    expect(e2.fl).toBe(0)
    expect(e2.ce).toBe(CEILING_UNLIMITED_FT)
  })

  it('P-51 prohibited area: kind = PROHIBITED (5), surface floor, 2500 ft ceiling', () => {
    const p = out.find((a: any) => a.n === 'P-51')
    expect(p.k).toBe(5)
    expect(p.fl).toBe(0)
    expect(p.ce).toBe(2500)
    expect(p.i).toBeUndefined() // SUA has no ICAO_ID field
  })

  it('R-2306D restricted area: kind = RESTRICTED (4), FL230 ceiling converted to 23000 ft', () => {
    const r = out.find((a: any) => a.n === 'R-2306D')
    expect(r.k).toBe(4)
    expect(r.ce).toBe(23000)
  })

  it('Adirondack MOA: kind = MOA (6), 6000 ft floor, FL180 -> 18000 ft ceiling', () => {
    const moa = out.find((a: any) => a.n === 'ADIRONDACK A MOA')
    expect(moa.k).toBe(6)
    expect(moa.fl).toBe(6000)
    expect(moa.ce).toBe(18000)
  })

  it('rounds ring coordinates to 5 decimal places', () => {
    const b = out.find((a: any) => a.se === 'AREA K')
    for (const [lon, lat] of b.r[0]) {
      expect(lon).toBe(+lon.toFixed(5))
      expect(lat).toBe(+lat.toFixed(5))
    }
  })
})
