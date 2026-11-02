import { describe, expect, it } from 'vitest'
import { xpActionFor, describeXpAction, type XpAction } from '../src/render/xplane-interact'
import type { Obj8Manip } from '../src/render/xplane-obj8'

const m = (type: string, commands: string[] = [], datarefs: string[] = [], tooltip = 't'): Obj8Manip => ({ type, cursor: 'button', commands, datarefs, tooltip })
const click = (x: Obj8Manip, o: { right?: boolean; upper?: boolean; wheel?: number } = {}): XpAction => xpActionFor(x, { right: o.right ?? true, upper: o.upper ?? true, ...(o.wheel !== undefined ? { wheel: o.wheel } : {}) })

describe('mode control panel buttons', () => {
  it('each button presses the autopilot button it is', () => {
    const press = (c: string): XpAction => click(m('command', [`laminar/B738/autopilot/${c}`]))
    expect(press('hdg_sel_press')).toEqual({ kind: 'ap', button: 'hdg' })
    expect(press('lnav_press')).toEqual({ kind: 'ap', button: 'nav' })
    expect(press('vorloc_press')).toEqual({ kind: 'ap', button: 'nav' })
    expect(press('app_press')).toEqual({ kind: 'ap', button: 'apr' })
    expect(press('alt_hld_press')).toEqual({ kind: 'ap', button: 'alt' })
    expect(press('vs_press')).toEqual({ kind: 'ap', button: 'vs' })
    expect(press('lvl_chg_press')).toEqual({ kind: 'ap', button: 'flc' })
    expect(press('cmd_a_press')).toEqual({ kind: 'ap', button: 'ap' })
    expect(press('cmd_b_press')).toEqual({ kind: 'ap', button: 'ap' })
    expect(press('speed_press')).toEqual({ kind: 'speed' })
    expect(press('disconnect_toggle')).toEqual({ kind: 'disengage' })
  })
})

describe('knobs turn by their clicked half and by the wheel', () => {
  const heading = m('command_knob', ['sim/autopilot/heading_up', 'sim/autopilot/heading_down'])
  it('right half up, left half down', () => {
    expect(click(heading, { right: true })).toEqual({ kind: 'apTurn', knob: 'heading', steps: 1 })
    expect(click(heading, { right: false })).toEqual({ kind: 'apTurn', knob: 'heading', steps: -1 })
  })
  it('the wheel turns it by the notches, scroll up = up', () => {
    expect(click(heading, { wheel: -3 })).toEqual({ kind: 'apTurn', knob: 'heading', steps: 3 })
    expect(click(heading, { wheel: 2 })).toEqual({ kind: 'apTurn', knob: 'heading', steps: -2 })
  })
  it('altitude, speed and vertical speed', () => {
    expect(click(m('command_knob', ['sim/autopilot/altitude_up', 'sim/autopilot/altitude_down']))).toEqual({ kind: 'apTurn', knob: 'altitude', steps: 1 })
    expect(click(m('command_knob', ['sim/autopilot/airspeed_up', 'sim/autopilot/airspeed_down']), { right: false })).toEqual({ kind: 'apTurn', knob: 'ias', steps: -1 })
    const vs = m('command_switch_up_down', ['sim/autopilot/vertical_speed_down', 'sim/autopilot/vertical_speed_up'])
    expect(click(vs, { upper: true })).toEqual({ kind: 'apTurn', knob: 'vs', steps: -1 })    // the first command is the upper half
    expect(click(vs, { upper: false })).toEqual({ kind: 'apTurn', knob: 'vs', steps: 1 })
  })
  it('the autobrake knob steps the selector, baro and course follow their knobs', () => {
    const ab = m('command_knob', ['sim/flight_controls/brakes_up_auto', 'sim/flight_controls/brakes_dn_auto'])
    expect(click(ab, { right: true })).toEqual({ kind: 'autobrake', steps: 1 })
    expect(click(ab, { right: false })).toEqual({ kind: 'autobrake', steps: -1 })
    expect(click(m('command_knob', ['sim/instruments/barometer_up', 'sim/instruments/barometer_down']))).toEqual({ kind: 'baro', steps: 1 })
    expect(click(m('command_knob', ['sim/radios/obs_HSI_up', 'sim/radios/obs_HSI_down']), { right: false })).toEqual({ kind: 'course', steps: -1 })
  })
})

describe('switches, handles and levers', () => {
  it('the A/T ARM switch arms when its upper half is clicked and turns off from the lower half', () => {
    const at = m('command_switch_up_down', ['sim/autopilot/autothrottle_arm', 'sim/autopilot/autothrottle_hard_off'])
    expect(click(at, { upper: true })).toEqual({ kind: 'atSwitch', arm: true })
    expect(click(at, { upper: false })).toEqual({ kind: 'atSwitch', arm: false })
  })
  it('parking brake and landing lights toggle', () => {
    expect(click(m('command', ['sim/flight_controls/park_brake_valve_toggle']))).toEqual({ kind: 'parking' })
    expect(click(m('toggle', [], ['sim/cockpit2/switches/landing_lights_switch[0]']))).toEqual({ kind: 'landingLights' })
    expect(click(m('toggle', [], ['sim/cockpit2/switches/landing_lights_switch[3]']))).toEqual({ kind: 'landingLights' })
  })
  it('the flap lever moves down a gate from its lower half, up from its upper half', () => {
    const flaps = m('drag_rotate', [], ['sim/cockpit2/controls/flap_ratio', 'laminar/B738/handles/flap_lever/stop_pos'])
    expect(click(flaps, { upper: false })).toEqual({ kind: 'flaps', steps: 1 })
    expect(click(flaps, { upper: true })).toEqual({ kind: 'flaps', steps: -1 })
    expect(click(flaps, { wheel: 1 })).toEqual({ kind: 'flaps', steps: 1 })       // scroll down = lever down = more flap
    expect(click(flaps, { wheel: -2 })).toEqual({ kind: 'flaps', steps: -2 })
  })
  it('the gear handle and the speedbrake lever', () => {
    expect(click(m('drag_rotate', [], ['sim/cockpit2/controls/gear_handle_animation', 'none']))).toEqual({ kind: 'gear' })
    expect(click(m('drag_rotate', [], ['laminar/B738/flt_ctrls/speedbrake_lever', 'laminar/B738/flt_ctrls/speedbrake_lever_stop']))).toEqual({ kind: 'speedbrake' })
  })
})

describe('what is not simulated', () => {
  it('answers honestly with the control\'s own name instead of pretending', () => {
    const a = click(m('toggle', [], ['sim/cockpit2/fuel/fuel_tank_pump_on[0]'], 'Fuel Tank L Pump'))
    expect(a).toEqual({ kind: 'unsimulated', tooltip: 'Fuel Tank L Pump' })
    expect(describeXpAction(a)).toBe('FUEL TANK L PUMP — NOT SIMULATED')
  })
  it('a click that does nothing in X-Plane either (noop, none) is not an action', () => {
    expect(click(m('noop'))).toEqual({ kind: 'none' })
  })
  it('describes the actions it can announce', () => {
    expect(describeXpAction({ kind: 'flaps', steps: 1 })).toBe('')
    expect(describeXpAction({ kind: 'none' })).toBe('')
  })
})
