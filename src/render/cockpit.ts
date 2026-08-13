import * as THREE from 'three'
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
const GAUGE_FACE = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.4 })

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
  /** Boeing-NG MCP digit strip (N3): live SPD/HDG/ALT/VS windows + mode
   *  lamps, redrawn only when the formatted state changes. Absent on the
   *  G1000 layout. */
  mcp?: { ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture; last: string; cmdLabel: string }
  /** N3: yoke slots hold a sidestick (Airbus layout) — the control
   *  animation tilts instead of translating. */
  sidestick?: true
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
export type PanelLayout = 'g1000' | 'boeingNG' | 'airbusFcu'

/** Pick the panel layout for a fleet member (N3). Airbus-family
 *  designators (A3xx, A220/BCS) get the FCU layout; other stabilizer-trim
 *  transports get the Boeing-NG layout; everything else keeps the G1000.
 *  Pure — unit-tested. */
export function panelLayoutFor(designator: string, trimIsStabilizer: boolean): PanelLayout {
  if (!trimIsStabilizer) return 'g1000'
  return /^(A[23]|BCS)/.test(designator) ? 'airbusFcu' : 'boeingNG' // A20N/A21N are neo A32x
}

export function buildCockpit(parent: THREE.Object3D, layout: PanelLayout = 'g1000'): CockpitMeshes {
  const group = new THREE.Group()
  const interactive: THREE.Object3D[] = []
  let mcp: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture } | undefined
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
  // N3: the Boeing-NG layout swaps the G1000 shell for the 737 panel —
  // wide brown-gray main panel, SIX display-unit bezels (outboard PFD /
  // inboard ND per side + stacked center EICAS pair), and a glareshield
  // MCP strip. HONEST SCOPE (recorded in the night-shift plan): the DU
  // CONTENT is still this sim's G1000-style PFD/ND drawing for now — the
  // LAYOUT, proportions, and palette follow the NG photos; per-family
  // display content is a later slice.
  // Palettes: Boeing NG brown-gray vs Airbus blue-gray (photo-matched
  // tones; both share the six-DU + glareshield-strip arrangement — the
  // Airbus ECAM pair sits where the EICAS pair does).
  const BOEING_PANEL = new THREE.MeshStandardMaterial({ color: layout === 'airbusFcu' ? 0x39404a : 0x655b52, roughness: 0.85 })
  const DU_BEZEL = new THREE.MeshStandardMaterial({ color: layout === 'airbusFcu' ? 0x1c1e22 : 0x24262a, roughness: 0.6 })
  const MCP_FACE = new THREE.MeshStandardMaterial({ color: layout === 'airbusFcu' ? 0x4a5058 : 0x83807a, roughness: 0.55 })
  if (layout === 'boeingNG' || layout === 'airbusFcu') {
    add(new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.62, 0.06), BOEING_PANEL), 1.02, 0.02, -0.55)
    // Six DU bezels: [captain PFD, captain ND, upper EICAS, lower EICAS,
    // FO ND, FO PFD] — screens for the captain pair come below; the rest
    // are dark faces tonight.
    for (const [dz, dy] of [[-0.62, -0.02], [-0.42, -0.02], [-0.2, 0.06], [-0.2, -0.2], [0.02, -0.02], [0.22, -0.02]] as const) {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.015), DU_BEZEL), 1.0, dy, dz)
    }
    // Glareshield MCP strip.
    add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.09, 0.1), DU_BEZEL), 1.03, 0.36, -0.3)
    add(new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.06, 0.02), MCP_FACE), 0.985, 0.36, -0.3)
    // Live MCP digit windows (canvas plane proud of the metal face —
    // same coplanarity lesson as the PFD/MFD screens).
    mcp = makeCanvasTexture(1024, 40)
    const mcpMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 0.05),
      new THREE.MeshBasicMaterial({ map: mcp.texture, toneMapped: false }),
    )
    add(mcpMesh, 0.97, 0.36, -0.3)
  } else {
    add(new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.62, 0.06), PANEL_DARK), 1.02, 0.02, -0.55)
  }

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
  if (layout !== 'g1000') pfdMesh.scale.setScalar(0.55) // fit the DU bezel
  add(pfdMesh, 0.97, layout !== 'g1000' ? -0.02 : -0.24, layout !== 'g1000' ? -0.62 : -0.42)
  const mfdMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.32),
    new THREE.MeshBasicMaterial({ map: mfd.texture, toneMapped: false }),
  )
  if (layout !== 'g1000') mfdMesh.scale.setScalar(0.55)
  add(mfdMesh, 0.97, layout !== 'g1000' ? -0.02 : 0.15, layout !== 'g1000' ? -0.42 : -0.42)
  // 15c: the MFD screen is pickable — clicks map through the hit UV to
  // `mfdSoftkeyRegions` (the bezel row was drawn but never routed).
  mfdMesh.userData.controlId = 'mfdScreen'
  interactive.push(mfdMesh)

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
  // N3: Airbus gets the SIDESTICK on the captain's left console — the
  // FCU cockpit must not carry a Boeing yoke. Same mesh slots (the
  // animation path keys off `sidestick`), different geometry/placement.
  const isStick = layout === 'airbusFcu'
  const yokeColumn = isStick
    ? new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.022, 0.16, 8), YOKE_MAT)
    : new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 8), YOKE_MAT)
  add(yokeColumn, isStick ? 0.62 : 0.7, isStick ? -0.62 : -0.3, isStick ? -0.28 : -0.16)
  const yokeWheel = isStick
    ? new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.06), YOKE_MAT)
    : new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.015, 8, 16), YOKE_MAT)
  add(yokeWheel, isStick ? 0.62 : 0.68, isStick ? -0.62 : -0.3, isStick ? -0.36 : -0.26)

  parent.add(group)

  return {
    group,
    ...(mcp ? { mcp: { ctx: mcp.ctx, texture: mcp.texture, last: '', cmdLabel: layout === 'airbusFcu' ? 'AP1' : 'CMD' } } : {}),
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
    ...(layout === 'airbusFcu' ? { sidestick: true as const } : {}),
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
/** N3: redraw the Boeing-NG MCP digit strip — real AP targets in the real
 *  window order (SPD | HDG | ALT | V/S) with active/armed mode lamps.
 *  No-op on the G1000 layout; skips the canvas entirely when nothing
 *  changed (digits update at state-change rate, not frame rate). */
export function updateMcp(
  meshes: CockpitMeshes,
  d: {
    iasKt: number
    hdgDeg: number
    altFt: number
    vsFpm: number
    master: boolean
    lateral: string
    vertical: string
    lateralArmed?: boolean
    verticalArmed?: boolean
  },
): void {
  const m = meshes.mcp
  if (!m) return
  const vsTxt = d.vertical === 'VS' ? `${d.vsFpm >= 0 ? '+' : '-'}${String(Math.abs(Math.round(d.vsFpm))).padStart(4, '0')}` : '----'
  const key = [Math.round(d.iasKt), Math.round(d.hdgDeg), Math.round(d.altFt), vsTxt, d.master, d.lateral, d.vertical, d.lateralArmed, d.verticalArmed].join('|')
  if (key === m.last) return
  m.last = key
  const c = m.ctx
  c.fillStyle = '#83807a'
  c.fillRect(0, 0, 1024, 40)
  const windowAt = (x: number, w: number, label: string, value: string): void => {
    c.fillStyle = '#111'
    c.fillRect(x, 4, w, 32)
    c.fillStyle = '#f2f2ee'
    c.font = '11px sans-serif'
    c.textAlign = 'center'
    c.fillText(label, x + w / 2, 13)
    c.fillStyle = '#ffdca8'
    c.font = 'bold 19px monospace'
    c.fillText(value, x + w / 2, 33)
  }
  windowAt(60, 100, 'IAS', String(Math.round(d.iasKt)).padStart(3, '0'))
  windowAt(330, 100, 'HEADING', String(((Math.round(d.hdgDeg) % 360) + 360) % 360).padStart(3, '0'))
  windowAt(600, 120, 'ALTITUDE', String(Math.round(d.altFt)).padStart(5, '0'))
  windowAt(860, 100, 'VERT SPEED', vsTxt)
  const lamp = (x: number, label: string, on: boolean, armed = false): void => {
    c.fillStyle = on ? '#2f6e2f' : armed ? '#6e662f' : '#3a3a3a'
    c.fillRect(x, 8, 52, 24)
    c.fillStyle = on || armed ? '#eaffea' : '#9a9a9a'
    c.font = 'bold 11px sans-serif'
    c.textAlign = 'center'
    c.fillText(label, x + 26, 24)
  }
  lamp(180, d.lateral === 'HDG' ? 'HDG' : d.lateral === 'NAV' ? 'LNAV' : d.lateral === 'APR' ? 'APP' : d.lateral, d.master, !!d.lateralArmed)
  lamp(460, d.vertical === 'ALTS' || d.vertical === 'ALT' ? 'ALT' : d.vertical === 'VS' ? 'V/S' : d.vertical === 'GS' ? 'G/S' : d.vertical, d.master, !!d.verticalArmed)
  lamp(750, m.cmdLabel, d.master)
  m.texture.needsUpdate = true
}

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
  if (meshes.sidestick) {
    // Sidestick: tilt in roll and pitch about its base, no fore/aft slide.
    const rollRad = (rollDeg * Math.PI) / 180
    for (const m of [meshes.yokeColumn, meshes.yokeWheel]) {
      m.rotation.z = -rollRad * 0.4
      m.rotation.x = THREE.MathUtils.clamp(pitchDeg / 20, -1, 1) * 0.35
    }
    return
  }
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
  /** Ignition-key walk direction (15c ping-pong between detent stops). */
  private magDir: 1 | -1 = 1
  private softkey: string | null = null

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** MFD softkey pressed since the last call (15c routing), else null. */
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
