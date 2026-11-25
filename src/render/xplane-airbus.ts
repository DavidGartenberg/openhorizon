import * as THREE from 'three'
import { ROSTER } from '../sim/aircraft/roster'
import { jetProfileFor } from './jet-profiles'
import type { LoadXpCockpitOptions, XpCockpitModel } from './xplane-cockpit'
import { makeXpDatarefReader, type XpCockpitInputs } from './xplane-datarefs'
import type { PanelRect } from './xplane-panel'

// A330.acf attachments 17–31, 35, 37–38 are on the aircraft datum.
// Attachment 36 (cockpit_OUT) is for the outside view, not the flight deck.
const part = (file: string) => `objects/cockpit/${file}.obj`
export const XP_COCKPIT_A333 = {
  folder: 'Airbus A330-300',
  objs: [
    ...Array.from({ length: 9 }, (_, i) => part(`A330_int${i + 1}`)),
    part('standby_compass'), part('FMS'), part('cockpit_annunciators'),
    ...['A330_Interior_Glass_2', 'A330_Interior_Transparent_Edges', 'A330_Interior_Transparent',
      'A330_glass_interior', 'A330_cockpit_windows_interior'].map(name => ({ path: part(name), glass: true })),
  ],
  panelObj: part('A330_cockpit'),
  panelKind: 'airbus',
  cgFt: [0, -3.28, 97],
  eyeObj: [-1.61 * .3048, 3.22 * .3048, 7.91 * .3048],
} satisfies XpCockpitModel

const AIRBUS_TYPES = new Set(ROSTER.filter(r => r.spec.label.startsWith('Airbus ')).map(r => r.spec.designator))

export function airbusCockpitFor(key: string): XpCockpitModel | undefined {
  return AIRBUS_TYPES.has(key) ? XP_COCKPIT_A333 : undefined
}

/** Variants keep their own exterior. Fit the donor cross-section and preserve
 * the captain's relative position in the nose, rather than stretching a deck
 * according to the overall airframe length (fuselage plugs are aft of the deck). */
export function airbusCockpitFit(key: string, lengthM: number): LoadXpCockpitOptions['place'] {
  if (key === 'A333') return undefined
  const scale = jetProfileFor(key).diameter / jetProfileFor('A333').diameter
  const model = XP_COCKPIT_A333
  const a330EyeForward = model.cgFt[2] * .3048 - model.eyeObj[2]
  const eyeToNose = 63.67 / 2 - a330EyeForward
  return { scale, eye: {
    x: lengthM / 2 - eyeToNose * scale,
    y: model.eyeObj[0] * scale,
    up: (model.eyeObj[1] - model.cgFt[1] * .3048) * scale,
  } }
}

const rect = (x0: number, y0: number, x1: number, y1: number): PanelRect => ({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })

/** Measured from the six screen faces under ATTR_cockpit_lit_only in
 * A330_cockpit.obj. Pixels in the authored 2048 × 1024 atlas, top-left origin. */
export const XP_A333_DISPLAYS = {
  captPfd: rect(5, 5, 507, 507), captNd: rect(517, 5, 1019, 507),
  upper: rect(1029, 5, 1531, 507), lower: rect(1541, 5, 2043, 507),
  foPfd: rect(5, 517, 507, 1019), foNd: rect(517, 517, 1019, 1019),
  standby: rect(1029, 514, 1406, 891),
} as const

export class XpAirbusPanel {
  readonly canvas = document.createElement('canvas')
  readonly texture: THREE.CanvasTexture
  private readonly ctx: CanvasRenderingContext2D

  constructor() {
    this.canvas.width = 2048; this.canvas.height = 1024
    const ctx = this.canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('Airbus panel: no 2D canvas context')
    this.ctx = ctx
    ctx.fillStyle = '#050706'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 8
  }

  display(name: keyof typeof XP_A333_DISPLAYS, draw: (ctx: CanvasRenderingContext2D, size: number) => void): void {
    const { x, y, w, h } = XP_A333_DISPLAYS[name], c = this.ctx
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.translate(x, y)
    c.fillStyle = '#050706'; c.fillRect(0, 0, w, h)
    draw(c, Math.min(w, h)); c.restore()
  }

  copy(from: 'captPfd' | 'captNd', to: 'foPfd' | 'foNd'): void {
    const a = XP_A333_DISPLAYS[from], b = XP_A333_DISPLAYS[to]
    this.ctx.drawImage(this.canvas, a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h)
  }

  /** FCU digits use the A330.acf panel positions (canvas y = 768 − POS y). */
  fcu(s: { iasKt: number; hdgDeg: number; altFt: number; vsFpm: number; vsActive: boolean }): void {
    const c = this.ctx
    c.fillStyle = '#050706'; c.fillRect(1029, 897, 747, 50)
    c.fillStyle = '#ffc961'; c.font = 'bold 25px monospace'; c.textBaseline = 'middle'; c.textAlign = 'center'
    c.fillText(String(Math.round(s.iasKt)).padStart(3, '0'), 1088, 931)
    c.fillText(String(Math.round(s.hdgDeg) % 360).padStart(3, '0'), 1231, 931)
    c.fillText(String(Math.round(s.altFt)).padStart(5, '0'), 1559, 931)
    c.fillText(s.vsActive ? `${s.vsFpm >= 0 ? '+' : '−'}${String(Math.abs(Math.round(s.vsFpm))).padStart(4, '0')}` : '----', 1705, 931)
  }

  commit(): void { this.texture.needsUpdate = true }
  dispose(): void { this.texture.dispose() }
}

interface AirbusControls { flapIndex: number; flapCount: number; headingDeg: number }

/** Airbus-specific datarefs use the donor's authored ranges; common jet
 * controls share the existing reader. Unsupported systems stay unmodeled. */
export function makeAirbusDatarefReader(s: XpCockpitInputs, a: AirbusControls, overrides: Record<string, number>): (ref: string) => number {
  const common = makeXpDatarefReader(s, overrides)
  const bit = (v: boolean) => v ? 1 : 0
  const lamp = 'laminar/A333/annun/autopilot/'
  const button = (mode: string) => bit((s.mcp.pressedAgoS[mode] ?? Infinity) < .14)
  return ref => {
    if (Object.prototype.hasOwnProperty.call(overrides, ref)) return overrides[ref]!
    switch (ref) {
      case 'sim/cockpit2/controls/yoke_pitch_ratio':
      case 'sim/cockpit2/controls/yoke_pitch_ratio_copilot': return s.pitch
      case 'sim/cockpit2/controls/yoke_roll_ratio':
      case 'sim/cockpit2/controls/yoke_roll_ratio_copilot': return s.roll
      case 'sim/cockpit2/controls/flap_handle_request_ratio': return a.flapIndex / Math.max(1, a.flapCount - 1)
      case 'sim/cockpit2/controls/speedbrake_ratio': return s.speedbrakeArmed && s.speedbrake < .02 ? -.5 : s.speedbrake
      case 'sim/cockpit2/gauges/indicators/compass_heading_deg_mag': return a.headingDeg
      case 'sim/cockpit2/engine/actuators/throttle_jet_rev_ratio_all': return common('sim/cockpit2/engine/actuators/throttle_jet_rev_ratio[0]')
      case 'laminar/A333/switches/park_brake_pos': return bit(s.parkingBrake)
      case `${lamp}ap1_mode`: return bit(s.mcp.master)
      case `${lamp}ap2_mode`: return 0 // OpenHorizon models one AP channel.
      case `${lamp}a_thr_mode`: return bit(s.mcp.atArm)
      case `${lamp}alt_mode`: return bit(s.mcp.vertical === 'ALT')
      case `${lamp}appr_mode`: return bit(s.mcp.lateral === 'APR' && s.mcp.vertical === 'GS')
      case `${lamp}loc_mode`: return bit(s.mcp.lateral === 'APR' && s.mcp.vertical !== 'GS')
      case 'laminar/A333/autopilot/ap1_pos': return button('ap')
      case 'laminar/A333/autopilot/appr_pos': return button('apr')
      case 'laminar/A333/autopilot/alt_pos': return button('alt')
      case 'laminar/A333/autopilot/loc_pos': return button('nav')
      case 'laminar/A333/autopilot/knobs/speed_pos': return s.mcp.iasKt
      case 'laminar/A333/autopilot/knobs/heading_pos': return s.mcp.headingDeg
      case 'laminar/A333/autopilot/knobs/altitude_pos': return s.mcp.altitudeFt / 100
      case 'laminar/A333/autopilot/knobs/vertical_pos': return s.mcp.vsFpm / 100
    }
    // Authored panel/overhead backlight groups, not warning annunciators.
    if (/^sim\/cockpit2\/(?:switches|electrical)\/instrument_brightness_ratio(?:_manual|_auto)?\[\d+\]$/.test(ref)) return s.panelLight
    return common(ref)
  }
}
