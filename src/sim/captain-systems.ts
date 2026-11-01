/** Captain controls, independent of DOM/hardware. Engine starts are
 * deliberately simplified, not aircraft-specific certified logic; the autobrake
 * is the 737-style deceleration controller in sim/autobrake.ts.
 * The two masters control equal engine groups; physics retains shared N1 and
 * aggregate thrust, with no asymmetric engine-out yaw or separate fuel tanks. */
export type IgnitionMode = 'crank' | 'norm' | 'start'
import { makeAutobrake, normalizeAutobrakeSetting, selectAutobrake, stepAutobrake, type AutobrakeSetting, type AutobrakeState } from './autobrake'

/** Selector positions; 'low' and 'medium' are the older controller-preset names for 1 and 2. */
export type AutobrakeMode = AutobrakeSetting | 'low' | 'medium'

export interface CaptainSystemsState {
  engineMaster1: boolean
  engineMaster2: boolean
  ignitionMode: IgnitionMode
  engine1Running: boolean
  engine2Running: boolean
  engine1StartS: number
  engine2StartS: number
  enginePowerFraction: number
  /** Add to pedal yaw then clamp [-1,1], for physics AND rendered rudder. */
  rudderTrim: number
  /** Normalised selector position (never 'low'/'medium'). */
  autobrakeMode: AutobrakeSetting
  /** The controller itself (sim/autobrake.ts); the fields below mirror it. */
  autobrake: AutobrakeState
  autobrakeDemand: number
  autobrakeActive: boolean
  autobrakeDisarmed: boolean
  landingArmed: boolean
  rtoArmed: boolean
}

export interface CaptainSystemsInput {
  /** Undefined leaves a latched command unchanged (disconnect is not OFF). */
  engineMaster1?: boolean
  engineMaster2?: boolean
  ignitionMode?: IgnitionMode
  autobrakeMode?: AutobrakeMode
  trimLeft?: boolean
  trimRight?: boolean
  trimReset?: boolean
  fuelAvailable: boolean
  electricalPower: boolean
  onGround: boolean
  groundSpeedKt: number
  throttle: number
  /** Maximum of the pilot's left/right brake, before adding autobrake. */
  manualBrake: number
  /** Speedbrake position 0…1, reverse selected, and the deceleration full brakes
   *  give (m/s²) — what the autobrake needs to hold a deceleration. */
  spoilerPos?: number
  reverse?: boolean
  maxBrakeDecelMs2?: number
}

export function createCaptainSystems(running = true): CaptainSystemsState {
  return {
    engineMaster1: running, engineMaster2: running, ignitionMode: 'norm',
    engine1Running: running, engine2Running: running, engine1StartS: 0, engine2StartS: 0,
    enginePowerFraction: running ? 1 : 0, rudderTrim: 0,
    autobrakeMode: 'off', autobrake: makeAutobrake(), autobrakeDemand: 0, autobrakeActive: false,
    autobrakeDisarmed: false, landingArmed: false, rtoArmed: false,
  }
}

/** Pure transition. Call once per simulation tick. START takes six seconds
 * with power/fuel; CRANK cannot light fuel, NORM sustains a running engine. */
export function stepCaptainSystems(previous: CaptainSystemsState, input: CaptainSystemsInput, dt: number): CaptainSystemsState {
  const s = { ...previous }
  const elapsed = Number.isFinite(dt) ? Math.max(dt, 0) : 0
  s.engineMaster1 = input.engineMaster1 ?? s.engineMaster1
  s.engineMaster2 = input.engineMaster2 ?? s.engineMaster2
  s.ignitionMode = input.ignitionMode ?? s.ignitionMode
  for (const engine of [1, 2] as const) {
    const master = engine === 1 ? s.engineMaster1 : s.engineMaster2
    const runningKey = engine === 1 ? 'engine1Running' : 'engine2Running'
    const timeKey = engine === 1 ? 'engine1StartS' : 'engine2StartS'
    if (!master || !input.fuelAvailable) s[runningKey] = false
    if (!s[runningKey] && master && input.fuelAvailable && input.electricalPower && s.ignitionMode === 'start') {
      s[timeKey] = Math.min(s[timeKey] + elapsed, 6)
      if (s[timeKey] >= 6) s[runningKey] = true
    } else s[timeKey] = 0
  }
  s.enginePowerFraction = (Number(s.engine1Running) + Number(s.engine2Running)) / 2
  s.rudderTrim = input.trimReset ? 0 : Math.min(0.3, Math.max(-0.3,
    s.rudderTrim + (Number(!!input.trimRight) - Number(!!input.trimLeft)) * elapsed * 0.04))

  let ab = previous.autobrake
  const requested = input.autobrakeMode === undefined ? null : normalizeAutobrakeSetting(input.autobrakeMode)
  if (requested && requested !== ab.setting) ab = selectAutobrake(ab, requested)
  ab = stepAutobrake(ab, {
    dt: elapsed, onGround: input.onGround,
    groundSpeedMs: (Number.isFinite(input.groundSpeedKt) ? Math.max(0, input.groundSpeedKt) : 0) * 0.514444,
    throttle: input.throttle, reverse: !!input.reverse, pilotBrake: input.manualBrake,
    spoilerPos: input.spoilerPos ?? 0, maxBrakeDecelMs2: input.maxBrakeDecelMs2 ?? 4,
  })
  s.autobrake = ab
  s.autobrakeMode = ab.setting
  s.autobrakeDemand = ab.demand
  s.autobrakeActive = ab.phase === 'active'
  s.autobrakeDisarmed = ab.phase === 'disarmed'
  s.landingArmed = ab.phase === 'armed' && ab.airborneSeen && ab.setting !== 'rto'
  s.rtoArmed = ab.setting === 'rto' && ab.powerSeen && ab.phase !== 'disarmed'
  return s
}
