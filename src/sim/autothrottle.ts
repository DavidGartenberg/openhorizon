/**
 * 737NG autothrottle (A/T) — pure. Modes follow the 737NG FCOM pattern:
 *
 *  - A/T ARM switch OFF → OFF (no command, levers are the pilot's).
 *  - ARM switch ON, not engaged → ARM.
 *  - Engaged with the MCP SPEED button (or automatically once a pitch mode
 *    is flown with the switch armed):
 *      · LVL CHG (MCP-speed-on-pitch, this AP's FLC) climbing → N1
 *        (climb-limit thrust; pitch holds the speed),
 *      · LVL CHG descending → RETARD (levers to idle) then ARM,
 *      · any other pitch mode (ALT HOLD, V/S, G/S, …) → MCP SPD: the
 *        levers hold the MCP speed.
 *  - Pilot lever movement against the servo, the A/T disconnect switch, or
 *    the ARM switch going OFF disconnects; a disconnect latches the red
 *    flashing A/T P/RST light until reset.
 *
 * The speed loop is velocity-form PI on IAS error with speed-rate damping
 * (dU/dt = Ki·err − Kd·dIAS/dt), slew-limited like the real servo, which is
 * robust to engine spool lag and needs no trim-throttle guess.
 *
 * Fitment (`atFitment`): airliners and the bizjets that carry a real A/T are
 * 'full'. Every other powered airplane (turboprops, light jets, pistons) has
 * no autothrottle in real life; the same speed-hold law is offered there as a
 * labelled ASSIST ('assist'), tuned per powerplant class (`atGainsFor`) and
 * engaged without needing the autopilot, like the MSFS auto-throttle assist.
 * Gliders and unpowered airframes get 'none'.
 */

export type AtMode = 'OFF' | 'ARM' | 'MCP SPD' | 'N1' | 'RETARD'

/** Servo/loop tuning for one powerplant class. */
export interface AtGains {
  /** Lever per kt of IAS error per second (integral action). */
  ki: number
  /** Lever per (kt/s) of IAS rate (damping). */
  kd: number
  /** Servo slew, lever per second. */
  slew: number
  /** Lever position flown in a climb (N1 / climb power). */
  climbLimit: number
}

export const AT_GAINS_JET: AtGains = { ki: 0.0018, kd: 0.035, slew: 0.12, climbLimit: 0.94 }
// Closed-loop sweeps (tests/autothrottle-fleet.test.ts) show one gain set holds
// speed on a 172, a 1900-class twin, a TBM, a light jet and the 737. Power
// levers on props have no N1 climb limit, so they may use the whole travel.
export const AT_GAINS_TURBOPROP: AtGains = { ki: 0.0018, kd: 0.035, slew: 0.12, climbLimit: 1 }
export const AT_GAINS_PISTON: AtGains = { ki: 0.0018, kd: 0.035, slew: 0.12, climbLimit: 1 }

export type AtFitment = 'full' | 'assist' | 'none'

/** Whether this airplane has a real autothrottle, an assist, or nothing.
 *  `kind` is the roster powerplant kind ('jet' | 'turboprop' | 'piston' |
 *  'none'); `deckHasAt` is the cockpit profile's real-A/T flag. */
export function atFitment(kind: string, deckHasAt: boolean, fuelCapacityKg: number): AtFitment {
  if (kind === 'none' || !(fuelCapacityKg >= 1)) return 'none'
  return deckHasAt ? 'full' : 'assist'
}

export function atGainsFor(kind: string): AtGains {
  return kind === 'jet' ? AT_GAINS_JET : kind === 'turboprop' ? AT_GAINS_TURBOPROP : AT_GAINS_PISTON
}

export interface AtState {
  gains: AtGains
  mode: AtMode
  engaged: boolean
  /** Last lever position the servo commanded (for override detection). */
  cmd: number
  /** Filtered IAS rate, kt/s. */
  iasRate: number
  lastIas: number
  /** Red A/T P/RST light: latched by any disconnect until reset. */
  disconnectLight: boolean
}

export function makeAutothrottle(gains: AtGains = AT_GAINS_JET): AtState {
  return { gains, mode: 'OFF', engaged: false, cmd: 0, iasRate: 0, lastIas: Number.NaN, disconnectLight: false }
}

export interface AtInputs {
  armSwitch: boolean
  /** MCP SPEED button pressed this frame. */
  speedPressed?: boolean
  /** A/T disconnect switch on the thrust lever pressed this frame. */
  disconnectPressed?: boolean
  /** A/T P/RST light pressed this frame (clears the disconnect light). */
  resetLight?: boolean
  iasKt: number
  targetKt: number
  /** Engage as soon as the airplane is airborne with the switch on, with no
   *  autopilot needed (the assist on airplanes that have no real A/T). */
  engageAirborne?: boolean
  /** Autopilot pitch mode this frame. */
  verticalMode: string
  /** AP or FD engaged (A/T auto-engages with a flown pitch mode). */
  pitchModeActive: boolean
  altitudeFt: number
  selectedAltFt: number
  onGround: boolean
  /** The lever position actually in effect this frame (pilot or servo). */
  lever: number
}

export const AT_CLIMB_LIMIT = 0.94
const OVERRIDE = 0.04 // lever travel against the servo that disconnects

function disconnect(s: AtState): void {
  if (s.engaged) s.disconnectLight = true
  s.engaged = false
}

/** Step the A/T. Returns the lever command, or null when the A/T is not
 *  driving the levers this frame. */
export function stepAutothrottle(s: AtState, dt: number, i: AtInputs): number | null {
  if (i.resetLight) s.disconnectLight = false
  // Speed-rate estimate (≈1.5 s filter). Samples are clamped to what an
  // airplane can physically do (±10 kt/s) so a sensor step — e.g. the
  // first frame after a respawn — can't slam the levers.
  if (Number.isFinite(s.lastIas) && dt > 0) {
    const sample = Math.max(-10, Math.min(10, (i.iasKt - s.lastIas) / dt))
    s.iasRate += (sample - s.iasRate) * Math.min(1, dt / 1.5)
  }
  s.lastIas = i.iasKt

  if (!i.armSwitch) { disconnect(s); s.mode = 'OFF'; return null }
  if (s.engaged && (i.disconnectPressed || Math.abs(i.lever - s.cmd) > OVERRIDE)) disconnect(s)
  if (!s.engaged && !i.disconnectPressed && !i.onGround && (i.speedPressed || ((i.pitchModeActive || i.engageAirborne) && !s.disconnectLight))) {
    s.engaged = true
    s.cmd = i.lever
    s.iasRate = 0
  }
  if (!s.engaged) { s.mode = 'ARM'; return null }

  const flc = i.verticalMode === 'FLC' || i.verticalMode === 'IAS'
  let target: number
  if (flc && i.selectedAltFt > i.altitudeFt + 100) {
    s.mode = 'N1'
    target = s.gains.climbLimit
  } else if (flc && i.selectedAltFt < i.altitudeFt - 100) {
    s.mode = s.cmd > 0.02 ? 'RETARD' : 'ARM'
    target = 0
  } else {
    s.mode = 'MCP SPD'
    const err = i.targetKt - i.iasKt
    target = s.cmd + (s.gains.ki * err - s.gains.kd * s.iasRate) * dt
  }
  const step = Math.max(-s.gains.slew * dt, Math.min(s.gains.slew * dt, target - s.cmd))
  s.cmd = Math.max(0, Math.min(s.gains.climbLimit, s.cmd + step))
  return s.cmd
}
