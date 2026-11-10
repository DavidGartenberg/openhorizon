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

import * as THREE from 'three'
import { XpInteraction, dragControlOf } from '../src/render/xplane-interact'

describe('dragging a lever or wheel', () => {
  const lever = (dataref: string): { mesh: THREE.Mesh; cam: THREE.PerspectiveCamera } => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    mesh.userData.manip = { type: 'drag_rotate', cursor: 'hand', commands: [], datarefs: [dataref, 'none'], tooltip: 'Thrust Lever' }
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
    cam.position.set(0, 0, 3); cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld(true); mesh.updateMatrixWorld(true)
    return { mesh, cam }
  }
  const ptr = (o: Partial<{ x: number; y: number; pressed: boolean; down: boolean; released: boolean; wheel: number }>) => ({ x: 100, y: 100, w: 200, h: 200, pressed: false, down: false, released: false, wheel: 0, ...o })
  it('knows which manipulators are held-drag controls', () => {
    expect(dragControlOf(lever('sim/cockpit2/engine/actuators/throttle_jet_rev_ratio[0]').mesh.userData.manip)).toBe('throttle')
    expect(dragControlOf(lever('sim/cockpit2/engine/actuators/throttle_jet_rev_ratio_all').mesh.userData.manip)).toBe('throttle')
    expect(dragControlOf(lever('sim/cockpit2/controls/elevator_trim').mesh.userData.manip)).toBe('trim')
    expect(dragControlOf(lever('sim/cockpit2/controls/flap_ratio').mesh.userData.manip)).toBeNull()
  })
  it('the press only grabs it; moving the pointer then reports how far, frame by frame', () => {
    const { mesh, cam } = lever('sim/cockpit2/engine/actuators/throttle_jet_rev_ratio[1]')
    const x = new XpInteraction(cam)
    expect(x.update(ptr({ pressed: true, down: true }), [mesh]).actions).toEqual([])
    expect(x.isDraggingControl).toBe(true)
    expect(x.update(ptr({ y: 130, down: true }), [mesh]).actions).toEqual([{ kind: 'drag', control: 'throttle', dyPx: 30 }])
    expect(x.update(ptr({ y: 120, down: true }), [mesh]).actions).toEqual([{ kind: 'drag', control: 'throttle', dyPx: -10 }])
    expect(x.update(ptr({ y: 120, down: true }), [mesh]).actions).toEqual([])      // no movement, no action
  })
  it('releasing ends the drag; the camera may look around again', () => {
    const { mesh, cam } = lever('sim/cockpit2/controls/elevator_trim')
    const x = new XpInteraction(cam)
    x.update(ptr({ pressed: true, down: true }), [mesh])
    x.update(ptr({ released: true, down: false }), [mesh])
    expect(x.isDraggingControl).toBe(false)
    expect(x.update(ptr({ y: 150, down: false }), [mesh]).actions).toEqual([])
  })
})

describe('light-airplane switches and flap lever', () => {
  const rocker = (on: string, off: string): Obj8Manip => m('command_switch_up_down', [on, off])
  it('battery, alternator, avionics, pitot heat and fuel pump rockers: up is ON, down is OFF', () => {
    expect(click(rocker('sim/electrical/battery_1_on', 'sim/electrical/battery_1_off'), { upper: true })).toEqual({ kind: 'gaSwitch', id: 'masterBattery', on: true })
    expect(click(rocker('sim/electrical/battery_1_on', 'sim/electrical/battery_1_off'), { upper: false })).toEqual({ kind: 'gaSwitch', id: 'masterBattery', on: false })
    expect(click(rocker('sim/electrical/generator_1_on', 'sim/electrical/generator_1_off'))).toMatchObject({ id: 'masterAlternator' })
    expect(click(rocker('sim/systems/avionics_on', 'sim/systems/avionics_off'))).toMatchObject({ id: 'avionicsSwitch' })
    expect(click(rocker('sim/ice/pitot_heat0_on', 'sim/ice/pitot_heat0_off'))).toMatchObject({ id: 'pitotHeat' })
    expect(click(rocker('sim/fuel/fuel_pumps_on', 'sim/fuel/fuel_pumps_off'))).toMatchObject({ id: 'boostPumpOn' })
    expect(click(rocker('sim/lights/landing_lights_on', 'sim/lights/landing_lights_off'))).toEqual({ kind: 'landingLights' })
    expect(click(rocker('sim/lights/strobe_lights_on', 'sim/lights/strobe_lights_off')).kind).toBe('unsimulated')
  })
  it('the sliding flap lever: the lower half and the wheel down give more flap', () => {
    const flap = m('drag_axis', [], ['sim/cockpit2/controls/flap_ratio'])
    expect(click(flap, { upper: false })).toEqual({ kind: 'flaps', steps: 1 })
    expect(click(flap, { upper: true })).toEqual({ kind: 'flaps', steps: -1 })
    expect(click(flap, { wheel: 2 })).toEqual({ kind: 'flaps', steps: 2 })
    expect(click(m('drag_axis', [], ['sim/operation/sound/radio_volume_ratio'])).kind).toBe('unsimulated')
  })
  it('throttle and mixture plungers follow a held drag instead of acting on the click', () => {
    const throttle = m('drag_axis', [], ['sim/cockpit2/engine/actuators/throttle_ratio[0]'])
    const mixture = m('drag_axis', [], ['sim/cockpit2/engine/actuators/mixture_ratio[0]'])
    expect(dragControlOf(throttle)).toBe('throttle'); expect(click(throttle)).toEqual({ kind: 'none' })
    expect(dragControlOf(mixture)).toBe('mixture'); expect(click(mixture)).toEqual({ kind: 'none' })
    expect(dragControlOf(m('drag_axis', [], ['sim/cockpit2/controls/flap_ratio']))).toBeNull()
  })
  it('stock autopilot, brake, flap and toggle buttons do what they say', () => {
    const press = (c: string): XpAction => click(m('command', [c]))
    expect(press('sim/autopilot/heading')).toEqual({ kind: 'ap', button: 'hdg' })
    expect(press('sim/autopilot/NAV')).toEqual({ kind: 'ap', button: 'nav' })
    expect(press('sim/autopilot/approach')).toEqual({ kind: 'ap', button: 'apr' })
    expect(press('sim/autopilot/altitude_hold')).toEqual({ kind: 'ap', button: 'alt' })
    expect(press('sim/autopilot/servos_off_any')).toEqual({ kind: 'disengage' })
    expect(press('sim/flight_controls/brakes_toggle_max')).toEqual({ kind: 'parking' })
    expect(press('sim/flight_controls/flaps_down')).toEqual({ kind: 'flaps', steps: 1 })
    expect(press('sim/flight_controls/flaps_up')).toEqual({ kind: 'flaps', steps: -1 })
    expect(press('sim/systems/avionics_toggle')).toEqual({ kind: 'gaSwitch', id: 'avionicsSwitch', on: 'toggle' })
    expect(press('sim/flight_controls/pitch_trim_up')).toEqual({ kind: 'drag', control: 'trim', dyPx: -12 })
  })
  it('the one-command switch forms press their command whichever half is clicked', () => {
    expect(click(m('command_switch_up_down2', ['sim/lights/landing_lights_toggle']), { upper: false })).toEqual({ kind: 'landingLights' })
    expect(click(m('command_knob2', ['sim/electrical/battery_1_toggle']))).toEqual({ kind: 'gaSwitch', id: 'masterBattery', on: 'toggle' })
    expect(click(m('command_switch_left_right2', ['sim/lights/strobe_lights_toggle'])).kind).toBe('unsimulated')
  })
  it('radio knobs tune the standby frequency by megahertz or by channel, and the flip button swaps', () => {
    const knob = (up: string, down: string): Obj8Manip => m('command_knob', [up, down])
    expect(click(knob('sim/radios/stby_com1_coarse_up', 'sim/radios/stby_com1_coarse_down'), { right: true })).toEqual({ kind: 'tune', radio: 'com1', coarse: true, steps: 1 })
    expect(click(knob('sim/radios/stby_com1_fine_up', 'sim/radios/stby_com1_fine_down'), { right: false })).toEqual({ kind: 'tune', radio: 'com1', coarse: false, steps: -1 })
    expect(click(knob('sim/radios/stby_nav1_fine_up', 'sim/radios/stby_nav1_fine_down'), { wheel: -3 })).toEqual({ kind: 'tune', radio: 'nav1', coarse: false, steps: 3 })
    expect(click(knob('sim/radios/obs1_up', 'sim/radios/obs1_down'), { right: true })).toEqual({ kind: 'course', steps: 1 })
    expect(click(m('command', ['sim/radios/com1_standy_flip']))).toEqual({ kind: 'flip', radio: 'com1' })
    expect(click(knob('sim/radios/stby_adf1_ones_tens_up', 'sim/radios/stby_adf1_ones_tens_down')).kind).toBe('unsimulated')
  })
})
