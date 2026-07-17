import * as THREE from 'three'
import type { Input } from '../input/input'
import { drawPfd, type PfdInput } from '../cockpit/pfd'
import { drawMfd, type MfdInput } from '../cockpit/mfd'
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

/** Click-cycle order for the ignition key's 4 non-momentary detents (the
 *  starter itself is a separate momentary push, see `starterEngaged`
 *  handling in `CockpitInteraction`) — off -> right -> left -> both -> off. */
export function cycleMagneto(current: MagnetoPosition): MagnetoPosition {
  const order: MagnetoPosition[] = ['off', 'right', 'left', 'both']
  const i = order.indexOf(current)
  return order[(i + 1) % order.length]!
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
const GAUGE_FACE = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.4 })

/** Place a mesh using BODY coordinates (x fwd, y right, z down) — same
 *  convention/helper as `aircraft-mesh.ts`'s `placeBody`, duplicated here to
 *  keep the two render modules independent. */
function placeBody(m: THREE.Object3D, x: number, y: number, z: number): void {
  m.position.set(y, -z, -x)
}

export type SwitchId = 'masterBattery' | 'masterAlternator' | 'avionicsSwitch' | 'pitotHeat' | 'apMaster'

export interface CockpitMeshes {
  group: THREE.Group
  pfdCanvas: HTMLCanvasElement
  pfdCtx: CanvasRenderingContext2D
  pfdTexture: THREE.CanvasTexture
  mfdCanvas: HTMLCanvasElement
  mfdCtx: CanvasRenderingContext2D
  mfdTexture: THREE.CanvasTexture
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

/** Build the 3D cockpit interior and parent it under `parent` (the aircraft
 *  body group from `aircraft-mesh.ts`, so it tracks position/attitude for
 *  free). Returns handles used every frame to redraw the PFD/MFD canvases
 *  and animate the controls. */
export function buildCockpit(parent: THREE.Object3D): CockpitMeshes {
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
  add(new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.62, 0.06), PANEL_DARK), 1.02, 0.02, -0.55)

  // PFD (left) and MFD (center) — canvas-textured planes.
  const pfd = makeCanvasTexture(CANVAS_W, CANVAS_H)
  const mfd = makeCanvasTexture(MFD_CANVAS_W, MFD_CANVAS_H)
  // `toneMapped: false` on both screens: `MeshBasicMaterial` defaults
  // `toneMapped: true`, which runs its color through the renderer's scene
  // tonemapping (ACESFilmic, exposure 0.55 — tuned for lit exterior scene
  // brightness). A canvas texture's pixels are already final display
  // colors, not HDR scene radiance, so running them through that pipeline
  // a second time crushed the PFD/MFD to near-black regardless of what
  // `pfd.ts`/`mfd.ts` actually drew — a pre-existing bug independent of the
  // cockpit-camera depth/yoke fix, just never noticed until this pass
  // looked closely at a screenshot instead of judging by code alone.
  const pfdMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.32),
    new THREE.MeshBasicMaterial({ map: pfd.texture, toneMapped: false }),
  )
  // No extra rotation needed: PlaneGeometry's default normal (+local-Z)
  // already maps to +render-Z = body -x ("aft", toward the pilot) under
  // the placeBody convention — exactly the direction the panel needs to
  // face to be visible to a pilot looking forward (+body-x) at it.
  //
  // body-x 0.97 (was 0.99): the panel bezel below is a 0.06-deep box
  // centered at x=1.02, so its near/front face sits at exactly x=0.99 —
  // identical to where these screens used to be placed. Two coplanar
  // surfaces z-fight, and combined with this scene's enormous near/far
  // ratio (0.02 / 2,000,000 — tuned for exterior views, terrible depth
  // precision up close) the opaque bezel consistently won, silently hiding
  // the entire PFD/MFD behind it. Moving the screens 2cm proud of the
  // bezel face (a real G1000 does sit slightly forward of the panel skin)
  // gives clean separation. This was a pre-existing bug, unrelated to the
  // depth/yoke fix — it just took a close screenshot to notice the PFD/MFD
  // were rendering as solid dark rectangles instead of their actual content.
  add(pfdMesh, 0.97, -0.24, -0.42)
  const mfdMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.32),
    new THREE.MeshBasicMaterial({ map: mfd.texture, toneMapped: false }),
  )
  add(mfdMesh, 0.97, 0.15, -0.42)

  // Standby instrument cluster (placeholder circles, left of the PFD) — a
  // full standby-gauge canvas renderer wasn't in this task's committed
  // scope (Task 2d spec explicitly allows placeholder shapes here).
  for (let i = 0; i < 3; i++) {
    const gauge = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), GAUGE_FACE)
    add(gauge, 0.98, -0.5, -0.62 + i * 0.12)
    const bezelRing = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.058, 20), BEZEL)
    add(bezelRing, 0.975, -0.5, -0.62 + i * 0.12)
  }

  // Switch row, bottom-left of the panel: master battery/alt, avionics,
  // pitot heat, AP master (Phase 4 Task 6 engage/disengage).
  const switches = {
    masterBattery: makeSwitch('sw_masterBattery'),
    masterAlternator: makeSwitch('sw_masterAlternator'),
    avionicsSwitch: makeSwitch('sw_avionicsSwitch'),
    pitotHeat: makeSwitch('sw_pitotHeat'),
    apMaster: makeSwitch('sw_apMaster'),
  } as Record<SwitchId, THREE.Mesh>
  const swIds: SwitchId[] = ['masterBattery', 'masterAlternator', 'avionicsSwitch', 'pitotHeat', 'apMaster']
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

  // Yoke — visual only, mirrors aircraft.controls.pitch/roll (no separate
  // interaction beyond what the ordinary flight controls already provide).
  // Positioned roughly halfway between the cockpit-camera eyepoint (body-x
  // EYE_X = 0.35, see cockpit-camera.ts) and the panel (body-x ~1.02) — a
  // real yoke sits well clear of the pilot's face, not nearly touching it.
  // Also sat lower than the PFD/MFD (z=-0.16/-0.26, i.e. "up" 0.16/0.26 vs.
  // the screens' 0.42): the original construction had the wheel dead level
  // with the PFD (both at up=0.42), so even at a sane distance the wheel's
  // large angular size (it's much closer to the eye than the panel) fully
  // covered the PFD head-on. A real yoke rim sits below the panel — the
  // pilot looks over it, not through it — so the wheel's top edge is
  // lowered here to clear the PFD's bottom edge (checked against the
  // PFD/eye/panel geometry above, not just eyeballed).
  const yokeColumn = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 8), YOKE_MAT)
  add(yokeColumn, 0.7, -0.3, -0.16)
  const yokeWheel = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.015, 8, 16), YOKE_MAT)
  add(yokeWheel, 0.68, -0.3, -0.26)

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
 *  canvases are cheap enough at this resolution to redraw every frame;
 *  `pfd.ts`/`mfd.ts`'s own header docs target 20-30fps, which this meets
 *  under a typical rAF loop without extra throttling logic). */
export function updateCockpitDisplays(meshes: CockpitMeshes, pfdInput: PfdInput, mfdInput: MfdInput): void {
  drawPfd(meshes.pfdCtx, CANVAS_W, CANVAS_H, pfdInput)
  meshes.pfdTexture.needsUpdate = true
  drawMfd(meshes.mfdCtx, MFD_CANVAS_W, MFD_CANVAS_H, mfdInput)
  meshes.mfdTexture.needsUpdate = true
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
  pitchDeg: number,
  rollDeg: number,
): void {
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
  meshes.yokeColumn.rotation.z = (rollDeg * Math.PI) / 180 * 0.3
  meshes.yokeWheel.rotation.z = (rollDeg * Math.PI) / 180 * 0.6
  const pitchThrow = THREE.MathUtils.clamp(pitchDeg / 20, -1, 1) * 0.05
  placeBody(meshes.yokeColumn, 0.7, -0.3, -0.16 + pitchThrow)
  placeBody(meshes.yokeWheel, 0.68, -0.3, -0.26 + pitchThrow)
}

// ============================================================================
// Interaction: raycast-based click/drag routed to controls
// ============================================================================

export type DraggableAxis = 'throttle' | 'mixture' | 'trim' | 'flap'

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

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

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
    systems: { masterBattery: boolean; masterAlternator: boolean; avionicsSwitch: boolean; pitotHeat: boolean; apMaster: boolean; magneto: MagnetoPosition; starterEngaged: boolean; fuelSelector: FuelSelector },
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
      else if (id === 'ignitionKey') systems.magneto = cycleMagneto(systems.magneto)
      else if (id === 'starterButton') systems.starterEngaged = true
      else if (id === 'fuelSelector') systems.fuelSelector = cycleFuelSelector(systems.fuelSelector)
      else if (id === 'throttleKnob' || id === 'mixtureKnob' || id === 'trimWheel' || id === 'flapLever') {
        const { x, y } = input.pointerPixels()
        const axis: DraggableAxis = id === 'throttleKnob' ? 'throttle' : id === 'mixtureKnob' ? 'mixture' : id === 'trimWheel' ? 'trim' : 'flap'
        const startValue = axis === 'throttle' ? controls.throttle : axis === 'mixture' ? controls.mixture : axis === 'trim' ? controls.trim : controls.flapsIndex / 3
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
        controls.flapsIndex = nearestFlapDetent(frac)
      }
    }

    if (input.wasMouseReleased()) {
      this.activeDrag = null
      systems.starterEngaged = false
    }
  }
}
