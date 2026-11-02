import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { parseObj8, buildObj8, applyObj8Lights, lightLevelValue, makeObj8Material } from '../src/render/xplane-obj8'
import { makeXpDatarefReader, defaultXpInputs } from '../src/render/xplane-datarefs'

const OBJ = [
  'I', '800', 'OBJ', 'TEXTURE foo.png', 'TEXTURE_LIT foo_LIT.png',
  'POINT_COUNTS 4 0 0 24',
  'VT 0 0 0 0 1 0 0 0', 'VT 1 0 0 0 1 0 1 0', 'VT 1 0 1 0 1 0 1 1', 'VT 0 0 1 0 1 0 0 1',
  'IDX10 0 1 2 0 2 3 0 1 2 0',
  'IDX 2', 'IDX 3', 'IDX 0', 'IDX 1', 'IDX 2', 'IDX 0', 'IDX 2', 'IDX 3', 'IDX 0', 'IDX 1', 'IDX 2', 'IDX 0', 'IDX 2', 'IDX 3',
  'TRIS 0 6',                                                  // no light level: the cockpit's own night glow
  'ATTR_light_level 0 1 laminar/B738/annunciator/master_caution_light 3500',
  'TRIS 6 6',
  'TRIS 12 6',                                                 // same state: one draw
  'ATTR_light_level 0 1 sim/cockpit2/electrical/panel_brightness_ratio[0] 500',
  'TRIS 18 6',
  'ATTR_light_level_reset',
  'TRIS 0 6',
].join('\n')

describe('ATTR_light_level', () => {
  const p = parseObj8(OBJ)
  it('is captured per draw, with its range, dataref and brightness in nits', () => {
    expect(p.draws).toHaveLength(4)
    expect(p.draws[0]!.light).toBeUndefined()
    expect(p.draws[1]!.light).toEqual({ v1: 0, v2: 1, dataref: 'laminar/B738/annunciator/master_caution_light', nits: 3500 })
    expect(p.draws[2]!.light).toEqual({ v1: 0, v2: 1, dataref: 'sim/cockpit2/electrical/panel_brightness_ratio[0]', nits: 500 })
    expect(p.draws[3]!.light).toBeUndefined()                     // ATTR_light_level_reset
  })
  it('contiguous draws under the same light level are one draw; a change starts a new one', () => {
    const lamp = p.draws[1]!
    expect(lamp.count).toBe(12)                                   // TRIS 6 6 + TRIS 12 6
  })
  it('a light level without a brightness is accepted', () => {
    const q = parseObj8(OBJ.replace('master_caution_light 3500', 'master_caution_light'))
    expect(q.draws[1]!.light).toEqual({ v1: 0, v2: 1, dataref: 'laminar/B738/annunciator/master_caution_light', nits: null })
  })
})

describe('light level value', () => {
  it('maps the dataref between v1 and v2 onto 0…1', () => {
    expect(lightLevelValue(0.5, 0, 1)).toBeCloseTo(0.5)
    expect(lightLevelValue(2, 0, 4)).toBeCloseTo(0.5)
    expect(lightLevelValue(-3, 0, 1)).toBe(0); expect(lightLevelValue(9, 0, 1)).toBe(1)
    expect(lightLevelValue(1, 1, 1)).toBe(1); expect(lightLevelValue(0, 1, 1)).toBe(0) // a degenerate range is a switch
    expect(lightLevelValue(NaN, 0, 1)).toBe(0)
  })
})

describe('lamps in a built object', () => {
  const parsed = parseObj8(OBJ)
  const base = makeObj8Material({}, parsed)
  const built = buildObj8(parsed, base, { lightLevels: true })
  it('each distinct light level has its own material; unlit draws keep the shared one', () => {
    expect(built.lights).toHaveLength(2)
    const meshes: THREE.Mesh[] = []
    built.group.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o) })
    expect(meshes).toHaveLength(4)
    expect(meshes.filter((m) => m.material === base)).toHaveLength(2)
    for (const l of built.lights) expect(l.material).not.toBe(base)
  })
  it('does not split materials unless asked (exteriors stay as they were)', () => {
    expect(buildObj8(parsed, base).lights).toHaveLength(0)
  })
  it('applying the datarefs sets each lamp\'s glow in proportion to its brightness', () => {
    const read = (ref: string): number => (ref.endsWith('master_caution_light') ? 1 : ref.includes('panel_brightness_ratio[0]') ? 0.5 : 0)
    applyObj8Lights(built.lights, read)
    const caution = built.lights.find((l) => l.dataref.endsWith('master_caution_light'))!
    const panel = built.lights.find((l) => l.dataref.includes('panel_brightness'))!
    expect((caution.material as THREE.MeshStandardMaterial).emissiveIntensity).toBeCloseTo(3500 / 500)
    expect((panel.material as THREE.MeshStandardMaterial).emissiveIntensity).toBeCloseTo(0.5)
    applyObj8Lights(built.lights, () => 0)
    expect((caution.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0)
  })
  it('caps a very bright lamp so one annunciator cannot flare the whole screen', () => {
    const lamp = { ...built.lights[0]!, nits: 1_000_000 }
    applyObj8Lights([lamp], () => 1)
    expect((lamp.material as THREE.MeshStandardMaterial).emissiveIntensity).toBeLessThanOrEqual(8)
  })
})

describe('lamp datarefs from the airplane', () => {
  const read = (o = {}) => makeXpDatarefReader({ ...defaultXpInputs(), ...o })
  it('the three green gear lights show down-and-locked only', () => {
    const down = read({ gearLocked: [true, true, true] })
    for (const n of ['nose', 'left', 'right']) expect(down(`laminar/B738/annunciator/${n}_gear_safe`)).toBe(1)
    const moving = read({ gearLocked: [false, false, false] })
    for (const n of ['nose', 'left', 'right']) expect(moving(`laminar/B738/annunciator/${n}_gear_safe`)).toBe(0)
    expect(read({ gearLocked: [true, false, true] })('laminar/B738/annunciator/left_gear_safe')).toBe(0)
  })
  it('master caution, the A/P and A/T disconnect lights and the parking brake light follow the airplane', () => {
    expect(read({ masterCaution: true })('laminar/B738/annunciator/master_caution_light')).toBe(1)
    expect(read({})('laminar/B738/annunciator/master_caution_light')).toBe(0)
    expect(read({ apDisconnect: true })('laminar/B738/annunciator/ap_disconnect1')).toBe(1)
    expect(read({ apDisconnect: true })('laminar/B738/annunciator/ap_disconnect2')).toBe(1)
    expect(read({ atDisconnect: true })('laminar/B738/annunciator/at_fms_disconnect1')).toBe(1)
    expect(read({ parkingBrake: true })('sim/flightmodel2/lights/generic_lights_brightness_ratio[125]')).toBe(1)
    expect(read({ parkingBrake: false })('sim/flightmodel2/lights/generic_lights_brightness_ratio[125]')).toBe(0)
  })
  it('the panel backlights follow the night level; the lights test and unsimulated lamps stay dark', () => {
    const night = read({ panelLight: 0.8 })
    for (const i of [0, 1, 2, 3]) expect(night(`sim/cockpit2/electrical/panel_brightness_ratio[${i}]`)).toBeCloseTo(0.8)
    expect(read({})('sim/cockpit2/electrical/panel_brightness_ratio[0]')).toBe(0)
    expect(read({ panelLight: 1 })('laminar/B738/annunciator/generic')).toBe(0)
    for (const n of ['pack', 'cargo_fire', 'wing_body_ovht', 'eng1_valve_closed', 'cabin_alt', 'below_gs', 'takeoff_config', 'fire_bell_annun']) expect(read({ panelLight: 1 })(`laminar/B738/annunciator/${n}`), n).toBe(0)
  })
  it('legend and audio lamps: instrument lights bright, COM 1 selected', () => {
    expect(read({})('laminar/B738/brightness_level2')).toBe(1)
    expect(read({})('laminar/B738/audio/indicators/audio_selection_com1')).toBe(1)
    expect(read({})('laminar/B738/audio/indicators/audio_selection_com2')).toBe(0)
  })
  it('the lights-test dataref reads zero so the "generic" lamps do not light', () => {
    expect(read({})('laminar/no_ref')).toBe(0)
  })
})

describe('resting switches and the lights circuit', () => {
  const read = (o = {}) => makeXpDatarefReader({ ...defaultXpInputs(), ...o })
  it('the four landing light switches follow the real landing light', () => {
    for (const i of [0, 1, 2, 3]) {
      expect(read({ landingLights: true })(`sim/cockpit2/switches/landing_lights_switch[${i}]`)).toBe(1)
      expect(read({ landingLights: false })(`sim/cockpit2/switches/landing_lights_switch[${i}]`)).toBe(0)
    }
  })
  it('the overhead rests in normal flight (powered, pumps and packs on), as a recorded stand-in', () => {
    const r = read()
    for (const k of ['sim/cockpit2/electrical/battery_on[0]', 'laminar/B738/electrical/gen1_pos', 'sim/cockpit2/fuel/fuel_tank_pump_on[0]', 'sim/cockpit2/switches/yaw_damper_on', 'laminar/B738/pressurization/l_pack_pos']) expect(r(k), k).toBe(1)
    expect(r('sim/cockpit2/fuel/fuel_tank_pump_on[1]')).toBe(0)           // centre tank is empty
    expect(r('laminar/B738/electrical/apu_genL_pos')).toBe(0)             // APU off
    expect(r('laminar/B738/electrical/gpu_pos')).toBe(0)
  })
  it('the rheostats follow the light outside; every resting value is a finite number', async () => {
    expect(read({ panelLight: 0.7 })('laminar/B738/rheos/panel_lighting1')).toBeCloseTo(0.7)
    expect(read({ panelLight: 0 })('laminar/B738/rheos/generic_lighting7')).toBe(0)
    const { XP_B738_RESTING } = await import('../src/render/xplane-datarefs')
    for (const [k, v] of Object.entries(XP_B738_RESTING)) expect(Number.isFinite(v), k).toBe(true)
  })
  it('live state wins over a resting value', () => {
    expect(read({ parkingBrake: true })('laminar/B738/park_brake_valve_anim')).toBe(1)
    expect(makeXpDatarefReader({ ...defaultXpInputs() }, { 'sim/cockpit2/electrical/battery_on[0]': 0 })('sim/cockpit2/electrical/battery_on[0]')).toBe(0)
  })
})
