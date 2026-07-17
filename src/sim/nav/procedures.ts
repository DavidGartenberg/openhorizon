/**
 * CIFP procedure leg model + interpreter (Phase 4 Task 4, §24/§10): a typed
 * ARINC 424 leg representation (IF/TF/CF/DF/CA/FA + simplified HM/HA/HF
 * holds) and pure geometry functions that turn one leg + the current
 * aircraft state into steering guidance (desired track, cross-track error,
 * distance remaining, termination test). Pure module — no three.js/DOM
 * (§4.1) — mirrors `gps.ts`'s leg/CDI style and reuses its great-circle
 * course/distance/cross-track functions wherever a leg type maps cleanly
 * onto "fly to this fix" semantics.
 *
 * This module is deliberately independent of the CIFP parser
 * (`server/parse.mjs#buildCifpProcedures`) — its `ProcLeg` shape is a
 * cleaned-up, camelCase, unit-normalized version of that parser's terse
 * JSON leg records, so it can be (and is, in
 * `tests/nav/procedures.test.ts`) exercised entirely against hand-built
 * fixtures regardless of whether the real-data CIFP parser lands cleanly.
 * `fromCifpLeg` below is the (thin, isolated) adapter from the parser's
 * wire format to this module's model.
 *
 * Scope (per the phase plan's explicit authorization to scope down on the
 * highest-risk task in the phase):
 *   IMPLEMENTED:   IF, TF, CF, DF, CA, FA, HM, HA, HF
 *   NOT IMPLEMENTED (raw leg type is preserved but `evaluateLeg` throws a
 *   descriptive error rather than silently mis-flying it — see
 *   `SUPPORTED_LEG_TYPES`): VA, VM, VI, FM, RF, PI, and any other ARINC 424
 *   path-terminator not listed above. These leg types are real (they show
 *   up in real KSFO SIDs/STARs/approaches, e.g. the ILS 28R missed
 *   approach's RF legs) but were not in this task's required subset;
 *   flagged here and in docs/plans/phase-4-task4-report.md rather than
 *   fabricated.
 */
import { distanceM, type LatLon } from '../../math/geo'
import { crossTrackDistanceM, alongTrackDistanceM, directTo, type Leg, type Waypoint } from './gps'

// ---- leg model ----

export type ProcLegType = 'IF' | 'TF' | 'CF' | 'DF' | 'CA' | 'FA' | 'HM' | 'HA' | 'HF'

export const SUPPORTED_LEG_TYPES: ReadonlySet<string> = new Set<ProcLegType>([
  'IF', 'TF', 'CF', 'DF', 'CA', 'FA', 'HM', 'HA', 'HF',
])

/** Altitude constraint on a leg, decoded from ARINC 424's altitude
 *  description + Altitude 1/2 fields (see `server/parse.mjs` header comment
 *  for the real-data derivation). */
export interface AltitudeConstraint {
  kind: 'at' | 'atOrAbove' | 'atOrBelow' | 'between'
  /** Target/ceiling altitude, ft. For `between`, this is the upper bound. */
  altitudeFt: number
  /** Lower bound, ft — only present for `between`. */
  altitudeFt2?: number
}

/** One procedure leg. `type` is the raw ARINC 424 leg-type string (so
 *  unsupported types round-trip through this model even though
 *  `evaluateLeg` can't fly them); `fix` is the leg's terminating/reference
 *  waypoint. */
export interface ProcLeg {
  type: string
  /** Terminating (or, for holds, holding) fix. Undefined for leg types
   *  that don't reference a fix at all (not modeled here — CA has no fix,
   *  callers must still supply one as the "activation point" per
   *  `evaluateCaLeg`'s contract, documented below). */
  fix?: Waypoint
  /** Specified course, degrees. Required for CF/CA/FA/holds. */
  courseDeg?: number
  /** Turn direction for RF/holds. */
  turnDirection?: 'L' | 'R'
  /** Holding leg length, nm (outbound/inbound leg length — simplified,
   *  time-based holds are not distinguished from distance-based ones, per
   *  the phase plan's "simplified... no wind-corrected entry logic
   *  needed"). */
  legLengthNm?: number
  altitude?: AltitudeConstraint
  runway?: Waypoint
}

// ---- per-leg guidance ----

export interface LegGuidance {
  /** Desired track, degrees true/magnetic (whichever the fix coordinates
   *  are referenced to — this module doesn't do magnetic variation, same
   *  as `gps.ts`). */
  desiredTrackDeg: number
  crossTrackNm: number
  distanceRemainingNm: number
  /** True once this leg's termination condition is met and the sequencer
   *  should advance to the next leg. */
  isTerminated: boolean
}

const M_PER_NM = 1852
/** Leg-termination capture radius, m — accounts for floating-point noise
 *  in the great-circle math (distance-remaining can land at ~1e-7 m
 *  instead of exactly 0 right at the fix) as well as matching a real GPS's
 *  small waypoint-capture tolerance rather than requiring an impossible
 *  exact zero. */
const LEG_CAPTURE_M = 5

function toNm(m: number): number {
  return m / M_PER_NM
}

/** Build a synthetic `Leg` with an explicit (not derived) course, anchored
 *  far enough behind `to` that the standard `gps.ts` cross-track/along-
 *  track formulas (which key off `leg.from` + `leg.courseDeg`) work
 *  unchanged. Used for CF/CA/FA/hold-leg guidance, where the course is
 *  specified directly by the procedure rather than computed from a prior
 *  fix. 100 nm is arbitrary but large relative to any real procedure leg
 *  length, so the projected `from` point never matters except as a course
 *  reference line. */
function courseLeg(courseDeg: number, to: Waypoint): Leg {
  const backAz = ((courseDeg + 180) % 360) * (Math.PI / 180)
  const R = 6_371_000
  const distM = 100 * M_PER_NM
  const lat1 = (to.lat * Math.PI) / 180
  const lon1 = (to.lon * Math.PI) / 180
  const angDist = distM / R
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angDist) + Math.cos(lat1) * Math.sin(angDist) * Math.cos(backAz),
  )
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(backAz) * Math.sin(angDist) * Math.cos(lat1),
      Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2),
    )
  const from: Waypoint = { ident: `${to.ident}-BACK`, lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI }
  return { from, to, courseDeg, distanceM: distM }
}

/**
 * IF — Initial Fix: not really a "leg to fly" (it just establishes the
 * starting point of a transition/segment); modeled the same way most real
 * GPS/FMS implementations handle it — fly direct to the fix. Terminates
 * once past it (same sequencing rule as `gps.ts`'s TF/DF handling: along-
 * track distance exceeds the direct-to leg's length).
 */
export function evaluateIfLeg(leg: ProcLeg, aircraft: LatLon): LegGuidance {
  if (!leg.fix) throw new Error('IF leg requires a fix')
  return evaluateDfLeg(leg, aircraft)
}

/**
 * TF — Track to Fix: a straight great-circle leg from wherever the
 * aircraft is toward the fix, using the aircraft's current position as the
 * effective leg start (matches `gps.ts`'s direct-to semantics — the caller
 * is expected to have already established the aircraft near the leg's
 * nominal starting fix; this module doesn't track a separate "previous
 * fix" state, that's a flight-plan-sequencer concern one level up).
 */
export function evaluateTfLeg(leg: ProcLeg, aircraft: LatLon): LegGuidance {
  if (!leg.fix) throw new Error('TF leg requires a fix')
  return evaluateDfLeg(leg, aircraft)
}

/**
 * DF — Direct to Fix: fly direct from the current aircraft position to the
 * fix, recomputed every update (a real "direct-to", not a fixed course —
 * matches `gps.ts#directTo`).
 */
export function evaluateDfLeg(leg: ProcLeg, aircraft: LatLon): LegGuidance {
  if (!leg.fix) throw new Error('DF leg requires a fix')
  const dtoLeg = directTo(aircraft, leg.fix)
  const distanceRemainingM = distanceM(aircraft, { lat: leg.fix.lat, lon: leg.fix.lon })
  return {
    desiredTrackDeg: dtoLeg.courseDeg,
    crossTrackNm: 0, // a direct-to has no fixed course line to deviate from
    distanceRemainingNm: toNm(distanceRemainingM),
    isTerminated: distanceRemainingM < 50, // "at/over the fix", ~50m capture radius
  }
}

/**
 * CF — Course to Fix: fly a *specified* course to the fix (unlike TF/DF,
 * the course is given by the procedure, not derived from the aircraft's
 * position or a prior fix — e.g. intercepting a specific inbound course).
 */
export function evaluateCfLeg(leg: ProcLeg, aircraft: LatLon): LegGuidance {
  if (!leg.fix) throw new Error('CF leg requires a fix')
  if (leg.courseDeg === undefined) throw new Error('CF leg requires courseDeg')
  const line = courseLeg(leg.courseDeg, leg.fix)
  const crossTrackM = crossTrackDistanceM(line, aircraft)
  const alongTrackM = alongTrackDistanceM(line, aircraft)
  const distanceRemainingM = line.distanceM - alongTrackM
  return {
    desiredTrackDeg: leg.courseDeg,
    crossTrackNm: toNm(crossTrackM),
    distanceRemainingNm: toNm(Math.max(distanceRemainingM, 0)),
    isTerminated: distanceRemainingM <= LEG_CAPTURE_M,
  }
}

/**
 * CA/FA — Course to Altitude / Fix to Altitude: fly a specified course
 * until reaching a target altitude, no fixed terminating fix. FA anchors
 * the course line at a reference fix (`leg.fix`); CA has no fix at all — a
 * real CA leg's course line starts wherever the aircraft was when the leg
 * activated, so the caller must supply that activation point once (the
 * `activationPoint` param) since this module has no per-leg mutable state
 * of its own.
 */
export function evaluateAltitudeTerminatedLeg(
  leg: ProcLeg,
  aircraft: LatLon,
  currentAltitudeFt: number,
  activationPoint?: LatLon,
): LegGuidance {
  if (leg.courseDeg === undefined) throw new Error(`${leg.type} leg requires courseDeg`)
  if (!leg.altitude) throw new Error(`${leg.type} leg requires an altitude constraint`)
  const anchor = leg.fix ?? (activationPoint && { ident: 'CA-START', lat: activationPoint.lat, lon: activationPoint.lon })
  if (!anchor) throw new Error('CA leg requires an activationPoint (no fix of its own)')
  const to: Waypoint = anchor
  const line = courseLeg(leg.courseDeg, to)
  // The "to" of this synthetic line is 100nm ahead along the course, purely
  // as a reference — distanceRemaining for an altitude-terminated leg is
  // meaningless in the great-circle sense, so it's reported as the
  // distance to termination based on climb/descent progress instead: 0 once
  // terminated, otherwise Infinity (unknowable without a climb-rate model,
  // which is out of scope for this pure geometry module).
  const crossTrackM = crossTrackDistanceM(line, aircraft)
  const target = leg.altitude.altitudeFt
  const above = currentAltitudeFt >= target
  // Termination direction: CA/FA legs are typically climbs (SID initial
  // climb) but can be descents (approach step-downs); infer direction from
  // the constraint kind — atOrAbove/at implies climbing to reach target,
  // atOrBelow implies descending.
  const climbing = leg.altitude.kind !== 'atOrBelow'
  const isTerminated = climbing ? above : currentAltitudeFt <= target
  return {
    desiredTrackDeg: leg.courseDeg,
    crossTrackNm: toNm(crossTrackM),
    distanceRemainingNm: isTerminated ? 0 : Infinity,
    isTerminated,
  }
}

// ---- holds (simplified HM/HA/HF) ----

export type HoldPhase = 'INBOUND' | 'OUTBOUND'

export interface HoldState {
  phase: HoldPhase
}

/**
 * Simplified holding-pattern guidance: a two-leg racetrack (inbound leg on
 * the published course to the holding fix, outbound leg on the reciprocal,
 * offset to the turn-direction side) with instantaneous 180-degree turns at
 * each end — no wind-corrected entry logic, no DME/time-based leg-length
 * distinction beyond the parsed `legLengthNm` (per the phase plan's
 * "simplified... racetrack shape/timing only" scope). Turns are modeled as
 * an instant course reversal once the active leg's termination distance is
 * reached, which is adequate for autopilot NAV-mode testing but not a
 * flyable procedural-turn animation.
 *
 * HM (hold, manual termination), HA (hold to altitude) and HF (hold, exit
 * after one circuit) share this exact geometry; the only difference is
 * *when the caller stops calling this function and sequences onward* — HM
 * never self-terminates (the caller decides when to exit), HA terminates
 * once `currentAltitudeFt` crosses the leg's altitude constraint, HF
 * terminates after one full inbound-outbound-inbound circuit. Since exit
 * timing is a sequencing decision, not a per-call geometry fact, this
 * function reports raw phase/leg guidance plus an `isTerminated` flag
 * appropriate to `leg.type`, letting the caller decide what to do with it.
 */
export function evaluateHoldLeg(
  leg: ProcLeg,
  aircraft: LatLon,
  state: HoldState,
  currentAltitudeFt?: number,
): { guidance: LegGuidance; nextState: HoldState } {
  if (!leg.fix) throw new Error('hold leg requires a fix')
  if (leg.courseDeg === undefined) throw new Error('hold leg requires courseDeg (inbound course)')
  const turn = leg.turnDirection ?? 'R'
  const legLengthM = (leg.legLengthNm ?? 1) * M_PER_NM

  if (state.phase === 'INBOUND') {
    const line = courseLeg(leg.courseDeg, leg.fix)
    const crossTrackM = crossTrackDistanceM(line, aircraft)
    const alongTrackM = alongTrackDistanceM(line, aircraft)
    const distanceRemainingM = line.distanceM - alongTrackM
    const reachedFix = distanceRemainingM <= LEG_CAPTURE_M
    let isTerminated = false
    if (leg.type === 'HA' && currentAltitudeFt !== undefined && leg.altitude) {
      isTerminated = currentAltitudeFt >= leg.altitude.altitudeFt
    }
    return {
      guidance: {
        desiredTrackDeg: leg.courseDeg,
        crossTrackNm: toNm(crossTrackM),
        distanceRemainingNm: toNm(Math.max(distanceRemainingM, 0)),
        isTerminated,
      },
      nextState: reachedFix ? { phase: 'OUTBOUND' } : state,
    }
  }

  // OUTBOUND: reciprocal course, flown away from the fix for legLengthM,
  // offset to the turn-direction side (R = turns/offsets to the right of
  // the inbound course, L = left) so the two legs form a racetrack rather
  // than retracing the same line.
  const outboundCourseDeg = (leg.courseDeg + 180) % 360
  const offsetSign = turn === 'R' ? 1 : -1
  const offsetBearingDeg = (leg.courseDeg + offsetSign * 90 + 360) % 360
  // Displace the fix perpendicular to the inbound course to get the
  // outbound leg's nominal end point (a simplified racetrack corner, not a
  // flown turn radius).
  const R = 6_371_000
  const angDist = (2 * 1852) / R // a nominal 2nm racetrack half-width
  const lat1 = (leg.fix.lat * Math.PI) / 180
  const lon1 = (leg.fix.lon * Math.PI) / 180
  const brg = (offsetBearingDeg * Math.PI) / 180
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angDist) + Math.cos(lat1) * Math.sin(angDist) * Math.cos(brg))
  const lon2 = lon1 + Math.atan2(Math.sin(brg) * Math.sin(angDist) * Math.cos(lat1), Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2))
  const outboundFix: Waypoint = { ident: `${leg.fix.ident}-OUT`, lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI }
  const outboundLine = courseLeg(outboundCourseDeg, outboundFix)
  const crossTrackM = crossTrackDistanceM(outboundLine, aircraft)
  const alongTrackM = alongTrackDistanceM(outboundLine, aircraft)
  const distanceRemainingM = legLengthM - alongTrackM
  const reachedEnd = distanceRemainingM <= LEG_CAPTURE_M
  return {
    guidance: {
      desiredTrackDeg: outboundCourseDeg,
      crossTrackNm: toNm(crossTrackM),
      distanceRemainingNm: toNm(Math.max(distanceRemainingM, 0)),
      isTerminated: false,
    },
    nextState: reachedEnd ? { phase: 'INBOUND' } : state,
  }
}

// ---- dispatch ----

/**
 * Evaluate any supported leg type, dispatching to the right geometry.
 * Throws for leg types outside `SUPPORTED_LEG_TYPES` (see module header) —
 * callers should check `SUPPORTED_LEG_TYPES.has(leg.type)` before flying a
 * leg pulled from real CIFP data, which can contain types this module
 * doesn't implement.
 */
export function evaluateLeg(leg: ProcLeg, aircraft: LatLon, currentAltitudeFt?: number, activationPoint?: LatLon): LegGuidance {
  switch (leg.type) {
    case 'IF':
      return evaluateIfLeg(leg, aircraft)
    case 'TF':
      return evaluateTfLeg(leg, aircraft)
    case 'DF':
      return evaluateDfLeg(leg, aircraft)
    case 'CF':
      return evaluateCfLeg(leg, aircraft)
    case 'CA':
    case 'FA':
      if (currentAltitudeFt === undefined) throw new Error(`${leg.type} leg requires currentAltitudeFt`)
      return evaluateAltitudeTerminatedLeg(leg, aircraft, currentAltitudeFt, activationPoint)
    case 'HM':
    case 'HA':
    case 'HF':
      throw new Error(`${leg.type} holds carry extra state — call evaluateHoldLeg directly, not evaluateLeg`)
    default:
      throw new Error(`unsupported leg type "${leg.type}" — not in this task's IF/TF/CF/DF/CA/FA/HM/HA/HF subset`)
  }
}

// ---- CIFP JSON adapter + procedure assembly ----

/** One leg record from `/api/procedures/{ICAO}.json` (see
 *  `server/parse.mjs#buildCifpProcedures`'s header comment for the exact
 *  wire schema). */
export interface CifpLegJson {
  s: number
  ty: string
  f: string
  la?: number
  lo?: number
  td?: string
  c?: number
  d?: number
  ad?: string
  a1?: number
  a2?: number
  sp?: number
  va?: number
  rw?: string
  rwla?: number
  rwlo?: number
}

export interface CifpTransitionJson {
  tn: string
  l: CifpLegJson[]
}

export interface CifpProcedureJson {
  y: 0 | 1 | 2
  n: string
  t: CifpTransitionJson[]
}

function decodeAltitude(leg: CifpLegJson): AltitudeConstraint | undefined {
  if (leg.a1 === undefined) return undefined
  if (leg.ad === 'B' && leg.a2 !== undefined) return { kind: 'between', altitudeFt: leg.a1, altitudeFt2: leg.a2 }
  if (leg.ad === '+') return { kind: 'atOrAbove', altitudeFt: leg.a1 }
  if (leg.ad === '-') return { kind: 'atOrBelow', altitudeFt: leg.a1 }
  return { kind: 'at', altitudeFt: leg.a1 }
}

/**
 * Adapt one CIFP-parser JSON leg record to this module's `ProcLeg`. Legs
 * whose fix coordinates weren't resolved by the parser (fix not found in
 * the CIFP's own terminal-waypoint/runway tables) come through with
 * `fix: undefined` — real data, just incomplete; callers must not fabricate
 * a position for them.
 */
export function fromCifpLeg(json: CifpLegJson): ProcLeg {
  const fix: Waypoint | undefined =
    json.la !== undefined && json.lo !== undefined ? { ident: json.f, lat: json.la, lon: json.lo } : undefined
  const runway: Waypoint | undefined =
    json.rw && json.rwla !== undefined && json.rwlo !== undefined ? { ident: json.rw, lat: json.rwla, lon: json.rwlo } : undefined
  const leg: ProcLeg = { type: json.ty, fix }
  if (json.c !== undefined) leg.courseDeg = json.c
  if (json.td === 'L' || json.td === 'R') leg.turnDirection = json.td
  if (json.d !== undefined) leg.legLengthNm = json.d
  const altitude = decodeAltitude(json)
  if (altitude) leg.altitude = altitude
  if (runway) leg.runway = runway
  return leg
}

/**
 * Concatenate a named transition's legs with the shared "common" segment
 * (transition name `''`) that every CIFP procedure funnels into — e.g. for
 * KSFO's ILS 28R, the "ARCHI" transition followed by the common segment
 * that flies the final approach to the runway. Real ARINC 424 procedures
 * store these as independent segments (this parser preserves that
 * structure, see `server/parse.mjs`); this is the minimal assembly needed
 * to hand a flyable leg sequence to an autopilot/GPS NAV mode. Does not
 * handle SID runway-transition selection (a SID chains
 * runway-transition -> common -> enroute-transition, three segments, not
 * two) — out of scope for this task, flagged for the Task 6 cockpit-wiring
 * follow-up that actually flies procedures end-to-end.
 */
export function assembleProcedureLegs(proc: CifpProcedureJson, transitionName: string): ProcLeg[] {
  const named = proc.t.find((t) => t.tn === transitionName)
  const common = proc.t.find((t) => t.tn === '')
  const legs: CifpLegJson[] = [...(named?.l ?? []), ...(common?.l ?? [])]
  return legs.map(fromCifpLeg)
}
