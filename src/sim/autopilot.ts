/**
 * GFC700-style autopilot (Phase 4 Task 3, §24/§9): cascaded-PID mode state
 * machine driving roll/pitch/yaw control-surface commands + a trim
 * follow-up, plus flight-director attitude targets. Pure module — no
 * three.js/DOM (§4.1), mirrors `navaids.ts`/`gps.ts`'s data-in/data-out
 * style and `src/sim/systems/electrical.ts`'s `make*State()` +
 * `step*(state, dt, inputs)` mutate-in-place convention.
 *
 * This module does not know about `NavaidsIndex`/`FlightPlan`/`Aircraft` —
 * lateral/vertical nav deviations (CDI, localizer, glideslope) arrive as
 * plain normalized numbers a later wiring task computes from
 * `src/sim/nav/navaids.ts` (`localizerDeflection`/`glideslopeDeflection`)
 * and `src/sim/nav/gps.ts` (`gpsCdiDeflection`), and outputs are plain
 * numbers in `Controls.pitch`/`.roll`/`.yaw`/`.trim`'s [-1, 1] convention
 * (`src/sim/aircraft.ts`) for that same later task to write into
 * `aircraft.controls`.
 *
 * DESIGN NOTE — pitch-for-airspeed / trim follow-up (carried over from a
 * separate `main.ts` "flight assist" investigation this session, not this
 * module, but directly informing it): a fixed-attitude pitch hold cannot
 * sustain a stable climb/descent because it ignores the aircraft's natural
 * tendency to seek a trimmed equilibrium airspeed, producing phugoid-like
 * altitude/airspeed oscillation. FLC below is therefore built as a genuine
 * pitch-FOR-airspeed loop (error = IAS - target IAS, output = pitch
 * attitude), not pitch-hold with an airspeed label; VS targets vertical
 * speed instead (a different, independently legitimate setpoint), and
 * ALT/VS/FLC/GS all bleed their steady-state pitch command into
 * `trimCommand` over time so the active loop isn't fighting a permanent
 * aerodynamic load hands-off for a long duration. PIT is deliberately left
 * as plain attitude-hold with no trim follow-up — it's documented as a
 * short-term/manual-adjustment mode, not a sustained autonomous climb.
 */
import { clamp } from '../math/vec'

// ---- mode types ----

export type LateralMode = 'ROL' | 'HDG' | 'NAV' | 'APR' | 'BC'

/** Vertical modes. `GS` (glideslope tracking) is not explicitly named in
 *  the task's vertical-mode list, but is added here because APR's
 *  glideslope tracking is fundamentally a distinct vertical control target
 *  (own capture logic, own error source) from PIT/ALT/VS/FLC — exactly
 *  matching the real GFC700's own "GS" annunciation. Flagged as a
 *  deliberate, reasoned extension beyond the literal spec text, not scope
 *  creep: without it, APR would have no vertical mode identity at all. */
export type VerticalMode = 'PIT' | 'ALT' | 'ALTS' | 'VS' | 'FLC' | 'GS'

/** Modes flown while an armed altitude/glideslope capture (`ALTS`/`GS`)
 *  awaits its trigger — the mode the aircraft is actually climbing/
 *  descending under until the capture point arrives. */
export type UnderlyingVerticalMode = 'PIT' | 'VS' | 'FLC'

// ---- inputs ----

export interface AutopilotInputs {
  // ---- current aircraft state (primitives — decoupled from FlightData) ----
  iasKt: number
  altitudeFt: number
  verticalSpeedFpm: number
  headingDeg: number
  pitchDeg: number
  rollDeg: number

  // ---- engagement + mode selects ----
  masterEnabled: boolean
  lateralMode: LateralMode
  verticalMode: VerticalMode
  /** Only consulted while `verticalMode` is `ALTS` or `GS` and the capture
   *  hasn't happened yet: which mode is actually flying the aircraft during
   *  the arm phase. Defaults to `VS` if omitted. */
  underlyingVerticalMode?: UnderlyingVerticalMode

  // ---- targets / bugs ----
  headingBugDeg: number
  altitudeBugFt: number
  vsTargetFpm: number
  iasTargetKt: number
  /** ROL mode target bank angle, deg. Default 0 = wings level. */
  bankCommandDeg: number
  /** PIT mode target pitch attitude, deg. */
  pitchCommandDeg: number

  // ---- nav deviations (caller-normalized plain numbers) ----
  /** Lateral deviation for NAV/APR/BC, fraction of full-scale deflection
   *  (e.g. `gpsCdiDeflection(...).deflectionFraction`, or
   *  `localizerDeflection(...) / LOC_FULL_SCALE_DEG`). Positive = aircraft
   *  right of course. */
  navDeviation: number
  /** Vertical deviation for GS, fraction of full-scale
   *  (`glideslopeDeflection(...) / GS_FULL_SCALE_DEG`). Positive = aircraft
   *  above the glidepath (fly down). */
  glideslopeDeviation: number
}

// ---- output / state ----

interface PidMemory {
  integrator: number
  prevError: number
}

function makePid(): PidMemory {
  return { integrator: 0, prevError: 0 }
}

export interface AutopilotState {
  masterEnabled: boolean
  /** One-shot: true immediately after a disconnect, until the next
   *  `stepAutopilot` call consumes it. A later audio task can poll this to
   *  fire the AP-disconnect tone. */
  justDisconnected: boolean

  lateralMode: LateralMode
  /** True while the mode is selected but not yet capturing/tracking
   *  (avionics "armed", white annunciation vs. "active", green). */
  lateralArmed: boolean
  verticalMode: VerticalMode
  verticalArmed: boolean

  // ---- primary control outputs, Controls-compatible [-1, 1] ----
  rollCmd: number
  pitchCmd: number
  yawCmd: number
  /** Elevator trim follow-up, matches `Controls.trim`'s [-1, 1] convention. */
  trimCommand: number

  // ---- flight-director attitude targets, degrees ----
  /** Commanded bank attitude — computed every step regardless of
   *  `masterEnabled` (a flight director shows the target even hand-flown). */
  fdBankDeg: number
  fdPitchDeg: number

  // ---- internal bookkeeping (not part of the output contract, but plain
  //      and inspectable — no hidden closures, matching this file's other
  //      exported-state style) ----
  lastCommandedLateralMode: LateralMode
  lastCommandedVerticalMode: VerticalMode
  navBank: PidMemory
  gsPitch: PidMemory
  altPitch: PidMemory
  vsPitch: PidMemory
  flcPitch: PidMemory
  bankAttitude: PidMemory
  pitchAttitude: PidMemory
}

export function makeAutopilotState(): AutopilotState {
  return {
    masterEnabled: false,
    justDisconnected: false,
    lateralMode: 'ROL',
    lateralArmed: false,
    verticalMode: 'PIT',
    verticalArmed: false,
    rollCmd: 0,
    pitchCmd: 0,
    yawCmd: 0,
    trimCommand: 0,
    fdBankDeg: 0,
    fdPitchDeg: 0,
    lastCommandedLateralMode: 'ROL',
    lastCommandedVerticalMode: 'PIT',
    navBank: makePid(),
    gsPitch: makePid(),
    altPitch: makePid(),
    vsPitch: makePid(),
    flcPitch: makePid(),
    bankAttitude: makePid(),
    pitchAttitude: makePid(),
  }
}

/** Instantly disconnect: servos and captures drop, no active modes, back to
 *  manual (real AP disconnects are immediate, unlike a servo rate-limited
 *  capture roll-in). `justDisconnected` is a one-shot a later audio task can
 *  hook to fire the disconnect tone (Phase 9 — not built here). */
export function disconnect(state: AutopilotState): void {
  state.masterEnabled = false
  state.justDisconnected = true
  state.lateralMode = 'ROL'
  state.lateralArmed = false
  state.lastCommandedLateralMode = 'ROL'
  state.verticalMode = 'PIT'
  state.verticalArmed = false
  state.lastCommandedVerticalMode = 'PIT'
  state.rollCmd = 0
  state.pitchCmd = 0
  state.yawCmd = 0
  // trimCommand is intentionally left alone — a real trim wheel doesn't
  // snap back to neutral just because the AP servos disengaged.
}

// ---- design-choice constants (flagged engineering choices, not sourced
//      GFC700 specs — the real gain tables/servo rates are proprietary and
//      not publicly documented; these are tuned only to produce stable,
//      convergent step responses) ----

/** Commanded-bank cap for HDG/NAV/APR/BC — a widely-used convention for GA
 *  autopilot STCs (many cap around 25-30 deg in heading/nav modes). */
export const MAX_BANK_DEG = 25

/** Commanded pitch-attitude cap for ALT/VS/FLC/GS — keeps captures gentle
 *  rather than commanding an aggressive attitude off a large error. */
export const MAX_PITCH_CMD_DEG = 10

/** Servo rate limit, fraction of full [-1,1] control travel per second —
 *  ~4 s to traverse center-to-full. This is what makes a capture visibly
 *  roll/pitch in over a couple of seconds instead of snapping. Design
 *  choice; real servo rates vary by installation and aren't published. */
export const SERVO_RATE_PER_S = 0.5

/** Trim follow-up rate: trimCommand fraction moved per second per unit of
 *  sustained primary-axis command. Chosen so a steady moderate elevator
 *  load (~half-authority) bleeds most of the way into trim over roughly a
 *  minute — slow enough to not fight transient corrections, fast enough to
 *  matter for genuinely hands-off long-duration flight. Design choice. */
export const TRIM_FOLLOWUP_RATE_PER_S = 0.04

/** Airspeed at which gain-schedule scaling = 1.0 — near the C172S's normal
 *  operating/approach speed range (Va 105 KIAS, per `c172s.ts`). Standard
 *  autopilot practice is to schedule gains against IAS/dynamic pressure
 *  since control-surface moment authority grows with q ~ V², so less
 *  deflection is needed per unit attitude error at higher speed; the exact
 *  curve is an engineering choice, not a sourced GFC700 table. */
export const GAIN_REF_IAS_KT = 90

/** Capture threshold for NAV/APR/BC/GS: armed → active once the deviation
 *  is within this fraction of full scale (half-scale). Flagged design
 *  choice approximating real avionics capture logic without modeling
 *  closure-rate prediction. */
export const CAPTURE_FRACTION = 0.5

/** Assumed achievable vertical-speed deceleration (fpm per second) used to
 *  predict the ALTS/altitude-capture lead point — the vertical-axis analog
 *  of Task 2's turn-anticipation lead distance: rather than waiting until
 *  the aircraft is exactly at the bugged altitude (which overshoots), start
 *  the level-off `leadFt` early, where `leadFt` is the standard kinematic
 *  stopping-distance v²/(2a) worked in ft/s. Design choice. */
export const ALTS_DECEL_FPM_PER_S = 200

// ---- helpers ----

/** Signed heading error, deg, wrapped to (-180, 180]. Positive = bug is to
 *  the right of current heading (need a right turn). */
function headingErrorDeg(bugDeg: number, currentDeg: number): number {
  let d = (bugDeg - currentDeg) % 360
  if (d > 180) d -= 360
  if (d <= -180) d += 360
  return d
}

/** Gain-schedule multiplier by IAS — decreases as IAS increases (see
 *  `GAIN_REF_IAS_KT` above), clamped to a sane range so it never zeroes out
 *  authority at very low speed or explodes near stall. */
export function gainScale(iasKt: number): number {
  const ias = clamp(iasKt, 40, 160)
  return clamp(GAIN_REF_IAS_KT / ias, 0.5, 1.8)
}

function pidUpdate(mem: PidMemory, error: number, dt: number, kp: number, ki: number, kd: number, iMax: number): number {
  mem.integrator = clamp(mem.integrator + error * dt, -iMax, iMax)
  const deriv = dt > 1e-6 ? (error - mem.prevError) / dt : 0
  mem.prevError = error
  return kp * error + ki * mem.integrator + kd * deriv
}

function rateLimit(current: number, target: number, maxRatePerSec: number, dt: number): number {
  const maxDelta = maxRatePerSec * dt
  return current + clamp(target - current, -maxDelta, maxDelta)
}

/** ALTS/altitude-capture lead distance, ft — see `ALTS_DECEL_FPM_PER_S`. */
export function altsLeadFt(verticalSpeedFpm: number, decelFpmPerS = ALTS_DECEL_FPM_PER_S): number {
  const vFtS = Math.abs(verticalSpeedFpm) / 60
  const aFtS2 = Math.max(decelFpmPerS, 1) / 60
  return (vFtS * vFtS) / (2 * aFtS2)
}

// ---- vertical pitch-target control laws (outer loops) ----

/** Compute the target pitch attitude (deg) for one of the "flying" vertical
 *  modes (PIT/ALT/VS/FLC), plus its trim-eligibility. GS is handled
 *  separately (see stepAutopilot) since its error source is glideslope
 *  deviation, not altitude/VS/IAS. */
function verticalPitchTarget(mode: UnderlyingVerticalMode | 'ALT', state: AutopilotState, dt: number, inputs: AutopilotInputs): number {
  if (mode === 'PIT') {
    return clamp(inputs.pitchCommandDeg, -30, 30)
  }
  if (mode === 'ALT') {
    const error = inputs.altitudeBugFt - inputs.altitudeFt // +ft = need to climb
    return clamp(pidUpdate(state.altPitch, error, dt, 0.02, 0.0006, 0.05, 200), -MAX_PITCH_CMD_DEG, MAX_PITCH_CMD_DEG)
  }
  if (mode === 'VS') {
    const error = inputs.vsTargetFpm - inputs.verticalSpeedFpm // +fpm = need more climb rate
    return clamp(pidUpdate(state.vsPitch, error, dt, 0.016, 0.003, 0.002, 3000), -MAX_PITCH_CMD_DEG, MAX_PITCH_CMD_DEG)
  }
  // FLC: pitch-FOR-airspeed. error = current - target: too fast -> pitch up
  // (bleed speed, climb faster); too slow -> pitch down (regain speed).
  const error = inputs.iasKt - inputs.iasTargetKt
  return clamp(pidUpdate(state.flcPitch, error, dt, 0.4, 0.02, 0.05, 50), -MAX_PITCH_CMD_DEG, MAX_PITCH_CMD_DEG)
}

// ---- main step ----

export function stepAutopilot(state: AutopilotState, dt: number, inputs: AutopilotInputs): void {
  // ---- engagement sync / implicit disconnect ----
  // One-shot semantics: `justDisconnected` must still read true to a caller
  // that checks it right after the call that set it (whether that was an
  // explicit `disconnect()` or this step noticing masterEnabled went false)
  // and only gets cleared by a *subsequent* call.
  const enteringDisconnectedFromPriorCall = state.justDisconnected
  if (state.masterEnabled && !inputs.masterEnabled) {
    disconnect(state) // sets justDisconnected = true for this call's caller to observe
  } else {
    state.masterEnabled = inputs.masterEnabled
    if (enteringDisconnectedFromPriorCall) state.justDisconnected = false
  }

  const gain = gainScale(inputs.iasKt)
  const underlying: UnderlyingVerticalMode = inputs.underlyingVerticalMode ?? 'VS'

  // ================= LATERAL =================
  if (inputs.lateralMode !== state.lastCommandedLateralMode) {
    state.lastCommandedLateralMode = inputs.lateralMode
    state.lateralMode = inputs.lateralMode
    state.lateralArmed = inputs.lateralMode === 'NAV' || inputs.lateralMode === 'APR' || inputs.lateralMode === 'BC'
  }

  let targetBankDeg: number
  if (state.lateralMode === 'ROL') {
    targetBankDeg = clamp(inputs.bankCommandDeg, -MAX_BANK_DEG, MAX_BANK_DEG)
  } else if (state.lateralMode === 'HDG') {
    targetBankDeg = clamp(2.0 * headingErrorDeg(inputs.headingBugDeg, inputs.headingDeg), -MAX_BANK_DEG, MAX_BANK_DEG)
  } else {
    // NAV / APR / BC
    if (state.lateralArmed) {
      // Intercept: fly the heading bug toward the course while watching for
      // the capture point.
      targetBankDeg = clamp(2.0 * headingErrorDeg(inputs.headingBugDeg, inputs.headingDeg), -MAX_BANK_DEG, MAX_BANK_DEG)
      const sign = state.lateralMode === 'BC' ? -1 : 1
      const effectiveDeviation = sign * inputs.navDeviation
      if (Math.abs(effectiveDeviation) <= CAPTURE_FRACTION) {
        state.lateralArmed = false // captured — starts tracking below next call
      }
    } else {
      const sign = state.lateralMode === 'BC' ? -1 : 1
      const effectiveDeviation = sign * inputs.navDeviation
      // Positive deviation = right of course -> need a left (negative) bank
      // to converge, hence the negated error fed to the PID. Kd is kept
      // small here (unlike the inner attitude loops) since the error input
      // is a raw deviation signal that can change abruptly — a large
      // derivative gain on it would inject a destabilizing "kick".
      targetBankDeg = clamp(pidUpdate(state.navBank, -effectiveDeviation, dt, 15, 1.5, 0.3, 1), -MAX_BANK_DEG, MAX_BANK_DEG)
    }
  }
  state.fdBankDeg = targetBankDeg

  // ================= VERTICAL =================
  if (inputs.verticalMode !== state.lastCommandedVerticalMode) {
    state.lastCommandedVerticalMode = inputs.verticalMode
    state.verticalMode = inputs.verticalMode
    state.verticalArmed = inputs.verticalMode === 'ALTS' || inputs.verticalMode === 'GS'
  }

  let targetPitchDeg: number
  let trimEligible: boolean
  if (state.verticalMode === 'ALT') {
    targetPitchDeg = verticalPitchTarget('ALT', state, dt, inputs)
    trimEligible = true
  } else if (state.verticalMode === 'PIT' || state.verticalMode === 'VS' || state.verticalMode === 'FLC') {
    targetPitchDeg = verticalPitchTarget(state.verticalMode, state, dt, inputs)
    trimEligible = state.verticalMode !== 'PIT'
  } else if (state.verticalMode === 'ALTS') {
    // Armed: fly the underlying mode, watch for the capture point.
    targetPitchDeg = verticalPitchTarget(underlying, state, dt, inputs)
    trimEligible = underlying !== 'PIT'
    if (state.verticalArmed) {
      const leadFt = altsLeadFt(inputs.verticalSpeedFpm)
      if (Math.abs(inputs.altitudeFt - inputs.altitudeBugFt) <= leadFt) {
        state.verticalMode = 'ALT'
        state.verticalArmed = false
        state.lastCommandedVerticalMode = 'ALT'
      }
    }
  } else {
    // GS
    if (state.verticalArmed) {
      targetPitchDeg = verticalPitchTarget(underlying, state, dt, inputs)
      trimEligible = underlying !== 'PIT'
      if (Math.abs(inputs.glideslopeDeviation) <= CAPTURE_FRACTION) {
        state.verticalArmed = false
      }
    } else {
      // Positive deviation = above glidepath -> need to pitch down, hence
      // the negated error.
      targetPitchDeg = clamp(pidUpdate(state.gsPitch, -inputs.glideslopeDeviation, dt, 6, 0.5, 1, 1), -MAX_PITCH_CMD_DEG, MAX_PITCH_CMD_DEG)
      trimEligible = true
    }
  }
  state.fdPitchDeg = targetPitchDeg

  // ================= INNER ATTITUDE LOOPS -> CONTROL SURFACES =================
  const bankError = targetBankDeg - inputs.rollDeg
  const rawRoll = clamp(pidUpdate(state.bankAttitude, bankError, dt, 0.05, 0.03, 0.01, 30) * gain, -1, 1)

  const pitchError = targetPitchDeg - inputs.pitchDeg
  const rawPitch = clamp(pidUpdate(state.pitchAttitude, pitchError, dt, 0.08, 0.03, 0.02, 30) * gain, -1, 1)

  if (state.masterEnabled) {
    state.rollCmd = rateLimit(state.rollCmd, rawRoll, SERVO_RATE_PER_S, dt)
    state.pitchCmd = rateLimit(state.pitchCmd, rawPitch, SERVO_RATE_PER_S, dt)
    // Basic turn-coordination feed-forward (a design choice, not a full yaw
    // damper): a little rudder in the direction of the commanded roll to
    // offset adverse yaw.
    state.yawCmd = clamp(state.rollCmd * 0.2, -1, 1)

    if (trimEligible) {
      state.trimCommand = clamp(state.trimCommand + state.pitchCmd * TRIM_FOLLOWUP_RATE_PER_S * dt, -1, 1)
    }
  } else {
    state.rollCmd = rateLimit(state.rollCmd, 0, SERVO_RATE_PER_S, dt)
    state.pitchCmd = rateLimit(state.pitchCmd, 0, SERVO_RATE_PER_S, dt)
    state.yawCmd = rateLimit(state.yawCmd, 0, SERVO_RATE_PER_S, dt)
    // trimCommand is left where it is — releasing the servos doesn't move
    // the trim wheel.
  }
}
