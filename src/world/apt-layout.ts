import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { disposeAirportObject, ownMaterial, type GroundPoint, type SurfaceObstacle } from './airport-scenery'
import { osmIdentSegs } from './osm-layout'

/**
 * X-Plane's real airport layouts: the pavement polygons (taxiways, aprons,
 * holes and all), the painted lines on and around them, and the taxi network,
 * exactly as authored in the Global Airports `apt.dat` (served by
 * /api/apt/<ICAO>.json from the user's own install). Replaces the stand-in
 * taxiway complex and the OpenStreetMap ribbons wherever X-Plane has the
 * airport. Airport-local frame like the rest of the airport: x = east metres
 * from the airport reference, z = −north, y up from the field elevation.
 *
 * Height ladder (20 mm steps, no coplanar pairs): turf < dirt/gravel <
 * asphalt < concrete < runway strip (+0.06, drawn by airports.ts) <
 * painted-line borders < painted lines.
 */

export interface AptLine { t: number; p: [number, number][]; edge?: boolean }
export interface AptPavement { surf: number; name: string; rings: [number, number][][] }
export interface AptTaxiNode { id: number; lat: number; lon: number; use: string; name: string }
export interface AptTaxiEdge { a: number; b: number; oneway: boolean; kind: string; name: string }
export interface AptRamp { lat: number; lon: number; hdg: number; kind: string; cats: string[]; name: string }
export interface AptLayout {
  icao: string
  name: string
  elevFt: number
  pav: AptPavement[]
  lines: AptLine[]
  ramps: AptRamp[]
  taxi: { nodes: AptTaxiNode[]; edges: AptTaxiEdge[] }
}

const isLatLon = (p: unknown): p is [number, number] =>
  Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0] as number) <= 90 && Math.abs(p[1] as number) <= 180

/** Validate untrusted JSON: drop malformed features as units, never join across a missing point. */
export function normalizeApt(raw: unknown): AptLayout | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  const pts = (v: unknown, min: number): [number, number][] | null => (Array.isArray(v) && v.length >= min && v.length <= 20_000 && v.every(isLatLon) ? (v as [number, number][]) : null)
  const pav: AptPavement[] = []
  for (const p of arr(d.pav).slice(0, 4000)) {
    const o = p as Record<string, unknown>
    const rings = arr(o?.rings).slice(0, 64).map((r) => pts(r, 3)).filter((r): r is [number, number][] => r !== null)
    if (rings.length) pav.push({ surf: Number(o.surf) || 0, name: typeof o.name === 'string' ? o.name.slice(0, 40) : '', rings })
  }
  const lines: AptLine[] = []
  for (const l of arr(d.lines).slice(0, 20_000)) {
    const o = l as Record<string, unknown>
    const p = pts(o?.p, 2)
    if (p && Number.isFinite(o.t)) lines.push({ t: Number(o.t), p, ...(o.edge ? { edge: true } : {}) })
  }
  const ramps: AptRamp[] = arr(d.ramps).slice(0, 2000).flatMap((r) => {
    const o = r as Record<string, unknown>
    return Number.isFinite(o?.lat) && Number.isFinite(o?.lon) ? [{ lat: Number(o.lat), lon: Number(o.lon), hdg: Number(o.hdg) || 0, kind: String(o.kind ?? ''), cats: Array.isArray(o.cats) ? o.cats.map(String) : [], name: String(o.name ?? '').slice(0, 40) }] : []
  })
  const tx = (d.taxi ?? {}) as Record<string, unknown>
  const nodes: AptTaxiNode[] = arr(tx.nodes).slice(0, 8000).flatMap((n) => {
    const o = n as Record<string, unknown>
    return Number.isFinite(o?.id) && Number.isFinite(o?.lat) && Number.isFinite(o?.lon) ? [{ id: Number(o.id), lat: Number(o.lat), lon: Number(o.lon), use: String(o.use ?? ''), name: String(o.name ?? '') }] : []
  })
  const edges: AptTaxiEdge[] = arr(tx.edges).slice(0, 16_000).flatMap((e) => {
    const o = e as Record<string, unknown>
    return Number.isFinite(o?.a) && Number.isFinite(o?.b) ? [{ a: Number(o.a), b: Number(o.b), oneway: !!o.oneway, kind: String(o.kind ?? ''), name: String(o.name ?? '').slice(0, 12) }] : []
  })
  if (!pav.length && !lines.length) return null
  return { icao: String(d.icao ?? ''), name: String(d.name ?? ''), elevFt: Number(d.elevFt) || 0, pav, lines, ramps, taxi: { nodes, edges } }
}

// ------------------------------------------------------------- surfaces --

/** apt.dat surface codes → paint. 15 (transparent) and 13/14 (water, snow) draw nothing. */
export function surfaceStyle(surf: number): { color: number; lift: number; roughness: number } | null {
  switch (surf) {
    case 1: return { color: 0x6a6d70, lift: 0.030, roughness: 0.95 }  // asphalt
    case 2: return { color: 0xb2b3ae, lift: 0.034, roughness: 0.9 }   // concrete
    case 3: return { color: 0x3c5233, lift: 0.010, roughness: 1 }     // turf
    case 4: return { color: 0x6a5a46, lift: 0.014, roughness: 1 }     // dirt
    case 5: return { color: 0x7a7367, lift: 0.018, roughness: 1 }     // gravel
    case 12: return { color: 0x8a7e66, lift: 0.014, roughness: 1 }    // dry lakebed
    case 13: case 14: case 15: return null
    default:
      // X-Plane 12's weathered variants: 20–29 are asphalt, 30–38 concrete.
      if (surf >= 30 && surf <= 38) return { color: 0xb2b3ae, lift: 0.036, roughness: 0.9 }
      return { color: 0x6a6d70, lift: 0.031, roughness: 0.95 }
  }
}

// ----------------------------------------------------------- painted lines --

export type PaintColor = 'yellow' | 'white' | 'red' | 'orange' | 'blue' | 'green'
export interface LineStyle {
  color: PaintColor
  /** Width of each painted stripe, metres. */
  width: number
  /** Lateral offsets of the stripes from the line, metres (one entry = a single line). */
  lanes: number[]
  /** [paint, gap] metres for a broken line; applies to `dashedLanes` (or every lane when omitted). */
  dash?: [number, number]
  dashedLanes?: number[]
  /** A black border under the paint (the "_b" variants). */
  border: boolean
}

/** The paint pattern for an apt.dat line-type code, or null for codes this renderer does not paint (lights 100+). */
export function lineStyle(code: number): LineStyle | null {
  let base = code
  let border = false
  if (code >= 51 && code <= 64) { base = code - 50; border = true }
  else if (code >= 70 && code <= 75) { base = code - 50; border = true }
  else if (code >= 80 && code <= 82) { base = code - 50; border = true }
  else if (code >= 90 && code <= 92) { base = code - 50; border = true }
  const mk = (color: PaintColor, width: number, lanes: number[], dash?: [number, number], dashedLanes?: number[]): LineStyle =>
    ({ color, width, lanes, ...(dash ? { dash } : {}), ...(dashedLanes ? { dashedLanes } : {}), border })
  switch (base) {
    case 1: return mk('yellow', 0.2, [0])
    case 2: return mk('yellow', 0.2, [0], [3, 3])
    case 3: return mk('yellow', 0.15, [-0.2, 0.2])
    case 4: case 7: return mk('yellow', 0.15, [-0.45, -0.15, 0.15, 0.45], [0.9, 0.9], [0.15, 0.45])      // runway holding position: two solid, two broken
    case 5: return mk('yellow', 0.15, [-0.15, 0.15], [0.9, 0.9], [0.15])
    case 6: return mk('yellow', 0.15, [-0.5, 0.5, 0], [0.15, 0.6], [0])                                  // ILS holding position: ladder
    case 8: return mk('yellow', 0.12, [0])
    case 9: return mk('yellow', 0.12, [-0.12, 0.12])
    case 10: return mk('yellow', 0.3, [0])
    case 11: return mk('yellow', 0.2, [-0.6, -0.2, 0.2, 0.6], [1.2, 1.2], [0.2, 0.6])
    case 12: return mk('yellow', 0.2, [-0.6, -0.2, 0.2, 0.6], [1.2, 1.2], [0.2, 0.6])
    case 13: return mk('yellow', 0.2, [-0.2, 0.2], [1.2, 1.2], [0.2])
    case 14: return mk('yellow', 0.2, [-0.7, 0.7, 0], [0.2, 0.8], [0])
    case 19: return mk('yellow', 0.8, [0], [0.4, 0.4])
    case 20: case 24: return mk('white', base === 24 ? 0.3 : 0.2, [0])
    case 21: case 22: case 23: case 25: return mk('white', base === 25 ? 0.3 : 0.2, [0], base === 21 ? [0.9, 0.9] : [3, 3])
    case 30: case 32: return mk('red', base === 32 ? 0.3 : 0.2, [0])
    case 31: return mk('red', 0.2, [0], [3, 3])
    case 40: return mk('orange', 0.3, [0])
    case 41: return mk('blue', 0.3, [0])
    case 42: return mk('green', 0.3, [0])
    default: return null
  }
}

const PAINT: Record<PaintColor, number> = { yellow: 0xd6b311, white: 0xe6e6de, red: 0xb02a22, orange: 0xd9741a, blue: 0x2457a8, green: 0x2f8a46 }

export interface XZ { x: number; z: number }

/** Split a polyline into `on`-long paint runs separated by `off`-long gaps (arc length). Pure. */
export function dashRuns(pts: readonly XZ[], on: number, off: number): XZ[][] {
  const runs: XZ[][] = []
  let cur: XZ[] = []
  let painting = true
  let left = on
  const push = (p: XZ): void => { if (painting) cur.push(p) }
  if (pts.length) push(pts[0]!)
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1]!
    const b = pts[i]!
    let seg = Math.hypot(b.x - a.x, b.z - a.z)
    while (seg > left) {
      const t = left / seg
      const m = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
      if (painting) { cur.push(m); runs.push(cur); cur = [] } else cur = [m]
      painting = !painting
      seg -= left; a = m
      left = painting ? on : off
    }
    left -= seg
    push(b)
  }
  if (painting && cur.length > 1) runs.push(cur)
  return runs.filter((r) => r.length > 1)
}

/** Laterally offset a polyline by `d` metres (positive = to the right of travel). Pure. */
export function offsetLine(pts: readonly XZ[], d: number): XZ[] {
  if (d === 0 || pts.length < 2) return pts.map((p) => ({ ...p }))
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!
    const dx = b.x - a.x, dz = b.z - a.z
    const len = Math.hypot(dx, dz) || 1
    return { x: p.x + (-dz / len) * d, z: p.z + (dx / len) * d }
  })
}

// ---------------------------------------------------------- taxi network --

/** Where each named taxiway lies (midpoints of its taxi-network edges), for ground control's route naming. Pure. */
export function taxiIdentSegments(layout: AptLayout, toLocal: (lat: number, lon: number) => XZ): { ref: string; x: number; z: number }[] {
  const byId = new Map(layout.taxi.nodes.map((n) => [n.id, n]))
  const out: { ref: string; x: number; z: number }[] = []
  for (const e of layout.taxi.edges) {
    if (!e.name || !/^taxiway/.test(e.kind)) continue
    const a = byId.get(e.a), b = byId.get(e.b)
    if (!a || !b) continue
    const p = toLocal((a.lat + b.lat) / 2, (a.lon + b.lon) / 2)
    out.push({ ref: e.name, x: p.x, z: p.z })
  }
  return out
}

// ----------------------------------------------------------------- build --

interface Ribbons { pos: number[]; idx: number[] }
const ribbon = (): Ribbons => ({ pos: [], idx: [] })

function addRibbon(r: Ribbons, pts: readonly XZ[], width: number, y: number): void {
  const hw = width / 2
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!
    const dx = b.x - a.x, dz = b.z - a.z
    const len = Math.hypot(dx, dz)
    if (len < 1e-6) continue
    const nx = (-dz / len) * hw, nz = (dx / len) * hw
    const base = r.pos.length / 3
    r.pos.push(a.x + nx, y, a.z + nz, a.x - nx, y, a.z - nz, b.x + nx, y, b.z + nz, b.x - nx, y, b.z - nz)
    r.idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3)
  }
}

function toMesh(r: Ribbons, mat: THREE.Material, name: string): THREE.Mesh | null {
  if (!r.pos.length) return null
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(r.pos, 3))
  geo.setIndex(r.idx)
  geo.computeVertexNormals()
  const m = new THREE.Mesh(geo, mat)
  m.name = name
  m.receiveShadow = true
  return m
}

const paintMaterials = new Map<string, THREE.MeshStandardMaterial>()
function paintMaterial(key: string, color: number): THREE.MeshStandardMaterial {
  let m = paintMaterials.get(key)
  if (!m) { m = ownMaterial(new THREE.MeshStandardMaterial({ color, roughness: 0.85, envMapIntensity: 0.2 })); paintMaterials.set(key, m) }
  return m
}
const pavementMaterials = new Map<number, THREE.MeshStandardMaterial>()
function pavementMaterial(surf: number): THREE.MeshStandardMaterial | null {
  const s = surfaceStyle(surf)
  if (!s) return null
  let m = pavementMaterials.get(surf)
  if (!m) { m = ownMaterial(new THREE.MeshStandardMaterial({ color: s.color, roughness: s.roughness, envMapIntensity: 0.25, side: THREE.DoubleSide })); pavementMaterials.set(surf, m) }
  return m
}

/** Pavement + painted lines as one group in the airport-local frame. */
export function buildAptMeshes(layout: AptLayout, toLocal: (lat: number, lon: number) => XZ, elevM: number): THREE.Group {
  const group = new THREE.Group()
  group.name = 'aptLayout'
  // ---- pavement, merged per surface
  const bySurface = new Map<number, THREE.BufferGeometry[]>()
  for (const p of layout.pav) {
    const style = surfaceStyle(p.surf)
    if (!style) continue
    try {
      const ring = (r: [number, number][]): THREE.Vector2[] => r.map(([lat, lon]) => { const q = toLocal(lat, lon); return new THREE.Vector2(q.x, q.z) })
      const shape = new THREE.Shape(ring(p.rings[0]!))
      for (const hole of p.rings.slice(1)) shape.holes.push(new THREE.Path(ring(hole)))
      const geo = new THREE.ShapeGeometry(shape)
      geo.rotateX(Math.PI / 2)
      geo.translate(0, elevM + style.lift, 0)
      const list = bySurface.get(p.surf) ?? []
      list.push(geo)
      bySurface.set(p.surf, list)
    } catch { /* a degenerate polygon is dropped, never the airport */ }
  }
  for (const [surf, geos] of bySurface) {
    const merged = geos.length === 1 ? geos[0]! : mergeGeometries(geos, false)
    if (geos.length > 1) geos.forEach((g) => g.dispose())
    const mat = pavementMaterial(surf)
    if (!merged || !mat) continue
    const mesh = new THREE.Mesh(merged, mat)
    mesh.name = `aptPavement${surf}`
    mesh.receiveShadow = true
    mesh.renderOrder = 10
    group.add(mesh)
  }
  // ---- painted lines, merged per colour (+ one black border mesh)
  const paint = new Map<PaintColor, Ribbons>()
  const borders = ribbon()
  const yPaint = elevM + 0.09, yBorder = elevM + 0.075
  for (const l of layout.lines) {
    const style = lineStyle(l.t)
    if (!style) continue
    const pts = l.p.map(([lat, lon]) => toLocal(lat, lon))
    const r = paint.get(style.color) ?? ribbon()
    paint.set(style.color, r)
    const lanes = style.lanes
    const span = Math.max(...lanes.map(Math.abs)) * 2 + style.width
    if (style.border) addRibbon(borders, pts, span + 0.3, yBorder)
    for (const lane of lanes) {
      const line = offsetLine(pts, lane)
      const dashed = style.dash && (!style.dashedLanes || style.dashedLanes.includes(lane))
      if (dashed && style.dash) for (const run of dashRuns(line, style.dash[0], style.dash[1])) addRibbon(r, run, style.width, yPaint)
      else addRibbon(r, line, style.width, yPaint)
    }
  }
  const b = toMesh(borders, paintMaterial('border', 0x16181a), 'aptLineBorders')
  if (b) { b.renderOrder = 21; group.add(b) }
  for (const [color, r] of paint) {
    const m = toMesh(r, paintMaterial(color, PAINT[color]), `aptPaint-${color}`)
    if (m) { m.renderOrder = 22; group.add(m) }
  }
  return group
}

/** Fetch and build X-Plane's layout for `icao`; true when it was applied. */
export async function enhanceAirportWithXplane(group: THREE.Group, icao: string, refLat: number, refLon: number, elevM: number): Promise<boolean> {
  let layout: AptLayout | null
  try {
    const res = await fetch(`/api/apt/${icao}.json`)
    if (!res.ok) return false
    layout = normalizeApt(await res.json())
  } catch { return false }
  if (!layout || group.userData.airportDisposed || group.getObjectByName('aptLayout')) return false
  const mLat = 111_320
  const mLon = 111_320 * Math.cos((refLat * Math.PI) / 180)
  const toLocal = (lat: number, lon: number): XZ => ({ x: (lon - refLon) * mLon, z: -(lat - refLat) * mLat })
  // Reject remote/corrupt coordinates before allocating geometry.
  const near = (r: [number, number][]): boolean => r.every(([lat, lon]) => { const q = toLocal(lat, lon); return Math.hypot(q.x, q.z) < 25_000 })
  layout = { ...layout, pav: layout.pav.map((p) => ({ ...p, rings: p.rings.filter(near) })).filter((p) => p.rings.length), lines: layout.lines.filter((l) => near(l.p)) }
  if (!layout.pav.length) return false
  const built = buildAptMeshes(layout, toLocal, elevM)
  group.add(built)

  // The stand-in taxiway complex retires: X-Plane's pavement replaces it.
  const stale: THREE.Object3D[] = []
  group.traverse((o) => { if (o.name === 'proceduralTaxi') stale.push(o) })
  for (const o of stale) disposeAirportObject(o)
  if (stale.length) {
    const colors = (group.userData.night?.pts as THREE.Points | undefined)?.geometry.getAttribute('color')
    if (colors) {
      for (const i of group.userData.proceduralTaxiLightIndices ?? []) colors.setXYZ(i, 0, 0, 0)
      colors.needsUpdate = true
    }
  }
  // Ground control names the real taxiways.
  const segs = taxiIdentSegments(layout, toLocal)
  if (segs.length) osmIdentSegs.set(icao, segs)
  // Facilities (stands, fleet) are replanned around the real pavement.
  const apronLike = layout.pav.filter((p) => /apron|ramp|stand|gate|parking|terminal|hangar/i.test(p.name))
  const aprons: GroundPoint[][] = apronLike.map((p) => p.rings[0]!.map(([lat, lon]) => toLocal(lat, lon)))
  const byId = new Map(layout.taxi.nodes.map((n) => [n.id, n]))
  const obstacles: SurfaceObstacle[] = []
  for (const e of layout.taxi.edges) {
    const a = byId.get(e.a), c = byId.get(e.b)
    if (a && c && /^taxiway/.test(e.kind)) obstacles.push({ a: toLocal(a.lat, a.lon), b: toLocal(c.lat, c.lon), radius: 18 })
  }
  group.userData.aptApplied = { aprons, obstacles }
  const rebuild = group.userData.rebuildFacilities as ((o: SurfaceObstacle[], a: GroundPoint[][], real: boolean, elev: number) => void) | undefined
  rebuild?.(obstacles.slice(0, 600), aprons, false, elevM)
  return true
}
