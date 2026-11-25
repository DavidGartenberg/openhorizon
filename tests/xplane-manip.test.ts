import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { parseObj8, buildObj8, makeObj8Material } from '../src/render/xplane-obj8'

const OBJ = [
  'I', '800', 'OBJ', 'TEXTURE foo.png',
  'POINT_COUNTS 4 0 0 30',
  'VT 0 0 0 0 1 0 0 0', 'VT 1 0 0 0 1 0 1 0', 'VT 1 1 0 0 1 0 1 1', 'VT 0 1 0 0 1 0 0 1',
  'IDX10 0 1 2 0 2 3 0 1 2 0',
  'IDX 2', 'IDX 3', 'IDX 0', 'IDX 1', 'IDX 2', 'IDX 0', 'IDX 2', 'IDX 3', 'IDX 0', 'IDX 1', 'IDX 2', 'IDX 0', 'IDX 2', 'IDX 3', 'IDX 0', 'IDX 1', 'IDX 2', 'IDX 0', 'IDX 2', 'IDX 3', 'IDX 0', 'IDX 1', 'IDX 2', 'IDX 0', 'IDX 2', 'IDX 3',
  'ATTR_draw_disable',
  'ATTR_manip_command\tbutton\tlaminar/B738/autopilot/hdg_sel_press\tHDG SEL Mode',
  'TRIS 0 6',
  'ATTR_manip_command_knob\trotate_medium\tsim/autopilot/heading_up\tsim/autopilot/heading_down\tAP Heading',
  'TRIS 6 6',
  'ATTR_manip_command_switch_up_down\tup_down\tsim/autopilot/autothrottle_arm\tsim/autopilot/autothrottle_hard_off\tAutothrottle ARM',
  'TRIS 12 6',
  'ATTR_manip_toggle\tup_down\t1.000\t0.000\tsim/cockpit2/switches/landing_lights_switch[0]\tWingroot Left Landing Light',
  'TRIS 18 6',
  'ATTR_manip_axis_knob\trotate_medium\t0.000\t7.000\t1.000\t1.000\tsim/cockpit2/EFIS/map_range\tCAPT EFIS Range',
  'TRIS 24 6',
  'ATTR_manip_none',
  'TRIS 0 6',                                                    // disabled, no manipulator: not a hit box
  'ANIM_begin',
  'ANIM_rotate 1 0 0 0 60 0 1 sim/cockpit2/controls/flap_ratio',
  'ATTR_manip_drag_rotate\thand\t-0.1\t-0.0069\t2.25\t1.000\t0.000\t-0.000\t0.000\t45.000\t0.003\t0.000\t1.000\t0.000\t0.003\tsim/cockpit2/controls/flap_ratio\tlaminar/B738/handles/flap_lever/stop_pos\tFlap Handle',
  'TRIS 0 6',
  'ANIM_end',
  'ATTR_draw_enable',
  'TRIS 6 6',
].join('\n')

describe('manipulators', () => {
  const plain = parseObj8(OBJ)
  const withHits = parseObj8(OBJ, { hitBoxes: true })
  it('the default parse still drops every disabled draw (visible geometry only)', () => {
    expect(plain.draws).toHaveLength(1)
    expect(plain.draws.every((d) => !d.hidden)).toBe(true)
  })
  it('with hit boxes on, each disabled draw that sits under a manipulator is kept and marked hidden', () => {
    const hits = withHits.draws.filter((d) => d.hidden)
    expect(hits).toHaveLength(6)                                  // 5 flat ones + the flap lever inside its anim block
    expect(withHits.draws.filter((d) => !d.hidden)).toHaveLength(1)
  })
  it('knows each manipulator: type, commands or datarefs, and the tooltip', () => {
    const m = withHits.draws.filter((d) => d.hidden).map((d) => d.manip!)
    expect(m[0]).toMatchObject({ type: 'command', cursor: 'button', commands: ['laminar/B738/autopilot/hdg_sel_press'], tooltip: 'HDG SEL Mode' })
    expect(m[1]).toMatchObject({ type: 'command_knob', commands: ['sim/autopilot/heading_up', 'sim/autopilot/heading_down'], tooltip: 'AP Heading' })
    expect(m[2]).toMatchObject({ type: 'command_switch_up_down', commands: ['sim/autopilot/autothrottle_arm', 'sim/autopilot/autothrottle_hard_off'], tooltip: 'Autothrottle ARM' })
    expect(m[3]).toMatchObject({ type: 'toggle', datarefs: ['sim/cockpit2/switches/landing_lights_switch[0]'], tooltip: 'Wingroot Left Landing Light' })
    expect(m[4]).toMatchObject({ type: 'axis_knob', datarefs: ['sim/cockpit2/EFIS/map_range'], tooltip: 'CAPT EFIS Range' })
    expect(m[5]).toMatchObject({ type: 'drag_rotate', datarefs: ['sim/cockpit2/controls/flap_ratio', 'laminar/B738/handles/flap_lever/stop_pos'], tooltip: 'Flap Handle' })
  })
  it('a hit box inside an animation block keeps that block, so it follows the lever', () => {
    const lever = withHits.draws.find((d) => d.manip?.type === 'drag_rotate')!
    expect(lever.animPath).toHaveLength(1)
  })
  it('hit boxes build as invisible meshes under their anim groups, never drawn but raycastable', () => {
    const built = buildObj8(withHits, makeObj8Material({}, withHits), { hitBoxes: true })
    expect(built.hits).toHaveLength(6)
    for (const h of built.hits) {
      expect(h.visible).toBe(false)
      expect((h.userData.manip as { tooltip: string }).tooltip).toBeTruthy()
    }
    const ray = new THREE.Raycaster(new THREE.Vector3(0.5, 0.5, 5), new THREE.Vector3(0, 0, -1))
    built.group.updateMatrixWorld(true)
    const hitMat = (built.hits[0]!.material as THREE.Material)
    expect(hitMat.side).toBe(THREE.DoubleSide)
    expect(ray.intersectObjects(built.hits, false).length).toBeGreaterThan(0)
    // the flat hit boxes are not part of the drawn scene
    let drawn = 0
    built.group.traverse((o) => { if (o instanceof THREE.Mesh && o.visible) drawn++ })
    expect(drawn).toBe(1)
  })
  it('without the option nothing extra is built', () => {
    expect(buildObj8(plain, makeObj8Material({}, plain)).hits).toHaveLength(0)
  })
})

describe('the light airplanes\' manipulators (lines from the X-Plane C172 and Baron click maps)', () => {
  const HEAD = ['I', '800', 'OBJ', 'POINT_COUNTS 4 0 0 6', 'VT 0 0 0 0 1 0 0 0', 'VT 1 0 0 0 1 0 1 0', 'VT 1 1 0 0 1 0 1 1', 'VT 0 1 0 0 1 0 0 1', 'IDX 0', 'IDX 1', 'IDX 2', 'IDX 0', 'IDX 2', 'IDX 3', 'ATTR_draw_disable']
  const manipOf = (...lines: string[]) => parseObj8([...HEAD, ...lines, 'TRIS 0 6'].join('\n'), { hitBoxes: true }).draws[0]?.manip

  it('a sliding lever names its dataref and tooltip after five numbers', () => {
    expect(manipOf('ATTR_manip_drag_axis hand 0.000000 0.000000 -0.060000 0.000000 1.000000 sim/cockpit2/engine/actuators/throttle_ratio[0] Throttle'))
      .toMatchObject({ type: 'drag_axis', datarefs: ['sim/cockpit2/engine/actuators/throttle_ratio[0]'], tooltip: 'Throttle' })
    expect(manipOf('ATTR_manip_drag_axis hand 0.000000 -0.050285 0.000000 0.000000 1.000000 sim/cockpit2/controls/flap_ratio Flaps handle'))
      .toMatchObject({ datarefs: ['sim/cockpit2/controls/flap_ratio'], tooltip: 'Flaps handle' })
  })

  it('a mouse-wheel step or a detent belongs to the manipulator before it and does not replace it', () => {
    const m = manipOf(
      'ATTR_manip_drag_rotate hand -0.054190 -0.213776 0.328208\t1.000000 0.000000 0.000000\t-1440.000000 1440.000000 0.000000\t-1.000000 1.000000  0.000000 0.000000 sim/cockpit2/controls/elevator_trim none Elevator trim',
      'ATTR_manip_keyframe 0.000000 0.000000', 'ATTR_manip_wheel 0.005000')
    expect(m).toMatchObject({ type: 'drag_rotate', datarefs: ['sim/cockpit2/controls/elevator_trim', 'none'], tooltip: 'Elevator trim' })
  })

  it('reads the one-command switch, the wrapping button and the two-axis yoke', () => {
    expect(manipOf('ATTR_manip_command_switch_up_down2 up_down sim/lights/landing_lights_toggle Landing lights'))
      .toMatchObject({ type: 'command_switch_up_down2', commands: ['sim/lights/landing_lights_toggle'], tooltip: 'Landing lights' })
    expect(manipOf('ATTR_manip_wrap button 1 0 0 2 laminar/c172/knob_OAT Toggle from OAT'))
      .toMatchObject({ type: 'wrap', datarefs: ['laminar/c172/knob_OAT'], tooltip: 'Toggle from OAT' })
    expect(manipOf('ATTR_manip_drag_xy four_arrows 100.000000 100.000000 -1.000000 1.000000 1.000000 -1.000000 sim/cockpit2/controls/yoke_roll_ratio sim/cockpit2/controls/yoke_pitch_ratio Yoke'))
      .toMatchObject({ type: 'drag_xy', datarefs: ['sim/cockpit2/controls/yoke_roll_ratio', 'sim/cockpit2/controls/yoke_pitch_ratio'], tooltip: 'Yoke' })
  })
})
