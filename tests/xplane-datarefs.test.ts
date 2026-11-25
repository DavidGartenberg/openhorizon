import { describe, expect, it } from 'vitest'
import { makeXpDatarefReader, defaultXpInputs, flapGateRatio, XP_FLAP_GATES_DEG, speedbrakeLeverRatio, gearHandleRatio, defaultXpMcp, MCP_BUTTON_TRAVEL_S, type XpCockpitInputs, type XpMcpInputs } from '../src/render/xplane-datarefs'
import { B738 } from '../src/sim/aircraft/b738'

const read = (o: Partial<XpCockpitInputs> = {}, overrides?: Record<string, number>) => makeXpDatarefReader({ ...defaultXpInputs(), ...o }, overrides)

describe('thrust levers: one −1…1 value per engine (reverse · idle · forward)', () => {
  it('forward lever travel is positive, reverse is negative, and reverse wins when selected', () => {
    const r = read({ throttle: [0.6, 0.3], reverse: [0, 0] })
    expect(r('sim/cockpit2/engine/actuators/throttle_jet_rev_ratio[0]')).toBeCloseTo(0.6)
    expect(r('sim/cockpit2/engine/actuators/throttle_jet_rev_ratio[1]')).toBeCloseTo(0.3)
    const rev = read({ throttle: [0.6, 0.6], reverse: [0.5, 0] })
    expect(rev('sim/cockpit2/engine/actuators/throttle_jet_rev_ratio[0]')).toBeCloseTo(-0.5)
    expect(rev('sim/cockpit2/engine/actuators/throttle_jet_rev_ratio[1]')).toBeCloseTo(0.6)
  })
  it('clamps garbage', () => {
    expect(read({ throttle: [5, -3] })('sim/cockpit2/engine/actuators/throttle_jet_rev_ratio[0]')).toBe(1)
    expect(read({ throttle: [NaN, 0] })('sim/cockpit2/engine/actuators/throttle_jet_rev_ratio[0]')).toBe(0)
  })
})

describe('flaps: the X-Plane lever and needle are keyed on its nine gates (0 1 2 5 10 15 25 30 40)', () => {
  it('a gate is a ratio of its place in the list', () => {
    expect(XP_FLAP_GATES_DEG).toEqual([0, 1, 2, 5, 10, 15, 25, 30, 40])
    expect(XP_FLAP_GATES_DEG.map((d) => flapGateRatio(d))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => i / 8))
    expect(flapGateRatio(-5)).toBe(0); expect(flapGateRatio(60)).toBe(1); expect(flapGateRatio(NaN)).toBe(0)
  })
  it('between gates the ratio is linear in angle (the position needle sweeps through)', () => {
    expect(flapGateRatio(7.5)).toBeCloseTo((3 + 0.5) / 8)  // halfway from flaps 5 to flaps 10
    expect(flapGateRatio(20)).toBeCloseTo((5 + 0.5) / 8)   // halfway from 15 to 25
  })
  it('the lever sits on the gate for the angle the handle commands; the needle follows the real flaps', () => {
    const r = read({ flapsHandleDeg: 15, flapsDeg: 10 })
    expect(r('sim/cockpit2/controls/flap_ratio')).toBeCloseTo(5 / 8)
    expect(r('sim/cockpit2/controls/flap_handle_deploy_ratio')).toBeCloseTo(4 / 8)
    expect(read({ flapsHandleDeg: 0, flapsDeg: 7.5 })('sim/cockpit2/controls/flap_handle_deploy_ratio')).toBeCloseTo(3.5 / 8)
  })
  it("this simulator's own 737 detents all land exactly on a lever gate (so the lever never rests between them)", () => {
    for (const deg of B738.flapDetentsDeg) {
      const ratio = read({ flapsHandleDeg: deg })('sim/cockpit2/controls/flap_ratio')
      expect(ratio * 8, `flaps ${deg}`).toBeCloseTo(Math.round(ratio * 8), 6)
      expect(XP_FLAP_GATES_DEG).toContain(deg)
    }
  })
})

describe('speedbrake lever', () => {
  it('has DOWN, ARM (≈0.089), proportional deployment, and UP', () => {
    expect(speedbrakeLeverRatio(0, false, true)).toBe(0)
    expect(speedbrakeLeverRatio(0, true, true)).toBeCloseTo(0.0889, 3)
    expect(speedbrakeLeverRatio(1, false, true)).toBe(1)
    expect(speedbrakeLeverRatio(1, true, true)).toBe(1) // armed and deployed on landing: lever UP
    const mid = speedbrakeLeverRatio(0.5, false, true)
    expect(mid).toBeGreaterThan(0.0889); expect(mid).toBeLessThan(1)
    expect(speedbrakeLeverRatio(NaN, false, true)).toBe(0)
  })
})

describe('gear handle', () => {
  it('down = 1, up = 0', () => {
    expect(gearHandleRatio(true)).toBe(1); expect(gearHandleRatio(false)).toBe(0)
  })
})

describe('yoke visibility', () => {
  it('draws the yokes (the OBJ hides them for 0…0.5)', () => {
    expect(read()('sim/graphics/view/hide_yoke')).toBeGreaterThan(0.5)
  })
})

describe('autobrake knob is the real selector index', () => {
  it('maps RTO · OFF · 1 · 2 · 3 · MAX to 0…5', () => {
    const idx = (s: string) => read({ autobrake: s })('sim/cockpit2/switches/auto_brake_level')
    expect([idx('rto'), idx('off'), idx('1'), idx('2'), idx('3'), idx('max')]).toEqual([0, 1, 2, 3, 4, 5])
    expect(idx('nonsense')).toBe(1) // unknown reads as OFF
  })
})

describe('flight controls and gauges', () => {
  it('pass the yoke, pedals, brakes, trim and parking brake through', () => {
    const r = read({ pitch: 0.4, roll: -0.7, yaw: 0.2, brakeLeft: 0.3, brakeRight: 0.9, parkingBrake: true, trim: 0.25 })
    expect(r('sim/cockpit2/controls/total_pitch_ratio')).toBeCloseTo(0.4)
    expect(r('sim/cockpit2/controls/total_roll_ratio')).toBeCloseTo(-0.7)
    expect(r('sim/cockpit2/controls/yoke_heading_ratio')).toBeCloseTo(0.2)
    expect(r('sim/cockpit2/controls/left_brake_ratio')).toBeCloseTo(0.3)
    expect(r('sim/cockpit2/controls/right_brake_ratio')).toBeCloseTo(0.9)
    expect(r('laminar/B738/park_brake_valve_anim')).toBe(1)
    expect(read({ parkingBrake: false })('laminar/B738/park_brake_valve_anim')).toBe(0)
  })
  it('condition levers are IDLE when the engine runs and CUTOFF when it does not', () => {
    const r = read({ engineRunning: [true, false] })
    expect(r('laminar/B738/engine/slider/condition_lever1')).toBe(1)
    expect(r('laminar/B738/engine/slider/condition_lever2')).toBe(0)
  })
})

describe('defaults and overrides', () => {
  it('unknown datarefs read 0; button travel (_pos) reads released', () => {
    const r = read()
    expect(r('laminar/B738/some/unknown_thing')).toBe(0)
    expect(r('laminar/B738/autopilot/hdg_sel_pos')).toBe(0)
    expect(r('none')).toBe(0)
  })
  it('a verification override wins over the mapping', () => {
    expect(read({ pitch: 0.4 }, { 'sim/cockpit2/controls/total_pitch_ratio': -1 })('sim/cockpit2/controls/total_pitch_ratio')).toBe(-1)
  })
  it('always returns a finite number', () => {
    const r = read({ pitch: NaN, roll: Infinity, flapsDeg: NaN, flapsHandleDeg: NaN })
    for (const ref of ['sim/cockpit2/controls/total_pitch_ratio', 'sim/cockpit2/controls/total_roll_ratio', 'sim/cockpit2/controls/flap_handle_deploy_ratio']) {
      expect(Number.isFinite(r(ref))).toBe(true)
    }
  })
})

describe('speedbrake lever in flight vs on the ground', () => {
  it('stops at the FLIGHT detent (30°) in the air and goes to UP (45°) only on the ground', () => {
    expect(speedbrakeLeverRatio(1, false, false)).toBeCloseTo(0.667, 3)
    expect(speedbrakeLeverRatio(1, false, true)).toBe(1)
    expect(speedbrakeLeverRatio(0.5, false, false)).toBeGreaterThan(0.0889)
    expect(speedbrakeLeverRatio(0.5, false, false)).toBeLessThan(0.667)
    expect(speedbrakeLeverRatio(0, true, false)).toBeCloseTo(0.0889, 3)
  })
  it('is read from the airplane state (onGround)', () => {
    expect(read({ speedbrake: 1, onGround: false })('laminar/B738/flt_ctrls/speedbrake_lever')).toBeCloseTo(0.667, 3)
    expect(read({ speedbrake: 1, onGround: true })('laminar/B738/flt_ctrls/speedbrake_lever')).toBe(1)
  })
})

describe('MCP: lamps, dials, switches and button travel from the autopilot state', () => {
  const mcp = (o: Partial<XpMcpInputs> = {}): XpMcpInputs => ({ ...defaultXpMcp(), ...o })
  const r = (o: Partial<XpMcpInputs> = {}) => read({ mcp: mcp(o) })
  const lamp = (name: string, o: Partial<XpMcpInputs>): number => r(o)(`laminar/B738/autopilot/${name}`)
  it('every mode lamp is dark with nothing selected', () => {
    for (const n of ['hdg_sel_status', 'lnav_status', 'vorloc_status', 'app_status', 'alt_hld_status', 'vs_status', 'lvl_chg_status', 'vnav_status1', 'speed_status1', 'n1_status', 'cmd_a_status', 'cmd_b_status', 'cws_a_status', 'cws_b_status']) {
      expect(lamp(n, {}), n).toBe(0)
    }
  })
  it('lights the lateral mode the pilot selected', () => {
    expect(lamp('hdg_sel_status', { lateral: 'HDG' })).toBe(1)
    expect(lamp('lnav_status', { lateral: 'NAV', navSource: 'gps' })).toBe(1)
    expect(lamp('vorloc_status', { lateral: 'NAV', navSource: 'gps' })).toBe(0)
    expect(lamp('vorloc_status', { lateral: 'NAV', navSource: 'vor' })).toBe(1)
    expect(lamp('lnav_status', { lateral: 'NAV', navSource: 'vor' })).toBe(0)
    expect(lamp('app_status', { lateral: 'APR' })).toBe(1)
    expect(lamp('vorloc_status', { lateral: 'APR', lateralArmed: true })).toBe(1)
    expect(lamp('hdg_sel_status', { lateral: 'NAV' })).toBe(0)
  })
  it('lights the vertical mode, speed and thrust modes, and CMD A', () => {
    expect(lamp('alt_hld_status', { vertical: 'ALT' })).toBe(1)
    expect(lamp('vs_status', { vertical: 'VS' })).toBe(1)
    expect(lamp('lvl_chg_status', { vertical: 'FLC' })).toBe(1)
    expect(lamp('app_status', { vertical: 'GS' })).toBe(1)
    expect(lamp('speed_status1', { speedMode: true })).toBe(1)
    expect(lamp('n1_status', { n1Mode: true })).toBe(1)
    expect(lamp('cmd_a_status', { master: true })).toBe(1)
    expect(lamp('cmd_b_status', { master: true })).toBe(0)
  })
  it('the dials turn with the selected values the windows show', () => {
    const d = r({ headingDeg: 270, altitudeFt: 8000, iasKt: 250, vsFpm: -1500, courseDeg: 90 })
    expect(d('sim/cockpit2/autopilot/heading_dial_deg_mag_pilot')).toBe(270)
    expect(d('sim/cockpit2/autopilot/altitude_dial_ft')).toBe(8000)
    expect(d('sim/cockpit2/autopilot/airspeed_dial_kts_mach')).toBe(250)
    expect(d('sim/cockpit2/autopilot/vvi_dial_fpm')).toBe(-1500)
    expect(d('sim/cockpit2/radios/actuators/hsi_obs_deg_mag_pilot')).toBe(90)
    expect(d('sim/cockpit2/radios/actuators/hsi_obs_deg_mag_copilot')).toBe(90)
  })
  it('the F/D switches and the A/T ARM switch', () => {
    expect(r({ fdOn: true })('sim/cockpit2/autopilot/flight_director_master_pilot')).toBe(1)
    expect(r({ fdOn: true })('sim/cockpit2/autopilot/flight_director_master_copilot')).toBe(1)
    expect(r({ fdOn: false })('sim/cockpit2/autopilot/flight_director_master_pilot')).toBe(0)
    expect(r({ atArm: true })('sim/cockpit2/autopilot/autothrottle_enabled')).toBe(1)
    expect(r({ atArm: false })('sim/cockpit2/autopilot/autothrottle_enabled')).toBe(-1)
  })
  it('a button reads pushed in for a moment after it is pressed, then released', () => {
    expect(r({ pressedAgoS: { hdg: 0.05 } })('laminar/B738/autopilot/hdg_sel_pos')).toBe(1)
    expect(r({ pressedAgoS: { hdg: MCP_BUTTON_TRAVEL_S + 0.01 } })('laminar/B738/autopilot/hdg_sel_pos')).toBe(0)
    expect(r({ pressedAgoS: { ap: 0.02 } })('laminar/B738/autopilot/cmd_a_pos')).toBe(1)
    expect(r({ pressedAgoS: { flc: 0.02 } })('laminar/B738/autopilot/lvl_chg_pos')).toBe(1)
    expect(r({ pressedAgoS: { alt: 0.02 } })('laminar/B738/autopilot/alt_hld_pos')).toBe(1)
    expect(r({})('laminar/B738/autopilot/alt_hld_pos')).toBe(0)
  })
  it('never invents a lamp for a mode this simulator does not have (VNAV, CWS, CMD B stay dark)', () => {
    const everything = { master: true, lateral: 'HDG', vertical: 'VS', speedMode: true, n1Mode: true } as Partial<XpMcpInputs>
    for (const n of ['vnav_status1', 'cws_a_status', 'cws_b_status', 'cmd_b_status']) expect(lamp(n, everything), n).toBe(0)
  })
})
