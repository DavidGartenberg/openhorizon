/** Captain controls, independent of DOM/hardware. Engine starts and brake
 * demands are deliberately simplified, not aircraft-specific certified logic.
 * The two masters control equal engine groups; physics retains shared N1 and
 * aggregate thrust, with no asymmetric engine-out yaw or separate fuel tanks. */
export type IgnitionMode = 'crank' | 'norm' | 'start'
export type AutobrakeMode = 'off' | 'low' | 'medium' | 'max' | 'rto'

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
  autobrakeMode: AutobrakeMode
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
}

export function createCaptainSystems(running = true): CaptainSystemsState {
  return {
    engineMaster1: running, engineMaster2: running, ignitionMode: 'norm',
    engine1Running: running, engine2Running: running, engine1StartS: 0, engine2StartS: 0,
    enginePowerFraction: running ? 1 : 0, rudderTrim: 0,
    autobrakeMode: 'off', autobrakeDemand: 0, autobrakeActive: false,
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

  s.autobrakeMode = input.autobrakeMode ?? s.autobrakeMode
  if (s.autobrakeMode !== previous.autobrakeMode) {
    s.autobrakeDisarmed = false
    s.autobrakeActive = false
    s.rtoArmed = false
    s.landingArmed = false
  }
  s.autobrakeDemand = 0
  const speed = Number.isFinite(input.groundSpeedKt) ? Math.max(0, input.groundSpeedKt) : 0
  if (s.autobrakeMode === 'off') {
    s.autobrakeActive = s.landingArmed = s.rtoArmed = false
    return s
  }
  // Pilot intervention inhibits the latched selector until deliberately cycled.
  if (input.manualBrake > 0.05 || (s.autobrakeActive && input.throttle > 0.15)) {
    s.autobrakeDisarmed = true
    s.autobrakeActive = s.landingArmed = s.rtoArmed = false
  }
  if (s.autobrakeDisarmed) return s
  if (s.autobrakeMode === 'rto') {
    if (!input.onGround) s.rtoArmed = s.autobrakeActive = false
    else {
      if (input.throttle >= 0.8 && speed >= 40) s.rtoArmed = true
      if (s.rtoArmed && input.throttle <= 0.1 && speed >= 40) s.autobrakeActive = true
    }
  } else {
    if (!input.onGround) {
      s.landingArmed = true
      s.autobrakeActive = false
    } else if (s.landingArmed && speed >= 30 && input.throttle <= 0.1) {
      s.autobrakeActive = true
    }
  }
  if (input.onGround && speed < 5 && s.autobrakeActive) {
    s.autobrakeActive = s.landingArmed = s.rtoArmed = false
    s.autobrakeDisarmed = true
  }
  if (s.autobrakeActive && input.onGround && speed >= 5 && input.throttle <= 0.1) {
    s.autobrakeDemand = s.autobrakeMode === 'low' ? 0.25 : s.autobrakeMode === 'medium' ? 0.5 : 1
  }
  return s
}
