import { describe, expect, it } from 'vitest'
import { defaultXpGaInputs, makeXpGaDatarefReader, STANDARD_RATE_MARK_DEG, type XpGaInputs } from '../src/render/xplane-ga-datarefs'

const read = (patch: Partial<XpGaInputs>, overrides: Record<string, number> = {}): ((ref: string) => number) =>
  makeXpGaDatarefReader({ ...defaultXpGaInputs(), ...patch }, overrides)

describe('light-airplane gauges in X-Plane units', () => {
  it('the six-pack reads airspeed, altitude, attitude, heading and climb as the sim has them', () => {
    const r = read({ iasKt: 105, altitudeFt: 4500, baroInHg: 30.12, pitchDeg: 4, rollDeg: -12, headingDeg: 365, vsiFpm: -500 })
    expect(r('sim/cockpit2/gauges/indicators/airspeed_kts_pilot')).toBe(105)
    expect(r('sim/cockpit2/gauges/indicators/altitude_ft_pilot')).toBe(4500)
    expect(r('sim/cockpit2/gauges/indicators/altitude_ft_copilot')).toBe(4500)
    expect(r('sim/cockpit2/gauges/actuators/barometer_setting_in_hg_pilot')).toBe(30.12)
    expect(r('sim/cockpit2/gauges/indicators/pitch_vacuum_deg_pilot')).toBe(4)
    expect(r('sim/cockpit2/gauges/indicators/roll_vacuum_deg_pilot')).toBe(-12)
    expect(r('sim/cockpit2/gauges/indicators/heading_vacuum_deg_mag_pilot')).toBeCloseTo(5)
    expect(r('sim/cockpit2/gauges/indicators/compass_heading_deg_mag')).toBeCloseTo(5)
    expect(r('sim/cockpit2/gauges/indicators/vvi_fpm_pilot')).toBe(-500)
    expect(read({ iasKt: -3 })('sim/cockpit2/gauges/indicators/airspeed_kts_pilot')).toBe(0)
  })

  it('a standard-rate turn puts the turn coordinator on its marks', () => {
    expect(read({ turnRateDegS: 3 })('sim/cockpit2/gauges/indicators/turn_rate_roll_deg_pilot')).toBeCloseTo(STANDARD_RATE_MARK_DEG)
    expect(read({ turnRateDegS: -1.5 })('sim/cockpit2/gauges/indicators/turn_rate_roll_deg_pilot')).toBeCloseTo(-STANDARD_RATE_MARK_DEG / 2)
  })

  it('engine gauges are per engine, and a running engine pulls vacuum and sits on BOTH magnetos', () => {
    const r = read({ engineRunning: [true, false], rpm: [2400, 0], oilPressPsi: [60, 0], fuelKg: [40, 38] })
    expect(r('sim/cockpit2/engine/indicators/engine_speed_rpm[0]')).toBe(2400)
    expect(r('sim/cockpit2/engine/indicators/engine_speed_rpm[1]')).toBe(0)
    expect(r('sim/cockpit2/engine/indicators/oil_pressure_psi[0]')).toBe(60)
    expect(r('sim/cockpit2/engine/actuators/ignition_key[0]')).toBe(3)
    expect(r('sim/cockpit2/engine/actuators/ignition_key[1]')).toBe(0)
    expect(r('sim/cockpit2/gauges/indicators/suction_1_ratio')).toBe(5)
    expect(r('sim/cockpit2/fuel/fuel_quantity[1]')).toBe(38)
    expect(read({})('sim/cockpit2/gauges/indicators/suction_1_ratio')).toBe(0)
  })

  it('the CDI shows dots of deflection and its TO / FROM / OFF flag; the glideslope flag drops only with a glideslope', () => {
    const none = read({})
    expect(none('sim/cockpit2/radios/indicators/nav1_flag_from_to_pilot')).toBe(0)
    expect(none('sim/cockpit2/radios/indicators/nav1_flag_glideslope_mech')).toBe(1)
    const loc = read({ nav: { deflection: 0.4, toFrom: 1, glideslope: -0.2, obsDeg: 280 } })
    expect(loc('sim/cockpit2/radios/indicators/nav1_hdef_dots_pilot')).toBeCloseTo(1)
    expect(loc('sim/cockpit2/radios/indicators/nav1_vdef_dots_pilot')).toBeCloseTo(-0.5)
    expect(loc('sim/cockpit2/radios/indicators/nav1_flag_from_to_pilot')).toBe(1)
    expect(loc('sim/cockpit2/radios/indicators/nav1_flag_glideslope_mech')).toBe(0)
    expect(loc('sim/cockpit2/radios/actuators/hsi_obs_deg_mag_pilot')).toBe(280)
    expect(read({ nav: { deflection: 3, toFrom: 2, glideslope: null, obsDeg: 90 } })('sim/cockpit2/radios/indicators/hsi_hdef_dots_pilot')).toBeCloseTo(2.5)
  })

  it('levers, switches and clocks', () => {
    const r = read({ throttle: [0.7, 0.6], mixture: [0.9], flapHandle: 0.5, parkingBrake: true, battery: true, zuluHours: 14.5, hobbsHours: 2.25 })
    expect(r('sim/cockpit2/engine/actuators/throttle_ratio[0]')).toBe(0.7)
    expect(r('sim/cockpit2/engine/actuators/throttle_ratio[1]')).toBe(0.6)
    expect(r('sim/cockpit2/engine/actuators/mixture_ratio[1]')).toBe(0.9)   // a single lever value serves every engine
    expect(r('sim/cockpit2/controls/flap_ratio')).toBe(0.5)
    expect(r('sim/cockpit2/controls/parking_brake_ratio')).toBe(1)
    expect(r('sim/cockpit2/electrical/battery_on[0]')).toBe(1)
    expect(r('sim/cockpit2/clock_timer/zulu_time_hours')).toBe(14)
    expect(r('sim/cockpit2/clock_timer/zulu_time_minutes')).toBe(30)
    expect(r('sim/cockpit2/clock_timer/hobbs_time_minutes')).toBe(15)
  })

  it('draws the yoke, shuts the doors, answers 0 for anything unknown and lets overrides win', () => {
    const r = read({}, { 'sim/cockpit2/gauges/indicators/airspeed_kts_pilot': 160 })
    expect(r('sim/graphics/view/hide_yoke')).toBe(1)
    expect(r('sim/flightmodel2/misc/door_open_ratio[0]')).toBe(0)
    expect(r('laminar/c172/knob_TAS')).toBe(0)
    expect(r('sim/cockpit2/gauges/indicators/airspeed_kts_pilot')).toBe(160)
  })
})
