import { describe, expect, it } from 'vitest'
import { fromNedMeters, type LatLon } from '../../src/math/geo'
import {
  NavaidsIndex, vorCdi, VOR_FULL_SCALE_DEG,
  localizerDeflection, glideslopeDeflection, LOC_FULL_SCALE_DEG, GS_FULL_SCALE_DEG,
  dmeSlantRangeNm, vorServiceVolumeNm, radioLineOfSightNm, signalReceivable,
  makeMarkerBeacons, markerBeaconActive, morseTimeline, DEFAULT_MORSE_UNIT_MS,
  NavaidType, type IlsRef, type NavaidData,
} from '../../src/sim/nav/navaids'

const STATION: LatLon = { lat: 0, lon: 0 }

describe('NavaidsIndex', () => {
  const data: NavaidData[] = [
    { i: 'SFO', n: 'San Francisco', t: NavaidType.VOR_DME, la: 37.6195, lo: -122.374, e: 13, f: 115800, dla: 37.6195, dlo: -122.374, de: 13 },
    { i: 'OAK', n: 'Oakland', t: NavaidType.NDB, la: 37.7, lo: -122.2, e: 10, f: 373 },
  ]

  it('find() looks up by ident, case-insensitive', () => {
    const idx = new NavaidsIndex()
    idx.load(data)
    expect(idx.find('sfo')?.n).toBe('San Francisco')
    expect(idx.find('ZZZ')).toBeUndefined()
  })

  it('near() filters by radius', () => {
    const idx = new NavaidsIndex()
    idx.load(data)
    expect(idx.near(37.6195, -122.374, 1000).map((n) => n.i)).toEqual(['SFO'])
    expect(idx.near(37.6195, -122.374, 500_000).map((n) => n.i).sort()).toEqual(['OAK', 'SFO'])
  })

  it('hasDme() reflects station type', () => {
    const idx = new NavaidsIndex()
    idx.load(data)
    expect(idx.hasDme(data[0]!)).toBe(true)
    expect(idx.hasDme(data[1]!)).toBe(false)
  })
})

describe('VOR CDI', () => {
  it('on course, FROM: aircraft east of station, OBS 090', () => {
    const aircraft: LatLon = { lat: 0, lon: 1 }
    const { deflectionDeg, toFrom } = vorCdi(STATION, 90, aircraft)
    expect(deflectionDeg).toBeCloseTo(0, 6)
    expect(toFrom).toBe('FROM')
  })

  it('on course, TO: aircraft west of station, OBS 090', () => {
    const aircraft: LatLon = { lat: 0, lon: -1 }
    const { deflectionDeg, toFrom } = vorCdi(STATION, 90, aircraft)
    expect(deflectionDeg).toBeCloseTo(0, 6)
    expect(toFrom).toBe('TO')
  })

  it('full-scale deflection clamps at ±10°, north/south of an east/west course', () => {
    const north: LatLon = { lat: 1, lon: 0 }
    const south: LatLon = { lat: -1, lon: 0 }
    const n = vorCdi(STATION, 90, north)
    const s = vorCdi(STATION, 90, south)
    expect(n.deflectionDeg).toBeCloseTo(-VOR_FULL_SCALE_DEG, 6)
    expect(s.deflectionDeg).toBeCloseTo(VOR_FULL_SCALE_DEG, 6)
  })

  it('TO/FROM flips crossing the station on a north/south course', () => {
    const north: LatLon = { lat: 1, lon: 0 } // north of station
    const south: LatLon = { lat: -1, lon: 0 } // south of station
    const n = vorCdi(STATION, 0, north)
    const s = vorCdi(STATION, 0, south)
    expect(n.toFrom).toBe('FROM')
    expect(n.deflectionDeg).toBeCloseTo(0, 6)
    expect(s.toFrom).toBe('TO')
    expect(s.deflectionDeg).toBeCloseTo(0, 6)
  })
})

describe('ILS localizer/glideslope', () => {
  const threshold: LatLon = { lat: 37.6, lon: -122.37 }
  const ils: IlsRef = {
    threshold,
    courseDeg: 0, // front course north; aircraft approaches from the south
    thresholdElevFt: 13,
    gsAntenna: threshold,
    gsAntennaElevFt: 13,
  }

  it('on centerline reads 0 deflection', () => {
    const aircraft = fromNedMeters(-10_000, 0, threshold) // 10 km south, on centerline
    expect(localizerDeflection(ils, aircraft)).toBeCloseTo(0, 3)
  })

  it('known lateral offset produces the matching angular deflection', () => {
    // 10 km downrange, offset east by 10000*tan(1.25deg) so the geometric
    // angle off centerline is 1.25 deg (within full scale, not clamped).
    const downrangeM = 10_000
    const lateralM = downrangeM * Math.tan((1.25 * Math.PI) / 180)
    const aircraft = fromNedMeters(-downrangeM, lateralM, threshold)
    // East of centerline while flying the north front course = right of
    // course = negative per this module's documented sign convention.
    expect(localizerDeflection(ils, aircraft)).toBeCloseTo(-1.25, 1)
  })

  it('clamps to full scale well off axis', () => {
    const aircraft = fromNedMeters(-10_000, 10_000, threshold) // 45 deg off
    expect(Math.abs(localizerDeflection(ils, aircraft))).toBeCloseTo(LOC_FULL_SCALE_DEG, 6)
  })

  it('glideslope reads 0 on the nominal 3 deg path', () => {
    const groundM = 10_000
    const altFt = ils.gsAntennaElevFt + (groundM / 0.3048) * Math.tan((3 * Math.PI) / 180)
    const aircraft = fromNedMeters(-groundM, 0, threshold)
    expect(glideslopeDeflection(ils, aircraft, altFt)).toBeCloseTo(0, 1)
  })

  it('glideslope reads high/low off the nominal path, clamped to full scale', () => {
    const groundM = 10_000
    const aircraft = fromNedMeters(-groundM, 0, threshold)
    const high = glideslopeDeflection(ils, aircraft, ils.gsAntennaElevFt + 100_000)
    const low = glideslopeDeflection(ils, aircraft, ils.gsAntennaElevFt)
    expect(high).toBeCloseTo(GS_FULL_SCALE_DEG, 6)
    expect(low).toBeCloseTo(-GS_FULL_SCALE_DEG, 6)
  })
})

describe('DME slant range', () => {
  it('matches ground distance when altitude equals station elevation', () => {
    const station: LatLon = { lat: 0, lon: 0 }
    const aircraft: LatLon = { lat: 0, lon: 1 } // ~111.2 km east on the equator
    const nm = dmeSlantRangeNm(station, 0, aircraft, 0)
    expect(nm).toBeCloseTo(60.06, 1) // ~111,195 m / 1852
  })

  it('is genuinely larger than ground distance directly overhead at altitude (Pythagorean)', () => {
    const station: LatLon = { lat: 0, lon: 0 }
    const aircraft: LatLon = { lat: 0, lon: 0 } // directly overhead
    const altFt = 18_000
    const nm = dmeSlantRangeNm(station, 0, aircraft, altFt)
    const expectedM = altFt * 0.3048 // ground distance ~0, slant = height
    expect(nm).toBeCloseTo(expectedM / 1852, 3)
    expect(nm).toBeGreaterThan(0)
  })

  it('close-range + high-altitude: slant range exceeds ground range by the expected Pythagorean amount', () => {
    const station: LatLon = { lat: 0, lon: 0 }
    const aircraft = fromNedMeters(1000, 0, station) // 1000 m ground distance
    const altFt = 10_000
    const heightM = altFt * 0.3048
    const expectedSlantM = Math.hypot(1000, heightM)
    const nm = dmeSlantRangeNm(station, 0, aircraft, altFt)
    expect(nm).toBeCloseTo(expectedSlantM / 1852, 3)
    expect(expectedSlantM).toBeGreaterThan(1000) // sanity: genuinely different from ground distance
  })
})

describe('service volume / line-of-sight', () => {
  it('VOR service volume by class and altitude', () => {
    expect(vorServiceVolumeNm('T', 5000)).toBe(25)
    expect(vorServiceVolumeNm('T', 20000)).toBe(0)
    expect(vorServiceVolumeNm('L', 15000)).toBe(40)
    expect(vorServiceVolumeNm('H', 10000)).toBe(40)
    expect(vorServiceVolumeNm('H', 16000)).toBe(100)
    expect(vorServiceVolumeNm('H', 30000)).toBe(130)
  })

  it('radio line-of-sight grows with height and reduces signal receivability', () => {
    const near = radioLineOfSightNm(1000, 500)
    const far = radioLineOfSightNm(10000, 500)
    expect(far).toBeGreaterThan(near)
    expect(signalReceivable(60, 100, near)).toBe(near >= 60)
    expect(signalReceivable(5, 100, near)).toBe(true)
  })
})

describe('marker beacons', () => {
  const threshold: LatLon = { lat: 37.6, lon: -122.37 }
  const ils: IlsRef = {
    threshold, courseDeg: 0, thresholdElevFt: 13, gsAntenna: threshold, gsAntennaElevFt: 13,
  }
  const [om, mm] = makeMarkerBeacons(ils)

  it('detects the aircraft over the outer marker at approach altitude', () => {
    expect(markerBeaconActive(om!, om!.position, 1500)).toBe(true)
  })

  it('does not detect the aircraft far from the marker at low altitude', () => {
    const farAway = fromNedMeters(50_000, 0, om!.position)
    expect(markerBeaconActive(om!, farAway, 500)).toBe(false)
  })

  it('outer and middle markers sit at different distances from threshold', () => {
    // OM is further from the threshold than MM (OM ~5 nm vs MM ~3500 ft).
    const domFromThreshold = Math.hypot(om!.position.lat - threshold.lat, om!.position.lon - threshold.lon)
    const dmmFromThreshold = Math.hypot(mm!.position.lat - threshold.lat, mm!.position.lon - threshold.lon)
    expect(domFromThreshold).toBeGreaterThan(dmmFromThreshold)
  })
})

describe('Morse ident timeline', () => {
  it('SFO: dit/dah counts and durations match the standard alphabet', () => {
    // S = ..., F = ..-., O = ---
    const t = morseTimeline('SFO', 100)
    // Count "on" segments that are dits (100ms) vs dahs (300ms).
    const ons = t.filter((s) => s.on)
    const dits = ons.filter((s) => s.durationMs === 100)
    const dahs = ons.filter((s) => s.durationMs === 300)
    // S(3 dits) + F(3 dits,1 dah) + O(3 dahs) = 6 dits, 4 dahs
    expect(dits.length).toBe(6)
    expect(dahs.length).toBe(4)
    expect(t[0]).toEqual({ on: true, durationMs: 100 }) // first dit of S
  })

  it('inter-character gaps are 3 units, intra-character gaps are 1 unit', () => {
    // "AA": A = .-  →  dit, gap(1u), dah, GAP(3u), dit, gap(1u), dah
    const t = morseTimeline('AA', 100)
    const offs = t.filter((s) => !s.on).map((s) => s.durationMs)
    expect(offs).toEqual([100, 300, 100])
  })

  it('default unit duration is the documented 150ms', () => {
    const t = morseTimeline('E') // single dit
    expect(t).toEqual([{ on: true, durationMs: DEFAULT_MORSE_UNIT_MS }])
  })

  it('unknown characters are skipped without throwing', () => {
    expect(() => morseTimeline('1A#')).not.toThrow()
    const t = morseTimeline('1A#', 100)
    expect(t.some((s) => s.on)).toBe(true)
  })
})
