import { describe, expect, it } from 'vitest'
import { makeXpDatarefReader, defaultXpInputs, flapHandleRatio, speedbrakeLeverRatio, gearHandleRatio, type XpCockpitInputs } from '../src/render/xplane-datarefs'

const DETENTS = [0, 1, 2, 5, 10, 15, 25, 30, 40]
const read = (o: Partial<XpCockpitInputs> = {}, overrides?: Record<string, number>) => makeXpDatarefReader({ ...defaultXpInputs(), flapDetentsDeg: DETENTS, ...o }, overrides)

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

describe('flaps', () => {
  it('the handle sits at its detent: ratio = index / (detents − 1)', () => {
    expect(flapHandleRatio(0, DETENTS)).toBe(0)
    expect(flapHandleRatio(8, DETENTS)).toBe(1)
    expect(flapHandleRatio(3, DETENTS)).toBeCloseTo(0.375) // flaps 5
    expect(flapHandleRatio(99, DETENTS)).toBe(1)
    expect(flapHandleRatio(0, [0])).toBe(0) // a flapless airplane
  })
  it('the lever and the position needle are separate: needle follows the actual flaps, lever the handle', () => {
    const r = read({ flapsHandleIndex: 7, flapsDeg: 10 })
    expect(r('sim/cockpit2/controls/flap_ratio')).toBeCloseTo(7 / 8)
    expect(r('sim/cockpit2/controls/flap_handle_deploy_ratio')).toBeCloseTo(4 / 8) // 10° is detent index 4
    expect(read({ flapsHandleIndex: 0, flapsDeg: 7.5 })('sim/cockpit2/controls/flap_handle_deploy_ratio')).toBeCloseTo((3 + (7.5 - 5) / 5) / 8) // between flaps 5 and 10
  })
})

describe('speedbrake lever', () => {
  it('has DOWN, ARM (≈0.089), proportional deployment, and UP', () => {
    expect(speedbrakeLeverRatio(0, false)).toBe(0)
    expect(speedbrakeLeverRatio(0, true)).toBeCloseTo(0.0889, 3)
    expect(speedbrakeLeverRatio(1, false)).toBe(1)
    expect(speedbrakeLeverRatio(1, true)).toBe(1) // armed and deployed on landing: lever UP
    const mid = speedbrakeLeverRatio(0.5, false)
    expect(mid).toBeGreaterThan(0.0889); expect(mid).toBeLessThan(1)
    expect(speedbrakeLeverRatio(NaN, false)).toBe(0)
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
    const r = read({ pitch: NaN, roll: Infinity, flapsDeg: NaN })
    for (const ref of ['sim/cockpit2/controls/total_pitch_ratio', 'sim/cockpit2/controls/total_roll_ratio', 'sim/cockpit2/controls/flap_handle_deploy_ratio']) {
      expect(Number.isFinite(r(ref))).toBe(true)
    }
  })
})
