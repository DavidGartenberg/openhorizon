import * as THREE from 'three'
import { build737Deck, type Deck737 } from './cockpit-737'
import type { Input } from '../input/input'
import { drawPfd, type PfdInput } from '../cockpit/pfd'
import { drawMfd, mfdSoftkeyRegions, type MfdInput } from '../cockpit/mfd'
import type { MagnetoPosition } from '../sim/systems/engine-start'
import type { FuelSelector } from '../sim/systems/fuel'

/**
 * 3D cockpit interior (Phase 3 §8 / Task 2d). Built from three.js primitives,
 * exactly like `aircraft-mesh.ts`'s exterior — there is no glTF/Blender asset
 * pipeline available in this environment, so "proper glTF exterior/interior"
 * from the original phase-3 plan note is not achievable here. This is an
 * honest deviation, flagged in the task report, not a silent downgrade.
 *
 * Panel photo-match layout (§8): PFD (left) / MFD (center) as canvas-texture
 * planes, a placeholder standby cluster left of the PFD, a switch row
 * bottom-left, ignition key + starter, throttle/mixture vernier knobs, a
 * flap lever with 4 detents, a trim wheel, a floor fuel selector, and a
 * yoke that mirrors `aircraft.controls.pitch`/`roll` visually. All of this
 * geometry lives in the aircraft's own BODY frame (x fwd, y right, z down)
 * and is added as a child of `aircraft-mesh.ts`'s `mesh.group`, so it
 * automatically tracks the aircraft's position/attitude — no separate
 * per-frame placement math needed for the cockpit shell itself (only the
 * animated controls: knobs, levers, wheel, yoke).
 *
 * Panel/control *positions* below are layout choices with no in-repo source
 * (same status as `aircraft-mesh.ts`'s primitive dimensions) — flagged as
 * assumptions, not POH data. No flight-relevant numbers are invented here.
 */

// ============================================================================
// Pure logic (unit-tested in tests/render/cockpit.test.ts)
// ============================================================================

/** Click-cycle order for the floor fuel selector (Task 2d control mapping).
 *  OFF -> L -> BOTH -> R -> OFF. Order itself is a UI layout choice — the
 *  underlying `FuelSelector` semantics (starvation on an empty selected
 *  tank, etc.) are `fuel.ts`'s, untouched here. */
export function cycleFuelSelector(current: FuelSelector): FuelSelector {
  const order: FuelSelector[] = ['OFF', 'L', 'BOTH', 'R']
  const i = order.indexOf(current)
  return order[(i + 1) % order.length]!
}

/** One detent step for the ignition key (15c detent-order fix): a real
 *  key walks ADJACENT detents — off ↔ right ↔ left ↔ both — it cannot
 *  jump both→off in one click (the old wrap was a one-click engine
 *  kill). Clicks ping-pong: advance to `both`, then walk back down; the
 *  starter is a separate momentary push (`starterEngaged`). */
export function stepMagneto(current: MagnetoPosition, dir: 1 | -1): MagnetoPosition {
  const order: MagnetoPosition[] = ['off', 'right', 'left', 'both']
  const i = Math.max(0, order.indexOf(current))
  return order[Math.min(Math.max(i + dir, 0), order.length - 1)]!
}

/** Map a total drag distance (px) since grabbing a control to an absolute
 *  value in [min, max], clamped — shared math behind the throttle/mixture
 *  vernier knobs and the trim wheel. `pxForFullRange` is the drag distance
 *  that spans the whole [min, max] range (a layout/feel choice). */
export function dragToAxisValue(startValue: number, dragPxTotal: number, pxForFullRange: number, min: number, max: number): number {
  if (pxForFullRange <= 0) return Math.min(max, Math.max(min, startValue))
  const span = max - min
  return Math.min(max, Math.max(min, startValue + (dragPxTotal / pxForFullRange) * span))
}

/** Snap a continuous [0,1] lever position to the nearest of `detentCount`
 *  evenly spaced detents (the flap lever's 0/10/20/30° positions), returned
 *  as a detent index. */
export function nearestFlapDetent(fraction: number, detentCount = 4): number {
  const clamped = Math.min(Math.max(fraction, 0), 1)
  return Math.round(clamped * (detentCount - 1))
}

/** Click-increment/decrement a radio's standby frequency by one step,
 *  clamped to [minMhz, maxMhz] (Phase 4 Task 6 NAV/COM tuning knobs) — a
 *  simplified stand-in for a real G1000 dual-concentric knob's drag-to-
 *  rotate feel, matching the coarse click-cycle interaction style already
 *  used for the fuel selector/ignition key above rather than inventing a
 *  new drag paradigm. Rounds to avoid float drift after repeated clicks
 *  (e.g. 118.000 + 0.025 * n staying on exact channel spacing). */
export function tuneFrequency(standbyMhz: number, deltaSteps: number, stepMhz: number, minMhz: number, maxMhz: number): number {
  const raw = standbyMhz + deltaSteps * stepMhz
  const clamped = Math.min(maxMhz, Math.max(minMhz, raw))
  return Math.round(clamped * 1000) / 1000
}

// ============================================================================
// Meshes
// ============================================================================

const PANEL_DARK = new THREE.MeshStandardMaterial({ color: 0x232629, roughness: 0.8 })
const BEZEL = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.6 })
const KNOB = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.5, metalness: 0.3 })
const RED_KNOB = new THREE.MeshStandardMaterial({ color: 0x8a1f1f, roughness: 0.5 })
const BLACK_KNOB = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 })
const SWITCH_OFF = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.7 })
const SWITCH_ON = new THREE.MeshStandardMaterial({ color: 0x1f8a3a, roughness: 0.4, emissive: 0x0a3d16 })
const YOKE_MAT = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 })


/** Cockpit glazing: a faint blue-grey tint so the windshield reads as
 *  GLASS (an empty hole read as a missing wall — user: "make the cockpits
 *  look perfect"). Additive-free, depthWrite off so it never occludes. */
const GLAZING = new THREE.MeshStandardMaterial({
  color: 0x9fb4c4, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide,
})

/** G1000 panel face painter (C172S): the flat black box read as "no
 *  panel". Cessna-grey face, DU bezels with painted softkey rows and
 *  bezel knobs, the audio panel between the displays, standby-cluster
 *  bezels, the switch/breaker rows with labels, placard and screws —
 *  cosmetic and recorded as such; the LIVE PFD/MFD/standby planes render
 *  just proud of the painted glass regions. Panel plane: 1.13 m wide
 *  centered lat 0.02, 0.52 m tall centered up 0.43. */
function drawGaPanel(c: CanvasRenderingContext2D): void {
  const W = 1536
  const H = 704
  const px = (lat: number): number => ((lat - 0.02 + 0.565) / 1.13) * W
  const py = (up: number): number => ((0.26 - (up - 0.43)) / 0.52) * H
  const sx = (m: number): number => (m / 1.13) * W
  const sy = (m: number): number => (m / 0.52) * H
  c.fillStyle = '#8b8d88'
  c.fillRect(0, 0, W, H)
  const grad = c.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, 'rgba(255,255,255,0.08)')
  grad.addColorStop(1, 'rgba(0,0,0,0.16)')
  c.fillStyle = grad
  c.fillRect(0, 0, W, H)
  const screw = (x: number, y: number): void => {
    c.fillStyle = 'rgba(35,35,35,0.9)'
    c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill()
    c.strokeStyle = 'rgba(210,210,210,0.55)'; c.lineWidth = 1.5
    c.beginPath(); c.moveTo(x - 3, y); c.lineTo(x + 3, y); c.stroke()
  }
  // DU bezels: glass 0.42×0.32 centered (lat, up 0.42); frame + softkeys.
  for (const lat of [-0.24, 0.15]) {
    const w = sx(0.42), h = sy(0.32)
    const x = px(lat) - w / 2, y = py(0.42) - h / 2
    c.fillStyle = '#2a2c2e'
    c.beginPath(); c.roundRect(x - 26, y - 22, w + 52, h + 62, 12); c.fill()
    c.fillStyle = '#0a0b0c'
    c.beginPath(); c.roundRect(x, y, w, h, 6); c.fill()
    // softkey row under the glass
    for (let i = 0; i < 12; i++) {
      const bx = x + 14 + i * ((w - 28) / 12)
      c.fillStyle = '#4a4d50'
      c.beginPath(); c.roundRect(bx, y + h + 12, (w - 28) / 12 - 6, 20, 3); c.fill()
    }
    // bezel knobs left/right (NAV/COM, FMS)
    for (const kx of [x - 14, x + w + 14]) {
      for (const ky of [y + 34, y + h - 34]) {
        c.fillStyle = '#1e1f21'
        c.beginPath(); c.arc(kx, ky, 14, 0, Math.PI * 2); c.fill()
        c.fillStyle = '#5a5d60'
        c.beginPath(); c.arc(kx, ky, 8, 0, Math.PI * 2); c.fill()
      }
    }
    screw(x - 20, y - 16); screw(x + w + 20, y - 16); screw(x - 20, y + h + 48); screw(x + w + 20, y + h + 48)
  }
  // Audio panel strip between the displays.
  {
    const x0 = px(-0.045), x1 = px(-0.005)
    const y0 = py(0.58), y1 = py(0.27)
    c.fillStyle = '#2a2c2e'
    c.beginPath(); c.roundRect(x0, y0, x1 - x0, y1 - y0, 6); c.fill()
    for (let i = 0; i < 9; i++) {
      c.fillStyle = i % 3 === 0 ? '#6fbf73' : '#4a4d50'
      c.fillRect(x0 + 6, y0 + 10 + i * ((y1 - y0 - 20) / 9), x1 - x0 - 12, 10)
    }
  }
  // Standby cluster bezels (live faces render on a plane over these).
  for (const up of [0.62, 0.5, 0.38]) {
    const x = px(-0.5), y = py(up)
    c.fillStyle = '#1c1d1f'
    c.beginPath(); c.arc(x, y, sx(0.056), 0, Math.PI * 2); c.fill()
    c.strokeStyle = '#c9cac6'; c.lineWidth = 4
    c.beginPath(); c.arc(x, y, sx(0.056), 0, Math.PI * 2); c.stroke()
  }
  // Switch row labels + breaker rows along the bottom.
  c.fillStyle = '#1f2124'
  c.font = 'bold 15px sans-serif'
  c.textAlign = 'center'
  const labels = ['MASTER', 'ALT', 'AVION', 'PITOT', 'AP', 'PUMP']
  labels.forEach((l, i) => c.fillText(l, px(-0.5 + i * 0.045), py(0.185)))
  c.fillText('BREAKERS', px(0.55), py(0.34))
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < 9; i++) {
      c.fillStyle = '#d8d9d5'
      c.beginPath(); c.arc(px(0.42 + i * 0.03), py(0.3 - r * 0.045), 7, 0, Math.PI * 2); c.fill()
      c.strokeStyle = '#333'; c.lineWidth = 1.5
      c.beginPath(); c.arc(px(0.42 + i * 0.03), py(0.3 - r * 0.045), 7, 0, Math.PI * 2); c.stroke()
    }
  }
  c.fillStyle = '#2b2d30'
  c.font = 'bold 20px sans-serif'
  c.fillText('CESSNA 172S  ·  NAV III', px(0.02), py(0.185))
  c.font = 'bold 13px sans-serif'
  c.fillText('IGNITION', px(0.33), py(0.29))
  for (let x = 40; x < W; x += 300) { screw(x, 16); screw(x, H - 14) }
}

/** LIVE standby instruments for the G1000 layout — three stacked
 *  faces (airspeed / attitude / altimeter) read from the same PfdInput
 *  the PFD uses (§1: nothing synthesized). Canvas 256×768, one face per
 *  256×256 cell: top ASI, middle AI, bottom ALT. */
function drawStandbyCluster(c: CanvasRenderingContext2D, d: { iasKt: number; pitchDeg: number; rollDeg: number; altitudeFt: number }): void {
  const S = 256
  c.clearRect(0, 0, S, S * 3)
  const face = (cy: number): void => {
    c.fillStyle = '#111214'
    c.beginPath(); c.arc(S / 2, cy, S / 2 - 6, 0, Math.PI * 2); c.fill()
  }
  const tick = (cx: number, cy: number, ang: number, r0: number, r1: number, w: number, col: string): void => {
    c.strokeStyle = col; c.lineWidth = w
    c.beginPath(); c.moveTo(cx + Math.sin(ang) * r0, cy - Math.cos(ang) * r0); c.lineTo(cx + Math.sin(ang) * r1, cy - Math.cos(ang) * r1); c.stroke()
  }
  // ---- ASI (top): 40–160 kt over 300° ----
  {
    const cy = S / 2
    face(cy)
    const angOf = (kt: number): number => ((kt - 40) / 120) * (Math.PI * 5 / 3) - Math.PI * 5 / 6
    // arcs: white 40-85, green 48-129, yellow 129-163, red 163
    const arc = (a: number, b: number, col: string, r: number, w: number): void => {
      c.strokeStyle = col; c.lineWidth = w
      c.beginPath(); c.arc(S / 2, cy, r, angOf(a) - Math.PI / 2, angOf(b) - Math.PI / 2); c.stroke()
    }
    arc(48, 129, '#2ecc40', 104, 8); arc(40, 85, '#ffffff', 92, 6); arc(129, 160, '#f1c40f', 104, 8)
    for (let kt = 40; kt <= 160; kt += 10) {
      tick(S / 2, cy, angOf(kt), 96, kt % 20 === 0 ? 76 : 86, kt % 20 === 0 ? 4 : 2, '#eee')
      if (kt % 20 === 0) { c.fillStyle = '#eee'; c.font = 'bold 20px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(kt), S / 2 + Math.sin(angOf(kt)) * 60, cy - Math.cos(angOf(kt)) * 60) }
    }
    c.fillStyle = '#ccc'; c.font = 'bold 16px sans-serif'; c.fillText('KNOTS', S / 2, cy + 40)
    tick(S / 2, cy, angOf(Math.min(Math.max(d.iasKt, 40), 160)), -14, 90, 5, '#fff')
    c.fillStyle = '#ddd'; c.beginPath(); c.arc(S / 2, cy, 9, 0, Math.PI * 2); c.fill()
  }
  // ---- Attitude (middle) ----
  {
    const cy = S / 2 + S
    face(cy)
    c.save()
    c.beginPath(); c.arc(S / 2, cy, S / 2 - 14, 0, Math.PI * 2); c.clip()
    c.translate(S / 2, cy)
    c.rotate((-d.rollDeg * Math.PI) / 180)
    const shift = Math.max(Math.min(d.pitchDeg, 30), -30) * 3.2 // px per degree
    c.fillStyle = '#2e86de'; c.fillRect(-200, -200 + shift, 400, 200)
    c.fillStyle = '#8d5a2b'; c.fillRect(-200, shift, 400, 200)
    c.strokeStyle = '#fff'; c.lineWidth = 3
    c.beginPath(); c.moveTo(-200, shift); c.lineTo(200, shift); c.stroke()
    for (const pd of [-20, -10, 10, 20]) {
      const y = shift - pd * 3.2
      const len = pd % 20 === 0 ? 44 : 26
      c.lineWidth = 2
      c.beginPath(); c.moveTo(-len, y); c.lineTo(len, y); c.stroke()
    }
    c.restore()
    // fixed aircraft symbol + roll pointer
    c.strokeStyle = '#ffd166'; c.lineWidth = 5
    c.beginPath(); c.moveTo(S / 2 - 60, cy); c.lineTo(S / 2 - 22, cy); c.lineTo(S / 2 - 22, cy + 14); c.stroke()
    c.beginPath(); c.moveTo(S / 2 + 60, cy); c.lineTo(S / 2 + 22, cy); c.lineTo(S / 2 + 22, cy + 14); c.stroke()
    c.fillStyle = '#ffd166'; c.beginPath(); c.arc(S / 2, cy, 5, 0, Math.PI * 2); c.fill()
    for (const b of [-60, -30, -20, -10, 0, 10, 20, 30, 60]) tick(S / 2, cy, (b * Math.PI) / 180, 104, b % 30 === 0 ? 88 : 96, b === 0 ? 4 : 2, '#eee')
  }
  // ---- Altimeter (bottom): 100-ft needle + 1000-ft needle + digital ----
  {
    const cy = S / 2 + 2 * S
    face(cy)
    for (let i = 0; i < 50; i++) {
      const a = (i / 50) * Math.PI * 2
      tick(S / 2, cy, a, 108, i % 5 === 0 ? 90 : 100, i % 5 === 0 ? 4 : 2, '#eee')
      if (i % 5 === 0) { c.fillStyle = '#eee'; c.font = 'bold 22px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(i / 5), S / 2 + Math.sin(a) * 70, cy - Math.cos(a) * 70) }
    }
    const alt = d.altitudeFt
    tick(S / 2, cy, ((alt % 10_000) / 10_000) * Math.PI * 2, -8, 52, 8, '#fff') // 1000s (short)
    tick(S / 2, cy, ((alt % 1000) / 1000) * Math.PI * 2, -12, 92, 4, '#fff') // 100s (long)
    c.fillStyle = '#ddd'; c.beginPath(); c.arc(S / 2, cy, 8, 0, Math.PI * 2); c.fill()
    c.fillStyle = '#000'; c.fillRect(S / 2 - 46, cy + 38, 92, 26)
    c.fillStyle = '#fff'; c.font = 'bold 20px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'
    c.fillText(String(Math.round(alt)).padStart(5, ' '), S / 2, cy + 51)
  }
}

/** Place a mesh using BODY coordinates (x fwd, y right, z down) — same
 *  convention/helper as `aircraft-mesh.ts`'s `placeBody`, duplicated here to
 *  keep the two render modules independent. */
function placeBody(m: THREE.Object3D, x: number, y: number, z: number): void {
  m.position.set(y, -z, -x)
}

export type SwitchId = 'masterBattery' | 'masterAlternator' | 'avionicsSwitch' | 'pitotHeat' | 'apMaster' | 'boostPump'

export interface CockpitMeshes {
  group: THREE.Group
  pfdCanvas: HTMLCanvasElement
  pfdCtx: CanvasRenderingContext2D
  pfdTexture: THREE.CanvasTexture
  mfdCanvas: HTMLCanvasElement
  mfdCtx: CanvasRenderingContext2D
  mfdTexture: THREE.CanvasTexture
  /** G1000 layout: LIVE standby cluster (ASI/AI/ALT) canvas. */
  standby?: { ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture }
  switches: Record<SwitchId, THREE.Mesh>
  ignitionKey: THREE.Mesh
  starterButton: THREE.Mesh
  fuelSelectorKnob: THREE.Mesh
  throttleKnob: THREE.Mesh
  mixtureKnob: THREE.Mesh
  flapLever: THREE.Mesh
  trimWheel: THREE.Mesh
  yokeColumn: THREE.Mesh
  yokeWheel: THREE.Mesh
  /** NAV1/COM1 tuning knobs (Phase 4 Task 6) — click-increment/decrement
   *  buttons flanking each radio's standby-frequency position, plus a
   *  flip-flop swap button. NAV2/COM2 get modeled radio state (`main.ts`)
   *  but no physical knobs this task (scope cut, see task report). */
  nav1TuneUp: THREE.Mesh
  nav1TuneDown: THREE.Mesh
  nav1FlipFlop: THREE.Mesh
  com1TuneUp: THREE.Mesh
  com1TuneDown: THREE.Mesh
  com1FlipFlop: THREE.Mesh
  obs1Up: THREE.Mesh
  obs1Down: THREE.Mesh
  /** Every raycast-clickable/draggable object, tagged via `userData.controlId`. */
  interactive: THREE.Object3D[]
  /** Boeing 737NG flight deck (layout 'boeingNG'): the dedicated deck with
   *  its own live panels and control rig; displays use the Boeing formats
   *  (cockpit/boeing-displays.ts) on these square canvases. */
  deck737?: Deck737
  boeingScreens?: { eicas: { ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture }; isfd: { ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture } }
  /** Flap-lever detent count for drag mapping (default 4: the C172). */
  flapDetentCount?: number
}

const CANVAS_W = 1024
const CANVAS_H = 768
const MFD_CANVAS_W = 1024
const MFD_CANVAS_H = 768

function makeCanvasTexture(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable for cockpit canvas texture')
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return { canvas, ctx, texture }
}

function makeSwitch(label: string): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.02), SWITCH_OFF)
  m.userData.controlId = label
  return m
}

/** 737NG flight deck: the dedicated deck (cockpit-737.ts) plus inert,
 *  hidden stand-ins for the G1000-only slots of `CockpitMeshes`. */
function build737Cockpit(parent: THREE.Object3D, flapDetentsDeg: readonly number[], engines: number): CockpitMeshes {
  const group = new THREE.Group()
  const pfd = makeCanvasTexture(768, 768)
  const nd = makeCanvasTexture(768, 768)
  const eicas = makeCanvasTexture(768, 768)
  const isfd = makeCanvasTexture(256, 256)
  const deck = build737Deck(group, { pfd: pfd.texture, nd: nd.texture, eicas: eicas.texture, isfd: isfd.texture }, flapDetentsDeg, engines)
  const hidden = (): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.001, 0.001, 0.001), SWITCH_OFF)
    m.visible = false
    group.add(m)
    return m
  }
  const switches = {
    masterBattery: hidden(), masterAlternator: hidden(), avionicsSwitch: hidden(),
    pitotHeat: hidden(), apMaster: hidden(), boostPump: hidden(),
  } as Record<SwitchId, THREE.Mesh>
  parent.add(group)
  return {
    group,
    pfdCanvas: pfd.canvas, pfdCtx: pfd.ctx, pfdTexture: pfd.texture,
    mfdCanvas: nd.canvas, mfdCtx: nd.ctx, mfdTexture: nd.texture,
    switches,
    ignitionKey: hidden(), starterButton: hidden(), fuelSelectorKnob: hidden(), mixtureKnob: hidden(),
    throttleKnob: deck.throttleKnob, flapLever: deck.flapLever, trimWheel: deck.trimWheel,
    yokeColumn: deck.yokeColumn, yokeWheel: deck.yokeWheel,
    nav1TuneUp: hidden(), nav1TuneDown: hidden(), nav1FlipFlop: hidden(),
    com1TuneUp: hidden(), com1TuneDown: hidden(), com1FlipFlop: hidden(),
    obs1Up: hidden(), obs1Down: hidden(),
    interactive: deck.interactive,
    deck737: deck,
    boeingScreens: { eicas: { ctx: eicas.ctx, texture: eicas.texture }, isfd: { ctx: isfd.ctx, texture: isfd.texture } },
    flapDetentCount: flapDetentsDeg.length,
  }
}

/** Build the 3D cockpit interior and parent it under `parent` (the aircraft
 *  body group from `aircraft-mesh.ts`, so it tracks position/attitude for
 *  free). Returns handles used every frame to redraw the PFD/MFD canvases
 *  and animate the controls. */
export type PanelLayout = 'g1000' | 'boeingNG'

/** Pick the panel layout for a fleet member. Every jet and airliner
 *  (stabilizer-trim transports) flies the 737NG flight deck; everything
 *  else keeps the G1000. Pure — unit-tested. */
export function panelLayoutFor(_designator: string, trimIsStabilizer: boolean): PanelLayout {
  return trimIsStabilizer ? 'boeingNG' : 'g1000'
}

export function buildCockpit(parent: THREE.Object3D, layout: PanelLayout = 'g1000', flapDetentsDeg: readonly number[] = [0, 10, 20, 30], engines = 2): CockpitMeshes {
  // Jets and airliners fly the dedicated 737NG flight deck; everything
  // else (piston/turboprop/glider) keeps the G1000 panel below.
  if (layout === 'boeingNG') return build737Cockpit(parent, flapDetentsDeg, engines)
  const group = new THREE.Group()
  const interactive: THREE.Object3D[] = []
  const add = (mesh: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh => {
    placeBody(mesh, x, y, z)
    group.add(mesh)
    return mesh
  }

  // Panel shell (bezel) behind the screens. BoxGeometry(w,h,d) maps to
  // (render-X, render-Y, render-Z) directly since this mesh has no rotation
  // — under the placeBody convention that's (lateral, vertical, fore/aft),
  // so a wide-and-tall-but-thin panel needs (lateral, vertical, thin).
  //
  // GA panel: top at 0.72 up — just below the GA eyepoint (0.75) so a
  // C172 pilot gets real over-the-nose vision. The old 0.62-tall box
  // topped at 0.86 with 0.28 m of EMPTY bezel above the displays
  // (tallest content ≈ 0.67) and blocked the entire forward view.
  add(new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.54, 0.06), PANEL_DARK), 1.02, 0.02, -0.43)
  // Painted G1000 panel face just proud of the box (see drawGaPanel).
  const face = makeCanvasTexture(1536, 704)
  drawGaPanel(face.ctx)
  face.texture.needsUpdate = true
  add(new THREE.Mesh(new THREE.PlaneGeometry(1.13, 0.52), new THREE.MeshBasicMaterial({ map: face.texture, toneMapped: false })), 0.988, 0.02, -0.43)
  // Padded glareshield lip along the panel top (kept under the 0.75 eye).
  add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.2), BEZEL), 0.98, 0.02, -0.715)
  // Whiskey compass on the windshield center-post position.
  const compass = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.08), BEZEL)
  add(compass, 1.02, 0.0, -0.98)
  const card = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.03), new THREE.MeshBasicMaterial({ color: 0xe8e8e2 }))
  add(card, 0.978, 0.0, -0.98)

  // PFD (left) and MFD (center) — canvas-textured planes.
  const pfd = makeCanvasTexture(CANVAS_W, CANVAS_H)
  const mfd = makeCanvasTexture(MFD_CANVAS_W, MFD_CANVAS_H)
  // `toneMapped: false` on both screens: `MeshBasicMaterial` defaults
  // `toneMapped: true`, which runs its color through the renderer's scene
  // tonemapping (ACESFilmic, exposure 0.55 — tuned for lit exterior scene
  // brightness). A canvas texture's pixels are already final display
  // colors, not HDR scene radiance, so running them through that pipeline
  // a second time crushed the PFD/MFD to near-black.
  const pfdMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.32),
    new THREE.MeshBasicMaterial({ map: pfd.texture, toneMapped: false }),
  )
  // PlaneGeometry's default normal (+local-Z) already maps to +render-Z =
  // body −x ("aft", toward the pilot) under the placeBody convention.
  // body-x 0.97 (not 0.99): the bezel box's front face sits at 0.99, and
  // coplanar surfaces z-fight, so the screens stand 2 cm proud of it.
  add(pfdMesh, 0.97, -0.24, -0.42)
  const mfdMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.32),
    new THREE.MeshBasicMaterial({ map: mfd.texture, toneMapped: false }),
  )
  add(mfdMesh, 0.97, 0.15, -0.42)
  // 15c: the MFD screen is pickable — clicks map through the hit UV to
  // `mfdSoftkeyRegions` (the bezel row was drawn but never routed).
  mfdMesh.userData.controlId = 'mfdScreen'
  interactive.push(mfdMesh)

  // Live standby cluster: ASI/AI/ALT faces drawn from the same PfdInput
  // every frame — the old placeholder discs read as dead gauges.
  const sb = makeCanvasTexture(256, 768)
  const standby = { ctx: sb.ctx, texture: sb.texture }
  const sbMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.33), new THREE.MeshBasicMaterial({ map: sb.texture, toneMapped: false, transparent: true }))
  add(sbMesh, 0.975, -0.5, -0.5)

  // Switch row, bottom-left of the panel: master battery/alt, avionics,
  // pitot heat, AP master (Phase 4 Task 6 engage/disengage).
  const switches = {
    masterBattery: makeSwitch('sw_masterBattery'),
    masterAlternator: makeSwitch('sw_masterAlternator'),
    avionicsSwitch: makeSwitch('sw_avionicsSwitch'),
    pitotHeat: makeSwitch('sw_pitotHeat'),
    apMaster: makeSwitch('sw_apMaster'),
    boostPump: makeSwitch('sw_boostPump'), // 15c: was hook-only (__ohSystems)
  } as Record<SwitchId, THREE.Mesh>
  const swIds: SwitchId[] = ['masterBattery', 'masterAlternator', 'avionicsSwitch', 'pitotHeat', 'apMaster', 'boostPump']
  swIds.forEach((id, i) => {
    add(switches[id]!, 0.97, -0.5 + i * 0.045, -0.22)
    interactive.push(switches[id]!)
  })

  // NAV1/COM1 tuning knobs + flip-flop swap buttons, and the OBS course
  // knob (Phase 4 Task 6) — small pushbutton pairs below the PFD's radio
  // stack readout, coarse click-increment/decrement rather than a fine
  // drag-to-rotate knob (see `tuneFrequency`'s doc for the reasoning).
  const makeButton = (id: string, mat = KNOB): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.015, 10), mat)
    m.rotation.x = Math.PI / 2
    m.userData.controlId = id
    return m
  }
  const nav1TuneDown = makeButton('nav1TuneDown')
  add(nav1TuneDown, 0.975, -0.62, -0.4)
  interactive.push(nav1TuneDown)
  const nav1TuneUp = makeButton('nav1TuneUp')
  add(nav1TuneUp, 0.975, -0.6, -0.4)
  interactive.push(nav1TuneUp)
  const nav1FlipFlop = makeButton('nav1FlipFlop', RED_KNOB)
  add(nav1FlipFlop, 0.975, -0.58, -0.4)
  interactive.push(nav1FlipFlop)

  const com1TuneDown = makeButton('com1TuneDown')
  add(com1TuneDown, 0.975, -0.62, -0.36)
  interactive.push(com1TuneDown)
  const com1TuneUp = makeButton('com1TuneUp')
  add(com1TuneUp, 0.975, -0.6, -0.36)
  interactive.push(com1TuneUp)
  const com1FlipFlop = makeButton('com1FlipFlop', RED_KNOB)
  add(com1FlipFlop, 0.975, -0.58, -0.36)
  interactive.push(com1FlipFlop)

  const obs1Down = makeButton('obs1Down')
  add(obs1Down, 0.975, -0.62, -0.32)
  interactive.push(obs1Down)
  const obs1Up = makeButton('obs1Up')
  add(obs1Up, 0.975, -0.6, -0.32)
  interactive.push(obs1Up)

  // Ignition key (rotary, click-cycles off/right/left/both) + starter
  // pushbutton (momentary, separate from the key per `EngineStartInputs`'s
  // shape: `magneto` + `starterEngaged` are independent fields).
  const ignitionKey = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.04, 10), KNOB)
  ignitionKey.rotation.x = Math.PI / 2
  ignitionKey.userData.controlId = 'ignitionKey'
  add(ignitionKey, 0.97, 0.3, -0.25)
  interactive.push(ignitionKey)

  const starterButton = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 10), RED_KNOB)
  starterButton.rotation.x = Math.PI / 2
  starterButton.userData.controlId = 'starterButton'
  add(starterButton, 0.975, 0.36, -0.25)
  interactive.push(starterButton)

  // Throttle + mixture vernier knobs — center pedestal, push/pull along
  // the body x-axis (in toward the panel = idle/lean, out toward the pilot
  // = full power/rich, matching a real vernier's feel).
  const throttleKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 12), BLACK_KNOB)
  throttleKnob.rotation.x = Math.PI / 2 // cylinder axis (default local-Y) -> render-Z = body-x (fore/aft push-pull)
  throttleKnob.userData.controlId = 'throttleKnob'
  add(throttleKnob, 0.8, 0.02, -0.12)
  interactive.push(throttleKnob)

  const mixtureKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 12), RED_KNOB)
  mixtureKnob.rotation.x = Math.PI / 2
  mixtureKnob.userData.controlId = 'mixtureKnob'
  add(mixtureKnob, 0.8, 0.09, -0.12)
  interactive.push(mixtureKnob)

  // Flap lever — floor pedestal, 4 detents (0/10/20/30), drag/click along
  // the body x-axis.
  const flapLever = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8), BLACK_KNOB)
  flapLever.rotation.x = Math.PI / 2.6
  flapLever.userData.controlId = 'flapLever'
  add(flapLever, 0.6, -0.08, 0.05)
  interactive.push(flapLever)

  // Elevator trim wheel — side console, rotates about the lateral (y) axis.
  const trimWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.025, 20), KNOB)
  trimWheel.rotation.z = Math.PI / 2 // axis (default local-Y) -> render-X = body-y (lateral), disc face toward the pilot
  trimWheel.userData.controlId = 'trimWheel'
  add(trimWheel, 0.55, -0.4, 0.0)
  interactive.push(trimWheel)

  // Floor fuel selector — rotary, click-cycles L/R/BOTH/OFF.
  const fuelSelectorKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 4), RED_KNOB)
  fuelSelectorKnob.userData.controlId = 'fuelSelector'
  add(fuelSelectorKnob, 0.5, 0.0, 0.2)
  interactive.push(fuelSelectorKnob)

  // Yoke — visual only, mirrors aircraft.controls.pitch/roll. Positioned
  // roughly halfway between the eyepoint and the panel, and lowered so the
  // pilot looks over the rim rather than through it. Two-horn control yoke
  // (the C172's real yoke is this shape); the hub carries the horns as
  // children so the roll animation's rotation.z turns the whole assembly.
  const yokeColumn = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 8), YOKE_MAT)
  add(yokeColumn, 0.7, -0.3, -0.16)
  const yokeWheel = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.045, 0.028), YOKE_MAT)
  for (const hs of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.13, 8), YOKE_MAT)
    arm.position.set(hs * 0.075, 0.045, 0)
    arm.rotation.z = -hs * 0.85 // up and outboard from the hub
    yokeWheel.add(arm)
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.015, 0.095, 8), YOKE_MAT)
    grip.position.set(hs * 0.125, 0.115, 0)
    grip.rotation.z = -hs * 0.18 // near-vertical grips
    yokeWheel.add(grip)
  }
  add(yokeWheel, 0.68, -0.3, -0.26)

  // Cockpit structure — real flight decks are FRAMED: windshield posts,
  // roof beam, side pillars and floor. The frame hugs the cabin (a GA
  // cabin is ~half a transport flight deck wide — oversized posts would
  // poke through the C172's fuselage), and the windscreen band is sized to
  // the GA eyepoint (0.75 up → roof bottom 1.05, view band ≈ −3°…+22°).
  {
    const FRAME = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.85 })
    const framePart = (w: number, h: number, d: number, x: number, y: number, z: number, rotZ = 0): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), FRAME)
      placeBody(m, x, y, z)
      m.rotation.z = rotZ
      group.add(m)
    }
    const halfW = 0.6
    framePart(halfW * 2 + 0.2, 0.16, 0.9, 0.75, 0, -1.13)
    // A-pillars: slim raked posts spanning panel corners to the roof.
    framePart(0.045, 0.42, 0.12, 1.0, -halfW, -0.885, 0.22)
    framePart(0.045, 0.42, 0.12, 1.0, halfW, -0.885, -0.22)
    // Glazing: raked windshield pane between glareshield top and roof.
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2 + 0.05, 0.36), GLAZING)
    placeBody(pane, 1.06, 0, -0.9)
    pane.rotation.x = -0.45 // raked back at the top
    group.add(pane)
    // Side walls: sill kept below the eye so side windows read as windows.
    framePart(0.06, 0.7, 1.6, 0.35, -halfW - 0.02, -0.27)
    framePart(0.06, 0.7, 1.6, 0.35, halfW + 0.02, -0.27)
    // Floor.
    framePart(halfW * 2 + 0.1, 0.06, 1.8, 0.3, 0, 0.28)
  }

  parent.add(group)

  return {
    group,
    pfdCanvas: pfd.canvas,
    pfdCtx: pfd.ctx,
    pfdTexture: pfd.texture,
    mfdCanvas: mfd.canvas,
    mfdCtx: mfd.ctx,
    mfdTexture: mfd.texture,
    switches,
    ignitionKey,
    starterButton,
    fuelSelectorKnob,
    throttleKnob,
    mixtureKnob,
    flapLever,
    trimWheel,
    yokeColumn,
    yokeWheel,
    standby,
    nav1TuneUp,
    nav1TuneDown,
    nav1FlipFlop,
    com1TuneUp,
    com1TuneDown,
    com1FlipFlop,
    obs1Up,
    obs1Down,
    interactive,
  }
}

/** Redraw the PFD/MFD canvas textures (call once per rendered frame — the
 *  canvases are cheap enough at this resolution to redraw every frame). */
export function updateCockpitDisplays(
  meshes: CockpitMeshes, pfdInput: PfdInput, mfdInput: MfdInput,
  /** Alternate PFD renderer (the Boeing skin); the MFD takes its own via `mfdInput.skin`. */
  pfdSkin?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): void {
  if (meshes.deck737) return // Boeing formats are drawn by the 737 path (main.ts)
  if (pfdSkin) pfdSkin(meshes.pfdCtx, CANVAS_W, CANVAS_H)
  else drawPfd(meshes.pfdCtx, CANVAS_W, CANVAS_H, pfdInput)
  meshes.pfdTexture.needsUpdate = true
  drawMfd(meshes.mfdCtx, MFD_CANVAS_W, MFD_CANVAS_H, mfdInput)
  meshes.mfdTexture.needsUpdate = true
  if (meshes.standby) {
    drawStandbyCluster(meshes.standby.ctx, pfdInput)
    meshes.standby.texture.needsUpdate = true
  }
}

/** Animate switch colors, knob positions, and the yoke to reflect current
 *  control state — visual feedback only, no side effects on any control
 *  value (that's `CockpitInteraction`'s job). */
export function updateCockpitControls(
  meshes: CockpitMeshes,
  switchStates: Record<SwitchId, boolean>,
  throttle: number,
  mixture: number,
  flapsIndex: number,
  trim: number,
  pitchFrac: number, // control DEFLECTION −1..1 (aft positive), not attitude
  rollFrac: number, // control deflection −1..1 (right positive)
): void {
  if (meshes.deck737) return // the 737 rig is animated by animate737
  for (const id of Object.keys(switchStates) as SwitchId[]) {
    meshes.switches[id]!.material = switchStates[id] ? SWITCH_ON : SWITCH_OFF
  }
  // Push/pull knobs: 0 (in, at panel) -> 1 (out, toward pilot), 0.06m throw.
  placeBody(meshes.throttleKnob, 0.8 - throttle * 0.06, 0.02, -0.12)
  placeBody(meshes.mixtureKnob, 0.8 - mixture * 0.06, 0.09, -0.12)
  // Flap lever: slides fore/aft across a short travel per detent.
  placeBody(meshes.flapLever, 0.6 - (flapsIndex / 3) * 0.08, -0.08, 0.05)
  // Trim wheel: visually rotates with trim position (cosmetic only).
  // NB: this must NOT just assign `rotation.z = trim * Math.PI` — that would
  // clobber the constructor's rotation.z = Math.PI/2 (the fixed "disc face
  // toward the pilot" reorientation, see buildCockpit), snapping the wheel
  // back to its unrotated default (axis vertical, face lying flat) every
  // frame. Instead compose: spin about the cylinder's own original axis
  // (local Y, the wheel's shaft) first, then apply the fixed face-the-pilot
  // orientation on top.
  const trimBaseQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)
  const trimSpinQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), trim * Math.PI)
  meshes.trimWheel.quaternion.copy(trimBaseQuat).multiply(trimSpinQuat)
  // Yoke mirrors pitch/roll input, small visual throws (no new interaction).
  // The yoke mirrors the pilot's CONTROL INPUT, not aircraft attitude.
  const p = THREE.MathUtils.clamp(pitchFrac, -1, 1)
  const r = THREE.MathUtils.clamp(rollFrac, -1, 1)
  // Yoke: wheel turns (±75° at full aileron), column slides aft on pull.
  meshes.yokeWheel.rotation.z = -r * 1.3
  const pitchThrow = p * 0.07
  placeBody(meshes.yokeColumn, 0.7 - pitchThrow, -0.3, -0.16)
  placeBody(meshes.yokeWheel, 0.68 - pitchThrow, -0.3, -0.26)
}

// ============================================================================
// Interaction: raycast-based click/drag routed to controls
// ============================================================================

export type DraggableAxis = 'throttle' | 'mixture' | 'trim' | 'flap'

const DECK_CLICK_IDS = new Set(['fireTest', 'hornCutout', 'mcpCmdA', 'mcpDisengage', 'masterCaution', 'landingLights', 'mcpAtArm', 'mcpSpeed', 'atDisconnect', 'atReset', 'apReset'])

const DRAG_PX_FOR_FULL_RANGE = 220

/** Raycasts the pointer against the cockpit's interactive meshes and routes
 *  clicks/drags to `SystemsControls`/`aircraft.controls`. Owns no simulation
 *  truth itself — it only mutates the plain control objects handed to it,
 *  the same objects `main.ts`'s keyboard polling (`pollControls`) already
 *  writes to, so both input paths coexist without either regressing the
 *  other (keyboard still works; this is a second path into the same
 *  fields). Not unit-tested directly (three.js/DOM), but its pure mapping
 *  math (`dragToAxisValue`, `nearestFlapDetent`, `cycleFuelSelector`,
 *  `cycleMagneto` above) is. */
export class CockpitInteraction {
  private readonly raycaster = new THREE.Raycaster()
  private readonly ndc = new THREE.Vector2()
  private activeDrag: { axis: DraggableAxis; startValue: number; startPxX: number; startPxY: number } | null = null
  /** Ignition-key walk direction (15c ping-pong between detent stops). */
  private magDir: 1 | -1 = 1
  private softkey: string | null = null

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** MFD softkey pressed since the last call (15c routing), else null. */
  /** 737 deck pushbuttons: the last one clicked (consumed once) and the
   *  one currently held (FIRE WARN test is press-and-hold). */
  private deckClick: string | null = null
  private deckHold: string | null = null
  consumeDeckClick(): string | null {
    const s = this.deckClick
    this.deckClick = null
    return s
  }
  get heldDeckControl(): string | null {
    return this.deckHold
  }

  consumeSoftkey(): string | null {
    const s = this.softkey
    this.softkey = null
    return s
  }

  /** True while a drag on a cockpit control is in progress — callers (e.g.
   *  the cockpit camera's look-around) should not also consume the mouse
   *  delta while this is true. */
  get isDraggingControl(): boolean {
    return this.activeDrag !== null
  }

  private pick(input: Input, meshes: CockpitMeshes): THREE.Intersection<THREE.Object3D> | null {
    const { x, y } = input.pointerPixels()
    const { w, h } = input.targetSize()
    if (w <= 0 || h <= 0) return null
    this.ndc.set((x / w) * 2 - 1, -(y / h) * 2 + 1)
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const hits = this.raycaster.intersectObjects(meshes.interactive, false)
    return hits[0] ?? null
  }

  /** Call once per frame while in cockpit camera mode. Mutates `systems`
   *  (the `SystemsControls`-shaped object) and `controls` (`aircraft.controls`)
   *  in place based on clicks/drags this frame. */
  update(
    input: Input,
    meshes: CockpitMeshes,
    systems: { masterBattery: boolean; masterAlternator: boolean; avionicsSwitch: boolean; pitotHeat: boolean; apMaster: boolean; boostPumpOn: boolean; magneto: MagnetoPosition; starterEngaged: boolean; fuelSelector: FuelSelector },
    controls: { throttle: number; mixture: number; flapsIndex: number; trim: number },
    radios?: { nav1: { activeMhz: number; standbyMhz: number }; com1: { activeMhz: number; standbyMhz: number }; obs1Deg: number },
  ): void {
    if (input.wasMousePressed()) {
      const hit = this.pick(input, meshes)
      const id = hit?.object.userData.controlId as string | undefined
      if (id === 'sw_masterBattery') systems.masterBattery = !systems.masterBattery
      else if (id === 'sw_masterAlternator') systems.masterAlternator = !systems.masterAlternator
      else if (id === 'sw_avionicsSwitch') systems.avionicsSwitch = !systems.avionicsSwitch
      else if (id === 'sw_pitotHeat') systems.pitotHeat = !systems.pitotHeat
      else if (id === 'sw_apMaster') systems.apMaster = !systems.apMaster
      else if (id === 'sw_boostPump') systems.boostPumpOn = !systems.boostPumpOn
      else if (id === 'ignitionKey') {
        // Walk one adjacent detent; flip direction at the end stops.
        const next = stepMagneto(systems.magneto, this.magDir)
        if (next === systems.magneto) {
          this.magDir = this.magDir === 1 ? -1 : 1
          systems.magneto = stepMagneto(systems.magneto, this.magDir)
        } else systems.magneto = next
      }
      else if (id === 'starterButton') systems.starterEngaged = true
      else if (id === 'fuelSelector') systems.fuelSelector = cycleFuelSelector(systems.fuelSelector)
      else if (id && DECK_CLICK_IDS.has(id)) { this.deckClick = id; this.deckHold = id }
      else if (id === 'mfdScreen' && hit?.uv) {
        // 15c: hit UV → canvas pixel → softkey bezel region.
        const px = hit.uv.x * MFD_CANVAS_W
        const py = (1 - hit.uv.y) * MFD_CANVAS_H
        for (const r of mfdSoftkeyRegions(MFD_CANVAS_W, MFD_CANVAS_H)) {
          if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) {
            this.softkey = r.label
            break
          }
        }
      }
      else if (id === 'throttleKnob' || id === 'mixtureKnob' || id === 'trimWheel' || id === 'flapLever') {
        const { x, y } = input.pointerPixels()
        const axis: DraggableAxis = id === 'throttleKnob' ? 'throttle' : id === 'mixtureKnob' ? 'mixture' : id === 'trimWheel' ? 'trim' : 'flap'
        const startValue = axis === 'throttle' ? controls.throttle : axis === 'mixture' ? controls.mixture : axis === 'trim' ? controls.trim : controls.flapsIndex / Math.max(1, (meshes.flapDetentCount ?? 4) - 1)
        this.activeDrag = { axis, startValue, startPxX: x, startPxY: y }
      } else if (radios) {
        // NAV1/COM1 tuning knobs + flip-flop swap, OBS course knob (Phase 4
        // Task 6) — click-only, no drag state (see `tuneFrequency`'s doc).
        if (id === 'nav1TuneUp') radios.nav1.standbyMhz = tuneFrequency(radios.nav1.standbyMhz, 1, 0.05, 108.0, 117.95)
        else if (id === 'nav1TuneDown') radios.nav1.standbyMhz = tuneFrequency(radios.nav1.standbyMhz, -1, 0.05, 108.0, 117.95)
        else if (id === 'nav1FlipFlop') {
          const t = radios.nav1.activeMhz
          radios.nav1.activeMhz = radios.nav1.standbyMhz
          radios.nav1.standbyMhz = t
        } else if (id === 'com1TuneUp') radios.com1.standbyMhz = tuneFrequency(radios.com1.standbyMhz, 1, 0.025, 118.0, 136.0)
        else if (id === 'com1TuneDown') radios.com1.standbyMhz = tuneFrequency(radios.com1.standbyMhz, -1, 0.025, 118.0, 136.0)
        else if (id === 'com1FlipFlop') {
          const t = radios.com1.activeMhz
          radios.com1.activeMhz = radios.com1.standbyMhz
          radios.com1.standbyMhz = t
        } else if (id === 'obs1Up') radios.obs1Deg = (radios.obs1Deg + 1 + 360) % 360
        else if (id === 'obs1Down') radios.obs1Deg = (radios.obs1Deg - 1 + 360) % 360
      }
    }

    if (this.activeDrag && input.isMouseDown()) {
      const { x, y } = input.pointerPixels()
      const dragPx = this.activeDrag.axis === 'trim' ? x - this.activeDrag.startPxX : -(y - this.activeDrag.startPxY)
      if (this.activeDrag.axis === 'throttle') {
        controls.throttle = dragToAxisValue(this.activeDrag.startValue, dragPx, DRAG_PX_FOR_FULL_RANGE, 0, 1)
      } else if (this.activeDrag.axis === 'mixture') {
        controls.mixture = dragToAxisValue(this.activeDrag.startValue, dragPx, DRAG_PX_FOR_FULL_RANGE, 0, 1)
      } else if (this.activeDrag.axis === 'trim') {
        controls.trim = dragToAxisValue(this.activeDrag.startValue, dragPx, DRAG_PX_FOR_FULL_RANGE, -1, 1)
      } else {
        const frac = dragToAxisValue(this.activeDrag.startValue, dragPx, DRAG_PX_FOR_FULL_RANGE, 0, 1)
        controls.flapsIndex = nearestFlapDetent(frac, meshes.flapDetentCount ?? 4)
      }
    }

    if (input.wasMouseReleased()) {
      this.deckHold = null
      this.activeDrag = null
      systems.starterEngaged = false
    }
  }
}
