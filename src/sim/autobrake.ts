/**
 * Boeing-737-style autobrake (pure).
 *
 * Selector positions, in knob order: RTO · OFF · 1 · 2 · 3 · MAX.
 *
 *  - 1/2/3/MAX (landing): armed from selection. It does nothing until the
 *    airplane has actually flown and touched down, then applies once the thrust
 *    levers are at idle and holds a target DECELERATION (not a fixed brake
 *    pressure): other retarding forces — ground spoilers, reversers — are
 *    measured and the brakes back off by exactly that much.
 *  - RTO: armed on the ground; once takeoff power has been seen, retarding the
 *    thrust levers to idle above 85 kt applies full braking.
 *  - Disarms (with the AUTO BRAKE DISARM light) when the pilot brakes, advances
 *    the thrust levers, or — for a landing setting — stows the speedbrake after
 *    deploying it. Selecting a position again re-arms it. Below 5 kt it
 *    releases and disarms quietly.
 *
 * The target rates are the approximate published 737NG values (1 ≈ 4, 2 ≈ 5,
 * 3 ≈ 7.2, MAX ≈ 14 ft/s²) — recorded as approximations, not type-certified
 * numbers; MAX is limited in practice by what the brakes can deliver.
 */

export type AutobrakeSetting = 'rto' | 'off' | '1' | '2' | '3' | 'max'
/** Knob order on the 737 main panel. */
export const AUTOBRAKE_SETTINGS: readonly AutobrakeSetting[] = ['rto', 'off', '1', '2', '3', 'max']

const FT = 0.3048
export const AUTOBRAKE_TARGET_MS2: Record<'1' | '2' | '3' | 'max', number> = {
  '1': 4 * FT, '2': 5 * FT, '3': 7.2 * FT, max: 14 * FT,
}

export type AutobrakePhase = 'off' | 'armed' | 'active' | 'disarmed'

export interface AutobrakeState {
  setting: AutobrakeSetting
  phase: AutobrakePhase
  /** Brake demand [0,1] to add to the pilot's brakes. */
  demand: number
  /** Filtered measured deceleration, m/s². */
  decelMs2: number
  /** AUTO BRAKE DISARM light (a deliberate or automatic disarm, not a quiet release). */
  disarmLight: boolean
  reason: string
  prevSpeedMs: number | null
  integ: number
  /** The airplane has flown since this was selected: a landing is coming. */
  airborneSeen: boolean
  /** Takeoff power has been seen on this ground run (RTO). */
  powerSeen: boolean
  /** The speedbrake has been deployed on this rollout. */
  spoilerSeen: boolean
}

export interface AutobrakeInput {
  dt: number
  onGround: boolean
  groundSpeedMs: number
  /** Thrust lever, 0 (idle) … 1. */
  throttle: number
  /** Reverse thrust selected (the thrust lever then reads high but is not "advanced"). */
  reverse: boolean
  /** Larger of the pilot's two pedals, 0…1. */
  pilotBrake: number
  /** Speedbrake position, 0…1. */
  spoilerPos: number
  /** Deceleration full brakes give on this airplane, m/s² (feed-forward). */
  maxBrakeDecelMs2: number
}

const KT = 0.514444
const IDLE = 0.08
const POWER = 0.6
const RTO_MIN_SPEED_MS = 85 * KT
const RELEASE_MS = 5 * KT
const PILOT_BRAKE_DISARM = 0.25
const THRUST_DISARM = 0.25
const KP = 0.08
const KI = 0.12
const INTEG_LIMIT = 0.6
const DECEL_TAU_S = 0.4
const SLEW_UP_PER_S = 1.5
const SLEW_DOWN_PER_S = 4

export function makeAutobrake(): AutobrakeState {
  return {
    setting: 'off', phase: 'off', demand: 0, decelMs2: 0, disarmLight: false, reason: '',
    prevSpeedMs: null, integ: 0, airborneSeen: false, powerSeen: false, spoilerSeen: false,
  }
}

/** Accepts the older controller-preset names (low = 1, medium = 2). */
export function normalizeAutobrakeSetting(v: string): AutobrakeSetting | null {
  const s = String(v).trim().toLowerCase()
  if (s === 'low') return '1'
  if (s === 'medium') return '2'
  return (AUTOBRAKE_SETTINGS as readonly string[]).includes(s) ? (s as AutobrakeSetting) : null
}

/** Move the selector. Re-arms after a disarm and clears the light. */
export function selectAutobrake(s: AutobrakeState, setting: AutobrakeSetting): AutobrakeState {
  return {
    ...s, setting, phase: setting === 'off' ? 'off' : 'armed', demand: 0, integ: 0, disarmLight: false, reason: '',
    airborneSeen: setting === 'off' ? false : s.airborneSeen, powerSeen: false, spoilerSeen: false,
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

function slew(prev: number, target: number, dt: number): number {
  return target > prev ? Math.min(target, prev + SLEW_UP_PER_S * dt) : Math.max(target, prev - SLEW_DOWN_PER_S * dt)
}

export function stepAutobrake(prev: AutobrakeState, i: AutobrakeInput): AutobrakeState {
  if (!(i.dt > 0) || !Number.isFinite(i.dt)) return prev
  const s: AutobrakeState = { ...prev }
  const speed = Number.isFinite(i.groundSpeedMs) ? Math.max(0, i.groundSpeedMs) : (prev.prevSpeedMs ?? 0)
  const throttle = Number.isFinite(i.throttle) ? i.throttle : 0
  const pilot = Number.isFinite(i.pilotBrake) ? i.pilotBrake : 0
  // Deceleration the airplane is really achieving, from ground speed alone.
  if (prev.prevSpeedMs !== null) {
    const raw = (prev.prevSpeedMs - speed) / i.dt
    s.decelMs2 = prev.decelMs2 + (raw - prev.decelMs2) * (i.dt / (DECEL_TAU_S + i.dt))
  }
  s.prevSpeedMs = speed

  if (s.setting === 'off' || s.phase === 'off') { s.phase = 'off'; s.demand = 0; return s }
  if (!i.onGround) { s.airborneSeen = true; s.powerSeen = false; s.spoilerSeen = false }
  if (s.phase === 'disarmed') { s.demand = 0; return s }

  const rto = s.setting === 'rto'
  if (rto && i.onGround && throttle >= POWER) s.powerSeen = true
  if (i.onGround && i.spoilerPos > 0.5) s.spoilerSeen = true

  const idle = throttle <= IDLE
  const wantsApply = i.onGround && idle && (rto ? s.powerSeen && speed >= RTO_MIN_SPEED_MS : s.airborneSeen)
  if (s.phase === 'armed') {
    if (wantsApply) {
      s.phase = 'active'; s.integ = 0
      // The deceleration measured so far is the flare/touchdown transient, not braking:
      // start from the feed-forward (as if on target) instead of reacting to it.
      s.decelMs2 = rto ? 0 : AUTOBRAKE_TARGET_MS2[s.setting as '1' | '2' | '3' | 'max']
    } else { s.demand = 0; return s }
  }

  // ---- active ----
  const disarm = (reason: string): AutobrakeState => ({ ...s, phase: 'disarmed', demand: 0, integ: 0, disarmLight: true, reason })
  if (!i.onGround) return { ...s, phase: 'armed', demand: 0, integ: 0 } // bounce: release, re-apply on touchdown
  if (pilot >= PILOT_BRAKE_DISARM) return disarm('PILOT BRAKES')
  if (throttle > THRUST_DISARM && !i.reverse) return disarm('THRUST LEVERS ADVANCED')
  if (!rto && s.spoilerSeen && i.spoilerPos < 0.2) return disarm('SPEEDBRAKE STOWED')
  if (speed < RELEASE_MS) return { ...s, phase: 'disarmed', demand: 0, integ: 0, disarmLight: false, reason: 'STOPPED' }

  if (rto) { s.demand = slew(prev.demand, 1, i.dt); return s }

  const target = AUTOBRAKE_TARGET_MS2[s.setting as '1' | '2' | '3' | 'max']
  const bMax = Math.max(0.5, Number.isFinite(i.maxBrakeDecelMs2) ? i.maxBrakeDecelMs2 : 4)
  const err = target - s.decelMs2
  s.integ = clamp(prev.integ + KI * err * i.dt, -INTEG_LIMIT, INTEG_LIMIT)
  const wanted = clamp(target / bMax + KP * err + s.integ, 0, 1)
  s.demand = slew(prev.demand, wanted, i.dt)
  return s
}
