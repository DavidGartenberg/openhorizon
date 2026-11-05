import * as THREE from 'three'
import type { Obj8Manip } from './xplane-obj8'

/**
 * Operating the X-Plane flight deck with the mouse.
 *
 * The airplane's own `b738_cockpit.obj` describes every control as a
 * manipulator — a hidden hit box plus what a click does in X-Plane (a command,
 * a knob's up/down commands, a switch, a lever drag). This module turns each
 * manipulator into the matching action of THIS simulator (an autopilot button,
 * the flap handle, the gear lever …); the host (main.ts) carries the action
 * out through the same functions the keyboard uses. A control this simulator
 * has no system for says so by its own name rather than pretending.
 */

export type XpAction =
  | { kind: 'ap'; button: 'ap' | 'hdg' | 'nav' | 'apr' | 'alt' | 'vs' | 'flc' }
  | { kind: 'speed' }
  | { kind: 'disengage' }
  | { kind: 'apTurn'; knob: 'heading' | 'altitude' | 'ias' | 'vs'; steps: number }
  | { kind: 'atSwitch'; arm: boolean }
  | { kind: 'atDisconnect' }
  | { kind: 'flaps'; steps: number }
  | { kind: 'gear' }
  | { kind: 'speedbrake' }
  | { kind: 'parking' }
  | { kind: 'autobrake'; steps: number }
  | { kind: 'landingLights' }
  | { kind: 'baro'; steps: number }
  | { kind: 'course'; steps: number }
  | { kind: 'unsimulated'; tooltip: string }
  /** A held drag on a lever or wheel: how far the pointer moved since the last frame (pixels, down is positive). */
  | { kind: 'drag'; control: 'throttle' | 'trim'; dyPx: number }
  | { kind: 'none' }

/** Where the pointer is on a control (relative to its centre), and the wheel travel if the wheel was used. */
export interface XpPress { right: boolean; upper: boolean; wheel?: number }

const PRESS_BUTTONS: Record<string, XpAction> = {
  'laminar/B738/autopilot/hdg_sel_press': { kind: 'ap', button: 'hdg' },
  'laminar/B738/autopilot/lnav_press': { kind: 'ap', button: 'nav' },
  'laminar/B738/autopilot/vorloc_press': { kind: 'ap', button: 'nav' },
  'laminar/B738/autopilot/app_press': { kind: 'ap', button: 'apr' },
  'laminar/B738/autopilot/alt_hld_press': { kind: 'ap', button: 'alt' },
  'laminar/B738/autopilot/vs_press': { kind: 'ap', button: 'vs' },
  'laminar/B738/autopilot/lvl_chg_press': { kind: 'ap', button: 'flc' },
  'laminar/B738/autopilot/cmd_a_press': { kind: 'ap', button: 'ap' },
  'laminar/B738/autopilot/cmd_b_press': { kind: 'ap', button: 'ap' },
  'laminar/B738/autopilot/speed_press': { kind: 'speed' },
  'laminar/B738/autopilot/disconnect_toggle': { kind: 'disengage' },
  'laminar/B738/autopilot/capt_autothro_disco_press': { kind: 'atDisconnect' },
  'laminar/B738/autopilot/fo_autothro_disco_press': { kind: 'atDisconnect' },
  'sim/flight_controls/park_brake_valve_toggle': { kind: 'parking' },
}

/** Knob command pairs, first = up/clockwise, second = down/counter-clockwise. */
const KNOBS: Array<[string, (steps: number) => XpAction]> = [
  ['sim/autopilot/heading_up', (steps) => ({ kind: 'apTurn', knob: 'heading', steps })],
  ['sim/autopilot/altitude_up', (steps) => ({ kind: 'apTurn', knob: 'altitude', steps })],
  ['sim/autopilot/airspeed_up', (steps) => ({ kind: 'apTurn', knob: 'ias', steps })],
  ['sim/autopilot/vertical_speed_up', (steps) => ({ kind: 'apTurn', knob: 'vs', steps })],
  ['sim/flight_controls/brakes_up_auto', (steps) => ({ kind: 'autobrake', steps })],
  ['sim/instruments/barometer_up', (steps) => ({ kind: 'baro', steps })],
  ['sim/radios/obs_HSI_up', (steps) => ({ kind: 'course', steps })],
]

/** Levers and wheels that follow the pointer while it is held on them. */
const DRAGGABLE: Record<string, 'throttle' | 'trim'> = {
  'sim/cockpit2/engine/actuators/throttle_jet_rev_ratio[0]': 'throttle',
  'sim/cockpit2/engine/actuators/throttle_jet_rev_ratio[1]': 'throttle',
  'sim/cockpit2/engine/actuators/throttle_jet_rev_ratio_all': 'throttle',
  'sim/cockpit2/controls/elevator_trim': 'trim',
}
export const dragControlOf = (m: Obj8Manip): 'throttle' | 'trim' | null => (m.type === 'drag_rotate' ? DRAGGABLE[m.datarefs[0] ?? ''] ?? null : null)

const wheelSteps = (wheel: number): number => -Math.sign(wheel) * Math.max(1, Math.round(Math.abs(wheel)))

/** What clicking (or wheeling over) this manipulator does in this simulator. */
export function xpActionFor(m: Obj8Manip, press: XpPress): XpAction {
  const unsimulated: XpAction = { kind: 'unsimulated', tooltip: m.tooltip || m.commands[0] || m.datarefs[0] || 'control' }
  const cmd = m.commands[0] ?? ''
  const dr = m.datarefs[0] ?? ''
  switch (m.type) {
    case 'noop': return { kind: 'none' }
    case 'command': {
      const a = PRESS_BUTTONS[cmd]
      return a ?? unsimulated
    }
    case 'command_knob': {
      const k = KNOBS.find(([up]) => up === cmd)
      if (!k) return unsimulated
      const steps = press.wheel !== undefined && press.wheel !== 0 ? wheelSteps(press.wheel) : press.right ? 1 : -1
      return k[1](steps)
    }
    case 'command_switch_up_down': {
      if (cmd === 'sim/autopilot/autothrottle_arm') return { kind: 'atSwitch', arm: press.upper }
      if (cmd === 'sim/autopilot/vertical_speed_down') return { kind: 'apTurn', knob: 'vs', steps: press.upper ? -1 : 1 }
      if (cmd === 'sim/autopilot/vertical_speed_up') return { kind: 'apTurn', knob: 'vs', steps: press.upper ? 1 : -1 }
      return unsimulated
    }
    case 'toggle':
      if (/^sim\/cockpit2\/switches\/landing_lights_switch\[\d\]$/.test(dr)) return { kind: 'landingLights' }
      return unsimulated
    case 'drag_rotate': {
      if (dragControlOf(m)) return { kind: 'none' }        // held-drag levers act while the button is down, not on the click itself
      if (dr === 'sim/cockpit2/controls/flap_ratio') {
        // The lever moves down to extend: the lower half and scrolling down give a gate more flap.
        if (press.wheel) return { kind: 'flaps', steps: Math.sign(press.wheel) * Math.max(1, Math.round(Math.abs(press.wheel))) }
        return { kind: 'flaps', steps: press.upper ? -1 : 1 }
      }
      if (dr === 'sim/cockpit2/controls/gear_handle_animation') return { kind: 'gear' }
      if (dr === 'laminar/B738/flt_ctrls/speedbrake_lever') return { kind: 'speedbrake' }
      return unsimulated
    }
    default: return unsimulated
  }
}

/** The line shown when an action gives no other feedback (empty = the cockpit itself shows it). */
export function describeXpAction(a: XpAction): string {
  return a.kind === 'unsimulated' ? `${a.tooltip.toUpperCase()} — NOT SIMULATED` : ''
}

// ----------------------------------------------------------------- pointer --

export interface XpPointer {
  x: number
  y: number
  w: number
  h: number
  pressed: boolean
  down: boolean
  released: boolean
  wheel: number
}

export interface XpHover { mesh: THREE.Mesh; manip: Obj8Manip }

const _box = new THREE.Box3()
const _center = new THREE.Vector3()

/**
 * Raycasts the pointer against the manipulators' hit boxes. Owns no simulation
 * state: `update` returns what was hovered and the actions to carry out.
 */
export class XpInteraction {
  private readonly raycaster = new THREE.Raycaster()
  private readonly ndc = new THREE.Vector2()
  /** The control the button went down on, until it is released (the camera must not look around meanwhile). */
  private grabbed: XpHover | null = null
  private dragLastY = 0

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  get isDraggingControl(): boolean { return this.grabbed !== null }

  /** Nearest manipulator under the pointer, else null. */
  pick(p: XpPointer, hits: readonly THREE.Object3D[]): XpHover | null {
    if (p.w <= 0 || p.h <= 0 || !hits.length) return null
    this.ndc.set((p.x / p.w) * 2 - 1, -(p.y / p.h) * 2 + 1)
    this.raycaster.setFromCamera(this.ndc, this.camera)
    for (const h of this.raycaster.intersectObjects(hits as THREE.Object3D[], false)) {
      const manip = h.object.userData.manip as Obj8Manip | undefined
      if (manip && manip.type !== 'noop') return { mesh: h.object as THREE.Mesh, manip }
    }
    return null
  }

  /** Which half of the control the pointer is on: screen-space relative to the box's centre. */
  half(p: XpPointer, mesh: THREE.Mesh): { right: boolean; upper: boolean } {
    const geo = mesh.geometry
    if (!geo.boundingBox) geo.computeBoundingBox()
    _box.copy(geo.boundingBox!).applyMatrix4(mesh.matrixWorld)
    _box.getCenter(_center).project(this.camera)
    const cx = ((_center.x + 1) / 2) * p.w, cy = ((1 - _center.y) / 2) * p.h
    return { right: p.x >= cx, upper: p.y <= cy }
  }

  /** One frame: returns the hovered control and the actions for presses and wheel turns on it. */
  update(p: XpPointer, hits: readonly THREE.Object3D[]): { hover: XpHover | null; actions: XpAction[] } {
    const hover = this.pick(p, hits)
    const actions: XpAction[] = []
    if (p.pressed && hover) {
      this.grabbed = hover
      this.dragLastY = p.y
      actions.push(xpActionFor(hover.manip, this.half(p, hover.mesh)))
    } else if (this.grabbed && p.down && dragControlOf(this.grabbed.manip)) {
      const dy = p.y - this.dragLastY
      this.dragLastY = p.y
      if (dy !== 0) actions.push({ kind: 'drag', control: dragControlOf(this.grabbed.manip)!, dyPx: dy })
    } else if (p.wheel !== 0 && hover) {
      actions.push(xpActionFor(hover.manip, { ...this.half(p, hover.mesh), wheel: p.wheel }))
    }
    if (p.released || !p.down) this.grabbed = null
    return { hover, actions: actions.filter((a) => a.kind !== 'none') }
  }
}
