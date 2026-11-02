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
  /** The angle (deg) the flap handle is set to, and the actual flap angle. */
  flapsHandleDeg: number
  flapsDeg: number
  gearHandleDown: boolean
  /** Speedbrake deployed 0…1 and the ARM lever position. */
  speedbrake: number
  speedbrakeArmed: boolean
  /** In the air the lever stops at the FLIGHT detent; the UP position is for ground spoilers. */
  onGround: boolean
  engineRunning: [boolean, boolean]
  /** Autobrake selector: rto · off · 1 · 2 · 3 · max. */
  autobrake: string
  /** The mode control panel: selected values, lit modes, switches. */
  mcp: XpMcpInputs
}

/** The mode control panel as the autopilot has it right now. */
export interface XpMcpInputs {
  /** Selected values: what the windows show and the knobs point at. */
  headingDeg: number
  altitudeFt: number
  iasKt: number
  vsFpm: number
  courseDeg: number
  /** CMD A engaged. */
  master: boolean
  lateral: string
  lateralArmed: boolean
  vertical: string
  speedMode: boolean
  n1Mode: boolean
  fdOn: boolean
  /** The A/T ARM switch. */
  atArm: boolean
  /** Where NAV is flying from: a flight plan (LNAV) or a tuned VOR/localizer (VOR LOC). */
  navSource: 'gps' | 'vor' | null
  /** Seconds since each button (ap, hdg, nav, apr, alt, vs, flc) was last pressed. */
  pressedAgoS: Record<string, number>
}

/** How long a pressed MCP button reads as pushed in. */
export const MCP_BUTTON_TRAVEL_S = 0.14

export function defaultXpMcp(): XpMcpInputs {
  return {
    headingDeg: 0, altitudeFt: 0, iasKt: 0, vsFpm: 0, courseDeg: 0, master: false, lateral: 'ROL', lateralArmed: false,
    vertical: 'PIT', speedMode: false, n1Mode: false, fdOn: false, atArm: false, navSource: null, pressedAgoS: {},
  }
}

export function defaultXpInputs(): XpCockpitInputs {
  return {
    pitch: 0, roll: 0, yaw: 0, brakeLeft: 0, brakeRight: 0, parkingBrake: false, trim: 0, rudderTrim: 0,
    throttle: [0, 0], reverse: [0, 0], flapsHandleDeg: 0, flapsDeg: 0, gearHandleDown: true,
    speedbrake: 0, speedbrakeArmed: false, onGround: true, engineRunning: [true, true], autobrake: 'off', mcp: defaultXpMcp(),
  }
}

const AUTOBRAKE_INDEX: Record<string, number> = { rto: 0, off: 1, '1': 2, '2': 3, '3': 4, max: 5 }
const clamp = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0)

/**
 * The gates of the X-Plane 737's flap lever and position gauge. Both are keyed on
 * the ratio i/8 for gate i, so a handle at any angle goes to its place in this
 * list — whichever detents this simulator's own 737 has (it has 7 of the 9).
 */
export const XP_FLAP_GATES_DEG: readonly number[] = [0, 1, 2, 5, 10, 15, 25, 30, 40]

/** An angle's place along the gates (0…1), linear between neighbours. */
export function flapGateRatio(deg: number): number {
  const g = XP_FLAP_GATES_DEG, n = g.length - 1
  if (!Number.isFinite(deg) || deg <= g[0]!) return 0
  for (let i = 0; i < n; i++) {
    const a = g[i]!, b = g[i + 1]!
    if (deg <= b) return (i + (deg - a) / (b - a)) / n
  }
  return 1
}

/** 737 speedbrake lever: DOWN 0, ARM ≈ 0.089, the FLIGHT detent 0.667 (the most the air allows), UP 1 (ground only). */
export function speedbrakeLeverRatio(deployed: number, armed: boolean, onGround: boolean): number {
  const d = clamp(deployed, 0, 1)
  const ARM = 0.0889, FLIGHT = 0.667
  if (d > 0.02) return ARM + d * ((onGround ? 1 : FLIGHT) - ARM)
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
      case 'sim/cockpit2/controls/flap_ratio': return flapGateRatio(s.flapsHandleDeg)
      case 'sim/cockpit2/controls/flap_handle_deploy_ratio': return flapGateRatio(s.flapsDeg)
      case 'sim/cockpit2/controls/gear_handle_animation': return gearHandleRatio(s.gearHandleDown)
      case 'laminar/B738/flt_ctrls/speedbrake_lever': return speedbrakeLeverRatio(s.speedbrake, s.speedbrakeArmed, s.onGround)
      case 'sim/cockpit2/switches/auto_brake_level': return AUTOBRAKE_INDEX[s.autobrake] ?? 1
    }
    return mcpRef(s.mcp, ref)
  }
}

const bit = (v: boolean): number => (v ? 1 : 0)
const finite = (v: number): number => (Number.isFinite(v) ? v : 0)

/** Which `*_pos` (button travel) each MCP button animates. NAV is LNAV or VOR LOC depending on where it is flying from. */
function buttonPos(m: XpMcpInputs, ref: string): number {
  const pressed = (key: string): number => bit((m.pressedAgoS[key] ?? Infinity) < MCP_BUTTON_TRAVEL_S)
  switch (ref) {
    case 'laminar/B738/autopilot/cmd_a_pos': return pressed('ap')
    case 'laminar/B738/autopilot/hdg_sel_pos': return pressed('hdg')
    case 'laminar/B738/autopilot/lnav_pos': return m.navSource === 'gps' ? pressed('nav') : 0
    case 'laminar/B738/autopilot/vorloc_pos': return m.navSource === 'gps' ? 0 : pressed('nav')
    case 'laminar/B738/autopilot/app_pos': return pressed('apr')
    case 'laminar/B738/autopilot/alt_hld_pos': return pressed('alt')
    case 'laminar/B738/autopilot/vs_pos': return pressed('vs')
    case 'laminar/B738/autopilot/lvl_chg_pos': return pressed('flc')
  }
  return 0
}

/** The autopilot's mode lamps, dials and switches. Anything this simulator has no state for (VNAV, CWS, CMD B …) stays dark. */
function mcpRef(m: XpMcpInputs, ref: string): number {
  switch (ref) {
    // ---- mode lamps (a lamp shows at 0.5…1)
    case 'laminar/B738/autopilot/hdg_sel_status': return bit(m.lateral === 'HDG')
    case 'laminar/B738/autopilot/lnav_status': return bit(m.lateral === 'NAV' && m.navSource === 'gps')
    case 'laminar/B738/autopilot/vorloc_status': return bit((m.lateral === 'NAV' && m.navSource !== 'gps') || (m.lateral === 'APR' && m.lateralArmed))
    case 'laminar/B738/autopilot/app_status': return bit(m.lateral === 'APR' || m.vertical === 'GS')
    case 'laminar/B738/autopilot/alt_hld_status': return bit(m.vertical === 'ALT')
    case 'laminar/B738/autopilot/vs_status': return bit(m.vertical === 'VS')
    case 'laminar/B738/autopilot/lvl_chg_status': return bit(m.vertical === 'FLC' || m.vertical === 'IAS')
    case 'laminar/B738/autopilot/speed_status1': return bit(m.speedMode)
    case 'laminar/B738/autopilot/n1_status': return bit(m.n1Mode)
    case 'laminar/B738/autopilot/cmd_a_status': return bit(m.master)
    // ---- switches
    case 'sim/cockpit2/autopilot/flight_director_master_pilot':
    case 'sim/cockpit2/autopilot/flight_director_master_copilot': return bit(m.fdOn)
    // −1 is the OFF position of the A/T ARM switch; 0 and 1 are both ARM.
    case 'sim/cockpit2/autopilot/autothrottle_enabled': return m.atArm ? 1 : -1
    // ---- selector knobs turn with the value they set
    case 'sim/cockpit2/autopilot/heading_dial_deg_mag_pilot': return finite(m.headingDeg)
    case 'sim/cockpit2/autopilot/altitude_dial_ft': return finite(m.altitudeFt)
    case 'sim/cockpit2/autopilot/airspeed_dial_kts_mach': return finite(m.iasKt)
    case 'sim/cockpit2/autopilot/vvi_dial_fpm': return finite(m.vsFpm)
    case 'sim/cockpit2/radios/actuators/hsi_obs_deg_mag_pilot':
    case 'sim/cockpit2/radios/actuators/hsi_obs_deg_mag_copilot': return finite(m.courseDeg)
  }
  return buttonPos(m, ref)
}
