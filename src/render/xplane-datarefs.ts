/**
 * What the X-Plane 737 flight deck is told, as X-Plane datarefs (pure).
 *
 * The cockpit OBJ files animate every lever, knob, needle and lamp from named
 * datarefs. This maps this simulator's real state onto those names — nothing
 * here is decoration: a lever moves because its sim value moved. A dataref
 * the simulator has no state for reads its resting value (0, "released", or
 * the normal in-flight switch position) and is listed in the mapping notes in
 * PROGRESS.md; none of them is faked as live.
 */

export interface XpCockpitInputs {
  // flight controls, −1…1 (pitch + = pull, roll + = right, yaw + = right pedal)
  pitch: number
  roll: number
  yaw: number
  /** Toe brakes 0…1 and the parking brake. */
  brakeLeft: number
  brakeRight: number
  parkingBrake: boolean
  /** Stabilizer trim −1…1 (+ = nose up) and rudder trim −1…1. */
  trim: number
  rudderTrim: number
  // levers
  throttle: [number, number]
  reverse: [number, number]
  /** Flap handle detent index, actual flap angle (deg) and this airplane's detents. */
  flapsHandleIndex: number
  flapsDeg: number
  flapDetentsDeg: readonly number[]
  gearHandleDown: boolean
  /** Speedbrake deployed 0…1 and the ARM lever position. */
  speedbrake: number
  speedbrakeArmed: boolean
  engineRunning: [boolean, boolean]
  /** Autobrake selector: rto · off · 1 · 2 · 3 · max. */
  autobrake: string
}

export function defaultXpInputs(): XpCockpitInputs {
  return {
    pitch: 0, roll: 0, yaw: 0, brakeLeft: 0, brakeRight: 0, parkingBrake: false, trim: 0, rudderTrim: 0,
    throttle: [0, 0], reverse: [0, 0], flapsHandleIndex: 0, flapsDeg: 0, flapDetentsDeg: [0], gearHandleDown: true,
    speedbrake: 0, speedbrakeArmed: false, engineRunning: [true, true], autobrake: 'off',
  }
}

const AUTOBRAKE_INDEX: Record<string, number> = { rto: 0, off: 1, '1': 2, '2': 3, '3': 4, max: 5 }
const clamp = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0)

/** The handle's place along its detents: 0 at the first, 1 at the last. */
export function flapHandleRatio(index: number, detents: readonly number[]): number {
  const n = detents.length - 1
  return n <= 0 ? 0 : clamp(index, 0, n) / n
}

/** Where the flap position needle is: the actual angle placed between its detents. */
function flapNeedleRatio(deg: number, detents: readonly number[]): number {
  const n = detents.length - 1
  if (n <= 0 || !Number.isFinite(deg)) return 0
  if (deg <= detents[0]!) return 0
  for (let i = 0; i < n; i++) {
    const a = detents[i]!, b = detents[i + 1]!
    if (deg <= b) return (i + (b === a ? 0 : (deg - a) / (b - a))) / n
  }
  return 1
}

/** 737 speedbrake lever: DOWN 0, ARM ≈ 0.089, the flight detent at 0.667, UP 1. */
export function speedbrakeLeverRatio(deployed: number, armed: boolean): number {
  const d = clamp(deployed, 0, 1)
  const ARM = 0.0889
  if (d > 0.02) return ARM + d * (1 - ARM)
  return armed ? ARM : 0
}

/** Gear handle: 0 = UP, 0.5 = OFF, 1 = DN. */
export function gearHandleRatio(down: boolean): number { return down ? 1 : 0 }

/**
 * `overrides` is for verification only (look at a control at an extreme, or
 * prove a sign): any name in it wins over the sim-derived value.
 */
export function makeXpDatarefReader(s: XpCockpitInputs, overrides: Record<string, number> = {}): (dataref: string) => number {
  const engine = (ref: string): number => Number(/\[(\d+)\]/.exec(ref)?.[1] ?? 0)
  return (ref: string): number => {
    if (Object.prototype.hasOwnProperty.call(overrides, ref)) return overrides[ref]!
    switch (ref) {
      // ---- yoke, pedals, brakes, trim
      case 'sim/cockpit2/controls/total_pitch_ratio': return clamp(s.pitch, -1, 1)
      case 'sim/cockpit2/controls/total_roll_ratio': return clamp(s.roll, -1, 1)
      case 'sim/cockpit2/controls/yoke_heading_ratio': return clamp(s.yaw, -1, 1)
      case 'sim/cockpit2/controls/left_brake_ratio': return clamp(s.brakeLeft, 0, 1)
      case 'sim/cockpit2/controls/right_brake_ratio': return clamp(s.brakeRight, 0, 1)
      case 'laminar/B738/park_brake_valve_anim': return s.parkingBrake ? 1 : 0
      case 'sim/cockpit2/controls/elevator_trim': return clamp(s.trim, -1, 1)
      case 'sim/cockpit2/controls/rudder_trim': return clamp(s.rudderTrim, -1, 1)
      // ---- levers
      case 'sim/cockpit2/engine/actuators/throttle_jet_rev_ratio[0]':
      case 'sim/cockpit2/engine/actuators/throttle_jet_rev_ratio[1]': {
        const i = engine(ref)
        const rev = clamp(s.reverse[i] ?? 0, 0, 1)
        return rev > 0.001 ? -rev : clamp(s.throttle[i] ?? 0, 0, 1)
      }
      // The yokes are hidden when this reads 0..0.5, so 1 draws them.
      case 'sim/graphics/view/hide_yoke': return 1
      case 'laminar/B738/engine/slider/condition_lever1': return s.engineRunning[0] ? 1 : 0
      case 'laminar/B738/engine/slider/condition_lever2': return s.engineRunning[1] ? 1 : 0
      case 'sim/cockpit2/controls/flap_ratio': return flapHandleRatio(s.flapsHandleIndex, s.flapDetentsDeg)
      case 'sim/cockpit2/controls/flap_handle_deploy_ratio': return flapNeedleRatio(s.flapsDeg, s.flapDetentsDeg)
      case 'sim/cockpit2/controls/gear_handle_animation': return gearHandleRatio(s.gearHandleDown)
      case 'laminar/B738/flt_ctrls/speedbrake_lever': return speedbrakeLeverRatio(s.speedbrake, s.speedbrakeArmed)
      case 'sim/cockpit2/switches/auto_brake_level': return AUTOBRAKE_INDEX[s.autobrake] ?? 1
    }
    return 0
  }
}
