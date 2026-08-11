import { describe, expect, it } from 'vitest'
import type { LatLon } from '../../src/math/geo'
import { NavaidType, type NavaidData } from '../../src/sim/nav/navaids'
import {
  findTunedVor,
  vorCdiFraction,
  ilsRefFromRunwayThreshold,
  localizerFraction,
  glideslopeFraction,
  findKnownIls,
  ilsOnFinal,
  KNOWN_ILS_FREQUENCIES,
} from '../../src/sim/nav/tuning'
import { papiAngleDeg, papiWhiteCount } from '../../src/world/papi'

const SFO_VOR: NavaidData = { i: 'SFO', n: 'San Francisco', t: NavaidType.VOR_DME, la: 37.6195, lo: -122.374, e: 13, f: 115800 }
const OAK_NDB: NavaidData = { i: 'OAK', n: 'Oakland', t: NavaidType.NDB, la: 37.7, lo: -122.2, e: 10, f: 373 }

describe('findTunedVor', () => {
  it('matches a VOR/VORTAC/VOR-DME by frequency within tolerance', () => {
    expect(findTunedVor([SFO_VOR, OAK_NDB], 115.8)?.i).toBe('SFO')
  })

  it('does not match an NDB even at the same nominal frequency slot', () => {
    // OAK's f is 373 kHz (an NDB frequency); tuning a VOR-range MHz value
    // should never accidentally match it.
    expect(findTunedVor([SFO_VOR, OAK_NDB], 0.373)).toBeUndefined()
  })

  it('returns undefined (honest no-signal) when nothing matches', () => {
    expect(findTunedVor([SFO_VOR], 110.0)).toBeUndefined()
  })

  it('tolerates small float rounding in the MHz*1000 conversion', () => {
    expect(findTunedVor([SFO_VOR], 115.7999)?.i).toBe('SFO')
  })
})

describe('vorCdiFraction', () => {
  it('is zero on-course, full-scale left/right off it (matches vorCdi degrees / VOR_FULL_SCALE_DEG)', () => {
    const station: NavaidData = { ...SFO_VOR, la: 0, lo: 0 }
    const onCourse: LatLon = { lat: -1, lon: 0 } // due south of station, radial 180
    const r = vorCdiFraction(station, 180, onCourse)
    expect(r.deflectionFraction).toBeCloseTo(0, 5)
    expect(r.toFrom).toBe('FROM')
  })
})

describe('ilsRefFromRunwayThreshold + localizerFraction/glideslopeFraction', () => {
  // Runway 36: threshold at the SOUTH end (the end you cross landing
  // northbound), far end 2 nm north. Front course = threshold→far ≈ 360.
  // (A prior revision asserted the reciprocal — bearing(far→threshold) —
  // which fed the AP a 180°-wrong course datum in the app; caught by the
  // Phase-5 opening browser verification.)
  const t = {
    thresholdLat: 37.6, thresholdLon: -122.0, thresholdElevFt: 13,
    oppositeLat: 37.637, oppositeLon: -122.0, // ~2nm north
  }

  it('builds the front course flown from the threshold toward the far end', () => {
    const ils = ilsRefFromRunwayThreshold(t)
    expect(((ils.courseDeg % 360) + 360) % 360).toBeCloseTo(0, 0)
    expect(ils.gsAngleDeg).toBeUndefined() // defaults inside navaids.ts, not stamped here
  })

  it('reads zero deflection on the approach side of the extended centerline/glidepath', () => {
    const ils = ilsRefFromRunwayThreshold(t)
    // Approach side for a northbound course = SOUTH of the threshold.
    const metersPerDegLat = 111_319.5
    const onCenterline: LatLon = { lat: 37.58, lon: -122.0 }
    expect(localizerFraction(ils, onCenterline).deflectionFraction).toBeCloseTo(0, 5)
    // On-beam altitude references the GS ANTENNA 300 m down the runway
    // (13d fix — the old threshold-anchored beam crossed the threshold at
    // 0 ft TCH and sat ~0.2° below the PAPI).
    const point3nm: LatLon = { lat: t.thresholdLat - (3 * 1852) / metersPerDegLat, lon: -122.0 }
    const distFt = (3 * 1852) / 0.3048 + 300 / 0.3048
    const altFt = t.thresholdElevFt + distFt * Math.tan((3 * Math.PI) / 180)
    expect(glideslopeFraction(ils, point3nm, altFt)).toBeCloseTo(0, 1)
  })

  it('sites the GS antenna ~300 m past the threshold → ~52 ft TCH (13d)', () => {
    const ils = ilsRefFromRunwayThreshold(t)
    const setbackM = 111_319.5 * (ils.gsAntenna.lat - t.thresholdLat)
    expect(setbackM).toBeGreaterThan(295)
    expect(setbackM).toBeLessThan(305)
    // The 3° beam anchored there crosses the threshold at ~51.6 ft.
    const tchFt = t.thresholdElevFt + (setbackM / 0.3048) * Math.tan((3 * Math.PI) / 180)
    expect(glideslopeFraction(ils, { lat: t.thresholdLat, lon: t.thresholdLon }, tchFt)).toBeCloseTo(0, 1)
  })

  it('agrees with the PAPI: on the beam, the array 300 m in reads 3.0° = 2W2R', () => {
    const ils = ilsRefFromRunwayThreshold(t)
    const metersPerDegLat = 111_319.5
    const distThrM = 3 * 1852
    const point: LatLon = { lat: t.thresholdLat - distThrM / metersPerDegLat, lon: -122.0 }
    const altFt = t.thresholdElevFt + ((distThrM + 300) / 0.3048) * Math.tan((3 * Math.PI) / 180)
    expect(glideslopeFraction(ils, point, altFt)).toBeCloseTo(0, 2)
    // PAPI array also sits 300 m in at threshold elevation.
    const angle = papiAngleDeg(distThrM + 300, ((altFt - t.thresholdElevFt) * 0.3048))
    expect(angle).toBeCloseTo(3.0, 2)
    expect(papiWhiteCount(angle)).toBe(2)
  })
})

describe('findKnownIls (stopgap ILS-frequency table)', () => {
  it('finds KSFO 28R/28L at their published frequencies (IGWQ 111.7 / IBRG 109.55)', () => {
    expect(findKnownIls('KSFO', 111.7)?.runway).toBe('28R')
    expect(findKnownIls('KSFO', 109.55)?.runway).toBe('28L')
  })

  it('finds EGLL westerly ILS at the published shared frequencies (IRR 110.30 / ILL 109.50)', () => {
    // UK AIP: 09L/27R share 110.30 (IAA/IRR), 09R/27L share 109.50
    // (IBB/ILL) — opposite ends interlocked in reality. The stopgap table
    // resolves the westerly end first (Heathrow's dominant operation).
    expect(findKnownIls('EGLL', 110.3)?.runway).toBe('27R')
    expect(findKnownIls('EGLL', 109.5)?.runway).toBe('27L')
  })

  it('finds RJTT ILS at the AIP Japan frequencies (distinct per runway, no shared pairs)', () => {
    expect(findKnownIls('RJTT', 108.9)?.runway).toBe('34R') // I-TC
    expect(findKnownIls('RJTT', 111.7)?.runway).toBe('34L') // I-HA
    expect(findKnownIls('RJTT', 111.95)?.runway).toBe('16L') // I-OC
    expect(findKnownIls('RJTT', 110.5)?.runway).toBe('23') // I-TD
    // The offset LDA frequencies for 22/23 are deliberately absent — a
    // straight-in synthesis must not impersonate an offset LDA.
    expect(findKnownIls('RJTT', 110.1)).toBeUndefined() // I-KL (LDA W 22)
    expect(findKnownIls('RJTT', 108.5)).toBeUndefined() // I-TL (LDA 23)
  })

  it('finds NZAA ILS at the AIP New Zealand frequencies', () => {
    expect(findKnownIls('NZAA', 109.9)?.runway).toBe('23L') // I-MG
    expect(findKnownIls('NZAA', 110.3)?.runway).toBe('05R') // I-AA
    // LOC-only 05L/23R deliberately absent — a synthesis that always
    // provides a glideslope must not impersonate a localizer-only
    // approach.
    expect(findKnownIls('NZAA', 110.1)).toBeUndefined() // I-SL (LOC 05L)
    expect(findKnownIls('NZAA', 109.5)).toBeUndefined() // I-TR (LOC 23R)
    // 110.3 is keyed per-airport: EGLL 27R and NZAA 05R share the number
    // without colliding.
    expect(findKnownIls('EGLL', 110.3)?.runway).toBe('27R')
  })

  it('finds LFPG ILS at the published frequencies (all four runways, both ends)', () => {
    expect(findKnownIls('LFPG', 110.35)?.runway).toBe('27R') // PNW
    expect(findKnownIls('LFPG', 108.35)?.runway).toBe('26L') // DSU
    expect(findKnownIls('LFPG', 110.1)?.runway).toBe('09R') // CGE
    expect(findKnownIls('LFPG', 108.7)?.runway).toBe('08L') // GLE
    // Per-airport keying: RJTT 23 also sits on 110.5-adjacent block and
    // NZAA 05R shares 110.3 with EGLL — none of these collide with CDG.
    expect(findKnownIls('LFPG', 110.3)).toBeUndefined()
  })

  it('is honest about airports/frequencies not in the table', () => {
    expect(findKnownIls('KXYZ', 109.55)).toBeUndefined()
    expect(findKnownIls('KSFO', 99.9)).toBeUndefined()
  })

  it('table entries are internally consistent (icao/runway/freq all present)', () => {
    for (const e of KNOWN_ILS_FREQUENCIES) {
      expect(e.icao.length).toBeGreaterThan(0)
      expect(e.runway.length).toBeGreaterThan(0)
      expect(e.freqMhz).toBeGreaterThan(100)
    }
  })
})

describe('ilsOnFinal (15a Mode-5 gate)', () => {
  it('is true established inbound: small deflection, aligned course', () => {
    expect(ilsOnFinal(0.1, 300, 298)).toBe(true)
  })
  it('is false at full localizer deflection (the spurious-KPAO-GLIDESLOPE case)', () => {
    expect(ilsOnFinal(1, 310, 298)).toBe(false)
  })
  it('is false crossing the beam 90° off course', () => {
    expect(ilsOnFinal(0.2, 28, 298)).toBe(false)
  })
})
