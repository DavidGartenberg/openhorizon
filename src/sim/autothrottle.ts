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
 */

export type AtMode = 'OFF' | 'ARM' | 'MCP SPD' | 'N1' | 'RETARD'

export interface AtState {
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

export function makeAutothrottle(): AtState {
  return { mode: 'OFF', engaged: false, cmd: 0, iasRate: 0, lastIas: Number.NaN, disconnectLight: false }
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
const KI = 0.0018 // lever per kt per s
const KD = 0.035 // lever per (kt/s)
const SLEW = 0.12 // lever per s
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
  if (!s.engaged && !i.disconnectPressed && !i.onGround && (i.speedPressed || (i.pitchModeActive && !s.disconnectLight))) {
    s.engaged = true
    s.cmd = i.lever
    s.iasRate = 0
  }
  if (!s.engaged) { s.mode = 'ARM'; return null }

  const flc = i.verticalMode === 'FLC' || i.verticalMode === 'IAS'
  let target: number
  if (flc && i.selectedAltFt > i.altitudeFt + 100) {
    s.mode = 'N1'
    target = AT_CLIMB_LIMIT
  } else if (flc && i.selectedAltFt < i.altitudeFt - 100) {
    s.mode = s.cmd > 0.02 ? 'RETARD' : 'ARM'
    target = 0
  } else {
    s.mode = 'MCP SPD'
    const err = i.targetKt - i.iasKt
    target = s.cmd + (KI * err - KD * s.iasRate) * dt
  }
  const step = Math.max(-SLEW * dt, Math.min(SLEW * dt, target - s.cmd))
  s.cmd = Math.max(0, Math.min(AT_CLIMB_LIMIT, s.cmd + step))
  return s.cmd
}
