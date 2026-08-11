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
  /** Distance to the tracked lateral station/threshold, meters — REQUIRED
   *  for angular sources (LOC/BC localizers) whose full-scale width shrinks
   *  linearly with range; omit for fixed-width sources (GPS CDI). See the
   *  round-4 comment in the tracking branch: without this, closing the loop
   *  on the bare fraction makes physical loop gain grow ~1/range and the
   *  law goes unstable inside ~5-7 km (confirmed with a 0°-error coupled
   *  GS-descent control case — not an intercept-geometry problem). */
  navRangeM?: number
  /** Ground-track direction, deg true. When provided, localizer TRACKING
   *  steers the TRACK onto the course instead of the heading — wind drift
   *  becomes transparent (the loop's output is a track command; the
   *  aircraft's crab angle falls out physically instead of needing the
   *  integrator to discover ~12° of crab over minutes — the crosswind
   *  instant-capture case diverged without this). Falls back to heading. */
  trackDeg?: number
}

// ---- output / state ----

interface PidMemory {
  integrator: number
  prevError: number
  /** Last measured process value, used only by `pidUpdateOnMeasurement`
   *  (the inner bank-attitude loop) — see that function's comment. */
  prevMeasurement: number
}

function makePid(): PidMemory {
  return { integrator: 0, prevError: 0, prevMeasurement: 0 }
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
  /** True from the moment an ALTS arm captures (renaming `verticalMode` to
   *  `'ALT'`) until a genuinely new mode selection is observed. Tracked
   *  independently of the `lastCommandedVerticalMode` change-detector below
   *  because a real mode-select button's state doesn't revert itself just
   *  because the AP captured — a caller may keep feeding `verticalMode:
   *  'ALTS'` every frame after capture, and that must NOT be read as a new
   *  arm request. See the comment above the vertical-mode block in
   *  `stepAutopilot` for the full story. */
  altsCaptured: boolean

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
  gsPitch: PidMemory
  altPitch: PidMemory
  vsPitch: PidMemory
  flcPitch: PidMemory
  bankAttitude: PidMemory
  pitchAttitude: PidMemory

  /** Last (slew-limited) `effectiveDeviation` seen by the NAV/APR/BC
   *  tracking-phase law — see the slew-rate-limit comment at its use site
   *  in `stepAutopilot`. `navTrackInitialized` guards the first tracking
   *  step after each capture so that step doesn't slew-limit against a
   *  stale/first-frame value. */
  navTrackPrevDeviation: number
  navTrackInitialized: boolean
  /** Low-pass-filtered deviation fed to the tracking law's P term — see
   *  the constant-block comment above `NAV_MAX_INTERCEPT_DEG`. */
  navTrackFilteredDeviation: number
  /** Tracking law's integral accumulator — see the constant-block comment
   *  above `NAV_MAX_INTERCEPT_DEG`. */
  navTrackIntegral: number
  /** Last (rate-limited) intercept-angle bias commanded — see the
   *  rate-limit comment at its use site in `stepAutopilot`. */
  navTrackInterceptOffsetDeg: number
}

export function makeAutopilotState(): AutopilotState {
  return {
    masterEnabled: false,
    justDisconnected: false,
    lateralMode: 'ROL',
    lateralArmed: false,
    verticalMode: 'PIT',
    verticalArmed: false,
    altsCaptured: false,
    rollCmd: 0,
    pitchCmd: 0,
    yawCmd: 0,
    trimCommand: 0,
    fdBankDeg: 0,
    fdPitchDeg: 0,
    lastCommandedLateralMode: 'ROL',
    lastCommandedVerticalMode: 'PIT',
    gsPitch: makePid(),
    altPitch: makePid(),
    vsPitch: makePid(),
    flcPitch: makePid(),
    bankAttitude: makePid(),
    pitchAttitude: makePid(),
    navTrackPrevDeviation: 0,
    navTrackInitialized: false,
    navTrackFilteredDeviation: 0,
    navTrackIntegral: 0,
    navTrackInterceptOffsetDeg: 0,
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
  state.altsCaptured = false
  state.lastCommandedVerticalMode = 'PIT'
  state.rollCmd = 0
  state.pitchCmd = 0
  state.yawCmd = 0
  // Control-law memory clears with the servos: a wound-up integrator from
  // the previous engagement must not command the first frames of the next
  // one (an EGLL acceptance flight re-engaged APR/GS on a stable 3 nm
  // final and dove at -4900 fpm from exactly this — real AP laws
  // re-initialize at engagement).
  for (const pid of [state.gsPitch, state.altPitch, state.vsPitch, state.flcPitch, state.bankAttitude, state.pitchAttitude]) {
    pid.integrator = 0
    pid.prevError = 0
    pid.prevMeasurement = 0
  }
  state.navTrackInitialized = false
  state.navTrackIntegral = 0
  state.navTrackInterceptOffsetDeg = 0
  state.navTrackFilteredDeviation = 0
  state.navTrackPrevDeviation = 0
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
 *  ~0.4 s to traverse center-to-full (raised from the original 0.5, ~4s
 *  traversal). Empirically, 0.5 was too slow relative to the real
 *  `Aircraft` model's actual roll authority (a full-aileron step produces
 *  ~40-50 deg/s roll rate): once the bank-attitude PID decided to retract a
 *  command, the old rate limit held the aileron near its prior deflection
 *  for up to ~2s while the aircraft kept rolling, which was a second
 *  contributor (alongside the derivative-kick fix, see
 *  `pidUpdateOnMeasurement`) to Finding B's sustained oscillation. Still
 *  slow enough to roll in over roughly half a second rather than snap — the
 *  master spec's "visible roll-in, not a teleport" intent is preserved; see
 *  the fix report for measured captures that still look like a smooth
 *  roll-in, not a jump. */
export const SERVO_RATE_PER_S = 2.5

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

/** NAV/APR/BC tracking-law gain, deg of intercept-angle bias per unit of
 *  full-scale deviation, capped at `NAV_MAX_INTERCEPT_DEG`. ROOT CAUSE
 *  (confirmed against the real `Aircraft` model, see the fix report): the
 *  original tracking law fed cross-track deviation straight into a
 *  standalone bank-command PID (`kp=15,ki=1.5,kd=0.3`) with no notion of
 *  which way the aircraft's HEADING was pointed relative to the course —
 *  only how far away it was laterally. Once captured with any material
 *  heading/course misalignment (the normal case right after an intercept,
 *  not an edge case), that law had no mechanism to actually turn the
 *  aircraft parallel to the course; it just chased a small deviation
 *  number, producing the same class of sustained, undamped oscillation as
 *  Finding B's HDG bug (confirmed via a real localizer-geometry repro:
 *  heading swinging through the full compass rose, deviation pinned at
 *  full-scale for minutes). The fix reframes tracking as a "desired
 *  heading" problem instead: deviation is converted into a bounded
 *  intercept-angle bias off the course (`inputs.headingBugDeg`, which — per
 *  the ARMED branch just above — is already the reference the pilot flies
 *  toward), and the resulting desired-heading error is fed through the
 *  exact same already-validated heading-to-bank law HDG uses (2.0 gain,
 *  ±`MAX_BANK_DEG` cap, derivative-on-measurement inner loop). This
 *  guarantees the tracking law converges by construction once deviation
 *  reaches 0 (bias -> 0 -> flies the course heading directly), the same way
 *  HDG converges on its bug. `25` (deg per unit deviation, i.e. full-scale
 *  deviation commands a 25 deg intercept) and a matching `25` deg cap were
 *  the best all-around empirical fit across a 10-180 deg initial
 *  heading/course-error sweep (see fix report) — high enough to correct a
 *  large deviation with real authority, capped low enough to not
 *  re-introduce large-angle overshoot. */
/** Reference range for angular-deviation normalization (see `navRangeM`'s
 *  doc): loop gains are tuned at this range; the factor freezes physical
 *  loop gain there for all ranges. Shared by the localizer tracking law and
 *  the GS pitch law (the GS antenna sits at the same threshold). */
export const NAV_REF_RANGE_M = 8000

function navRangeFactor(inputs: AutopilotInputs): number {
  return inputs.navRangeM !== undefined ? clamp(inputs.navRangeM / NAV_REF_RANGE_M, 0, 2.5) : 1
}

export const NAV_INTERCEPT_GAIN_K_DEG = 25

/** Cap on the intercept-angle bias `NAV_INTERCEPT_GAIN_K_DEG` can command —
 *  see that constant's comment. Deliberately well under a 45 deg "standard"
 *  intercept angle so re-capturing after a disturbance stays gentle. */
export const NAV_MAX_INTERCEPT_DEG = 25

/** SECOND, independent fix layered on the tracking law above — see the fix
 *  report (`docs/plans/phase-4-autopilot-oscillation-fix-report.md`,
 *  "still-broken tracking-phase instability" section) for the full story,
 *  including a sweep across a genuine derivative-on-deviation term (raw AND
 *  low-pass-filtered, both signs, gains from -2000 to +50000) that was tried
 *  FIRST and empirically found to make the instability WORSE at every
 *  magnitude tested, not better — the intercept-angle-bias law's
 *  "proportional-only outer loop" diagnosis was right, but the missing term
 *  turned out to be integral (nulling a small persistent bias the bank
 *  inner loop can't fully null on its own) and a slower/filtered
 *  proportional response, not derivative. The actual fix applied at the
 *  call site (`stepAutopilot`'s NAV/APR/BC tracking branch) layers three
 *  independent pieces onto `NAV_INTERCEPT_GAIN_K_DEG`'s bare-P law:
 *   1. A ~5s low-pass filter on the deviation fed to the P term
 *      (`navTrackFilteredDeviation`) — slows the outer loop's response just
 *      enough to stop it exciting the ~70-100s lightly-damped mode a bare
 *      instantaneous P term rings at.
 *   2. A genuine integrator (`navTrackIntegral`, gain 0.2 deg per
 *      unit-deviation-second) — nulls the small sustained heading/deviation
 *      bias a pure-P law leaves uncorrected forever (confirmed directly: a
 *      1200s long-range repro held a STEADY ~0.26-fraction deviation
 *      indefinitely under P-only, never reaching zero; adding the
 *      integrator drove that down to <0.02 over the same run).
 *   3. A dynamic cap on the bias (`dynamicMaxInterceptDeg`) that stays tight
 *      while the aircraft's heading is already close to the course AND the
 *      integrator hasn't wound up much — this is glitch immunity for the
 *      genuine geometric singularity in bearing-based localizer navigation
 *      right at/very near the station (angular deflection is undefined
 *      exactly overhead the antenna), confirmed directly: deviation held
 *      converged for 10+ minutes in a long-range repro, then snapped from
 *      near-zero to full-scale within 1-2 simulated seconds purely from
 *      proximity to the antenna, not a control-law error. The cap opens
 *      back up once the integrator shows a persistent (not transient)
 *      error, so it can't permanently ignore a genuine sustained deviation.
 *  Deliberately scoped as local `const`s at the call site rather than
 *  module-level exports (unlike `NAV_INTERCEPT_GAIN_K_DEG`) — they're all
 *  empirically-tuned knobs for this one law and don't need external
 *  visibility the way the primary gain does. */

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

/** Derivative-ON-MEASUREMENT variant of `pidUpdate`, for loops whose target
 *  (setpoint) itself changes every step rather than holding still — e.g. the
 *  bank-attitude loop's target is `2.0 * headingErrorDeg(...)`, which keeps
 *  shrinking continuously as the aircraft turns toward the bug, not just on
 *  a one-time mode-select step.
 *
 *  ROOT CAUSE (confirmed empirically against the real `Aircraft` model, see
 *  `docs/plans/phase-4-autopilot-oscillation-fix-report.md`): differentiating
 *  `error = target - measurement` means the D term reacts to the setpoint's
 *  OWN rate of change, not just the measured bank angle's rate of change. As
 *  heading closes in on the bug, `targetBankDeg` retracts quickly (it's
 *  directly proportional to a shrinking heading error); that retraction rate
 *  showed up as a large derivative "kick" pushing the control output hard in
 *  the wrong direction well before the bank angle itself had actually
 *  overshot the target — a textbook "derivative kick from a moving
 *  setpoint," and the actual mechanism behind the sustained oscillation
 *  found in Finding B. Differentiating the measured bank angle instead
 *  (`-(measurement - prevMeasurement) / dt`) damps the aircraft's own roll
 *  rate, which is what a rate-damping D term is supposed to do, and ignores
 *  how fast the outer loop's target is sliding around. */
function pidUpdateOnMeasurement(mem: PidMemory, error: number, measurement: number, dt: number, kp: number, ki: number, kd: number, iMax: number): number {
  mem.integrator = clamp(mem.integrator + error * dt, -iMax, iMax)
  const deriv = dt > 1e-6 ? -(measurement - mem.prevMeasurement) / dt : 0
  mem.prevMeasurement = measurement
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
    // A fresh mode selection invalidates any deviation-rate history from a
    // prior tracking session (see `navTrackPrevDeviation`'s comment) — the
    // next capture must start its derivative fresh, not diff against a
    // stale deviation from a previous approach/track.
    state.navTrackInitialized = false
    state.navTrackIntegral = 0
    state.navTrackInterceptOffsetDeg = 0
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
        // Fresh capture: the next tracking step must not diff against a
        // deviation value from before capture (see `navTrackPrevDeviation`).
        state.navTrackInitialized = false
        state.navTrackIntegral = 0
        state.navTrackInterceptOffsetDeg = 0
        // ROUND 3 ATTEMPT (see the fix report's "round 3" section): seed the
        // P term's low-pass filter to the ACTUAL deviation at the instant of
        // capture rather than leaving it at 0/stale — a real, defensible
        // correctness fix in isolation (the filter otherwise under-reacts
        // for several `P_FILTER_TAU_S` (~5s) time constants right after a
        // fresh capture). Kept because it's strictly more correct and does
        // not regress any existing test.
        //
        // IMPORTANT — this does NOT close the acceptance gap for large
        // intercept angles at close range (verified directly: 40deg/6nm,
        // 60deg/8nm, 90deg/8nm all still breach half/full scale by very
        // similar margins with or without this line). Root cause: in the
        // test geometry both this fix and rounds 1-2 use, capture happens at
        // t=0 with near-zero lateral deviation but the full heading/course
        // angle already present — at that instant the ARMED and CAPTURED
        // bank-command formulas are mathematically identical
        // (`2.0 * headingErrorDeg(course, heading)`), so no tracking-law
        // tuning changes the physical trajectory. The excursion is governed
        // by turn radius at `MAX_BANK_DEG` (25deg), not by any P/I/filter
        // term: at ~90kt/25deg bank the turn radius is ~460m, versus a
        // half-scale localizer width of only ~240m at 6nm and ~120m at 3nm —
        // a bank-limited 40-90deg turn that close to the antenna will
        // geometrically overshoot half (or full) scale under most any
        // control law. This looks like a real envelope limit of a 25deg
        // max-bank autopilot intercepting at those angles that close in, not
        // a fixable software defect — see the fix report's round 3
        // addendum and the escalation raised alongside it.
        state.navTrackFilteredDeviation = effectiveDeviation
      }
    } else {
      // Tracking (captured): see `NAV_INTERCEPT_GAIN_K_DEG`'s comment for the
      // first root-cause story (why this isn't a bare deviation PID) and the
      // comment just above that constant for the SECOND, independent fix
      // layered on top (the "desired heading" reframe converges by
      // construction but a long-run re-check found it only delays a growing
      // oscillation). Convert deviation into a bounded intercept-angle bias
      // off the course (`headingBugDeg`, the pilot's course reference — same
      // field the ARMED branch above flies toward) and hand the resulting
      // desired-heading error to the exact same heading-to-bank law HDG
      // uses, so tracking inherits HDG's already-validated convergence
      // instead of needing its own separately-tuned control law.
      const sign = state.lateralMode === 'BC' ? -1 : 1
      // ---- ROUND 4 (the fix that finally closed the coupled-descent bug):
      // range-normalize angular deviations. A localizer's full-scale width
      // is proportional to range, so a loop closed on the bare FRACTION has
      // physical gain growing ~1/range — the same bank produces an ever
      // larger fraction change as the beam narrows. Diagnosed via a 0°-
      // initial-error coupled GS-descent control case (tests/autopilot.test.ts,
      // "coupled GS-descent" block): absolute cross-track was CONVERGED
      // (8→4 m) at 8-11 km, then oscillated with growing physical amplitude
      // (±13, ±23, ±34, ±59 m) and shortening period as range fell through
      // ~7→2 km — textbook loss of gain margin, unfixable by any constant-
      // gain tuning (rounds 1-3 each fixed something real and left this).
      // Multiplying the fraction by range/REF freezes physical loop gain at
      // the known-good 8 km behavior for all ranges. It also dissolves the
      // round-2 near-antenna singularity for free: a fraction pinned at ±1
      // right at the station attenuates toward 0 as range→0 instead of
      // slamming the law. Fixed-width sources (GPS CDI) omit `navRangeM`
      // and keep factor 1 — their fraction is already physically uniform.
      const rangeFactor = navRangeFactor(inputs)
      const rawEffectiveDeviation = sign * inputs.navDeviation * rangeFactor
      // First tracking step: seed the P-term filter in the SAME (range-
      // scaled) domain the loop closes on — the capture-block seed uses the
      // unscaled ARMED-branch deviation, up to 2.5× off (review finding).
      if (!state.navTrackInitialized) state.navTrackFilteredDeviation = rawEffectiveDeviation
      // Deviation SLEW-RATE limit: a genuine ILS localizer's angular
      // sensitivity is inversely proportional to distance from the station,
      // and right at/very near the station itself the bearing-based
      // deviation computation is a true geometric singularity (bearing FROM
      // a point you're sitting on top of is undefined) — raw `navDeviation`
      // can swing across its entire range within a second or two purely
      // from proximity, not a control error. Confirmed directly: a long-run
      // (1200s) repro held a converged, sub-0.01 deviation for 10+ straight
      // minutes right up until the aircraft got within about a mile of the
      // threshold, at which point deviation snapped from small to
      // full-scale within 1-2 seconds — an order of magnitude faster than
      // anything seen during genuine track-law dynamics (which topped out
      // around 0.05-0.15 units/sec even while oscillating). Slew-limiting
      // the deviation the control law reacts to (rather than an instant
      // step) turns that glitch into a brief, bounded ramp. `0.5` units/sec
      // sits well above the ordinary-dynamics ceiling (never interferes
      // with legitimate response) and well below the near-antenna snap
      // rate.
      const NAV_DEVIATION_SLEW_RATE_PER_S = 0.5
      const effectiveDeviation = state.navTrackInitialized
        ? rateLimit(state.navTrackPrevDeviation, rawEffectiveDeviation, NAV_DEVIATION_SLEW_RATE_PER_S, dt)
        : rawEffectiveDeviation
      state.navTrackPrevDeviation = effectiveDeviation
      state.navTrackInitialized = true
      // Low-pass the deviation fed to the P term (see the constant-block
      // comment above `NAV_MAX_INTERCEPT_DEG` for why): slows the outer
      // loop's response just enough to stop exciting the lightly-damped
      // slow mode a bare instantaneous P term rings at.
      const P_FILTER_TAU_S = 5
      const pAlpha = dt > 1e-6 ? clamp(dt / P_FILTER_TAU_S, 0, 1) : 0
      state.navTrackFilteredDeviation += (effectiveDeviation - state.navTrackFilteredDeviation) * pAlpha
      // Genuine integral term: nulls the small sustained bias a pure-P law
      // leaves uncorrected forever (see the constant-block comment).
      const NAV_INTEGRAL_GAIN_K_DEG_PER_UNIT_S = 0.2
      const NAV_INTEGRAL_MAX = 85
      state.navTrackIntegral = clamp(state.navTrackIntegral + effectiveDeviation * dt, -NAV_INTEGRAL_MAX, NAV_INTEGRAL_MAX)
      // Dynamic cap: while heading is already close to the course AND the
      // integrator hasn't wound up much (i.e. no evidence of a persistent,
      // real error), keep the bias tight — this is what actually protects
      // against the near-antenna geometric glitch above turning into a
      // large, wrong control input. It reopens automatically once the
      // integrator shows a genuinely sustained deviation (see the
      // constant-block comment for why using integrator wind-up, not a
      // fixed cap, avoids permanently ignoring a real, persistent error).
      const headingAlignErrorDeg = Math.abs(headingErrorDeg(inputs.headingBugDeg, inputs.headingDeg))
      const windUpImpliedDeg = Math.abs(state.navTrackIntegral) * NAV_INTEGRAL_GAIN_K_DEG_PER_UNIT_S
      const dynamicMaxInterceptDeg = clamp(Math.max(headingAlignErrorDeg * 2, windUpImpliedDeg), 3, NAV_MAX_INTERCEPT_DEG)
      // Positive deviation = right of course -> need a left (negative)
      // intercept-angle bias to converge, hence the negation.
      const rawInterceptOffsetDeg = clamp(
        -(NAV_INTERCEPT_GAIN_K_DEG * state.navTrackFilteredDeviation + NAV_INTEGRAL_GAIN_K_DEG_PER_UNIT_S * state.navTrackIntegral),
        -dynamicMaxInterceptDeg, dynamicMaxInterceptDeg,
      )
      // Rate-limit the commanded bias itself too — belt-and-suspenders
      // against the same near-antenna glitch (independent of the deviation
      // slew-limit above, which protects the P/I *inputs*; this protects
      // the *output* actually handed to the heading-to-bank law).
      state.navTrackInterceptOffsetDeg = rateLimit(state.navTrackInterceptOffsetDeg, rawInterceptOffsetDeg, 3, dt)
      const interceptOffsetDeg = state.navTrackInterceptOffsetDeg
      const desiredHeadingDeg = (inputs.headingBugDeg + interceptOffsetDeg + 360) % 360
      // Steer the ground TRACK (when available) onto course+intercept —
      // see `trackDeg`'s doc: crab falls out physically under wind.
      const refDeg = inputs.trackDeg ?? inputs.headingDeg
      targetBankDeg = clamp(2.0 * headingErrorDeg(desiredHeadingDeg, refDeg), -MAX_BANK_DEG, MAX_BANK_DEG)
    }
  }
  state.fdBankDeg = targetBankDeg

  // ================= VERTICAL =================
  // Overlay-capture pattern: ALTS and GS are "armed" wrappers around an
  // underlying flying mode (VS/FLC/PIT) rather than control laws of their
  // own. GS never renames `state.verticalMode` — it only flips
  // `verticalArmed` off once captured, so the caller-vs-internal mode name
  // always agree and the change-detector below just works. ALTS instead
  // *renames* `state.verticalMode` to `'ALT'` on capture (see below), and a
  // real mode-select button's state doesn't revert itself just because the
  // AP captured — a caller can go right on sending `verticalMode: 'ALTS'`
  // every subsequent frame. Comparing that against `lastCommandedVerticalMode`
  // naively would see a mismatch every frame post-capture and re-arm ALTS,
  // recomputing `targetPitchDeg` from the stale underlying VS/FLC/PIT law
  // before immediately re-capturing back to `'ALT'` within the same step —
  // silently reintroducing the old climb/descent command while
  // `state.verticalMode` still reads `'ALT'` to anything checking afterward.
  // `altsCaptured` tracks "has this specific ALTS arm already captured"
  // independently of the mode-name comparison, so a repeated `'ALTS'` input
  // post-capture is recognized as the selector holding steady rather than a
  // new arm request; it's cleared whenever a genuinely new mode is selected
  // (including a fresh ALTS re-arm).
  if (inputs.verticalMode !== state.lastCommandedVerticalMode) {
    const isReassertingCapturedAlts = inputs.verticalMode === 'ALTS' && state.altsCaptured
    state.lastCommandedVerticalMode = inputs.verticalMode
    if (!isReassertingCapturedAlts) {
      state.verticalMode = inputs.verticalMode
      state.verticalArmed = inputs.verticalMode === 'ALTS' || inputs.verticalMode === 'GS'
      state.altsCaptured = false
    }
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
        state.altsCaptured = true
        state.lastCommandedVerticalMode = 'ALT'
      }
    }
  } else {
    // GS
    if (state.verticalArmed) {
      targetPitchDeg = verticalPitchTarget(underlying, state, dt, inputs)
      trimEligible = underlying !== 'PIT'
      // GS capture is interlocked behind LOC capture (real GFC700
      // sequencing): while the localizer is un-captured the aircraft can
      // cross the beam cone far off-axis, where glideslope deviation is
      // geometric garbage — capturing on one momentary near-zero reading
      // there dove an EGLL acceptance flight at 3800 fpm. `lateralArmed`
      // false alone isn't enough (it's false in HDG/ROL too), so the
      // lateral mode must actually be APR.
      const locCaptured = state.lateralMode === 'APR' && !state.lateralArmed
      if (locCaptured && Math.abs(inputs.glideslopeDeviation) <= CAPTURE_FRACTION) {
        state.verticalArmed = false
      }
    } else {
      // Positive deviation = above glidepath -> need to pitch down, hence
      // the negated error.
      // Range-normalized like the lateral law (§ same angular-beam physics)
      // + integrator authority raised 0.5°→3° (ki·iMax): a 15 kt tailwind
      // needs a steeper path whose steady pitch offset the old 0.5° could
      // never null — the narrowing beam then amplified the standoff to
      // 0.53 fraction near DH (reviewer finding, now a regression test).
      targetPitchDeg = clamp(
        pidUpdate(state.gsPitch, -inputs.glideslopeDeviation * navRangeFactor(inputs), dt, 6, 0.5, 1, 6),
        -MAX_PITCH_CMD_DEG, MAX_PITCH_CMD_DEG,
      )
      trimEligible = true
    }
  }
  state.fdPitchDeg = targetPitchDeg

  // ================= INNER ATTITUDE LOOPS -> CONTROL SURFACES =================
  // Bank loop uses derivative-ON-MEASUREMENT (see `pidUpdateOnMeasurement`)
  // — its target (`targetBankDeg` above) tracks a continuously-shrinking
  // heading error, not a one-time step, and differentiating the raw error
  // was found to inject a destabilizing "derivative kick" from the target's
  // own motion (Finding B, see the function's doc comment and the fix
  // report). kd raised 0.01 -> 0.4 and iMax tightened 30 -> 3 (ki 0.03 ->
  // 0.005) — empirically tuned against the real `Aircraft` model's actual
  // roll response (a full-aileron step produces ~40-50 deg/s roll rate, far
  // more authority than the old, tiny kd could arrest before overshoot; the
  // old iMax=30/ki=0.03 combination could also wind up ~0.9 of full control
  // authority during a large, sustained heading error, adding to the
  // overshoot once the target passed). See fix report for before/after
  // convergence numbers across 20/40/60/180 deg initial errors.
  const bankError = targetBankDeg - inputs.rollDeg
  const rawRoll = clamp(pidUpdateOnMeasurement(state.bankAttitude, bankError, inputs.rollDeg, dt, 0.05, 0.005, 0.4, 3) * gain, -1, 1)

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
