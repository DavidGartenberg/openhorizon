/**
 * Autoland (pure): everything between glideslope capture and the end of the
 * rollout that the ordinary approach-coupled autopilot does not do.
 *
 *   OFF     not armed
 *   ARMED   LAND pressed, waiting for LOC + GS capture (the AP flies APR)
 *   LAND    stabilized approach: autoland owns speed (Vref + wind additive),
 *           gear and flap sequencing, and spoiler arming; the AP flies LOC/GS
 *   FLARE   below ~40 ft (jets) / ~12 ft (light aircraft): an exponential
 *           flare — commanded sink rate = height/τ + touchdown sink — flown as
 *           a pitch attitude, throttle to idle, wings nearly level, decrab
 *   ROLLOUT weight on wheels: derotate, spoilers, reversers, autobrake and
 *           centerline steering until taxi speed, then hand back
 *
 * The flare starts exactly when the exponential law's commanded sink equals
 * the current sink, so the transition from the glideslope is continuous —
 * no step in pitch, no balloon. Pitch gain is scaled by groundspeed so the
 * same law works from a Cessna to a 737.
 *
 * This module knows nothing about three.js, the DOM or the aircraft model:
 * numbers in, a small command record out. main.ts owns the wiring.
 */
import { clamp } from '../math/vec'
import type { AircraftParams } from './aircraft/params'

export type AutolandPhase = 'OFF' | 'ARMED' | 'LAND' | 'FLARE' | 'ROLLOUT' | 'DONE'

const FT_PER_NM_KT = 1.68781 // ft/s per knot

export interface AutolandConfig {
  /** 1.3 × Vs0: the reference landing speed. */
  vrefKt: number
  jet: boolean
  reversers: boolean
  spoilers: boolean
  /** Final landing flap detent index and the speed limit to extend into it. */
  finalFlapIndex: number
  flapLimitKt: (detentIndex: number) => number
  flapDetentsDeg: readonly number[]
  retractableGear: boolean
  /** Flare time constant, s, and the sink rate wanted at touchdown, ft/s. */
  flareTauS: number
  touchdownSinkFps: number
  /** Flare pitch-loop gain (× the geometric deg-per-fpm) and command lead, s. */
  flareGain: number
  flareIntGain: number
  /** Rollout steering: deg-of-heading gain, yaw-rate damping, deg of aim per metre off the centerline. */
  rolloutHdgGain: number
  rolloutRateGain: number
  rolloutXtGain: number
  /** Flight-path-rate prediction horizon, s. */
  flareDampS: number
  flareLeadS: number
  /** Start the flare when commanded sink × margin ≤ actual sink (>1 = earlier). */
  flareTriggerMargin: number
  /** Pitch ceiling in the flare (tail-strike / stall margin). */
  maxFlarePitchDeg: number
  /** Radio altitude below which autoland flies the glidepath itself, ft, and its height-error gain (1/s). */
  pathOwnRaFt: number
  pathGain: number
  /** Radio altitude below which the throttle is retarded, ft. */
  retardRaFt: number
  retardRatePerS: number
  /** Speed-loop gains (lever per kt per s, lever per kt/s²) and slew. */
  speedKi: number
  speedKd: number
  speedSlewPerS: number
  /** Brake demand once the nose is down, and its ramp. */
  brakeLevel: number
  /** Ground speed at which the rollout ends (stopped on the runway), kt. */
  handBackKt: number
}

/** Autoland needs a nosewheel airplane; null = not available on this type. */
export function autolandConfigFor(P: AircraftParams): AutolandConfig | null {
  if (!P.gear.nose || P.gear.tail) return null
  const jet = !!P.jet
  const dets = P.flapDetentsDeg
  // Landing flaps: the last detent for light aircraft, the largest ≤ 30° for
  // jets (the 30° limit speed is what the approach is flown against).
  let finalIdx = dets.length - 1
  if (jet) {
    finalIdx = 0
    dets.forEach((d, i) => { if (d <= 30) finalIdx = i })
  }
  return {
    vrefKt: 1.3 * P.vSpeeds.vs0,
    jet,
    reversers: !!P.reversers,
    spoilers: !!P.spoilers,
    finalFlapIndex: Math.max(0, finalIdx),
    flapLimitKt: (idx) => (dets[idx]! > 10 ? P.vSpeeds.vfe30 : P.vSpeeds.vfe10),
    flapDetentsDeg: dets,
    retractableGear: !!P.gearRetractable,
    flareTauS: jet ? 3.8 : 3.3,
    flareGain: 0.8,
    flareIntGain: 0.3,
    rolloutHdgGain: 0.2,
    rolloutRateGain: 0.06,
    rolloutXtGain: 0.5,
    flareDampS: 1.5,
    flareLeadS: jet ? 1.8 : 1.2,
    flareTriggerMargin: 1.0,
    touchdownSinkFps: jet ? 1.8 : 1.4,
    maxFlarePitchDeg: jet ? 8.5 : 10,
    pathOwnRaFt: jet ? 400 : 250,
    pathGain: 0.12,
    retardRaFt: jet ? 22 : 14,
    retardRatePerS: jet ? 0.25 : 0.7,
    speedKi: jet ? 0.0018 : 0.004,
    speedKd: jet ? 0.035 : 0.05,
    speedSlewPerS: jet ? 0.12 : 0.25,
    brakeLevel: jet ? 0.55 : 0.4,
    handBackKt: 4,
  }
}

export interface AutolandState {
  phase: AutolandPhase
  clock: number
  /** Speed loop memory. */
  throttle: number
  lastIas: number
  iasRate: number
  lastVs: number
  /** Filtered vertical acceleration, fpm/s. */
  vsAcc: number
  /** Flare memory. */
  pitchBaseDeg: number
  flarePitchDeg: number
  vsInt: number
  flareT: number
  /** Angle of attack and airspeed when the flare began (α ∝ 1/V² thereafter). */
  alpha0: number
  ias0: number
  /** Rollout memory. */
  groundT: number
  brake: number
  derotatePitchDeg: number
  lastFlapStepT: number
  /** Sink rate seen on the last airborne frame (reported at touchdown), fpm. */
  touchdownVsFpm: number | null
  /** Short-final lateral tracking owned by autoland (geometric cross-track). */
  lateralOwned: boolean
  xtInt: number
  /** Short-final glidepath tracking owned by autoland (radio altitude vs. beam geometry). */
  verticalOwned: boolean
  /** Why autoland dropped back to ARMED, for the panel message. */
  lostReason: string | null
}

export function makeAutolandState(): AutolandState {
  return {
    phase: 'OFF', clock: 0, throttle: 0, lastIas: Number.NaN, iasRate: 0, lastVs: Number.NaN, vsAcc: 0,
    pitchBaseDeg: 0, flarePitchDeg: 0, vsInt: 0, flareT: 0, alpha0: 0, ias0: 100,
    groundT: 0, brake: 0, derotatePitchDeg: 0, lastFlapStepT: -99, touchdownVsFpm: null, lateralOwned: false, xtInt: 0, verticalOwned: false, lostReason: null,
  }
}

export interface AutolandInputs {
  /** AP master on and LAND selected. */
  armed: boolean
  /** The AP has captured the localizer / glideslope (it is flying them). */
  locCaptured: boolean
  gsCaptured: boolean
  /** Radio altitude: main-gear height above the ground, ft. */
  radioAltFt: number
  iasKt: number
  tasKt: number
  alphaDeg: number
  groundSpeedKt: number
  verticalSpeedFpm: number
  pitchDeg: number
  rollDeg: number
  headingDeg: number
  trackDeg: number
  yawRateDegS: number
  onGround: boolean
  /** Runway course (deg true) and position on the runway, metres; cross-track
   *  positive to the RIGHT. */
  courseDeg: number | undefined
  crossTrackM: number | undefined
  /** Height of the glidepath above the runway at the aircraft's position, ft
   *  (from the ILS geometry), and its angle, deg. Undefined = no geometry:
   *  the autopilot's own glideslope law flies to the flare. */
  glidepathHeightFt?: number
  glidepathAngleDeg?: number
  /** Headwind component along the final approach, kt (+ headwind). */
  headwindKt: number
  /** Current throttle lever, flap detent index, gear state. */
  throttle: number
  flapIndex: number
  gearDown: boolean
}

export interface AutolandOutput {
  phase: AutolandPhase
  /** Short annunciation for the FMA / panel. */
  annunciation: string
  /** Target approach speed, kt (also feeds the AP speed bug). */
  speedTargetKt: number
  /** When non-null autoland owns the throttle this frame. */
  throttle: number | null
  /** AP overrides for the flare / rollout. */
  pitchTargetDeg?: number
  maxBankDeg?: number
  /** Bank to fly (centerline tracking) — replaces the AP's LOC law. */
  bankTargetDeg?: number
  yawCmd?: number
  /** Configuration requests (monotonic: never retract). */
  gearDown: boolean
  flapIndex: number | null
  spoilerArm: boolean
  reverse: boolean
  brake: number
  /** Rollout complete: hand the airplane back to the pilot (brakes keep
   *  holding — `brake` stays set — until the app sees the pilot take over). */
  disconnect: boolean
  /** One-shot text for the pilot (phase changes). */
  message?: string
}

const wrap180 = (d: number): number => ((d + 540) % 360) - 180

/** Centerline tracking: a track-offset command (first-order convergence in
 *  cross-track, time constant `T`) flown through the autopilot's own
 *  heading-to-bank gain — fast inner loop, slow outer loop, nothing to
 *  oscillate. Right of the centerline aims left of the course. Bank, deg. */
export function centerlineBankDeg(xtM: number, trackErrDeg: number, gsKt: number, xtIntMs = 0): number {
  const V = Math.max(gsKt * 0.51444, 20)
  const T = 20
  const Ti = 25 // slow integral: an airplane that needs a degree of bank to fly straight (rigging, wind shear) must not settle off the centerline
  const offsetDeg = clamp(-(((xtM + xtIntMs / Ti) / (V * T)) * 180) / Math.PI, -8, 8)
  // Gentler than the HDG law's 2°/°: the inner track loop must be slower than
  // the airplane's bank-response lag or the pair rings (found in closed loop).
  return clamp(1.0 * (offsetDeg - trackErrDeg), -8, 8)
}

/** Approach speed: Vref + 5, plus half the headwind and any gust margin (the
 *  standard additive), capped so a strong wind cannot push past flap limits. */
export function approachSpeedKt(vrefKt: number, headwindKt: number): number {
  return vrefKt + 5 + clamp(headwindKt * 0.5, 0, 10)
}

/** Sink rate the exponential flare commands at a given height, ft/s (+down). */
export function flareSinkFps(raFt: number, cfg: Pick<AutolandConfig, 'flareTauS' | 'touchdownSinkFps'>): number {
  return Math.max(raFt, 0) / cfg.flareTauS + cfg.touchdownSinkFps
}

export function stepAutoland(s: AutolandState, dt: number, i: AutolandInputs, cfg: AutolandConfig): AutolandOutput {
  s.clock += dt
  const vapp = approachSpeedKt(cfg.vrefKt, i.headwindKt)
  const out: AutolandOutput = {
    phase: s.phase, annunciation: '', speedTargetKt: vapp, throttle: null,
    gearDown: false, flapIndex: null, spoilerArm: false, reverse: false, brake: 0, disconnect: false,
  }
  // IAS rate (≈1.5 s filter), clamped so a sensor step cannot slam the lever.
  if (Number.isFinite(s.lastIas) && dt > 0) {
    const sample = clamp((i.iasKt - s.lastIas) / dt, -10, 10)
    s.iasRate += (sample - s.iasRate) * Math.min(dt / 1.5, 1)
  }
  s.lastIas = i.iasKt
  if (Number.isFinite(s.lastVs) && dt > 0) {
    const sample = clamp((i.verticalSpeedFpm - s.lastVs) / dt, -3000, 3000)
    s.vsAcc += (sample - s.vsAcc) * Math.min(dt / 0.5, 1)
  }
  s.lastVs = i.verticalSpeedFpm

  if (!i.armed) {
    if (s.phase !== 'OFF') Object.assign(s, makeAutolandState())
    out.phase = 'OFF'
    return out
  }
  const announce = (m: string): void => { out.message = m }

  if (s.phase === 'OFF' || s.phase === 'DONE') {
    // A fresh arm from OFF; DONE stays done until disarmed.
    if (s.phase === 'OFF') { s.phase = 'ARMED'; s.lostReason = null; announce('AUTOLAND ARMED') }
    else { out.phase = 'DONE'; return out }
  }

  const ra = i.radioAltFt
  const course = i.courseDeg

  // ---- ARMED → LAND on LOC + GS capture ----
  if (s.phase === 'ARMED' && i.locCaptured && i.gsCaptured && !i.onGround && ra < 4000) {
    s.phase = 'LAND'
    s.throttle = i.throttle
    s.lastFlapStepT = s.clock - 99
    announce('AUTOLAND — LAND')
  }

  // ---- LAND losing its beams above 100 ft falls back to ARMED ----
  if (s.phase === 'LAND' && (!i.locCaptured || !i.gsCaptured) && ra > 100) {
    s.phase = 'ARMED'
    s.lostReason = !i.locCaptured ? 'LOCALIZER LOST' : 'GLIDESLOPE LOST'
    announce(`AUTOLAND NOT AVAILABLE — ${s.lostReason}`)
  }

  // ---- LAND → FLARE when the exponential law's sink matches the current sink ----
  if (s.phase === 'LAND' && !i.onGround) {
    const sinkFps = Math.max(0, -i.verticalSpeedFpm / 60)
    const cmd = flareSinkFps(ra, cfg)
    if ((ra < 120 && cmd * cfg.flareTriggerMargin <= sinkFps) || ra <= 10) {
      s.phase = 'FLARE'
      s.flareT = 0
      if (!s.verticalOwned) {
        s.pitchBaseDeg = i.pitchDeg
        s.flarePitchDeg = i.pitchDeg
        s.vsInt = 0
        s.alpha0 = i.alphaDeg
        s.ias0 = Math.max(i.iasKt, 30)
      }
    }
  }

  // ---- FLARE → ROLLOUT on touchdown ----
  if (s.phase === 'FLARE' && i.onGround) {
    s.phase = 'ROLLOUT'
    s.groundT = 0
    s.brake = 0
    s.derotatePitchDeg = i.pitchDeg
    announce(s.touchdownVsFpm !== null ? `TOUCHDOWN ${Math.round(s.touchdownVsFpm)} FPM — ROLLOUT` : 'ROLLOUT')
  }
  if (s.phase === 'FLARE' && !i.onGround) s.touchdownVsFpm = i.verticalSpeedFpm

  // ---- a bounce re-enters the flare ----
  if (s.phase === 'ROLLOUT' && !i.onGround && ra > 3 && s.groundT < 3) {
    s.phase = 'FLARE'
    s.pitchBaseDeg = i.pitchDeg
    s.flarePitchDeg = i.pitchDeg
    s.vsInt = 0
    s.flareT = 0
    s.alpha0 = i.alphaDeg
    s.ias0 = Math.max(i.iasKt, 30)
  }

  out.phase = s.phase

  // =============== phase behaviours ===============
  if (s.phase === 'ARMED') {
    out.annunciation = 'LAND ARM'
    return out
  }

  /** θ = α + γ. Command the flight-path angle a sink-rate target calls for on
   *  top of the angle of attack the airplane will need at this speed (α ∝ 1/V²
   *  from where the law took over — the reason a fixed "pitch up N degrees"
   *  flare balloons or drops), with feedback on the flight-path error and a
   *  predictive damping term (γ + Td·γ̇). `rateFpmS` is how fast the target
   *  is moving (the flight path lags pitch by a second or two, so chase it). */
  const pitchForSink = (vsCmdFpm: number, rateFpmS: number): number => {
    const tasFps = Math.max(i.tasKt, 40) * FT_PER_NM_KT
    const lead = vsCmdFpm + cfg.flareLeadS * rateFpmS
    const gammaCmdDeg = (Math.asin(clamp(lead / 60 / tasFps, -0.5, 0.5)) * 180) / Math.PI
    const gammaNowDeg = (Math.asin(clamp(i.verticalSpeedFpm / 60 / tasFps, -0.5, 0.5)) * 180) / Math.PI
    const gammaRateDegS = (((s.vsAcc / 60) / tasFps) * 180) / Math.PI
    const e = gammaCmdDeg - (gammaNowDeg + cfg.flareDampS * gammaRateDegS) // + = sinking faster than wanted
    s.vsInt = clamp(s.vsInt + cfg.flareIntGain * e * dt, -1.5, 1.5)
    const alphaEst = s.alpha0 * Math.pow(s.ias0 / Math.max(i.iasKt, 30), 2)
    const wanted = clamp(alphaEst + gammaCmdDeg + cfg.flareGain * e + s.vsInt, s.pitchBaseDeg - 3, cfg.maxFlarePitchDeg)
    const maxStep = (wanted > s.flarePitchDeg ? 2.5 : 2) * dt
    s.flarePitchDeg += clamp(wanted - s.flarePitchDeg, -maxStep, maxStep)
    return s.flarePitchDeg
  }

  // Short-final vertical guidance: below `pathOwnRaFt` the beam is too
  // narrow to fly by (and sits on a different datum than the wheels), so
  // follow the glidepath geometry against RADIO altitude instead — flown
  // with the same θ = α + γ law as the flare, so the two join seamlessly.
  const ownVertical = (): void => {
    if (i.glidepathHeightFt === undefined) return
    if (!s.verticalOwned && ra < cfg.pathOwnRaFt) {
      s.verticalOwned = true
      s.pitchBaseDeg = i.pitchDeg
      s.flarePitchDeg = i.pitchDeg
      s.vsInt = 0
      s.alpha0 = i.alphaDeg
      s.ias0 = Math.max(i.iasKt, 30)
    }
    if (!s.verticalOwned) return
    const tanG = Math.tan(((i.glidepathAngleDeg ?? 3) * Math.PI) / 180)
    const vsPath = -Math.max(i.groundSpeedKt, 40) * FT_PER_NM_KT * tanG * 60
    const hErr = ra - i.glidepathHeightFt // + above the path
    out.pitchTargetDeg = pitchForSink(vsPath - cfg.pathGain * hErr * 60, 0)
  }

  // Short-final lateral guidance: take over from the AP's soft LOC law once
  // low and close to the centerline; keep it through the flare.
  const ownLateral = (): void => {
    if (!s.lateralOwned && ra < 800 && i.crossTrackM !== undefined && Math.abs(i.crossTrackM) < 100 && course !== undefined) {
      s.lateralOwned = true
      s.xtInt = 0
    }
    if (s.lateralOwned && i.crossTrackM !== undefined && course !== undefined) {
      if (Math.abs(i.crossTrackM) < 25) s.xtInt = clamp(s.xtInt + i.crossTrackM * dt, -400, 400) // anti-windup: not while far off
      out.bankTargetDeg = centerlineBankDeg(i.crossTrackM, wrap180(i.trackDeg - course), i.groundSpeedKt, s.xtInt)
    }
  }

  if (s.phase === 'LAND') {
    out.annunciation = 'LAND'
    // Gear: down for the approach (never retracted here).
    out.gearDown = cfg.retractableGear
    // Flaps: one detent at a time, only inside that detent's speed limit.
    if (i.flapIndex < cfg.finalFlapIndex && s.clock - s.lastFlapStepT > 4) {
      const next = i.flapIndex + 1
      if (i.iasKt <= cfg.flapLimitKt(next) - 3) { out.flapIndex = next; s.lastFlapStepT = s.clock }
    }
    out.spoilerArm = cfg.spoilers && ra < 1200
    ownLateral()
    ownVertical()
    // Speed: velocity-form PI with speed-rate damping, slew-limited.
    const err = vapp - i.iasKt
    const du = clamp((cfg.speedKi * err - cfg.speedKd * s.iasRate) * dt, -cfg.speedSlewPerS * dt, cfg.speedSlewPerS * dt)
    s.throttle = clamp(s.throttle + du, 0, 1)
    out.throttle = s.throttle
    return out
  }

  if (s.phase === 'FLARE') {
    out.annunciation = 'LAND' // the flare is silent on screen: autoland just keeps saying LAND
    s.flareT += dt
    out.gearDown = cfg.retractableGear
    out.spoilerArm = cfg.spoilers
    // ---- pitch: θ = α + γ (see pitchForSink) on the exponential sink profile ----
    out.pitchTargetDeg = pitchForSink(-flareSinkFps(ra, cfg) * 60, -i.verticalSpeedFpm / cfg.flareTauS)
    // ---- throttle: hold, then retard to idle ----
    if (ra <= cfg.retardRaFt) s.throttle = Math.max(0, s.throttle - cfg.retardRatePerS * dt)
    else {
      const err = vapp - i.iasKt
      const du = clamp((cfg.speedKi * err - cfg.speedKd * s.iasRate) * dt, -cfg.speedSlewPerS * dt, cfg.speedSlewPerS * dt)
      s.throttle = clamp(s.throttle + du, 0, 1)
    }
    out.throttle = s.throttle
    // ---- lateral: nearly wings level, kick the crab out with rudder ----
    ownLateral()
    out.maxBankDeg = 5
    if (course !== undefined) {
      const hdgErr = wrap180(course - i.headingDeg)
      const kick = clamp((12 - ra) / 12, 0, 1) // decrab progressively below ~12 ft… from 40 for jets
      const k = cfg.jet ? clamp((40 - ra) / 40, 0, 1) : kick
      out.yawCmd = clamp(0.05 * hdgErr * k - 0.02 * i.yawRateDegS, -0.6, 0.6)
    }
    return out
  }

  // ---------------- ROLLOUT ----------------
  s.groundT += dt
  out.annunciation = 'ROLLOUT'
  out.spoilerArm = cfg.spoilers
  out.throttle = 0
  s.throttle = 0
  // Reversers once the nose is coming down, off below 60 kt.
  out.reverse = cfg.reversers && s.groundT > 0.6 && i.groundSpeedKt > 60
  // Derotate gently; the nosewheel must come down on its own schedule.
  s.derotatePitchDeg = Math.max(-0.5, s.derotatePitchDeg - 1.6 * dt)
  out.pitchTargetDeg = s.derotatePitchDeg
  out.maxBankDeg = 0
  // Autobrake: after the nose is down, ramp to the configured level; ease off near hand-back.
  if (s.groundT > 1.2 && i.pitchDeg < 2.5) s.brake = Math.min(cfg.brakeLevel, s.brake + 0.5 * dt)
  const easeOff = clamp((i.groundSpeedKt - cfg.handBackKt) / 30, 0, 1)
  out.brake = s.brake * (0.5 + 0.5 * easeOff)
  // Steering: hold the runway heading, biased back toward the centerline.
  if (course !== undefined) {
    const xt = i.crossTrackM ?? 0
    const desired = course - clamp(xt * cfg.rolloutXtGain, -10, 10) // right of centerline → aim left
    const hdgErr = wrap180(desired - i.headingDeg)
    const speedScale = 1 / (1 + i.groundSpeedKt / 50)
    out.yawCmd = clamp((cfg.rolloutHdgGain * hdgErr - cfg.rolloutRateGain * i.yawRateDegS) * (0.45 + speedScale), -0.8, 0.8)
  }
  if (i.groundSpeedKt < cfg.handBackKt && s.groundT > 3) {
    s.phase = 'DONE'
    out.phase = 'DONE'
    out.disconnect = true
    out.brake = cfg.brakeLevel * 0.6 // keep holding the airplane still
    out.reverse = false
    announce('AUTOLAND COMPLETE — STOPPED ON THE RUNWAY, BRAKES HOLDING')
  }
  return out
}

/** Radio altitude, ft: height of the main wheels above the ground, from the
 *  CG height and pitch (a rotated airplane's mains sit lower than at rest). */
export function radioAltitudeFt(aglFt: number, pitchDeg: number, P: Pick<AircraftParams, 'gear'>): number {
  const main = P.gear.mainL
  const th = (pitchDeg * Math.PI) / 180
  const wheelBelowCgM = main.z * Math.cos(th) - main.x * Math.sin(th)
  return aglFt - wheelBelowCgM / 0.3048
}
