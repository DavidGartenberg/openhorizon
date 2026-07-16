import { describe, expect, it } from 'vitest'
import { fromNedMeters, type LatLon } from '../../src/math/geo'
import {
  FlightPlan, makeLeg, directTo, crossTrackDistanceM, alongTrackDistanceM,
  activeLegProgress, standardRateTurnRadiusM, turnAnticipationDistanceM,
  determinePhase, gpsCdiDeflection, CDI_FULL_SCALE_NM,
  type Waypoint, type Leg,
} from '../../src/sim/nav/gps'

describe('FlightPlan legs', () => {
  it('computes course/distance matching independently-computed great-circle geometry', () => {
    // KSFO-ish origin, waypoint 1 deg east on the equator for hand-checkable
    // geometry: due east course (90), distance ~111.2 km (1 deg of longitude
    // at the equator).
    const a: Waypoint = { ident: 'A', lat: 0, lon: 0 }
    const b: Waypoint = { ident: 'B', lat: 0, lon: 1 }
    const plan = new FlightPlan()
    plan.setWaypoints([a, b])
    const legs = plan.legs()
    expect(legs.length).toBe(1)
    expect(legs[0]!.courseDeg).toBeCloseTo(90, 6)
    // 1 deg longitude at equator ~ 111,320 m (WGS84-ish mean); allow loose tolerance
    expect(legs[0]!.distanceM).toBeCloseTo(111_195, -2)
  })

  it('multi-waypoint plan produces one leg per consecutive pair', () => {
    const wps: Waypoint[] = [
      { ident: 'A', lat: 0, lon: 0 },
      { ident: 'B', lat: 0, lon: 1 },
      { ident: 'C', lat: 1, lon: 1 },
    ]
    const plan = new FlightPlan()
    plan.setWaypoints(wps)
    const legs = plan.legs()
    expect(legs.length).toBe(2)
    expect(legs[0]!.from.ident).toBe('A')
    expect(legs[0]!.to.ident).toBe('B')
    expect(legs[1]!.from.ident).toBe('B')
    expect(legs[1]!.to.ident).toBe('C')
    // second leg heads due north
    expect(legs[1]!.courseDeg).toBeCloseTo(0, 6)
  })

  it('fewer than 2 waypoints produces no legs', () => {
    const plan = new FlightPlan()
    plan.setWaypoints([{ ident: 'A', lat: 0, lon: 0 }])
    expect(plan.legs()).toEqual([])
  })
})

describe('direct-to', () => {
  it('produces the correct course/distance from an arbitrary position to a target waypoint, ignoring the rest of the plan', () => {
    const target: Waypoint = { ident: 'DST', lat: 1, lon: 1 }
    const current: LatLon = { lat: 0, lon: 0 }
    const leg = directTo(current, target)
    // Independently computed expected leg via makeLeg with the same points.
    const expected = makeLeg({ ident: 'X', lat: 0, lon: 0 }, target)
    expect(leg.courseDeg).toBeCloseTo(expected.courseDeg, 6)
    expect(leg.distanceM).toBeCloseTo(expected.distanceM, 3)
    expect(leg.to.ident).toBe('DST')
  })

  it('is independent of any loaded flight plan', () => {
    const plan = new FlightPlan()
    plan.setWaypoints([
      { ident: 'A', lat: 5, lon: 5 },
      { ident: 'B', lat: 6, lon: 6 },
    ])
    // Direct-to a waypoint not even in the plan, from a position far from it.
    const target: Waypoint = { ident: 'FAR', lat: -10, lon: 20 }
    const current: LatLon = { lat: 0, lon: 0 }
    const leg = directTo(current, target)
    expect(leg.to).toEqual(target)
    expect(leg.from.lat).toBe(0)
    expect(leg.from.lon).toBe(0)
    // Unaffected by plan contents.
    expect(plan.count).toBe(2)
  })
})

describe('cross-track error', () => {
  it('due-north leg: aircraft displaced east reads a known positive cross-track distance', () => {
    // Leg from equator northward; a lateral offset east of eastOffsetM at the
    // starting point, small enough for a flat-earth cross-check via
    // fromNedMeters (north, east) around the same origin.
    const from: Waypoint = { ident: 'A', lat: 0, lon: 0 }
    const to: Waypoint = { ident: 'B', lat: 1, lon: 0 } // due north
    const leg: Leg = makeLeg(from, to)
    expect(leg.courseDeg).toBeCloseTo(0, 3)

    const origin: LatLon = { lat: 0, lon: 0 }
    const eastOffsetM = 5000
    // Keep along-track distance modest relative to Earth's radius so the
    // flat-earth NED offset used to construct the test point stays a close
    // approximation of the true great-circle cross-track distance (at very
    // large along-track distances the two diverge due to meridian
    // convergence, which is real geometry, not a bug in either formula).
    const aircraft = fromNedMeters(50_000, eastOffsetM, origin) // well along the leg, offset east
    const xtd = crossTrackDistanceM(leg, aircraft)
    // East of a due-north course = right of course = positive per this
    // module's documented sign convention.
    expect(Math.abs(xtd - eastOffsetM)).toBeLessThan(50) // within tens of meters at this scale
    expect(xtd).toBeGreaterThan(0)
  })

  it('due-north leg: aircraft displaced west reads a known negative cross-track distance', () => {
    const from: Waypoint = { ident: 'A', lat: 0, lon: 0 }
    const to: Waypoint = { ident: 'B', lat: 1, lon: 0 }
    const leg: Leg = makeLeg(from, to)
    const origin: LatLon = { lat: 0, lon: 0 }
    const westOffsetM = 3000
    const aircraft = fromNedMeters(50_000, -westOffsetM, origin)
    const xtd = crossTrackDistanceM(leg, aircraft)
    expect(Math.abs(xtd - -westOffsetM)).toBeLessThan(50)
    expect(xtd).toBeLessThan(0)
  })

  it('on-course aircraft reads ~0 cross-track error', () => {
    const from: Waypoint = { ident: 'A', lat: 0, lon: 0 }
    const to: Waypoint = { ident: 'B', lat: 1, lon: 0 }
    const leg: Leg = makeLeg(from, to)
    const aircraft: LatLon = { lat: 0.5, lon: 0 } // exactly on the meridian
    expect(crossTrackDistanceM(leg, aircraft)).toBeCloseTo(0, 3)
  })

  it('along-track distance for an on-course aircraft matches the great-circle distance already covered', () => {
    const from: Waypoint = { ident: 'A', lat: 0, lon: 0 }
    const to: Waypoint = { ident: 'B', lat: 1, lon: 0 }
    const leg: Leg = makeLeg(from, to)
    const aircraft: LatLon = { lat: 0.5, lon: 0 } // halfway, on the meridian
    const alongTrack = alongTrackDistanceM(leg, aircraft)
    const expected = leg.distanceM / 2
    expect(alongTrack).toBeCloseTo(expected, -1)
  })
})

describe('active-leg tracking', () => {
  it('selects the first leg while short of its along-track length, with distance-remaining to the waypoint', () => {
    const wps: Waypoint[] = [
      { ident: 'A', lat: 0, lon: 0 },
      { ident: 'B', lat: 1, lon: 0 },
      { ident: 'C', lat: 2, lon: 0 },
    ]
    const plan = new FlightPlan()
    plan.setWaypoints(wps)
    const legs = plan.legs()
    const aircraft: LatLon = { lat: 0.4, lon: 0 } // partway along leg 0
    const progress = activeLegProgress(legs, aircraft)
    expect(progress).toBeDefined()
    expect(progress!.legIndex).toBe(0)
    expect(progress!.distanceRemainingM).toBeGreaterThan(0)
    expect(progress!.crossTrackM).toBeCloseTo(0, 3)
  })

  it('advances to the next leg once the aircraft is past the first leg along-track', () => {
    const wps: Waypoint[] = [
      { ident: 'A', lat: 0, lon: 0 },
      { ident: 'B', lat: 1, lon: 0 },
      { ident: 'C', lat: 2, lon: 0 },
    ]
    const plan = new FlightPlan()
    plan.setWaypoints(wps)
    const legs = plan.legs()
    const aircraft: LatLon = { lat: 1.4, lon: 0 } // past waypoint B, on leg 1
    const progress = activeLegProgress(legs, aircraft)
    expect(progress!.legIndex).toBe(1)
  })

  it('reports lateral cross-track distance on the active leg', () => {
    const wps: Waypoint[] = [
      { ident: 'A', lat: 0, lon: 0 },
      { ident: 'B', lat: 1, lon: 0 },
    ]
    const plan = new FlightPlan()
    plan.setWaypoints(wps)
    const legs = plan.legs()
    const origin: LatLon = { lat: 0, lon: 0 }
    const offsetM = 1852 // 1 nm east
    const aircraft = fromNedMeters(50_000, offsetM, origin)
    const progress = activeLegProgress(legs, aircraft)
    expect(progress!.crossTrackNm).toBeCloseTo(1, 1)
  })
})

describe('turn anticipation', () => {
  // Standard-rate turn (3 deg/sec) radius formula: r = V / omega.
  // At 120 kt groundspeed: V = 120 * 1852/3600 m/s = 61.7333... m/s.
  // omega = 3 deg/s = 3*pi/180 rad/s = 0.05235988 rad/s.
  // r = 61.7333 / 0.05235988 = 1179.11 m.
  const GS_KT = 120
  const V_MPS = (GS_KT * 1852) / 3600
  const OMEGA = (3 * Math.PI) / 180
  const EXPECTED_R = V_MPS / OMEGA

  it('standardRateTurnRadiusM matches the hand-computed standard-rate radius at 120 kt', () => {
    const r = standardRateTurnRadiusM(GS_KT)
    expect(r).toBeCloseTo(EXPECTED_R, 1)
  })

  it('90 deg turn anticipation distance = r * tan(45 deg) = r', () => {
    const expected = EXPECTED_R * Math.tan(Math.PI / 4) // tan(45deg) = 1
    const d = turnAnticipationDistanceM(0, 90, GS_KT)
    expect(d).toBeCloseTo(expected, 1)
    expect(d).toBeCloseTo(EXPECTED_R, 1) // tan(45)=1 special case
  })

  it('45 deg turn anticipation distance = r * tan(22.5 deg)', () => {
    const expected = EXPECTED_R * Math.tan((22.5 * Math.PI) / 180)
    const d = turnAnticipationDistanceM(10, 55, GS_KT) // 45 deg course change
    expect(d).toBeCloseTo(expected, 1)
  })

  it('0 deg turn (straight leg) needs no anticipation', () => {
    const d = turnAnticipationDistanceM(270, 270, GS_KT)
    expect(d).toBeCloseTo(0, 6)
  })

  it('180 deg reversal is capped (finite) rather than diverging to infinity', () => {
    const d = turnAnticipationDistanceM(0, 180, GS_KT)
    expect(Number.isFinite(d)).toBe(true)
    expect(d).toBeGreaterThan(EXPECTED_R * 50) // very large, as tan(~90deg) blows up, but finite
  })

  it('higher groundspeed increases the anticipation distance for the same turn angle', () => {
    const slow = turnAnticipationDistanceM(0, 90, 90)
    const fast = turnAnticipationDistanceM(0, 90, 180)
    expect(fast).toBeGreaterThan(slow)
  })
})

describe('CDI phase-of-flight scaling', () => {
  it('full-scale figures match the cited ENR/TERM/APR standard values', () => {
    expect(CDI_FULL_SCALE_NM.ENR).toBe(2.0)
    expect(CDI_FULL_SCALE_NM.TERM).toBe(1.0)
    expect(CDI_FULL_SCALE_NM.APR).toBe(0.3)
  })

  it('determinePhase: far from both airports and not on final approach -> ENR', () => {
    const phase = determinePhase({ distFromDepartureNm: 100, distToDestinationNm: 120, onFinalApproachSegment: false })
    expect(phase).toBe('ENR')
  })

  it('determinePhase: within terminal radius of destination -> TERM', () => {
    const phase = determinePhase({ distFromDepartureNm: 100, distToDestinationNm: 15, onFinalApproachSegment: false })
    expect(phase).toBe('TERM')
  })

  it('determinePhase: close in on the final approach segment -> APR', () => {
    const phase = determinePhase({ distFromDepartureNm: 100, distToDestinationNm: 2, onFinalApproachSegment: true })
    expect(phase).toBe('APR')
  })

  it('the same 0.5 nm cross-track error reads as a small deflection in ENR but pegs in APR', () => {
    const enr = gpsCdiDeflection(0.5, 'ENR')
    const apr = gpsCdiDeflection(0.5, 'APR')
    expect(enr.deflectionFraction).toBeCloseTo(0.25, 6) // 0.5/2.0
    expect(apr.deflectionFraction).toBe(1) // 0.5/0.3 > 1, clamped/pegged
    expect(Math.abs(apr.deflectionFraction)).toBeGreaterThan(Math.abs(enr.deflectionFraction))
  })

  it('TERM sits between ENR and APR sensitivity for the same error', () => {
    const term = gpsCdiDeflection(0.5, 'TERM')
    expect(term.deflectionFraction).toBeCloseTo(0.5, 6) // 0.5/1.0
  })

  it('negative cross-track error produces a negative (mirrored) deflection, pegged symmetrically', () => {
    const result = gpsCdiDeflection(-1.0, 'APR')
    expect(result.deflectionFraction).toBe(-1)
  })
})
