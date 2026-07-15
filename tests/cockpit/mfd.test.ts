import { describe, expect, it } from 'vitest'
import {
  barGaugeFraction,
  rpmGaugeFractions,
  fuelQtyGauge,
  egtDeltaFromPeakC,
  filterAirportsInRange,
  projectToMap,
  mapElevationGridOffsets,
  elevationColor,
  mfdSoftkeyRegions,
  MFD_SOFTKEY_LABELS,
  RPM_GAUGE_MAX,
  type MapAirport,
} from '../../src/cockpit/mfd'
import { C172S } from '../../src/sim/aircraft/c172s'
import { TANK_CAPACITY_GAL, TANK_CAPACITY_KG, kgToGal } from '../../src/sim/systems/fuel'
import { EGT_PEAK_MIXTURE, EGT_PEAK_C, egtC } from '../../src/sim/systems/mixture'

describe('barGaugeFraction', () => {
  it('is 0 at min and 1 at max', () => {
    expect(barGaugeFraction(0, 0, 100)).toBe(0)
    expect(barGaugeFraction(100, 0, 100)).toBe(1)
  })

  it('is 0.5 at the midpoint', () => {
    expect(barGaugeFraction(50, 0, 100)).toBeCloseTo(0.5, 9)
  })

  it('clamps below min and above max', () => {
    expect(barGaugeFraction(-10, 0, 100)).toBe(0)
    expect(barGaugeFraction(200, 0, 100)).toBe(1)
  })

  it('does not divide by zero when min===max', () => {
    expect(barGaugeFraction(5, 10, 10)).toBe(0)
  })
})

describe('rpmGaugeFractions', () => {
  it('places redline at redlineRpm/RPM_GAUGE_MAX', () => {
    const { redlineFrac } = rpmGaugeFractions(0, C172S.redlineRpm)
    expect(redlineFrac).toBeCloseTo(C172S.redlineRpm / RPM_GAUGE_MAX, 9)
  })

  it('value fraction tracks rpm linearly', () => {
    const a = rpmGaugeFractions(1000, C172S.redlineRpm)
    const b = rpmGaugeFractions(2000, C172S.redlineRpm)
    expect(b.valueFrac).toBeCloseTo(a.valueFrac * 2, 9)
  })

  it('reads redline fraction from C172S.redlineRpm, not a hardcoded 2700', () => {
    const { redlineFrac } = rpmGaugeFractions(0, 3000)
    expect(redlineFrac).toBeCloseTo(1, 9)
  })
})

describe('fuelQtyGauge (kg -> gal conversion, reusing fuel.ts)', () => {
  it('matches fuel.ts kgToGal exactly', () => {
    const { gal } = fuelQtyGauge(50)
    expect(gal).toBeCloseTo(kgToGal(50), 9)
  })

  it('a full tank reads TANK_CAPACITY_GAL and frac 1', () => {
    const { gal, frac } = fuelQtyGauge(TANK_CAPACITY_KG)
    expect(gal).toBeCloseTo(TANK_CAPACITY_GAL, 3)
    expect(frac).toBeCloseTo(1, 6)
  })

  it('an empty tank reads 0/0', () => {
    const { gal, frac } = fuelQtyGauge(0)
    expect(gal).toBe(0)
    expect(frac).toBe(0)
  })
})

describe('egtDeltaFromPeakC (lean-assist peak-EGT readout)', () => {
  it('is ~0 exactly at the modeled peak mixture', () => {
    expect(Math.abs(egtDeltaFromPeakC(EGT_PEAK_MIXTURE))).toBeLessThan(1e-6)
  })

  it('is positive away from peak on both sides (rich-of-peak and lean-of-peak)', () => {
    expect(egtDeltaFromPeakC(1)).toBeGreaterThan(0) // full rich, rich-of-peak
    expect(egtDeltaFromPeakC(EGT_PEAK_MIXTURE - 0.05)).toBeGreaterThan(0) // just lean of peak
  })

  it('matches egtC directly (no re-derivation of the curve)', () => {
    expect(egtDeltaFromPeakC(0.6)).toBeCloseTo(EGT_PEAK_C - egtC(0.6), 9)
  })
})

describe('filterAirportsInRange', () => {
  const aircraft = { lat: 37.0, lon: -122.0 }
  const airports: MapAirport[] = [
    { id: 'NEAR', name: 'Near Field', lat: 37.01, lon: -122.0 }, // ~1.1km away
    { id: 'FAR', name: 'Far Field', lat: 38.0, lon: -122.0 }, // ~111km away
  ]

  it('includes airports within range and excludes those beyond it', () => {
    const inRange = filterAirportsInRange(aircraft, airports, 5000)
    expect(inRange.map((a) => a.id)).toEqual(['NEAR'])
  })

  it('includes both when range is large enough', () => {
    const inRange = filterAirportsInRange(aircraft, airports, 200_000)
    expect(inRange.map((a) => a.id).sort()).toEqual(['FAR', 'NEAR'])
  })

  it('excludes all when range is very small', () => {
    const inRange = filterAirportsInRange(aircraft, airports, 10)
    expect(inRange).toEqual([])
  })
})

describe('projectToMap', () => {
  const aircraft = { lat: 0, lon: 0 }

  it('returns null for a target beyond rangeM', () => {
    const p = projectToMap(aircraft, { lat: 5, lon: 0 }, 0, 10_000, false)
    expect(p).toBeNull()
  })

  it('north-up: a target due north of the aircraft projects straight up (negative y, x~=0)', () => {
    const target = { lat: 0.05, lon: 0 } // due north, well within range
    const p = projectToMap(aircraft, target, 0, 20_000, false)
    expect(p).not.toBeNull()
    expect(p!.x).toBeCloseTo(0, 2)
    expect(p!.y).toBeLessThan(0)
  })

  it('north-up: a target due east projects to positive x, y~=0', () => {
    const target = { lat: 0, lon: 0.05 }
    const p = projectToMap(aircraft, target, 0, 20_000, false)
    expect(p!.x).toBeGreaterThan(0)
    expect(p!.y).toBeCloseTo(0, 2)
  })

  it('track-up rotates the picture by heading: flying east, a target ahead (due east) projects up', () => {
    const target = { lat: 0, lon: 0.05 } // due east of aircraft
    const p = projectToMap(aircraft, target, 90, 20_000, true) // heading 090
    expect(p!.x).toBeCloseTo(0, 1)
    expect(p!.y).toBeLessThan(0)
  })

  it('scales with distance: a target at half rangeM sits at half the unit radius', () => {
    const near = projectToMap(aircraft, { lat: 0.025, lon: 0 }, 0, 20_000, false)
    const far = projectToMap(aircraft, { lat: 0.05, lon: 0 }, 0, 20_000, false)
    expect(Math.abs(near!.y)).toBeCloseTo(Math.abs(far!.y) / 2, 1)
  })
})

describe('mapElevationGridOffsets', () => {
  it('returns cellsPerAxis^2 points', () => {
    const pts = mapElevationGridOffsets(5000, 4)
    expect(pts.length).toBe(16)
  })

  it('spans from -rangeM to +rangeM (cell-centered, so strictly inside)', () => {
    const rangeM = 5000
    const pts = mapElevationGridOffsets(rangeM, 6)
    for (const p of pts) {
      expect(p.nOffsetM).toBeGreaterThan(-rangeM)
      expect(p.nOffsetM).toBeLessThan(rangeM)
      expect(p.eOffsetM).toBeGreaterThan(-rangeM)
      expect(p.eOffsetM).toBeLessThan(rangeM)
    }
  })
})

describe('elevationColor', () => {
  it('returns a distinct color per band and is stable for the same input', () => {
    const colors = new Set([elevationColor(-10), elevationColor(100), elevationColor(500), elevationColor(1200), elevationColor(3000)])
    expect(colors.size).toBe(5)
    expect(elevationColor(500)).toBe(elevationColor(500))
  })
})

describe('mfdSoftkeyRegions', () => {
  it('returns one region per softkey label', () => {
    const regions = mfdSoftkeyRegions(2048, 1024)
    expect(regions.length).toBe(MFD_SOFTKEY_LABELS.length)
    expect(regions.map((r) => r.label)).toEqual([...MFD_SOFTKEY_LABELS])
  })

  it('regions are non-overlapping and cover the row left-to-right', () => {
    const regions = mfdSoftkeyRegions(2048, 1024)
    for (let i = 1; i < regions.length; i++) {
      const prev = regions[i - 1]!
      const cur = regions[i]!
      expect(cur.x).toBeCloseTo(prev.x + prev.w, 6)
    }
  })

  it('all regions stay within canvas bounds', () => {
    const width = 2048
    const height = 1024
    const regions = mfdSoftkeyRegions(width, height)
    for (const r of regions) {
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.x + r.w).toBeLessThanOrEqual(width + 1e-6)
      expect(r.y + r.h).toBeLessThanOrEqual(height + 1e-6)
    }
  })
})
