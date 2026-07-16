/**
 * GPS flight-plan logic (Phase 4 Task 2, §24/§10): flight-plan waypoint
 * sequencing, great-circle leg course/distance, direct-to, active-leg
 * tracking (distance remaining + cross-track error), turn anticipation,
 * and phase-dependent CDI scaling. Pure module — no three.js/DOM (§4.1),
 * mirrors `navaids.ts`'s data-holder + pure-function style.
 *
 * This module does not know about CIFP procedures (SID/STAR/approach) —
 * that's a later task (`procedures.ts`) — but the `Waypoint`/`Leg` shapes
 * here are deliberately minimal (identifier + lat/lon) so a procedure
 * importer can produce compatible waypoint lists without this module
 * needing to change.
 */
import { bearingDeg, distanceM, type LatLon } from '../../math/geo'
import { clamp } from '../../math/vec'

// ---- flight-plan model ----

/** A geometric point in a flight plan. Deliberately minimal — this task
 *  does not build a navaid/fix/airport database; any lat/lon with a name
 *  works (VOR, NDB, user waypoint, airport reference point, ...). */
export interface Waypoint {
  ident: string
  lat: number
  lon: number
}

/** One leg of the active flight plan: great-circle course + distance from
 *  `from` to `to`. Course is the *initial* great-circle bearing (via
 *  `bearingDeg`) — for the leg lengths a GA flight plan involves (tens to
 *  low hundreds of nm) the initial bearing is what a GPS displays as
 *  "desired track" and is a fine approximation of the course throughout
 *  the leg (real GPS units also technically fly a rhumb-line-ish track
 *  between waypoints over short legs, not a continuously-updating great
 *  circle — this is a standard simplification, not a bug). */
export interface Leg {
  from: Waypoint
  to: Waypoint
  courseDeg: number
  distanceM: number
}

/** Build a `Leg` between two waypoints. */
export function makeLeg(from: Waypoint, to: Waypoint): Leg {
  const a: LatLon = { lat: from.lat, lon: from.lon }
  const b: LatLon = { lat: to.lat, lon: to.lon }
  return { from, to, courseDeg: bearingDeg(a, b), distanceM: distanceM(a, b) }
}

/** Holds the ordered waypoint sequence and derives the leg list. Mirrors
 *  the load()-then-query shape of `NavaidsIndex`. */
export class FlightPlan {
  private waypoints: Waypoint[] = []

  setWaypoints(waypoints: Waypoint[]): void {
    this.waypoints = waypoints.slice()
  }

  get all(): readonly Waypoint[] {
    return this.waypoints
  }

  get count(): number {
    return this.waypoints.length
  }

  /** Legs between consecutive waypoints (empty if fewer than 2 waypoints). */
  legs(): Leg[] {
    const out: Leg[] = []
    for (let i = 0; i + 1 < this.waypoints.length; i++) {
      out.push(makeLeg(this.waypoints[i]!, this.waypoints[i + 1]!))
    }
    return out
  }

  waypointAt(i: number): Waypoint | undefined {
    return this.waypoints[i]
  }
}

/**
 * Direct-to: build a single leg from an arbitrary point (typically current
 * aircraft position) straight to a target waypoint, bypassing the rest of
 * the sequence. This is the most common real-world GPS operation ("push
 * direct-to, select a waypoint") — implemented as a standalone leg
 * constructor, independent of any `FlightPlan` state, since a direct-to can
 * target a waypoint that isn't even in the loaded plan.
 */
export function directTo(from: LatLon, to: Waypoint): Leg {
  const fromWp: Waypoint = { ident: 'DTO', lat: from.lat, lon: from.lon }
  return makeLeg(fromWp, to)
}

// ---- active-leg tracking ----

export interface LegProgress {
  /** Index into `legs()` of the currently active leg. */
  legIndex: number
  /** Distance remaining to the active leg's `to` waypoint, meters. */
  distanceRemainingM: number
  /** Cross-track distance from the leg's course line, meters. Positive =
   *  right of course, negative = left of course (matches the sign
   *  convention of the cross-track formula below: right-of-track is a
   *  positive perpendicular distance). */
  crossTrackM: number
  /** Cross-track distance in nautical miles, for CDI scaling convenience. */
  crossTrackNm: number
}

const EARTH_R_M = 6_371_000
const M_PER_NM = 1852

/**
 * Cross-track distance (m) of `point` from the great-circle path defined by
 * `leg`, using the standard spherical cross-track-error formula (Aviation
 * Formulary / Ed Williams' well-known great-circle navigation formulas):
 *
 *   dist13 = angular distance from leg.from to point (radians)
 *   brg13  = bearing from leg.from to point
 *   brg12  = bearing from leg.from to leg.to (the leg's course)
 *   xtd    = asin( sin(dist13) * sin(brg13 - brg12) ) * R
 *
 * Positive = point is to the right of the course line, negative = left.
 */
export function crossTrackDistanceM(leg: Leg, point: LatLon): number {
  const from: LatLon = { lat: leg.from.lat, lon: leg.from.lon }
  const dist13 = distanceM(from, point) / EARTH_R_M // angular distance, radians
  const brg13 = (bearingDeg(from, point) * Math.PI) / 180
  const brg12 = (leg.courseDeg * Math.PI) / 180
  const xtd = Math.asin(clamp(Math.sin(dist13) * Math.sin(brg13 - brg12), -1, 1)) * EARTH_R_M
  return xtd
}

/**
 * Determine the active leg and along-track progress for an aircraft
 * position against a flight plan's leg sequence.
 *
 * Active-leg selection: the "active leg" is the first leg (in sequence
 * order) whose `to` waypoint has not yet been passed — passing is detected
 * by the along-track distance from `from` exceeding the leg length (i.e.
 * the aircraft's projection onto the course line has moved past the `to`
 * waypoint). This is a simplified sequencing rule (real GPS units use a
 * "waypoint sequencing" leg-crossing test involving the bisector of the
 * inbound/outbound courses); flagged as a design choice, adequate for
 * straight TF-style legs which is all this task models.
 *
 * Returns undefined if the plan has no legs.
 */
export function activeLegProgress(legs: Leg[], aircraft: LatLon, startIndex = 0): LegProgress | undefined {
  if (legs.length === 0) return undefined
  let idx = Math.min(Math.max(startIndex, 0), legs.length - 1)
  for (; idx < legs.length; idx++) {
    const leg = legs[idx]!
    const to: LatLon = { lat: leg.to.lat, lon: leg.to.lon }
    const alongTrackM = alongTrackDistanceM(leg, aircraft)
    const distToGoM = leg.distanceM - alongTrackM
    if (distToGoM > 0 || idx === legs.length - 1) {
      const crossTrackM = crossTrackDistanceM(leg, aircraft)
      // Distance remaining to the waypoint uses direct great-circle
      // distance (not along-track) once close in, matching how a real GPS
      // "distance to next waypoint" field behaves.
      const distanceRemainingM = distanceM(aircraft, to)
      return { legIndex: idx, distanceRemainingM, crossTrackM, crossTrackNm: crossTrackM / M_PER_NM }
    }
  }
  const lastIdx = legs.length - 1
  const leg = legs[lastIdx]!
  const to: LatLon = { lat: leg.to.lat, lon: leg.to.lon }
  const crossTrackM = crossTrackDistanceM(leg, aircraft)
  return {
    legIndex: lastIdx,
    distanceRemainingM: distanceM(aircraft, to),
    crossTrackM,
    crossTrackNm: crossTrackM / M_PER_NM,
  }
}

/**
 * Along-track distance (m): how far along the leg's course line `point`'s
 * perpendicular projection sits, measured from `leg.from`. Uses the
 * companion formula to `crossTrackDistanceM` (same Aviation Formulary
 * source): along-track = acos( cos(dist13) / cos(xtd/R) ) * R.
 */
export function alongTrackDistanceM(leg: Leg, point: LatLon): number {
  const from: LatLon = { lat: leg.from.lat, lon: leg.from.lon }
  const dist13 = distanceM(from, point) / EARTH_R_M
  const xtd = crossTrackDistanceM(leg, point) / EARTH_R_M
  const cosArg = clamp(Math.cos(dist13) / Math.cos(xtd), -1, 1)
  return Math.acos(cosArg) * EARTH_R_M
}

// ---- turn anticipation ----

const KT_TO_MPS = 1852 / 3600
const STANDARD_RATE_DEG_PER_SEC = 3 // "standard rate" turn, 3 deg/sec — a
// well-known real aviation convention (FAA Instrument Flying Handbook):
// most GA autopilots/flight directors and GPS turn-anticipation logic
// below ~250 KIAS assume a standard-rate turn (2-minute full circle, i.e.
// 3 deg/sec) rather than a fixed bank angle. This module uses that
// convention: turn radius r = V / (turnRateRadPerSec), which follows
// directly from angular rate = V / r for a coordinated turn.

/**
 * Turn radius (m) for a standard-rate (3 deg/sec) turn at true airspeed /
 * groundspeed `groundspeedKt`. r = V / omega, omega = turnRateDegPerSec in
 * rad/s. This is the standard-rate-turn convention cited above; the
 * alternative fixed-bank-angle formula (r = V² / (g·tan(bank))) is equally
 * legitimate but not what's used here — flagged so a later task swapping
 * conventions knows where to look.
 */
export function standardRateTurnRadiusM(groundspeedKt: number, turnRateDegPerSec = STANDARD_RATE_DEG_PER_SEC): number {
  const vMps = groundspeedKt * KT_TO_MPS
  const omega = (turnRateDegPerSec * Math.PI) / 180
  return vMps / omega
}

/**
 * Turn-anticipation distance (m): how far *before* the waypoint the
 * aircraft should begin turning from the inbound course onto the outbound
 * (next-leg) course, so it rolls out on the new course rather than
 * overshooting and re-intercepting. Standard geometry for a course change
 * of angle `theta` (the angle between inbound and outbound course) flown
 * at turn radius `r`: the turn's tangent point is `r * tan(theta/2)` back
 * along the inbound course from the fix (this is the standard "lead
 * distance" formula used in GPS/FMS waypoint sequencing — the turn is
 * modeled as a circular arc tangent to both the inbound and outbound
 * course lines, and the tangent-line-to-arc distance from the vertex is
 * r*tan(half-angle), a standard result for a circle inscribed in an
 * angle).
 *
 * `theta` is the absolute course change in degrees (0-180). At theta = 0
 * (no turn) the anticipation distance is 0; as theta -> 180 (full
 * reversal) it diverges (tan(90 deg) -> infinity) since a normal turn arc
 * can never geometrically achieve an instantaneous reversal — capped here
 * at a generous but finite multiple of the turn radius to keep the
 * function well-behaved for near-180 deg turns (a real GPS would instead
 * fly a course-reversal procedure, out of scope for this pure geometry
 * helper).
 */
export function turnAnticipationDistanceM(
  inboundCourseDeg: number,
  outboundCourseDeg: number,
  groundspeedKt: number,
  turnRateDegPerSec = STANDARD_RATE_DEG_PER_SEC,
): number {
  const r = standardRateTurnRadiusM(groundspeedKt, turnRateDegPerSec)
  let theta = Math.abs(((outboundCourseDeg - inboundCourseDeg + 540) % 360) - 180)
  // theta now in [0, 180]: absolute course change.
  const halfRad = (Math.min(theta, 179.9) * Math.PI) / 360
  return r * Math.tan(halfRad)
}

// ---- CDI phase-of-flight scaling ----

export type FlightPhase = 'ENR' | 'TERM' | 'APR'

/** GPS CDI full-scale deflection by phase of flight, nautical miles.
 *  Standard, published GPS CDI sensitivity figures (per the phase plan's
 *  §10.2 citation and widely-documented WAAS/TSO-146 GPS receiver
 *  behavior): Enroute 2.0 nm, Terminal 1.0 nm, Approach 0.3 nm full scale.
 *  These are real figures, not invented. */
export const CDI_FULL_SCALE_NM: Record<FlightPhase, number> = {
  ENR: 2.0,
  TERM: 1.0,
  APR: 0.3,
}

/** Design-choice thresholds for phase determination (flagged: real-world
 *  terminal/approach area boundaries depend on specific airspace and
 *  procedure design — SIAPs, TAAs, feeder routes — none of which are
 *  modeled by this task; these are simple distance-based stand-ins):
 *   - within `APPROACH_RADIUS_NM` of the destination AND on the final
 *     approach segment (last leg of the plan) -> APR
 *   - within `TERMINAL_RADIUS_NM` of the departure or destination airport
 *     -> TERM
 *   - otherwise -> ENR
 */
export const TERMINAL_RADIUS_NM = 30
export const APPROACH_RADIUS_NM = 3

export interface PhaseContext {
  /** Great-circle distance from the aircraft to the departure airport/first
   *  waypoint, nm. Pass Infinity if not applicable/unknown. */
  distFromDepartureNm: number
  /** Great-circle distance from the aircraft to the destination airport/
   *  final waypoint, nm. Pass Infinity if not applicable/unknown. */
  distToDestinationNm: number
  /** True when the aircraft is tracking the final approach segment (the
   *  last leg of the active flight plan) — a later procedures task would
   *  set this from an IF/FAF-anchored final leg; here it's just a flag the
   *  caller supplies. */
  onFinalApproachSegment: boolean
}

/** Determine the current phase of flight from simple distance/segment
 *  heuristics (see thresholds above — a flagged design choice, not a
 *  sourced spec figure). */
export function determinePhase(ctx: PhaseContext): FlightPhase {
  if (ctx.onFinalApproachSegment && ctx.distToDestinationNm <= APPROACH_RADIUS_NM) return 'APR'
  if (ctx.distFromDepartureNm <= TERMINAL_RADIUS_NM || ctx.distToDestinationNm <= TERMINAL_RADIUS_NM) return 'TERM'
  return 'ENR'
}

export interface GpsCdiResult {
  phase: FlightPhase
  fullScaleNm: number
  /** Deflection as a fraction of full scale, clamped to ±1.0 (±1.0 = the
   *  needle pegged at full-scale-or-beyond, matching real GPS CDI needle
   *  behavior — it doesn't read "more than full scale", it just pegs). */
  deflectionFraction: number
}

/** Phase-scaled GPS CDI deflection for a given cross-track error. */
export function gpsCdiDeflection(crossTrackNm: number, phase: FlightPhase): GpsCdiResult {
  const fullScaleNm = CDI_FULL_SCALE_NM[phase]
  const deflectionFraction = clamp(crossTrackNm / fullScaleNm, -1, 1)
  return { phase, fullScaleNm, deflectionFraction }
}
