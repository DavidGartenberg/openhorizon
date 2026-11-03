import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { registerInteriorFill } from './cockpit-737'
import { B738_DECK_NOSE_SHIFT_M } from './cockpit-profile'

/**
 * 737-800 passenger cabin in the Boeing Sky Interior style, built behind the
 * flight deck in the aircraft body frame (x lateral right, y up,
 * z = −forward; the same frame as the deck and the `buildB738` fuselage).
 * With the exterior skin hidden in the cockpit view, the sidewall windows
 * are real openings onto the world and the wings.
 *
 * Everything here is original procedural geometry, sized from published
 * 737-800 cabin dimensions (3.54 m interior width, 31 in seat pitch, 20 in
 * window pitch, ~2.2 m floor to ceiling): sculpted window bays with rounded
 * openings, deep reveals and shades; curved pivot-bin doors with LED lips; an
 * arched ceiling with the blue LED wash; contoured 3-3 economy seats with
 * tray tables and seat pockets; a forward galley, closet and entry doors;
 * and an aft bulkhead with lavatory doors and a curtain.
 *
 * The flight deck sits at the real nose station (B738_DECK_NOSE_SHIFT_M
 * forward of the origin-relative deck layout), so the cabin fills the whole
 * constant-diameter barrel: the cockpit-door bulkhead just behind the deck,
 * the L1/R1 entry zone with the forward galley and closet, 28 rows of 3-3
 * seating with the over-wing exits above the wing, and the aft bulkhead where
 * the tail taper begins. The loft's barrel axis is 0.6 m above the origin,
 * its radius 1.88 m; it runs from 15.7 m forward to 9.9 m aft of the origin.
 */
const FRONT = -0.32 + B738_DECK_NOSE_SHIFT_M

export const CABIN = {
  /** Floor and barrel geometry (body up, metres). */
  floor: -0.25,
  axisY: 0.6,
  /** Inside the 1.88 m skin: 0.08 m of structure and lining. */
  radius: 1.8,
  ceiling: 1.95,
  /** Forward (flight-deck) bulkhead and aft bulkhead, metres forward of origin. */
  frontFwd: FRONT,
  aftFwd: -9.6,
  /** Where the overhead bins (and the arched ceiling) begin. */
  binsFwd: FRONT - 2.68,
  /** Seat rows (3-3), 31 in pitch. */
  firstRowFwd: FRONT - 3.03,
  rowPitch: 0.79,
  rows: 28,
  seatLats: [-1.43, -0.96, -0.49, 0.49, 0.96, 1.43] as const,
  /** Sidewall window band and the rounded openings in it. */
  windowPitch: 0.508,
  windowW: 0.24,
  windowBottom: 0.72,
  windowTop: 1.13,
  openingW: 0.205,
  openingH: 0.33,
  openingR: 0.075,
  revealDepth: 0.075,
  /** Entry doors (L1/R1) occupy this fwd span; no windows there. */
  doorFwd: [FRONT - 1.13, FRONT - 2.08] as const,
  /** Over-wing exit hatches (window plugs) above the wing, fwd centres. */
  overwingExitFwd: [0.9, 0.1] as const,
  /** Doorway to the flight deck. */
  doorwayHalfWidth: 0.33,
  doorwayTop: 1.5,
} as const

/** Lateral half-width of the cabin sidewall at body height `y`. */
export function cabinWallLat(y: number): number {
  const dy = y - CABIN.axisY
  return Math.sqrt(Math.max(CABIN.radius * CABIN.radius - dy * dy, 0))
}

/** Wall angle above the barrel's horizontal for body height `y`. */
const thetaAt = (y: number): number => Math.asin(THREE.MathUtils.clamp((y - CABIN.axisY) / CABIN.radius, -1, 1))

const b = (fwd: number, lat: number, up: number): THREE.Vector3 => new THREE.Vector3(lat, up, -fwd)

/** Point on the sidewall: side ±1, fwd, wall angle θ, optional radial offset. */
function wallPoint(side: number, fwd: number, theta: number, rOff = 0): THREE.Vector3 {
  const r = CABIN.radius + rOff
  return b(fwd, side * r * Math.cos(theta), CABIN.axisY + r * Math.sin(theta))
}

/** Window fwd positions: forward edges of each 0.24 m opening slot. */
export function cabinWindows(): number[] {
  const C = CABIN, out: number[] = []
  for (let f0 = C.frontFwd - 0.55; f0 - C.windowW > C.aftFwd + 0.3; f0 -= C.windowPitch) {
    // Doors take the wall where they are; no window may overlap them.
    if (f0 > C.doorFwd[1] - 0.05 && f0 - C.windowW < C.doorFwd[0] + 0.05) continue
    out.push(f0)
  }
  return out
}

export interface Cabin737 {
  group: THREE.Group
  seats: number
  windows: number
  /** Materials sharing the deck's daylight fill (dimmed with ambient). */
  materials: THREE.MeshStandardMaterial[]
}

// ---------------------------------------------------------------------------
// Procedural textures (skipped where there is no DOM, e.g. unit tests)
// ---------------------------------------------------------------------------

function canvasTexture(size: number, paint: (ctx: CanvasRenderingContext2D, rnd: () => number) => void, repeat: number): THREE.Texture | undefined {
  if (typeof document === 'undefined') return undefined
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  let s = 1234567
  const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647 }
  paint(ctx, rnd)
  const t = new THREE.CanvasTexture(canvas as HTMLCanvasElement)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** Cut-pile carpet: navy ground, blue/grey flecks, a faint diamond motif. */
const carpetTexture = (): THREE.Texture | undefined => canvasTexture(128, (c, rnd) => {
  c.fillStyle = '#343b4b'
  c.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 1400; i++) {
    const k = rnd()
    c.fillStyle = k < 0.4 ? 'rgba(78,92,122,0.55)' : k < 0.8 ? 'rgba(26,30,42,0.5)' : 'rgba(120,128,150,0.35)'
    c.fillRect(Math.floor(rnd() * 128), Math.floor(rnd() * 128), 1 + Math.floor(rnd() * 2), 1)
  }
  c.strokeStyle = 'rgba(96,112,150,0.18)'
  c.lineWidth = 2
  c.beginPath()
  c.moveTo(64, 8); c.lineTo(120, 64); c.lineTo(64, 120); c.lineTo(8, 64); c.closePath()
  c.stroke()
}, 1)

/** Woven seat fabric: fine twill plus a subtle heather. */
const fabricTexture = (): THREE.Texture | undefined => canvasTexture(128, (c, rnd) => {
  c.fillStyle = '#ffffff'
  c.fillRect(0, 0, 128, 128)
  for (let y = 0; y < 128; y += 2) {
    c.fillStyle = 'rgba(0,0,0,0.07)'
    c.fillRect(0, y, 128, 1)
  }
  for (let x = 0; x < 128; x += 3) {
    c.fillStyle = 'rgba(0,0,0,0.05)'
    c.fillRect(x, 0, 1, 128)
  }
  for (let i = 0; i < 900; i++) {
    c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'
    c.fillRect(Math.floor(rnd() * 128), Math.floor(rnd() * 128), 2, 1)
  }
}, 3)

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Parametric surface patch f(u, v) over a (nu × nv) grid, with optional
 *  per-vertex colours (for the additive LED wash). */
function patch(f: (u: number, v: number) => THREE.Vector3, nu: number, nv: number, mat: THREE.Material,
  color?: (u: number, v: number) => [number, number, number]): THREE.Mesh {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], col: number[] = []
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    pos.push(...f(i / nu, j / nv).toArray())
    uv.push(i / nu, j / nv)
    if (color) col.push(...color(i / nu, j / nv))
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, c = a + nu + 1
    idx.push(a, a + 1, c, a + 1, c + 1, c)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return new THREE.Mesh(g, mat)
}

function box(w: number, h: number, d: number, mat: THREE.Material, at: THREE.Vector3): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.copy(at)
  return m
}

function rbox(w: number, h: number, d: number, r: number, mat: THREE.Material, at: THREE.Vector3): THREE.Mesh {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2) * 0.999), mat)
  m.position.copy(at)
  return m
}

/** Rounded rectangle centred on (cx, cy), traced counter-clockwise. */
function roundedRect(path: THREE.Path, cx: number, cy: number, w: number, h: number, r: number): void {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2
  path.moveTo(x0 + r, y0)
  path.lineTo(x1 - r, y0)
  path.quadraticCurveTo(x1, y0, x1, y0 + r)
  path.lineTo(x1, y1 - r)
  path.quadraticCurveTo(x1, y1, x1 - r, y1)
  path.lineTo(x0 + r, y1)
  path.quadraticCurveTo(x0, y1, x0, y1 - r)
  path.lineTo(x0, y0 + r)
  path.quadraticCurveTo(x0, y0, x0 + r, y0)
}

/** Cross-section outline of the cabin (right side, floor → ceiling). */
function sectionRight(): Array<[number, number]> {
  const pts: Array<[number, number]> = []
  const n = 16
  for (let i = 0; i <= n; i++) {
    const y = CABIN.floor + (CABIN.ceiling - CABIN.floor) * (i / n)
    pts.push([cabinWallLat(y), y])
  }
  return pts
}

/** Full-section bulkhead at `fwd`, optionally notched for a doorway. */
function bulkhead(fwd: number, doorway: boolean, mat: THREE.Material): THREE.Mesh {
  const right = sectionRight()
  const shape = new THREE.Shape()
  const d = CABIN.doorwayHalfWidth
  const first = right[0]!
  shape.moveTo(-first[0], first[1])
  if (doorway) {
    shape.lineTo(-d, first[1])
    shape.lineTo(-d, CABIN.doorwayTop)
    shape.lineTo(d, CABIN.doorwayTop)
    shape.lineTo(d, first[1])
  }
  shape.lineTo(first[0], first[1])
  for (const [x, y] of right) shape.lineTo(x, y)
  for (let i = right.length - 1; i >= 0; i--) shape.lineTo(-right[i]![0], right[i]![1])
  shape.closePath()
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat)
  m.position.z = -fwd
  return m
}

/**
 * Sculpted window bay: a sidewall panel over the window band (fwd span
 * [fa, fb], fa > fb) with a rounded opening centred at `fc`, mapped onto
 * the barrel so its top and bottom edges meet the plain wall exactly.
 */
function windowBay(side: number, fa: number, fb: number, fc: number, mat: THREE.Material): THREE.Mesh {
  const C = CABIN, R = C.radius
  const tB = thetaAt(C.windowBottom), tT = thetaAt(C.windowTop)
  const sC = R * (tB + tT) / 2, halfS = R * (tT - tB) / 2
  const shape = new THREE.Shape()
  // Local (x = fwd − fc, y = arc length − sC); traced so the hole is inside.
  shape.moveTo(fb - fc, -halfS)
  shape.lineTo(fa - fc, -halfS)
  shape.lineTo(fa - fc, halfS)
  shape.lineTo(fb - fc, halfS)
  shape.closePath()
  const hole = new THREE.Path()
  roundedRect(hole, 0, 0, C.openingW, C.openingH, C.openingR)
  shape.holes.push(hole)
  const geo = new THREE.ShapeGeometry(shape, 8)
  const p = geo.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const w = wallPoint(side, fc + p.getX(i), (sC + p.getY(i)) / R)
    p.setXYZ(i, w.x, w.y, w.z)
  }
  geo.computeVertexNormals()
  return new THREE.Mesh(geo, mat)
}

/** Window reveal: the opening's outline swept outward through the wall. */
function windowReveal(side: number, fc: number, mat: THREE.Material): THREE.Mesh {
  const C = CABIN, R = C.radius
  const sC = R * (thetaAt(C.windowBottom) + thetaAt(C.windowTop)) / 2
  const path = new THREE.Path()
  roundedRect(path, 0, 0, C.openingW, C.openingH, C.openingR)
  const pts = path.getSpacedPoints(48)
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  pts.forEach((pt, i) => {
    const t = (sC + pt.y) / R
    pos.push(...wallPoint(side, fc + pt.x, t).toArray(), ...wallPoint(side, fc + pt.x, t, C.revealDepth).toArray())
    uv.push(i / pts.length, 0, i / pts.length, 1)
  })
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return new THREE.Mesh(g, mat)
}

/** Window shade pulled down `frac` of the opening, inside the reveal. */
function windowShade(side: number, fc: number, frac: number, mat: THREE.Material): THREE.Mesh {
  const C = CABIN, R = C.radius
  const sC = R * (thetaAt(C.windowBottom) + thetaAt(C.windowTop)) / 2
  // Never shorter than the corner radius, or the outline folds over itself.
  const w = C.openingW - 0.01, h = Math.max(C.openingH * frac, C.openingR + 0.012), top = C.openingH / 2
  const shape = new THREE.Shape()
  shape.moveTo(-w / 2, top - h)
  shape.lineTo(w / 2, top - h)
  shape.lineTo(w / 2, top - C.openingR)
  shape.quadraticCurveTo(w / 2, top, w / 2 - C.openingR, top)
  shape.lineTo(-w / 2 + C.openingR, top)
  shape.quadraticCurveTo(-w / 2, top, -w / 2, top - C.openingR)
  shape.closePath()
  const geo = new THREE.ShapeGeometry(shape, 6)
  const p = geo.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const q = wallPoint(side, fc + p.getX(i), (sC + p.getY(i)) / R, C.revealDepth * 0.55)
    p.setXYZ(i, q.x, q.y, q.z)
  }
  geo.computeVertexNormals()
  return new THREE.Mesh(geo, mat)
}

/** Economy seat parts: origin on the floor at the pan centre, facing −z. */
function seatParts(): Record<'fabric' | 'shell' | 'tray' | 'pocket' | 'head', THREE.BufferGeometry> {
  const lean = 0.14
  const part = (w: number, h: number, d: number, r: number, x: number, y: number, z: number, rotX = 0): THREE.BufferGeometry => {
    const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2) * 0.999)
    g.rotateX(rotX)
    g.translate(x, y, z)
    return g
  }
  const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => mergeGeometries(parts.map(g => (g.index ? g.toNonIndexed() : g)))!
  const tube = (len: number, r: number, x: number, y: number, z: number): THREE.BufferGeometry => {
    const g = new THREE.CylinderGeometry(r, r, len, 10)
    g.rotateZ(Math.PI / 2)
    g.translate(x, y, z)
    return g.toNonIndexed()
  }
  return {
    fabric: merge([
      part(0.45, 0.12, 0.48, 0.045, 0, 0.4, 0),               // seat pan cushion
      part(0.43, 0.6, 0.1, 0.045, 0, 0.8, 0.215, lean),       // backrest cushion
    ]),
    shell: merge([
      part(0.45, 0.68, 0.05, 0.022, 0, 0.79, 0.275, lean),    // backrest shell
      part(0.05, 0.05, 0.38, 0.018, -0.245, 0.64, -0.01),     // armrests
      part(0.05, 0.05, 0.38, 0.018, 0.245, 0.64, -0.01),
      part(0.03, 0.2, 0.05, 0.012, -0.245, 0.53, 0.12),       // armrest posts
      part(0.03, 0.2, 0.05, 0.012, 0.245, 0.53, 0.12),
      part(0.04, 0.36, 0.05, 0.015, -0.17, 0.19, 0.1),        // legs
      part(0.04, 0.36, 0.05, 0.015, 0.17, 0.19, 0.1),
      part(0.42, 0.04, 0.42, 0.012, 0, 0.33, 0.0),            // pan frame
      tube(0.42, 0.016, 0, 0.3, -0.2),                        // front spreader tube
      tube(0.42, 0.012, 0, 0.06, 0.1),                        // baggage bar
    ]),
    tray: merge([part(0.36, 0.26, 0.014, 0.012, 0, 0.88, 0.304, lean)]),
    pocket: merge([part(0.36, 0.16, 0.016, 0.01, 0, 0.6, 0.288, lean)]),
    head: merge([part(0.3, 0.19, 0.1, 0.04, 0, 1.07, 0.25, lean)]),
  }
}

/** Merge a group's plain meshes per material: one draw per material. */
function mergeByMaterial(group: THREE.Group): void {
  const buckets = new Map<THREE.Material, THREE.Mesh[]>()
  for (const o of group.children) {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || Array.isArray(o.material)) continue
    const list = buckets.get(o.material) ?? []
    list.push(o)
    buckets.set(o.material, list)
  }
  for (const [mat, meshes] of buckets) {
    if (meshes.length < 2) continue
    const geos = meshes.map((m) => {
      m.updateMatrix()
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix)
      g.clearGroups()
      return g
    })
    const merged = mergeGeometries(geos)
    if (!merged) continue
    for (const m of meshes) { group.remove(m); m.geometry.dispose() }
    for (const g of geos) g.dispose()
    const mesh = new THREE.Mesh(merged, mat)
    mesh.name = `cabin:${mat.name || mat.uuid.slice(0, 8)}`
    group.add(mesh)
  }
}

// ---------------------------------------------------------------------------
// The cabin
// ---------------------------------------------------------------------------

export function buildCabin737(): Cabin737 {
  const C = CABIN
  const group = new THREE.Group()
  group.name = 'cabin737'
  const materials: THREE.MeshStandardMaterial[] = []
  const mat = (name: string, color: number, roughness: number, fill = 0.4, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, ...extra })
    m.name = name
    registerInteriorFill(m, fill)
    materials.push(m)
    return m
  }
  const lining = mat('lining', 0xe2e0d8, 0.82, 0.44, { side: THREE.DoubleSide })
  const reveal = mat('reveal', 0xeeede8, 0.6, 0.48, { side: THREE.DoubleSide })
  const shadeM = mat('shade', 0xf3f2ee, 0.9, 0.5, { side: THREE.DoubleSide })
  const dado = mat('dado', 0x8e9097, 0.85, 0.35, { side: THREE.DoubleSide })
  const ceilingM = mat('ceiling', 0xeceae4, 0.9, 0.52, { side: THREE.DoubleSide })
  const bin = mat('bin', 0xe8e6df, 0.55, 0.44)
  const trim = mat('trim', 0x9a9ea5, 0.45, 0.32, { metalness: 0.3 })
  const dark = mat('dark', 0x4a4f58, 0.7, 0.36)
  const galley = mat('galley', 0xb4bac2, 0.32, 0.3, { metalness: 0.6 })
  const counter = mat('counter', 0xdadde1, 0.35, 0.32)
  const ovenGlass = mat('ovenGlass', 0x22262c, 0.15, 0.25, { metalness: 0.2 })
  const latch = mat('latch', 0xb22a22, 0.5, 0.35)
  const curtain = mat('curtain', 0x2a3a5c, 1, 0.38, { side: THREE.DoubleSide })
  const carpetMap = carpetTexture()
  // A textured material's emissive daylight fill must follow the pattern,
  // or it washes the colour out: emissiveMap = map.
  const carpet = mat('carpet', carpetMap ? 0xffffff : 0x353c4c, 1, 0.3, carpetMap ? { map: carpetMap, emissiveMap: carpetMap } : {})
  const runner = mat('runner', 0x5e6a88, 1, 0.3)
  const fabricMap = fabricTexture()
  const fabricM = mat('seatFabric', 0x34548a, 0.95, 0.42, fabricMap ? { map: fabricMap, emissiveMap: fabricMap } : {})
  const shellM = mat('seatShell', 0x6d7482, 0.55, 0.4)
  const trayM = mat('seatTray', 0x9aa1ad, 0.45, 0.42)
  const pocketM = mat('seatPocket', 0x404a5c, 0.95, 0.4)
  const headM = mat('headrest', 0xe6e9ee, 0.95, 0.42)
  const lightM = new THREE.MeshBasicMaterial({ color: 0xfff3dd })
  const ledM = new THREE.MeshBasicMaterial({ color: 0xd2e6ff })
  const exitM = new THREE.MeshBasicMaterial({ color: 0x3dff7a })
  const readingM = new THREE.MeshBasicMaterial({ color: 0xffe6b8 })
  const washM = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })

  const front = C.frontFwd, aft = C.aftFwd
  const length = front - aft
  const put = (o: THREE.Object3D): void => { group.add(o) }
  const tFloor = thetaAt(C.floor), tB = thetaAt(C.windowBottom), tT = thetaAt(C.windowTop), tCeil = thetaAt(C.ceiling)
  const tDado = thetaAt(C.floor + 0.17)

  // ---- floor ---------------------------------------------------------------
  {
    const half = cabinWallLat(C.floor)
    const f = patch((u, v) => b(front + 0.12 - u * (length + 0.12), (v * 2 - 1) * half, C.floor), 1, 1, carpet)
    const uv = f.geometry.getAttribute('uv') as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (length / 0.45), uv.getY(i) * (2 * half / 0.45))
    put(f)
    put(patch((u, v) => b(front - 2.3 - u * (length - 2.3), (v * 2 - 1) * 0.2, C.floor + 0.004), 1, 1, runner))
    // Seat tracks under the inboard legs of the aisle and window seats.
    const trackFwd = C.firstRowFwd + 0.4, trackLen = trackFwd - aft
    for (const lat of [-1.26, -0.32, 0.32, 1.26]) put(box(0.03, 0.008, trackLen, trim, b(trackFwd - trackLen / 2, lat, C.floor + 0.004)))
  }

  // ---- sidewalls: dado, lower wall, sculpted window bays, upper wall ---------
  const windows = cabinWindows()
  const shadeFrac = (i: number): number => {
    const h = Math.abs(Math.sin(i * 127.1 + 3.7) * 43758.5453) % 1
    return h < 0.62 ? 0 : 0.2 + (h - 0.62) * 1.4
  }
  for (const side of [-1, 1] as const) {
    const wall = (fa: number, fb: number, t0: number, t1: number, rows: number, m: THREE.Material): void => {
      put(patch((u, v) => wallPoint(side, fa + (fb - fa) * u, t0 + (t1 - t0) * v), 1, rows, m))
    }
    wall(front, aft, tFloor, tDado, 2, dado)
    wall(front, aft, tDado, tB, 6, lining)
    wall(front, aft, tT, tCeil, 8, lining)
    // Air-return grilles in the dado, one per window bay.
    for (let f = front - 0.7; f > aft + 0.4; f -= C.windowPitch) {
      if (f > C.doorFwd[1] && f < C.doorFwd[0] + 0.3) continue
      put(patch((u, v) => wallPoint(side, f - u * 0.3, tFloor + (tDado - tFloor) * (0.35 + 0.3 * v), -0.004), 1, 1, dark))
    }
    // Window band: a sculpted bay per window, plain wall between bays.
    const sorted = windows.slice().sort((p, q) => q - p)
    let cursor: number = front
    sorted.forEach((f0, i) => {
      const fc = f0 - C.windowW / 2
      const fa = Math.min(cursor, fc + C.windowPitch / 2), fb = Math.max(fc - C.windowPitch / 2, aft)
      if (cursor - fa > 1e-4) wall(cursor, fa, tB, tT, 4, lining)
      put(windowBay(side, fa, fb, fc, lining))
      put(windowReveal(side, fc, reveal))
      const k = shadeFrac(i * 2 + (side > 0 ? 1 : 0))
      if (k > 0) put(windowShade(side, fc, Math.min(k, 0.9), shadeM))
      cursor = fb
    })
    if (cursor - aft > 1e-4) wall(cursor, aft, tB, tT, 4, lining)
  }

  // ---- ceiling: flat over the entry zone, arched over the cabin ---------------
  const binInner = 0.84
  const arch = (lat: number): number => C.ceiling + 0.06 * (1 - (lat / binInner) ** 2)
  put(patch((u, v) => b(front + u * (C.binsFwd - front), (v * 2 - 1) * cabinWallLat(C.ceiling), C.ceiling), 1, 1, ceilingM))
  put(patch((u, v) => { const lat = (v * 2 - 1) * binInner; return b(C.binsFwd + u * (aft - C.binsFwd), lat, arch(lat)) }, 1, 16, ceilingM))
  // Lighting cove closing the step where the arch begins.
  put(patch((u, v) => { const lat = (u * 2 - 1) * binInner; return b(C.binsFwd, lat, C.ceiling + (arch(lat) - C.ceiling) * v) }, 16, 1, ceilingM))
  // Centre light diffuser and the Sky Interior blue LED wash along both coves.
  put(box(0.12, 0.01, C.binsFwd - aft - 0.3, lightM, b((C.binsFwd + aft) / 2, 0, arch(0) - 0.006)))
  for (const side of [-1, 1] as const) {
    put(patch((u, v) => {
      const lat = side * (binInner - 0.34 * v)
      return b(C.binsFwd - 0.05 + u * (aft - C.binsFwd + 0.1), lat, arch(lat) - 0.004)
    }, 1, 6, washM, (_u, v) => { const k = (1 - v) ** 1.6; return [0.07 * k, 0.15 * k, 0.32 * k] }))
    put(box(0.02, 0.012, C.binsFwd - aft - 0.1, ledM, b((C.binsFwd + aft) / 2, side * (binInner - 0.005), C.ceiling + 0.004)))
  }

  // ---- overhead bins: curved pivot-bin doors, LED lip, latches -----------------
  // Bin doors every two rows (~1.58 m), separated by narrow seams.
  const binFwd: Array<[number, number]> = []
  for (let f = C.binsFwd; f - 0.5 > aft; f -= 1.6) binFwd.push([f, Math.max(f - 1.58, aft)])
  for (const side of [-1, 1] as const) {
    for (const [fa, fb] of binFwd) {
      const len = fa - fb
      const shape = new THREE.Shape()
      const S = (x: number): number => side * x
      shape.moveTo(S(binInner), C.ceiling)
      shape.quadraticCurveTo(S(0.72), 1.64, S(0.9), 1.38)        // door face, bulging to the aisle
      shape.lineTo(S(0.99), 1.335)                               // lip
      shape.quadraticCurveTo(S(1.3), 1.27, S(cabinWallLat(1.25) - 0.012), 1.25) // underside
      for (let y = 1.3; y < C.ceiling; y += 0.1) shape.lineTo(S(cabinWallLat(y) - 0.012), y) // back follows the wall
      shape.lineTo(S(cabinWallLat(C.ceiling) - 0.012), C.ceiling)
      shape.closePath()
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 10 }), bin)
      m.position.z = -fa
      put(m)
      // Recessed latch near the lower door edge; LED strip along the lip.
      put(rbox(0.035, 0.03, Math.min(0.5, len * 0.35), 0.012, trim, b(fa - len / 2, side * 0.838, 1.46)))
      put(box(0.03, 0.008, len - 0.04, ledM, b(fa - len / 2, side * 0.955, 1.345)))
    }
  }

  // ---- seats + passenger service units -------------------------------------------
  const parts = seatParts()
  const seatCount = C.rows * C.seatLats.length
  const seatMeshes = [
    new THREE.InstancedMesh(parts.fabric, fabricM, seatCount),
    new THREE.InstancedMesh(parts.shell, shellM, seatCount),
    new THREE.InstancedMesh(parts.tray, trayM, seatCount),
    new THREE.InstancedMesh(parts.pocket, pocketM, seatCount),
    new THREE.InstancedMesh(parts.head, headM, seatCount),
  ]
  const psu = new THREE.InstancedMesh(new RoundedBoxGeometry(0.16, 0.03, 0.4, 2, 0.01), bin, C.rows * 2)
  const reading = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.018, 0.018, 0.006, 12), readingM, C.rows * 6)
  const m4 = new THREE.Matrix4()
  let n = 0, nPsu = 0, nRead = 0
  for (let r = 0; r < C.rows; r++) {
    const fwd = C.firstRowFwd - r * C.rowPitch
    for (const lat of C.seatLats) {
      m4.makeTranslation(lat, C.floor, -fwd)
      for (const im of seatMeshes) im.setMatrixAt(n, m4)
      n++
    }
    for (const side of [-1, 1]) {
      // PSU tucked under the bin lip, reading lights over each seat.
      m4.makeTranslation(side * 1.08, 1.3, -(fwd + 0.12))
      psu.setMatrixAt(nPsu++, m4)
      for (let k = 0; k < 3; k++) {
        const on = ((r * 7 + k * 3 + (side > 0 ? 1 : 0)) % 5) === 0
        m4.makeScale(1, 1, 1).setPosition(side * (1.0 + 0.08 * k), 1.282, -(fwd + 0.05))
        if (!on) m4.scale(new THREE.Vector3(0.001, 0.001, 0.001))
        reading.setMatrixAt(nRead++, m4)
      }
    }
  }
  for (const im of [...seatMeshes, psu, reading]) { im.instanceMatrix.needsUpdate = true; group.add(im) }

  // ---- forward bulkhead (cockpit door), galley, closet, entry doors ---------------
  put(bulkhead(front, true, lining))
  const d = C.doorwayHalfWidth
  put(box(0.05, C.doorwayTop - C.floor, 0.08, trim, b(front - 0.02, -d - 0.025, (C.doorwayTop + C.floor) / 2)))
  put(box(0.05, C.doorwayTop - C.floor, 0.08, trim, b(front - 0.02, d + 0.025, (C.doorwayTop + C.floor) / 2)))
  put(box(2 * d + 0.1, 0.05, 0.08, trim, b(front - 0.02, 0, C.doorwayTop + 0.025)))
  // Flight-deck door, swung open against the aisle, with handle and viewer.
  put(rbox(0.045, C.doorwayTop - C.floor - 0.03, 0.62, 0.01, lining, b(front - 0.36, -d + 0.02, (C.doorwayTop + C.floor) / 2 + 0.01)))
  put(rbox(0.07, 0.035, 0.12, 0.01, trim, b(front - 0.47, -d + 0.05, 0.55)))
  // Starboard galley: two cart bays, oven stack, counter, upper stowage.
  {
    const gFwdA = front - 0.05, gFwdB = front - 1.05 // stops short of the R1 door
    const lat0 = 0.42, lat1 = 1.45
    const cx = (lat0 + lat1) / 2, cz = (gFwdA + gFwdB) / 2, lz = gFwdA - gFwdB
    const faceZ = gFwdB // the galley faces aft, into the cabin
    put(box(lat1 - lat0, 0.98 - C.floor, lz, galley, b(cz, cx, (0.98 + C.floor) / 2)))
    put(rbox(lat1 - lat0 + 0.03, 0.035, lz + 0.03, 0.01, counter, b(cz, cx, 1.0)))
    const upLat = cabinWallLat(1.89) - 0.03
    put(box(upLat - lat0, 0.54, lz * 0.62, galley, b(gFwdA - lz * 0.31, (lat0 + upLat) / 2, 1.62)))
    // Cart fronts with handles and red latches.
    for (const [a0, a1] of [[lat0 + 0.02, lat0 + 0.34], [lat0 + 0.36, lat0 + 0.68]] as const) {
      put(box(a1 - a0, 0.95, 0.012, trim, b(faceZ - 0.006, (a0 + a1) / 2, 0.24)))
      put(rbox(a1 - a0 - 0.1, 0.03, 0.03, 0.01, dark, b(faceZ - 0.02, (a0 + a1) / 2, 0.62)))
      put(box(0.04, 0.03, 0.02, latch, b(faceZ - 0.018, (a0 + a1) / 2, 0.75)))
    }
    // Oven stack in the upper unit (dark glass doors).
    for (let i = 0; i < 2; i++) put(box(0.26, 0.18, 0.012, ovenGlass, b(gFwdA - lz * 0.62 - 0.006, lat0 + 0.18 + i * 0.3, 1.6)))
    // Coffee maker + water boiler on the counter.
    put(rbox(0.22, 0.28, 0.22, 0.03, galley, b(cz, lat0 + 0.2, 1.16)))
    put(rbox(0.2, 0.22, 0.2, 0.03, trim, b(cz, lat0 + 0.55, 1.13)))
  }
  // Port coat closet with a full-height door seam and handle.
  {
    const gFwdA = front - 0.05, gFwdB = front - 1.0
    const closetH = 1.88
    put(box(0.98, closetH, gFwdA - gFwdB, lining, b((gFwdA + gFwdB) / 2, -0.9, C.floor + closetH / 2)))
    put(box(0.012, 1.7, 0.012, dark, b(gFwdB + 0.005, -0.9, 0.62)))
    put(rbox(0.03, 0.22, 0.03, 0.012, trim, b(gFwdB - 0.01, -0.5, 0.7)))
  }
  // Entry doors L1 / R1: recessed leaf, frame, handle, door-mode panel, exit sign.
  for (const side of [-1, 1] as const) {
    const mid = (C.doorFwd[0] + C.doorFwd[1]) / 2, w = C.doorFwd[0] - C.doorFwd[1]
    const lat = side * 1.46
    put(rbox(0.06, 1.8, w, 0.03, lining, b(mid, lat, 0.62)))
    put(box(0.08, 0.05, w + 0.1, trim, b(mid, lat, 1.55)))
    put(box(0.08, 1.8, 0.05, trim, b(C.doorFwd[0] + 0.025, lat, 0.62)))
    put(box(0.08, 1.8, 0.05, trim, b(C.doorFwd[1] - 0.025, lat, 0.62)))
    put(rbox(0.06, 0.04, 0.36, 0.015, dark, b(mid, lat - side * 0.03, 0.56)))
    put(rbox(0.05, 0.2, 0.34, 0.02, trim, b(mid, lat - side * 0.03, 0.22)))
    put(box(0.06, 0.09, 0.3, exitM, b(mid, side * 1.35, 1.7)))
  }

  // ---- over-wing exits: hatch outline around the window bay, EXIT signs -------------
  {
    const exitRed = mat('exitHatch', 0xb2342a, 0.5, 0.35)
    const tB = thetaAt(C.windowBottom - 0.18), tT = thetaAt(C.windowTop + 0.2)
    for (const ef of C.overwingExitFwd) {
      // The window bay closest to the exit station.
      const fc = windows.map((f0) => f0 - C.windowW / 2).reduce((best, x) => (Math.abs(x - ef) < Math.abs(best - ef) ? x : best), Infinity)
      if (!Number.isFinite(fc)) continue
      for (const side of [-1, 1] as const) {
        const hw = 0.3
        // Thin red outline of the hatch on the wall, just proud of it.
        const strip = (fa: number, fb: number, t0: number, t1: number): void => {
          put(patch((u, v) => wallPoint(side, fa + (fb - fa) * u, t0 + (t1 - t0) * v, -0.006), 1, 3, exitRed))
        }
        strip(fc + hw, fc - hw, tB, tB + 0.012)
        strip(fc + hw, fc - hw, tT - 0.012, tT)
        strip(fc + hw, fc + hw - 0.022, tB, tT)
        strip(fc - hw + 0.022, fc - hw, tB, tT)
        // EXIT sign under the bin edge, facing the aisle.
        put(box(0.06, 0.09, 0.3, exitM, b(fc, side * 0.86, 1.33)))
      }
    }
  }

  // ---- aft bulkhead: lav doors, curtain, exit sign ------------------------------------
  put(bulkhead(aft, false, lining))
  for (const side of [-1, 1] as const) {
    put(rbox(0.62, 1.75, 0.04, 0.02, lining, b(aft + 0.03, side * 1.02, 0.62)))
    put(rbox(0.04, 0.12, 0.04, 0.012, trim, b(aft + 0.06, side * 0.78, 0.7)))
    put(box(0.2, 0.08, 0.02, exitM, b(aft + 0.055, side * 1.02, 1.32)))
  }
  put(patch((u, v) => b(aft + 0.12 + 0.03 * Math.sin(u * Math.PI * 9), (u * 2 - 1) * 0.38, C.floor + 0.05 + v * 2.1), 27, 2, curtain))
  put(box(0.8, 0.03, 0.03, trim, b(aft + 0.12, 0, 1.91)))
  put(box(0.3, 0.09, 0.06, exitM, b(aft + 0.05, 0, 1.83)))

  mergeByMaterial(group)
  group.userData.seats = seatCount
  return { group, seats: seatCount, windows: windows.length * 2, materials }
}
