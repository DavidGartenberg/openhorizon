import * as THREE from 'three'
import {
  MIP, PRST_UP, paintPrst, paintMip, paintOverhead, landingSwitchBox, lightsRowItemBox, ENGINE_START_ITEMS, paintEfis, paintAnnunciators, paintMcp737, paintAisle, paintCdu, paintCduKeys,
  plate, engrave, knob, gauge, lamp, AMBER, GREEN, RED, ENGRAVE, PANEL_GRAY, setPanelPalette, deckLayout, duGlass, mcpControls,
  type Mcp737State, type AisleState, type DeckLayout, type PanelStyle,
} from './cockpit-737-paint'
import { PALETTES, type Maker } from './cockpit-profile'

/**
 * Boeing 737NG flight deck (layout 'boeingNG'). Built around the captain's
 * design eye — the cockpit camera's transport eyepoint, body (0.45, −0.5,
 * up 1.0) — with stations taken from the published 737NG flight-deck
 * arrangement: six 8-inch-class DUs on the main panel (outboard PFD /
 * inboard ND each side, upper + lower center), ISFD left of the upper DU and
 * the gear lever right of it; the glareshield with the MCP flanked by the
 * EFIS control panels and the FIRE WARN / MASTER CAUTION / six-pack
 * clusters; No. 1/2/3 windows with their posts; the forward overhead's five
 * system columns over the lights/engine-start row; the control stand with
 * thrust levers, speedbrake, flap lever, start levers and the big
 * stabilizer-trim wheels; the aisle stand with both CDUs, radios and the
 * fire panel; ram's-horn control wheels on floor-pivoted columns, rudder
 * pedals, side consoles with the tiller, and the seats.
 *
 * Dimensions are engineering estimates from public diagrams/photos (no
 * Boeing CAD exists here) — recorded in PROGRESS.md. Everything sits in the
 * aircraft body frame; `v(fwd, lat, up)` takes metres forward of the eye,
 * lateral (right +) and height (render-up).
 */
const EYE_X = 0.45
const v = (fwd: number, lat: number, up: number): THREE.Vector3 => new THREE.Vector3(lat, up, -(EYE_X + fwd))

/** Lateral thrust-lever stations (metres from the stand centerline) for an
 *  engine count — shared by the 3D rig and the painted stand slots. */
export function leverLats(engines: number): number[] {
  if (engines <= 1) return [0]
  if (engines === 2) return [-0.04, 0.04]
  if (engines === 3) return [-0.07, 0, 0.07]
  return [-0.1, -0.034, 0.034, 0.1]
}

export interface Deck737Screens {
  pfd: THREE.Texture
  nd: THREE.Texture
  eicas: THREE.Texture
  isfd: THREE.Texture
}

interface Live { ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture; last: string }

/** How this airplane's deck is dressed (from its cockpit profile). */
export interface DeckStyle {
  layout: DeckLayout
  panel: PanelStyle
  maker: Maker
  control: 'yoke' | 'sidestick'
  trimWheels: boolean
  reversers: boolean
  /** Power + condition levers instead of thrust + start levers. */
  turboprop: boolean
  speedbrake: boolean
  autothrottle: boolean
}
export const DEFAULT_DECK_STYLE: DeckStyle = {
  layout: deckLayout('six'), panel: 'boeing', maker: 'boeing', control: 'yoke',
  trimWheels: true, reversers: true, turboprop: false, speedbrake: true, autothrottle: true,
}

export interface Deck737 {
  interactive: THREE.Object3D[]
  mcp: Live
  annunL: Live
  annunR: Live
  aisle: Live
  stand: Live
  gearPanel: Live
  cdu: Live
  overhead: Live
  prst: Live
  /** Painted panel materials (dimmed with ambient light). */
  panelMats: THREE.MeshBasicMaterial[]
  rig: {
    capt: { pivot: THREE.Group; wheel: THREE.Group }
    fo: { pivot: THREE.Group; wheel: THREE.Group }
    thrust: THREE.Group[]
    reversers: THREE.Group[]
    startLevers: THREE.Group[]
    speedbrake: THREE.Group
    flap: THREE.Group
    trimWheels: THREE.Mesh[]
    pedals: Array<{ mesh: THREE.Group; side: -1 | 1 }>
    gearHandle: THREE.Group
    parkingBrake: THREE.Group
    fireHandles: THREE.Mesh[]
  }
  flapDetentsDeg: readonly number[]
  /** Engine count (thrust/start levers, engine display, fire handles). */
  engines: number
  style: DeckStyle
  /** Stub meshes for the CockpitMeshes slots the G1000 path needs. */
  yokeColumn: THREE.Mesh
  yokeWheel: THREE.Mesh
  throttleKnob: THREE.Mesh
  flapLever: THREE.Mesh
  trimWheel: THREE.Mesh
}

function canvasTex(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable for 737 cockpit canvas')
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return { canvas, ctx, texture }
}

/** Quad from four corners (bl, br, tr, tl) with 0..1 UVs. */
function quad(bl: THREE.Vector3, br: THREE.Vector3, tr: THREE.Vector3, tl: THREE.Vector3, mat: THREE.Material): THREE.Mesh {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([...bl.toArray(), ...br.toArray(), ...tr.toArray(), ...tl.toArray()], 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
  g.setIndex([0, 1, 2, 0, 2, 3])
  g.computeVertexNormals()
  return new THREE.Mesh(g, mat)
}

/** Box beam between two points (frame posts, window frames). */
function beam(a: THREE.Vector3, b: THREE.Vector3, w: number, d: number, mat: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b)
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, d), mat)
  m.position.copy(a).add(b).multiplyScalar(0.5)
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
  return m
}

const M = {
  frame: new THREE.MeshStandardMaterial({ color: 0x6b6a64, roughness: 0.7, metalness: 0.1 }),
  lining: new THREE.MeshStandardMaterial({ color: 0xb4b3ab, roughness: 0.85, side: THREE.DoubleSide }),
  ceiling: new THREE.MeshStandardMaterial({ color: 0xc4c3bb, roughness: 0.9, side: THREE.DoubleSide }),
  glare: new THREE.MeshStandardMaterial({ color: 0x232527, roughness: 0.95 }),
  panelBack: new THREE.MeshStandardMaterial({ color: 0x4d5257, roughness: 0.75 }),
  stand: new THREE.MeshStandardMaterial({ color: 0x4f5459, roughness: 0.7, metalness: 0.1 }),
  black: new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 0.55 }),
  wheel: new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.45 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x0e0f10, roughness: 0.9 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.75 }),
  white: new THREE.MeshStandardMaterial({ color: 0xe6e6e0, roughness: 0.5 }),
  leverWhite: new THREE.MeshStandardMaterial({ color: 0xf0ede4, roughness: 0.42 }),
  knobGray: new THREE.MeshStandardMaterial({ color: 0xbfc0bc, roughness: 0.45 }),
  carpet: new THREE.MeshStandardMaterial({ color: 0x353a42, roughness: 1 }),
  seat: new THREE.MeshStandardMaterial({ color: 0x3d4450, roughness: 0.95 }),
  sheepskin: new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 1 }),
  red: new THREE.MeshStandardMaterial({ color: 0xb01c14, roughness: 0.5 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x9fb4c4, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }),
  fireHandle: new THREE.MeshStandardMaterial({ color: 0x2a1514, roughness: 0.5, emissive: new THREE.Color(0xff2a1a), emissiveIntensity: 0 }),
}

/** Interior fill: the flight deck is lit by daylight scattered through
 *  the windows, which a directional sun alone cannot provide inside a
 *  closed cabin — a scaled emissive fill on the interior materials. */
const FILLED: Array<[THREE.MeshStandardMaterial, number]> = [[M.lining, 0.5], [M.ceiling, 0.55], [M.frame, 0.3], [M.glare, 0.25], [M.panelBack, 0.35], [M.stand, 0.38], [M.carpet, 0.3], [M.seat, 0.32], [M.sheepskin, 0.35], [M.wheel, 0.25], [M.knobGray, 0.3], [M.white, 0.3], [M.leverWhite, 0.32], [M.metal, 0.25]]
let lastAmbient = 1
/** How much of the flat fill remains (default 0.35) once the deck is also lit by the real
 *  sky/sun/ambient-occlusion: 1 = the original uniform glow (flat, toy-like),
 *  lower = surfaces keep their shading. */
let fillScale = 0.35
export function setInteriorFillScale(scale: number): void {
  fillScale = Math.max(0, Math.min(1.5, scale))
  setInteriorFill(lastAmbient)
}
export function setInteriorFill(ambient: number): void {
  lastAmbient = ambient
  const k = 0.12 + 0.88 * Math.max(0, Math.min(1, ambient))
  for (const [m, f] of FILLED) m.emissive.copy(m.color).multiplyScalar(f * k * fillScale)
}
setInteriorFill(1)

/** A black engine-number numeral on a white square (thrust lever handles). */
function numeralTexture(n: string): THREE.CanvasTexture {
  const { ctx, texture } = canvasTex(64, 64)
  ctx.fillStyle = '#f0ede4'; ctx.fillRect(0, 0, 64, 64)
  ctx.fillStyle = '#111'; ctx.font = 'bold 52px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(n, 32, 35)
  texture.needsUpdate = true
  return texture
}

/** Quilted anti-glare padding for the glareshield top. */
function paddingTexture(): THREE.CanvasTexture {
  const { ctx, texture } = canvasTex(256, 256)
  ctx.fillStyle = '#17181a'; ctx.fillRect(0, 0, 256, 256)
  ctx.strokeStyle = '#2a2c2f'; ctx.lineWidth = 2
  for (let i = -256; i < 512; i += 32) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 256, 256); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i + 256, 0); ctx.lineTo(i, 256); ctx.stroke() }
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.needsUpdate = true
  return texture
}

function paintedMat(tex: THREE.Texture, alphaTest = 0): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, ...(alphaTest ? { alphaTest, transparent: false } : {}) })
}

/** 737 control wheel: hub with checklist clip and two ram's-horn grips. */
function buildControlWheel(side: -1 | 1): THREE.Group {
  const g = new THREE.Group()
  const hub = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.09, 0.055), M.wheel)
  g.add(hub)
  const clip = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.065, 0.004), M.frame)
  clip.position.set(0, 0.005, 0.026)
  g.add(clip)
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.12, 12), M.metal)
  shaft.rotation.x = Math.PI / 2
  shaft.position.z = -0.06
  g.add(shaft)
  for (const s of [-1, 1]) {
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(s * 0.045, -0.015, 0), new THREE.Vector3(s * 0.11, -0.03, 0.005),
      new THREE.Vector3(s * 0.165, 0.0, 0.01), new THREE.Vector3(s * 0.185, 0.06, 0.012), new THREE.Vector3(s * 0.175, 0.12, 0.01),
    ])
    g.add(new THREE.Mesh(new THREE.TubeGeometry(path, 24, 0.02, 12), M.wheel))
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.023, 0.105, 14), M.rubber)
    grip.position.set(s * 0.181, 0.075, 0.012)
    grip.rotation.z = s * 0.08
    g.add(grip)
    // Outboard horn: AP disconnect (red) + stab trim rocker; inboard: mic.
    if (s === (side === -1 ? -1 : 1)) {
      const apd = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.01, 10), M.red)
      apd.position.set(s * 0.19, 0.03, 0.028); apd.rotation.x = Math.PI / 2
      g.add(apd)
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.022, 0.012), M.black)
      trim.position.set(s * 0.172, 0.128, 0.012)
      g.add(trim)
    } else {
      const mic = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.018, 0.01), M.black)
      mic.position.set(s * 0.17, 0.125, 0.012)
      g.add(mic)
    }
  }
  return g
}

/** Floor-pivoted control column: the pivot group rotates for pitch; the
 *  wheel group (child) rotates about its shaft for roll. */
function buildColumn(lat: number, side: -1 | 1): { pivot: THREE.Group; wheel: THREE.Group } {
  const pivot = new THREE.Group()
  pivot.position.copy(v(0.53, lat, -0.2))
  const top = new THREE.Vector3(0, 0.78, 0.08) // pivot-local: hub 0.78 up, 0.08 aft
  const col = beam(new THREE.Vector3(0, 0, 0), top, 0.06, 0.075, M.wheel)
  pivot.add(col)
  const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.16, 14), M.rubber)
  boot.position.set(0, 0.06, 0.01)
  pivot.add(boot)
  const elbow = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.1), M.wheel)
  elbow.position.copy(top).add(new THREE.Vector3(0, 0.0, 0.03))
  pivot.add(elbow)
  const wheel = buildControlWheel(side)
  wheel.position.copy(top).add(new THREE.Vector3(0, 0.0, 0.07))
  pivot.add(wheel)
  return { pivot, wheel }
}

/** Sidestick on the outboard side console (Airbus, Falcon 7X): the pivot
 *  tilts for pitch (x) and roll (z); `wheel` is an empty group so the yoke
 *  animation path has a target. */
function buildSidestick(side: -1 | 1): { pivot: THREE.Group; wheel: THREE.Group } {
  const pivot = new THREE.Group()
  pivot.position.copy(v(0.16, side * 0.75, 0.455))
  const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.03, 14), M.rubber)
  boot.position.y = 0.015
  pivot.add(boot)
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.07, 10), M.wheel)
  stem.position.y = 0.06
  pivot.add(stem)
  const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.019, 0.07, 4, 12), M.wheel)
  grip.position.set(0, 0.13, -0.006)
  grip.rotation.x = -0.32 // raked toward the pilot
  pivot.add(grip)
  const thumbRest = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.014, 0.03), M.rubber)
  thumbRest.position.set(-side * 0.02, 0.15, 0.0)
  pivot.add(thumbRest)
  const takeover = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.008, 10), M.red)
  takeover.position.set(0, 0.18, -0.02)
  pivot.add(takeover)
  const wheel = new THREE.Group()
  pivot.add(wheel)
  pivot.userData.sidestick = true
  return { pivot, wheel }
}

function buildSeat(lat: number): THREE.Group {
  const g = new THREE.Group()
  const at = (m: THREE.Object3D, fwd: number, up: number, dl = 0): void => { m.position.copy(v(fwd, lat + dl, up)); g.add(m) }
  at(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.5), M.seat), -0.02, 0.17)
  at(new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.03, 0.44), M.sheepskin), -0.02, 0.235)
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.72, 0.11), M.seat)
  back.rotation.x = 0.2
  at(back, -0.3, 0.6)
  const skin = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.02), M.sheepskin)
  skin.rotation.x = 0.2
  at(skin, -0.24, 0.6)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.17, 0.1), M.seat)
  head.rotation.x = 0.2
  at(head, -0.38, 1.02)
  for (const s of [-1, 1]) at(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.36), M.seat), -0.06, 0.44, s * 0.29)
  at(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.4), M.frame), -0.02, -0.05)
  return g
}

export function build737Deck(group: THREE.Group, screens: Deck737Screens, flapDetentsDeg: readonly number[], engines = 2, style: DeckStyle = DEFAULT_DECK_STYLE): Deck737 {
  // Manufacturer palette: panel faces, glareshield, lining, stand.
  const pal = PALETTES[style.maker]
  setPanelPalette(pal.panel, pal.edge)
  M.glare.color.setHex(pal.glare); M.lining.color.setHex(pal.lining); M.ceiling.color.setHex(pal.ceiling)
  M.stand.color.setHex(pal.stand); M.panelBack.color.set(pal.panel).multiplyScalar(0.9)
  setInteriorFill(1)
  const layout = style.layout
  const interactive: THREE.Object3D[] = []
  const panelMats: THREE.MeshBasicMaterial[] = []
  const put = (m: THREE.Object3D): THREE.Object3D => { group.add(m); return m }
  const live = (w: number, h: number): Live & { canvas: HTMLCanvasElement } => ({ ...canvasTex(w, h), last: '' })
  const painted = (tex: THREE.Texture, alphaTest = 0): THREE.MeshBasicMaterial => { const m = paintedMat(tex, alphaTest); panelMats.push(m); return m }

  // ---------------- Main instrument panel ----------------
  const mipW = MIP.right - MIP.left, mipH = MIP.top - MIP.bottom
  const PX = 2000
  const mipTex = canvasTex(Math.round(mipW * PX), Math.round(mipH * PX))
  paintMip(mipTex.ctx, mipTex.canvas.width, mipTex.canvas.height, layout, style.panel, style.turboprop)
  mipTex.texture.needsUpdate = true
  const MIP_FWD = 0.74
  const mipMesh = new THREE.Mesh(new THREE.PlaneGeometry(mipW, mipH), painted(mipTex.texture, 0.5))
  mipMesh.position.copy(v(MIP_FWD, (MIP.left + MIP.right) / 2, (MIP.top + MIP.bottom) / 2))
  put(mipMesh)
  // Panel body behind the face (upper band + center stack) for depth.
  const upperBack = new THREE.Mesh(new THREE.BoxGeometry(mipW, MIP.top - MIP.sideBottom, 0.08), M.panelBack)
  upperBack.position.copy(v(MIP_FWD + 0.041, 0, (MIP.top + MIP.sideBottom) / 2))
  put(upperBack)
  const centerBack = new THREE.Mesh(new THREE.BoxGeometry(MIP.centerHalf * 2, MIP.sideBottom - MIP.bottom, 0.08), M.panelBack)
  centerBack.position.copy(v(MIP_FWD + 0.041, 0, (MIP.sideBottom + MIP.bottom) / 2))
  put(centerBack)
  // Knee-well kick panels and the structure below the side panels.
  for (const s of [-1, 1]) {
    const kick = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.04), M.frame)
    kick.position.copy(v(0.98, s * 0.58, 0.1))
    put(kick)
    const under = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.035, 0.24), M.panelBack)
    under.position.copy(v(MIP_FWD + 0.1, s * 0.585, MIP.sideBottom - 0.018))
    put(under)
  }

  // Live screens just proud of the painted glass.
  const screen = (tex: THREE.Texture, lat: number, up: number, w: number, h: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }))
    m.position.copy(v(MIP_FWD - 0.002, lat, up))
    put(m)
    return m
  }
  for (const slot of layout.dus) {
    if (slot.kind === 'lower') continue
    const g = duGlass(slot)
    screen(slot.kind === 'pfd' ? screens.pfd : slot.kind === 'nd' ? screens.nd : screens.eicas, slot.lat, slot.up, g.w, g.h)
  }
  screen(screens.isfd, layout.isfd.lat, layout.isfd.up, layout.isfd.size, layout.isfd.size)
  // Lower DU: blank in normal operation (secondary engine page on demand).

  // Gear panel (LIVE: gear lights + flap position indicator).
  const gearPanel = live(512, 900)
  const gs = layout.gear.scale
  const gearPanelW = 0.13 * gs, gearPanelH = 0.23 * gs
  const gp = new THREE.Mesh(new THREE.PlaneGeometry(gearPanelW, gearPanelH), painted(gearPanel.texture))
  gp.position.copy(v(MIP_FWD - 0.0015, layout.gear.lat, layout.gear.up + 0.005))
  put(gp)
  // Gear lever: wheel-shaped Boeing knob on a lever in a slot.
  const gearHandle = new THREE.Group()
  gearHandle.position.copy(v(MIP_FWD - 0.01, layout.gear.lat, layout.gear.up + 0.005))
  gearHandle.scale.setScalar(gs)
  gearHandle.userData.travel = 0.055 * gs
  const gearArm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.06), M.metal)
  gearArm.position.z = 0.03
  gearHandle.add(gearArm)
  // Boeing's wheel-shaped gear handle, face toward the pilot.
  const gearKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.016, 20), M.white)
  gearKnob.rotation.x = Math.PI / 2
  gearKnob.position.z = 0.065
  gearHandle.add(gearKnob)
  put(gearHandle)

  // A/P · A/T · FMC P/RST lights (LIVE, both sides share one canvas) —
  // also pushbuttons: pressing resets the light.
  const prst = live(384, 88)
  const pfdLat = (side: number): number => layout.dus.find((d) => d.kind === 'pfd' && Math.sign(d.lat) === side)?.lat ?? side * 0.645
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.024), painted(prst.texture))
    m.position.copy(v(MIP_FWD - 0.0015, pfdLat(side), PRST_UP))
    put(m)
    for (const [id, dl] of [['apReset', -0.06], ['atReset', 0]] as const) {
      const h = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.024), new THREE.MeshBasicMaterial({ visible: false }))
      h.position.copy(v(MIP_FWD - 0.003, pfdLat(side) + dl, PRST_UP))
      h.userData.controlId = id
      put(h)
      interactive.push(h)
    }
  }

  // ---------------- Glareshield ----------------
  // Glareshield: the hood over the MCP/EFIS faces, and a top surface that
  // slopes down to the windshield base, its forward edge following the
  // wrapped No.1 windows (a pentagon: post bases + nose).
  const GS_TOP = 0.91, HOOD_BOTTOM = 0.812, HOOD_AFT = 0.66
  const padPts = [v(0.655, -0.845, GS_TOP), v(0.655, 0.845, GS_TOP), v(0.88, 0.8, 0.872), v(1.06, 0, 0.866), v(0.88, -0.8, 0.872)]
  const padGeo = new THREE.BufferGeometry().setFromPoints(padPts)
  padGeo.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4])
  padGeo.computeVertexNormals()
  const glareTop = M.glare.clone()
  glareTop.side = THREE.DoubleSide
  glareTop.map = paddingTexture()
  padGeo.setAttribute('uv', new THREE.Float32BufferAttribute(padPts.flatMap((q) => [q.x * 4, q.z * 4]), 2))
  FILLED.push([glareTop, 0.25])
  put(new THREE.Mesh(padGeo, glareTop))
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.69, GS_TOP - HOOD_BOTTOM, 0.08), M.glare)
  hood.position.copy(v(HOOD_AFT + 0.04, 0, (GS_TOP + HOOD_BOTTOM) / 2))
  put(hood)
  const faceH = 0.092, faceUp = (GS_TOP + HOOD_BOTTOM) / 2 - 0.001
  const face = (tex: THREE.Texture, lat0: number, lat1: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(lat1 - lat0, faceH), painted(tex))
    m.position.copy(v(HOOD_AFT - 0.002, (lat0 + lat1) / 2, faceUp))
    put(m)
    return m
  }
  const mcp = live(2400, 310)
  const mcpMesh = face(mcp.texture, -0.43, 0.43)
  const annunL = live(560, 300), annunR = live(560, 300)
  face(annunL.texture, -0.84, -0.645)
  face(annunR.texture, 0.645, 0.84)
  const efis = canvasTex(560, 300)
  paintEfis(efis.ctx, 560, 300, style.panel)
  efis.texture.needsUpdate = true
  face(efis.texture, -0.64, -0.435)
  face(efis.texture, 0.435, 0.64)
  // MCP click regions (CMD A and DISENGAGE) as invisible hit boxes.
  const hit = (id: string, lat: number, up: number, w: number, h: number): void => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ visible: false }))
    m.position.copy(v(HOOD_AFT - 0.004, lat, up))
    m.userData.controlId = id
    put(m)
    interactive.push(m)
  }
  const mcpLat = (fx: number): number => -0.43 + fx * 0.86
  // Every button and knob half of the guidance panel is clickable; the
  // knobs auto-repeat while held (see main.ts) so the altitude can be dialled.
  const MW = 2400, MH = 310
  for (const c of mcpControls(style.panel, MW, MH, style.autothrottle)) {
    hit(c.id, -0.43 + c.fx * 0.86, faceUp + faceH * (0.5 - c.fy), Math.max(0.012, c.fw * 0.86), Math.max(0.008, c.fh * faceH))
  }
  if (style.panel === 'boeing') hit('mcpDisengage', mcpLat(0.95), faceUp + faceH * 0.24, 0.06, 0.015)
  hit('masterCaution', -0.69, faceUp + faceH * 0.27, 0.075, 0.035)
  hit('masterCaution', 0.79, faceUp + faceH * 0.27, 0.075, 0.035)
  void mcpMesh

  // ---------------- Windows & structure ----------------
  // No.1 windows wrap to ≈ 19° left of the captain's line of sight; the
  // No.1/No.2 posts stand on the glareshield corners.
  const W1 = { ib: v(1.06, -0.03, 0.866), ob: v(0.88, -0.8, 0.872), ot: v(0.7, -0.74, 1.37), it: v(0.805, -0.03, 1.415) }
  const W2 = { fb: v(0.875, -0.815, 0.876), ab: v(0.38, -0.88, 0.885), at: v(0.33, -0.83, 1.3), ft: v(0.69, -0.755, 1.365) }
  const W3 = { fb: v(0.35, -0.885, 0.885), ab: v(-0.1, -0.905, 0.9), at: v(-0.08, -0.87, 1.18), ft: v(0.31, -0.84, 1.29) }
  const mirror = (p: THREE.Vector3): THREE.Vector3 => new THREE.Vector3(-p.x, p.y, p.z)
  for (const s of [-1, 1]) {
    const f = (p: THREE.Vector3): THREE.Vector3 => (s < 0 ? p.clone() : mirror(p))
    put(quad(f(W1.ib), f(W1.ob), f(W1.ot), f(W1.it), M.glass))
    put(quad(f(W2.fb), f(W2.ab), f(W2.at), f(W2.ft), M.glass))
    put(quad(f(W3.fb), f(W3.ab), f(W3.at), f(W3.ft), M.glass))
    // Window frames.
    const fr = (a: THREE.Vector3, b: THREE.Vector3, w = 0.045): void => { put(beam(f(a), f(b), w, 0.05, M.frame)) }
    fr(W1.ob, W1.ot, 0.05) // A-pillar (No.1/No.2 post)
    fr(W1.it, W1.ot, 0.034)
    fr(W2.ab, W2.at, 0.042)
    fr(W2.ft, W2.at, 0.03)
    fr(W2.fb, W2.ab, 0.028)
    fr(W3.ft, W3.at, 0.03)
    fr(W3.fb, W3.ab, 0.028)
    fr(W3.ab, W3.at, 0.034)
    // Sliding-window handle on No.2.
    const handle = beam(f(v(0.6, -0.83, 1.0)), f(v(0.6, -0.83, 1.12)), 0.018, 0.03, M.metal)
    put(handle)
    // Sidewall: tapers from the A-pillar base to the panel station, then
    // runs aft under the side windows; a sill closes the gap to the
    // window line (the windows sit inboard of the lower wall).
    put(quad(f(v(0.9, -0.8, -0.25)), f(v(0.74, -0.86, -0.25)), f(v(0.74, -0.86, 0.9)), f(v(0.9, -0.8, 0.875)), M.lining))
    put(quad(f(v(0.74, -0.86, -0.25)), f(v(0.38, -0.88, -0.25)), f(v(0.38, -0.88, 0.885)), f(v(0.74, -0.86, 0.9)), M.lining))
    put(quad(f(v(0.38, -0.88, -0.25)), f(v(-0.7, -0.93, -0.25)), f(v(-0.7, -0.93, 0.9)), f(v(0.38, -0.88, 0.885)), M.lining))
    put(quad(f(v(0.875, -0.815, 0.876)), f(v(0.74, -0.86, 0.9)), f(v(0.38, -0.88, 0.885)), f(v(0.38, -0.88, 0.885)), M.lining))
    // Headliner: window tops to the overhead panel edge.
    put(quad(f(v(0.7, -0.74, 1.37)), f(v(0.70, -0.42, 1.45)), f(v(0.0, -0.42, 1.62)), f(v(0.33, -0.83, 1.3)), M.ceiling))
    put(quad(f(v(0.33, -0.82, 1.3)), f(v(0.0, -0.42, 1.62)), f(v(-0.6, -0.42, 1.66)), f(v(-0.08, -0.86, 1.18)), M.ceiling))
    put(quad(f(v(-0.08, -0.86, 1.18)), f(v(-0.6, -0.42, 1.66)), f(v(-0.7, -0.6, 1.6)), f(v(-0.7, -0.92, 1.1)), M.ceiling))
    put(quad(f(v(-0.1, -0.905, 0.9)), f(v(-0.08, -0.87, 1.18)), f(v(-0.7, -0.93, 1.1)), f(v(-0.7, -0.93, 0.9)), M.lining))
    // Sun visor stowed along the No.1 window head.
    // (sun visors stay stowed up against the headliner — not modelled as bars across the glass)
  }
  put(beam(W1.ib.clone().setX(0), W1.it.clone().setX(0), 0.045, 0.04, M.frame)) // center post
  put(quad(v(0.805, -0.03, 1.415), v(0.805, 0.03, 1.415), v(0.70, 0.42, 1.45), v(0.70, -0.42, 1.45), M.ceiling))
  put(quad(v(0.7, -0.74, 1.37), v(0.805, -0.03, 1.415), v(0.70, -0.42, 1.45), v(0.70, -0.42, 1.45), M.ceiling))
  put(quad(v(0.805, 0.03, 1.415), v(0.7, 0.74, 1.37), v(0.70, 0.42, 1.45), v(0.70, 0.42, 1.45), M.ceiling))

  // ---------------- Overhead ----------------
  const oh = live(2048, 1760)
  // Texture top = aft edge (read looking up); normal faces down at the pilot.
  const OH = { bl: v(0.70, -0.42, 1.45), br: v(0.70, 0.42, 1.45), tr: v(0.0, 0.42, 1.62), tl: v(0.0, -0.42, 1.62) }
  put(quad(OH.bl, OH.br, OH.tr, OH.tl, painted(oh.texture)))
  // Canvas px → point on the overhead quad (bilinear), 4 mm proud.
  const ohAt = (x: number, y: number): THREE.Vector3 => {
    const u = x / 2048, w = 1 - y / 1760
    const bottom = OH.bl.clone().lerp(OH.br, u), top = OH.tl.clone().lerp(OH.tr, u)
    return bottom.lerp(top, w).add(new THREE.Vector3(0, -0.004, 0.001))
  }
  {
    const b = landingSwitchBox(2048, 1760)
    const m = quad(ohAt(b.x0, b.y1), ohAt(b.x1, b.y1), ohAt(b.x1, b.y0), ohAt(b.x0, b.y0), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }))
    m.userData.controlId = 'landingLights'
    put(m)
    interactive.push(m)
  }
  if (style.turboprop) {
    // Engine start selectors: press and hold to crank (the starter).
    for (const idx of ENGINE_START_ITEMS) {
      const b = lightsRowItemBox(2048, 1760, idx)
      const m = quad(ohAt(b.x0, b.y1), ohAt(b.x1, b.y1), ohAt(b.x1, b.y0), ohAt(b.x0, b.y0), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }))
      m.userData.controlId = 'engStart'
      put(m)
      interactive.push(m)
    }
  }
  const aftOh = canvasTex(1024, 640)
  {
    const c = aftOh.ctx
    c.fillStyle = '#2f3236'; c.fillRect(0, 0, 1024, 640)
    plate(c, 6, 6, 330, 300, 'IRS MODE', 15)
    knob(c, 100, 160, 34, -Math.PI * 0.25, [['OFF', -Math.PI * 0.9], ['ALIGN', -Math.PI * 0.65], ['NAV', -Math.PI * 0.4], ['ATT', -Math.PI * 0.15]], 'L')
    knob(c, 240, 160, 34, -Math.PI * 0.4, [['OFF', -Math.PI * 0.9], ['ALIGN', -Math.PI * 0.65], ['NAV', -Math.PI * 0.4], ['ATT', -Math.PI * 0.15]], 'R')
    plate(c, 346, 6, 330, 300, 'OXYGEN', 15)
    gauge(c, 450, 170, 60, 'CREW OXY', 8, 0.75)
    lamp(c, 560, 120, 90, 40, ['PASS', 'OXY ON'], AMBER)
    plate(c, 686, 6, 332, 300, 'ENGINE EEC', 15)
    lamp(c, 720, 90, 110, 46, ['ON'], GREEN, true); lamp(c, 880, 90, 110, 46, ['ON'], GREEN, true)
    lamp(c, 720, 160, 110, 46, ['ALTN'], AMBER); lamp(c, 880, 160, 110, 46, ['ALTN'], AMBER)
    plate(c, 6, 316, 500, 318, 'WARNING TEST', 15)
    for (const [t, x] of [['MACH AIRSPEED 1', 90], ['MACH AIRSPEED 2', 210], ['STALL 1', 330], ['STALL 2', 440]] as const) {
      c.fillStyle = '#1e2124'; c.beginPath(); c.arc(x, 470, 20, 0, Math.PI * 2); c.fill()
      engrave(c, t, x, 520, 12)
    }
    plate(c, 516, 316, 502, 318, 'LANDING GEAR', 15)
    for (const [t, x] of [['LEFT', 620], ['NOSE', 767], ['RIGHT', 914]] as const) lamp(c, x - 55, 430, 110, 70, [t, 'GEAR', 'DOWN'], GREEN)
    void ENGRAVE
  }
  aftOh.texture.needsUpdate = true
  put(quad(v(0.0, -0.42, 1.62), v(0.0, 0.42, 1.62), v(-0.55, 0.42, 1.66), v(-0.55, -0.42, 1.66), painted(aftOh.texture)))

  // ---------------- Control stand (throttle quadrant) ----------------
  const standShape = new THREE.Shape()
  const prof: Array<[number, number]> = [[0.72, -0.25], [0.72, 0.3], [0.62, 0.345], [0.48, 0.368], [0.3, 0.372], [0.3, -0.25]]
  prof.forEach(([f, u], i) => (i === 0 ? standShape.moveTo(f, u) : standShape.lineTo(f, u)))
  const standGeo = new THREE.ExtrudeGeometry(standShape, { depth: 0.26, bevelEnabled: false })
  // Shape (x=fwd, y=up) extruded along +z → map to body: x→ −render z, z → lateral.
  standGeo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -0.13, 0, 1, 0, 0, -1, 0, 0, -EYE_X, 0, 0, 0, 1))
  put(new THREE.Mesh(standGeo, M.stand))
  // Top plate (LIVE: flap gate highlight, stab trim pointer, park brake light).
  const stand = live(640, 700)
  put(quad(v(0.3, -0.13, 0.374), v(0.3, 0.13, 0.374), v(0.62, 0.13, 0.348), v(0.62, -0.13, 0.348), painted(stand.texture)))
  // Thrust levers + piggyback reversers + start levers.
  const thrust: THREE.Group[] = [], reversers: THREE.Group[] = [], startLevers: THREE.Group[] = []
  const lats = leverLats(engines), kScale = lats.length >= 3 ? 0.75 : 1
  for (const lat of lats) {
    const s = lat < 0 ? -1 : 1
    const p = new THREE.Group()
    p.position.copy(v(0.52, lat, 0.26))
    let knobBar: THREE.Mesh
    if (style.turboprop) {
      // Turboprop power lever: straight arm, T-handle grip.
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.26, 0.014), M.metal)
      arm.position.set(0, 0.13, 0.02)
      arm.rotation.x = 0.15
      p.add(arm)
      knobBar = new THREE.Mesh(new THREE.BoxGeometry(0.05 * kScale, 0.022, 0.03), M.black)
      knobBar.position.set(0, 0.27, 0.06)
      p.add(knobBar)
    } else {
      // Jet thrust lever: a long arm curving aft to a wide grip.
      const armPath = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.14, 0.01), new THREE.Vector3(0, 0.26, 0.05), new THREE.Vector3(0, 0.31, 0.09)])
      p.add(new THREE.Mesh(new THREE.TubeGeometry(armPath, 16, 0.009, 8), M.metal))
      knobBar = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.034, 4, 10), M.leverWhite)
      knobBar.rotation.z = Math.PI / 2
      knobBar.scale.set(1, kScale, 1) // capsule length runs along local y before the roll
      knobBar.position.set(0, 0.315, 0.1)
      p.add(knobBar)
      // The engine number on top of the handle (1, 2, …), black on white.
      const nTex = numeralTexture(String(lats.indexOf(lat) + 1))
      const numPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.03 * kScale, 0.03 * kScale), new THREE.MeshBasicMaterial({ map: nTex, toneMapped: false }))
      numPlate.rotation.x = -Math.PI / 2 // faces up, texture top toward the nose
      numPlate.position.set(0, 0.315 + 0.0225 * kScale, 0.1)
      p.add(numPlate)
      if (style.panel === 'boeing') {
        const toga = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.012, 0.008), M.knobGray)
        toga.position.set(0, 0.297, 0.117)
        p.add(toga)
      }
      if (style.autothrottle) {
        const atDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 10), M.red)
        atDisc.rotation.z = Math.PI / 2
        atDisc.position.set(s * 0.036 * kScale, 0.315, 0.1)
        atDisc.userData.controlId = 'atDisconnect'
        interactive.push(atDisc)
        p.add(atDisc)
      }
    }
    knobBar.userData.controlId = 'throttleKnob'
    interactive.push(knobBar)
    put(p)
    thrust.push(p)
    if (style.reversers) {
      const r = new THREE.Group()
      r.position.set(0, 0.24, 0.02)
      const rev = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.07, 0.012), M.metal)
      rev.position.y = 0.035
      r.add(rev)
      const revKnob = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.016), M.black)
      revKnob.position.y = 0.07
      r.add(revKnob)
      r.rotation.x = 0.9
      p.add(r)
      reversers.push(r)
    }
    const st = new THREE.Group()
    st.position.copy(v(0.34, lat, 0.37))
    const sArm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.06, 0.012), M.metal)
    sArm.position.y = 0.03
    st.add(sArm)
    // Start levers (jets) or condition levers (turboprops, red grips).
    const sKnob = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.022, 0.03), style.turboprop ? M.red : M.knobGray)
    sKnob.position.y = 0.065
    st.add(sKnob)
    put(st)
    startLevers.push(st)
  }
  // Speedbrake (left) and flap (right) levers.
  const lever = (lat: number, len: number, handle: THREE.Mesh): THREE.Group => {
    const p = new THREE.Group()
    p.position.copy(v(0.47, lat, 0.33))
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.012, len, 0.012), M.metal)
    arm.position.y = len / 2
    p.add(arm)
    handle.position.y = len
    p.add(handle)
    put(p)
    return p
  }
  const sbHandle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.022, 0.055), M.knobGray)
  const speedbrake = lever(-0.1, 0.13, sbHandle)
  speedbrake.visible = style.speedbrake
  const flapHandle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.032), M.white)
  flapHandle.userData.controlId = 'flapLever'
  interactive.push(flapHandle)
  const flap = lever(0.1, 0.12, flapHandle)
  // Stabilizer trim wheels on the stand flanks.
  const trimWheels: THREE.Mesh[] = []
  for (const s of style.trimWheels ? [-1, 1] : []) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.034, 40), M.wheel)
    w.rotation.z = Math.PI / 2
    w.position.copy(v(0.5, s * 0.155, 0.2))
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.036, 0.11), M.white)
    stripe.position.set(0, 0, 0.07)
    w.add(stripe)
    const crank = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.05, 10), M.black)
    crank.position.set(0, s * 0.03, -0.09)
    w.add(crank)
    w.userData.controlId = 'trimWheel'
    interactive.push(w)
    put(w)
    trimWheels.push(w)
  }
  // Parking brake handle (aft-left) and the HORN CUTOUT button.
  const parkingBrake = new THREE.Group()
  parkingBrake.position.copy(v(0.34, -0.1, 0.372))
  const pbHandle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.012, 0.018), M.knobGray)
  pbHandle.position.y = 0.012
  parkingBrake.add(pbHandle)
  put(parkingBrake)
  const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.01, 12), M.black)
  horn.position.copy(v(0.6, -0.115, 0.352))
  horn.userData.controlId = 'hornCutout'
  interactive.push(horn)
  put(horn)

  // ---------------- Aisle stand ----------------
  const aisleBody = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.6, 0.72), M.stand)
  aisleBody.position.copy(v(-0.06, 0, 0.03))
  put(aisleBody)
  // CDU housings on the sloped forward section.
  const cdu = live(560, 860)
  const cduMat = painted(cdu.texture)
  for (const s of [-1, 1]) {
    put(quad(v(0.08, s * 0.087 - 0.075, 0.334), v(0.08, s * 0.087 + 0.075, 0.334), v(0.3, s * 0.087 + 0.075, 0.43), v(0.3, s * 0.087 - 0.075, 0.43), cduMat))
  }
  const slope = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.11, 0.24), M.stand)
  slope.position.copy(v(0.212, 0, 0.331))
  slope.rotation.x = 0.411
  put(slope)
  const aisle = live(768, 1024)
  put(quad(v(-0.4, -0.18, 0.336), v(-0.4, 0.18, 0.336), v(0.08, 0.18, 0.336), v(0.08, -0.18, 0.336), painted(aisle.texture)))
  // Engine/APU fire switch handles (lights live) and the fire test switch.
  const fireHandles: THREE.Mesh[] = []
  for (const fx of [0.2, 0.5, 0.8]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.03), M.fireHandle.clone())
    h.position.copy(v(0.08 - (3.5 / 7) * 0.48, -0.18 + fx * 0.36, 0.352))
    put(h)
    fireHandles.push(h)
  }
  const fireTest = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.03), M.black)
  fireTest.position.copy(v(0.08 - (575 / 1024) * 0.48, -0.18 + 0.35 * 0.36, 0.345))
  fireTest.userData.controlId = 'fireTest'
  interactive.push(fireTest)
  put(fireTest)

  // ---------------- Side consoles, tiller ----------------
  for (const s of [-1, 1]) {
    const con = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.9), M.stand)
    con.position.copy(v(0.0, s * 0.79, 0.1))
    put(con)
    const top = canvasTex(256, 1024)
    {
      const c = top.ctx
      c.fillStyle = PANEL_GRAY; c.fillRect(0, 0, 256, 1024)
      plate(c, 8, 20, 240, 300, s < 0 ? 'NOSE WHEEL STEERING' : 'CHART', 12)
      plate(c, 8, 340, 240, 300, 'OXYGEN MASK', 12)
      plate(c, 8, 660, 240, 340, 'AUDIO CONTROL', 12)
      for (let i = 0; i < 6; i++) lamp(c, 24 + (i % 3) * 74, 720 + Math.floor(i / 3) * 60, 60, 40, [['VHF1', 'VHF2', 'VHF3', 'HF1', 'FLT', 'SVC'][i]!], '#e8e8dc', i === 0)
      for (let i = 0; i < 6; i++) knob(c, 40 + (i % 3) * 80, 880 + Math.floor(i / 3) * 70, 16)
    }
    top.texture.needsUpdate = true
    const l0 = s < 0 ? -0.89 : 0.69
    put(quad(v(-0.45, l0, 0.452), v(-0.45, l0 + 0.2, 0.452), v(0.45, l0 + 0.2, 0.452), v(0.45, l0, 0.452), painted(top.texture)))
    const mask = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.17), M.frame)
    mask.position.copy(v(-0.05, s * 0.79, 0.49))
    put(mask)
  }
  const tiller = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.009, 8, 28), M.wheel)
  tiller.position.copy(v(0.33, -0.775, 0.49))
  tiller.rotation.x = -Math.PI / 2 + 0.35
  put(tiller)
  const tillerHub = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.04, 12), M.wheel)
  tillerHub.position.copy(v(0.33, -0.775, 0.47))
  put(tillerHub)

  // ---------------- Floor, pedals, seats, columns ----------------
  put(quad(v(-0.8, -0.92, -0.25), v(-0.8, 0.92, -0.25), v(1.05, 0.7, -0.25), v(1.05, -0.7, -0.25), M.carpet))
  const pedals: Array<{ mesh: THREE.Group; side: -1 | 1 }> = []
  for (const lat0 of [-0.5, 0.5]) for (const s of [-1, 1] as const) {
    const p = new THREE.Group()
    p.position.copy(v(0.93, lat0 + s * 0.1, -0.18))
    const plateM = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.17, 0.02), M.black)
    plateM.position.y = 0.1
    plateM.rotation.x = -0.35
    p.add(plateM)
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.02), M.metal)
    arm.position.set(0, 0.1, -0.06)
    p.add(arm)
    put(p)
    pedals.push({ mesh: p, side: s })
  }
  put(buildSeat(-0.5))
  put(buildSeat(0.5))
  const capt = style.control === 'sidestick' ? buildSidestick(-1) : buildColumn(-0.5, -1)
  const fo = style.control === 'sidestick' ? buildSidestick(1) : buildColumn(0.5, 1)
  put(capt.pivot)
  put(fo.pivot)

  const stub = (): THREE.Mesh => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.001, 0.001, 0.001), M.black); m.visible = false; group.add(m); return m }

  return {
    interactive, mcp, annunL, annunR, aisle, stand, gearPanel, cdu, overhead: oh, prst, panelMats,
    rig: { capt, fo, thrust, reversers, startLevers, speedbrake, flap, trimWheels, pedals, gearHandle, parkingBrake, fireHandles },
    flapDetentsDeg, engines, style,
    yokeColumn: stub(), yokeWheel: stub(), throttleKnob: stub(), flapLever: stub(), trimWheel: stub(),
  }
}

// ---------------------------------------------------------------------------
// Per-frame animation and live panels
// ---------------------------------------------------------------------------

export interface Deck737Controls {
  pitch: number
  roll: number
  yaw: number
  throttle: number
  reverse: number
  flapsDeg: number
  speedbrake: number
  speedbrakeArmed: boolean
  trim: number
  gearDown: boolean
  parkingBrake: boolean
  /** One flag per engine (length = deck.engines). */
  enginesRunning: readonly boolean[]
}

/** Flap lever angle for a flap setting: interpolated across the gate. */
export function flapLeverFrac(flapsDeg: number, detents: readonly number[]): number {
  if (detents.length < 2) return 0
  if (flapsDeg <= detents[0]!) return 0
  for (let i = 1; i < detents.length; i++) {
    if (flapsDeg <= detents[i]!) return (i - 1 + (flapsDeg - detents[i - 1]!) / Math.max(1e-6, detents[i]! - detents[i - 1]!)) / (detents.length - 1)
  }
  return 1
}

export function animate737(deck: Deck737, c: Deck737Controls): void {
  const clamp = (x: number, a = -1, b = 1): number => Math.max(a, Math.min(b, Number.isFinite(x) ? x : 0))
  const p = clamp(c.pitch), r = clamp(c.roll)
  // Column: ±12° fore/aft about the floor pivot (pull = aft = +x rotation);
  // wheel: ±90° (the 737 wheel travel is ~±107° — scaled for view).
  for (const side of [deck.rig.capt, deck.rig.fo]) {
    if (side.pivot.userData.sidestick) {
      // Sidestick: ±17° pitch (pull = aft), ±20° roll about its base.
      side.pivot.rotation.x = p * 0.3
      side.pivot.rotation.z = -r * 0.35
      continue
    }
    side.pivot.rotation.x = p * 0.2
    side.wheel.rotation.z = -r * 1.5
  }
  // Thrust levers: idle raked aft 30°, full forward ~22°.
  for (const t of deck.rig.thrust) t.rotation.x = 0.3 - clamp(c.throttle, 0, 1) * 0.85
  for (const rv of deck.rig.reversers) rv.rotation.x = 0.9 - clamp(c.reverse, 0, 1) * 1.6
  deck.rig.startLevers.forEach((s, i) => { s.rotation.x = c.enginesRunning[i] ?? c.enginesRunning[0] ? 0 : 0.55 })
  // Speedbrake: DOWN forward, ARMED a notch aft, UP fully aft.
  deck.rig.speedbrake.rotation.x = -0.45 + (c.speedbrakeArmed ? 0.12 : 0) + clamp(c.speedbrake, 0, 1) * 0.95
  // Flap lever: UP forward → 40 aft.
  deck.rig.flap.rotation.x = -0.5 + flapLeverFrac(c.flapsDeg, deck.flapDetentsDeg) * 1.0
  for (const w of deck.rig.trimWheels) w.rotation.x = clamp(c.trim) * Math.PI * 3
  for (const { mesh, side } of deck.rig.pedals) {
    mesh.userData.z0 ??= mesh.position.z
    mesh.position.z = (mesh.userData.z0 as number) - side * clamp(c.yaw) * 0.06
  }
  deck.rig.gearHandle.rotation.x = c.gearDown ? 0.35 : -0.35
  const travel = (deck.rig.gearHandle.userData.travel as number | undefined) ?? 0.055
  deck.rig.gearHandle.position.y = (deck.rig.gearHandle.userData.y0 ??= deck.rig.gearHandle.position.y) + (c.gearDown ? -travel : travel)
  deck.rig.parkingBrake.rotation.x = c.parkingBrake ? -0.6 : 0
}

export interface Deck737Live {
  mcp: Mcp737State
  /** Red A/P and A/T P/RST lights (latched after a disconnect). */
  prst: { ap: boolean; at: boolean }
  fireWarn: boolean
  masterCaution: boolean
  aisle: AisleState
  gear: { left: number; nose: number; right: number }
  flapsDeg: number
  trimUnits: number
  parkingBrake: boolean
  speedbrakeArmed: boolean
  cduLines: Array<[string, string, string?]>
  landingLights: boolean
  powered: boolean
  /** 0 (night, panel floodlights) … 1 (full daylight). */
  ambient: number
}

export function update737Live(deck: Deck737, s: Deck737Live): void {
  const redraw = (l: Live, key: string, paint: () => void): void => {
    if (key === l.last) return
    l.last = key
    paint()
    l.texture.needsUpdate = true
  }
  const C = (l: Live): CanvasRenderingContext2D => l.ctx
  redraw(deck.mcp, JSON.stringify(s.mcp), () => paintMcp737(C(deck.mcp), deck.mcp.ctx.canvas.width, deck.mcp.ctx.canvas.height, s.mcp, deck.style.panel, deck.style.autothrottle))
  // Disconnect lights flash at 2 Hz while latched.
  const flash = Math.floor(performance.now() / 250) % 2 === 0
  redraw(deck.prst, `${s.prst.ap && flash}|${s.prst.at && flash}`, () => paintPrst(C(deck.prst), 384, 88, s.prst.ap && flash, s.prst.at && flash, deck.style.panel))
  const ak = `${s.fireWarn}|${s.masterCaution}`
  redraw(deck.annunL, ak, () => paintAnnunciators(C(deck.annunL), 560, 300, 'L', s.fireWarn, s.masterCaution, deck.style.panel))
  redraw(deck.annunR, ak, () => paintAnnunciators(C(deck.annunR), 560, 300, 'R', s.fireWarn, s.masterCaution, deck.style.panel))
  redraw(deck.aisle, JSON.stringify(s.aisle), () => paintAisle(C(deck.aisle), 768, 1024, s.aisle))
  for (const h of deck.rig.fireHandles) (h.material as THREE.MeshStandardMaterial).emissiveIntensity = s.aisle.fireTest ? 1.2 : 0
  redraw(deck.gearPanel, `${s.gear.left.toFixed(2)}|${s.gear.nose.toFixed(2)}|${s.gear.right.toFixed(2)}|${s.flapsDeg.toFixed(1)}`, () => paintGearPanel(C(deck.gearPanel), 512, 900, s.gear, s.flapsDeg, deck.flapDetentsDeg))
  redraw(deck.stand, `${s.trimUnits.toFixed(1)}|${s.parkingBrake}|${s.flapsDeg.toFixed(0)}|${s.speedbrakeArmed}`, () => paintStand(C(deck.stand), 640, 700, s, deck.flapDetentsDeg, deck.engines, deck.style.turboprop))
  redraw(deck.overhead, `${s.landingLights}|${s.powered}`, () => paintOverhead(C(deck.overhead), 2048, 1760, { landing: s.landingLights, powered: s.powered }))
  redraw(deck.cdu, JSON.stringify(s.cduLines), () => {
    const c = C(deck.cdu)
    c.fillStyle = '#4b5055'; c.fillRect(0, 0, 560, 860)
    c.save(); c.translate(40, 30)
    paintCdu(c, 480, 330, s.cduLines)
    c.restore()
    c.save(); c.translate(0, 380)
    paintCduKeys(c, 560, 480)
    c.restore()
  })
  const k = 0.55 + 0.45 * Math.max(0, Math.min(1, s.ambient))
  for (const m of deck.panelMats) m.color.setScalar(k)
  setInteriorFill(s.ambient)
}

/** Landing gear lights (green down-and-locked / red in transit) and the
 *  dual-needle flap position indicator (LIVE). */
function paintGearPanel(c: CanvasRenderingContext2D, W: number, H: number, g: { left: number; nose: number; right: number }, flapsDeg: number, detents: readonly number[]): void {
  c.fillStyle = PANEL_GRAY
  c.fillRect(0, 0, W, H)
  // Gear lights in the Boeing triangle: nose top, left/right below.
  const light = (x: number, y: number, label: string, pos: number): void => {
    const down = pos >= 0.999, transit = pos > 0.001 && pos < 0.999
    lamp(c, x - 70, y, 140, 52, [label, 'GEAR'], RED, transit)
    lamp(c, x - 70, y + 60, 140, 52, [label, 'GEAR', 'DOWN'], GREEN, down)
  }
  light(W / 2, 20, 'NOSE', g.nose)
  light(W / 2 - 150, 150, 'LEFT', g.left)
  light(W / 2 + 150, 150, 'RIGHT', g.right)
  engrave(c, 'UP', W / 2, 300, 18); engrave(c, 'OFF', W / 2, 400, 18); engrave(c, 'DN', W / 2, 500, 18)
  c.fillStyle = '#1b1c1e'; c.fillRect(W / 2 - 16, 300, 32, 220)
  // Flap position indicator.
  const cx = W / 2, cy = 740, r = 110
  c.fillStyle = '#101113'; c.beginPath(); c.arc(cx, cy, r + 12, 0, Math.PI * 2); c.fill()
  c.fillStyle = '#18191b'; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill()
  engrave(c, 'FLAPS', cx, cy + 50, 18)
  const a0 = -Math.PI * 0.5, span = Math.PI * 1.3
  detents.forEach((d, i) => {
    const a = a0 + (i / Math.max(1, detents.length - 1)) * span
    c.strokeStyle = '#ececea'; c.lineWidth = 3
    c.beginPath(); c.moveTo(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78); c.lineTo(cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.95); c.stroke()
    engrave(c, i === 0 ? 'UP' : String(d), cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6, 17)
  })
  const fa = a0 + flapLeverFrac(flapsDeg, detents) * span
  for (const [dx, col] of [[-3, '#ffffff'], [3, '#ffffff']] as const) {
    c.strokeStyle = col; c.lineWidth = 4
    c.beginPath(); c.moveTo(cx + dx, cy); c.lineTo(cx + Math.cos(fa) * r * 0.85 + dx, cy + Math.sin(fa) * r * 0.85); c.stroke()
  }
  c.fillStyle = '#2b2d30'; c.beginPath(); c.arc(cx, cy, 12, 0, Math.PI * 2); c.fill()
  engrave(c, 'L', cx - 26, cy - 20, 12); engrave(c, 'R', cx + 26, cy - 20, 12)
}

/** Control-stand top plate: flap gate with detent numbers, stab trim
 *  scales with green band and pointer, speedbrake gate, park brake light. */
function paintStand(c: CanvasRenderingContext2D, W: number, H: number, s: Deck737Live, detents: readonly number[], engines: number, turboprop = false): void {
  c.fillStyle = PANEL_GRAY
  c.fillRect(0, 0, W, H)
  // canvas top = forward. Thrust lever slots (center).
  for (const lat of leverLats(engines)) { const x = W / 2 + (lat / 0.26) * W; c.fillStyle = '#16171a'; c.fillRect(x - 9, 60, 18, H * 0.6) }
  // Flap gate (right) — numbers along the slot, UP at the top (forward).
  const fx = W * 0.88
  c.fillStyle = '#16171a'; c.fillRect(fx - 8, 50, 16, H * 0.68)
  engrave(c, 'FLAPS', fx, 30, 18)
  detents.forEach((d, i) => {
    const y = 60 + (i / Math.max(1, detents.length - 1)) * H * 0.64
    engrave(c, i === 0 ? 'UP' : String(d), fx - 40, y, 15, 'center', Math.abs(d - s.flapsDeg) < 0.5 ? '#9cff9c' : ENGRAVE)
    c.fillStyle = ENGRAVE; c.fillRect(fx + 10, y - 1, 12, 2)
  })
  // Speedbrake gate (left).
  const sx = W * 0.12
  c.fillStyle = '#16171a'; c.fillRect(sx - 8, 50, 16, H * 0.6)
  engrave(c, 'SPEED BRAKE', sx + 40, 30, 15)
  for (const [t, y] of [['DOWN', 60], ['ARMED', 120], ['FLIGHT DETENT', 280], ['UP', 470]] as const) engrave(c, t, sx + 20, y, 12, 'left', t === 'ARMED' && s.speedbrakeArmed ? '#9cff9c' : ENGRAVE)
  // Stab trim scales (both sides): 0..17 units, green band 2.5..9 (takeoff).
  for (const x of [W * 0.27, W * 0.73]) {
    engrave(c, 'STAB TRIM', x, H * 0.72, 13)
    const y0 = H * 0.76, y1 = H * 0.98
    c.fillStyle = '#16171a'; c.fillRect(x - 10, y0, 20, y1 - y0)
    const uy = (u: number): number => y0 + (u / 17) * (y1 - y0)
    c.fillStyle = '#2f9a45'; c.fillRect(x - 10, uy(2.5), 20, uy(9) - uy(2.5))
    for (let u = 0; u <= 17; u += 1) { c.fillStyle = ENGRAVE; c.fillRect(x + 12, uy(u) - 1, u % 5 === 0 ? 14 : 7, 2) }
    const ty = uy(Math.max(0, Math.min(17, s.trimUnits)))
    c.fillStyle = '#ffffff'
    c.beginPath(); c.moveTo(x - 22, ty); c.lineTo(x - 8, ty - 7); c.lineTo(x - 8, ty + 7); c.closePath(); c.fill()
  }
  engrave(c, 'APL NOSE DOWN', W * 0.5, H * 0.995 - 6, 11)
  lamp(c, W * 0.06, H * 0.82, 120, 46, ['PARKING', 'BRAKE'], RED, s.parkingBrake)
  // Start levers placard (aft).
  engrave(c, turboprop ? 'CONDITION LEVERS' : 'START LEVERS', W * 0.5, H * 0.76, 13)
  engrave(c, turboprop ? 'AUTO' : 'IDLE', W * 0.5, H * 0.8, 11); engrave(c, turboprop ? 'FUEL SO' : 'CUTOFF', W * 0.5, H * 0.9, 11)
  for (let i = 0; i < engines; i++) lamp(c, W * (0.5 - 0.075 * engines + 0.15 * i) + 4, H * 0.84, 62, 26, [`ENG ${i + 1}`, 'VALVE'], AMBER)
}
