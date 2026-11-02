import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { disposeAirportObject, ownMaterial, type GroundPoint, type SurfaceObstacle } from './airport-scenery'
import { buildRunwayMarkings, buildRunwayOverruns, type RunwayLocal } from './airport-detail'
import { osmIdentSegs } from './osm-layout'
import { parkedAircraftFor } from './parked-aircraft'
import { lightGlowTexture } from '../render/light-glow'
import { pavementMaterial as proceduralPavement } from '../render/surface-materials'

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
/** A run of taxiway lights: apt.dat light-type code (101 centreline, 102 edge …) along a polyline. */
export interface AptLights { l: number; p: [number, number][] }
export interface AptPavement { surf: number; name: string; rings: [number, number][][] }
export interface AptTaxiNode { id: number; lat: number; lon: number; use: string; name: string }
export interface AptTaxiEdge { a: number; b: number; oneway: boolean; kind: string; name: string }
export interface AptSign { lat: number; lon: number; hdg: number; size: number; text: string }
export interface AptRunwayEnd { id: string; dthr: number; over: number; mark: number; lat?: number; lon?: number }
export interface AptRunway { w: number; surf: number; ends: [AptRunwayEnd, AptRunwayEnd] }
export interface AptRamp { lat: number; lon: number; hdg: number; kind: string; cats: string[]; name: string }
export interface AptLayout {
  icao: string
  name: string
  elevFt: number
  pav: AptPavement[]
  lines: AptLine[]
  lights: AptLights[]
  signs: AptSign[]
  rwy: AptRunway[]
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
  const lights: AptLights[] = []
  for (const l of arr(d.lights).slice(0, 20_000)) {
    const o = l as Record<string, unknown>
    const p = pts(o?.p, 2)
    if (p && Number.isFinite(o.l)) lights.push({ l: Number(o.l), p })
  }
  const rwy: AptRunway[] = arr(d.rwy).slice(0, 64).flatMap((r) => {
    const o = r as Record<string, unknown>
    const ends = arr(o?.ends).slice(0, 2).map((e) => {
      const x = e as Record<string, unknown>
      return typeof x?.id === 'string' ? { id: x.id, dthr: Math.max(0, Number(x.dthr) || 0), over: Math.max(0, Number(x.over) || 0), mark: Number(x.mark) || 0, ...(Number.isFinite(x.lat) && Number.isFinite(x.lon) && Math.abs(Number(x.lat)) <= 90 && Math.abs(Number(x.lon)) <= 180 ? { lat: Number(x.lat), lon: Number(x.lon) } : {}) } : null
    })
    return ends.length === 2 && ends[0] && ends[1] ? [{ w: Number(o.w) || 0, surf: Number(o.surf) || 0, ends: [ends[0], ends[1]] as AptRunway['ends'] }] : []
  })
  const signs: AptSign[] = arr(d.signs).slice(0, 2000).flatMap((r) => {
    const o = r as Record<string, unknown>
    const text = typeof o?.text === 'string' ? o.text.slice(0, 80) : ''
    return Number.isFinite(o?.lat) && Number.isFinite(o?.lon) && text ? [{ lat: Number(o.lat), lon: Number(o.lon), hdg: Number(o.hdg) || 0, size: Number(o.size) || 1, text }] : []
  })
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
  return { icao: String(d.icao ?? ''), name: String(d.name ?? ''), elevFt: Number(d.elevFt) || 0, pav, lines, lights, signs, rwy, ramps, taxi: { nodes, edges } }
}

// ------------------------------------------------------------- surfaces --

/** Pavement follows the ground in triangles no longer than this (m), and sits this far above it on top of the surface's own lift (the terrain mesh interpolates the levelling between its vertices, so it can stand a few centimetres above the sampled ground). */
const PAVEMENT_MAX_EDGE_M = 30
const DRAPE_BIAS_M = 0.05
/** Painted lines follow the ground in segments no longer than this (m). */
const PAINT_MAX_SEG_M = 14
/** The ground is sampled on a grid of this spacing (m) over the airport. */
const GROUND_GRID_M = 20
/** Where the ground is level to within this (m) over a triangle or a segment, it is not subdivided (up to FLAT_MAX_SPAN_M across). */
const FLAT_TOL_M = 0.01
const FLAT_MAX_SPAN_M = 90
/** Pavement near a runway is cut into triangles of this size, and cut away inside the runway's footprint less this inset (m). */
const RUNWAY_CUT_EDGE_M = 8
const RUNWAY_CUT_PAD_M = 6
const RUNWAY_CUT_INSET_M = 1.5

/** apt.dat surface codes → paint. 15 (transparent) and 13/14 (water, snow) draw nothing. */
export function surfaceStyle(surf: number): { color: number; lift: number; roughness: number } | null {
  switch (surf) {
    case 1: return { color: 0x8c9094, lift: 0.030, roughness: 0.95 }  // asphalt
    case 2: return { color: 0xbebeb7, lift: 0.045, roughness: 0.9 }   // concrete
    case 3: return { color: 0x3c5233, lift: 0.004, roughness: 1 }     // turf
    case 4: return { color: 0x6a5a46, lift: 0.012, roughness: 1 }     // dirt
    case 5: return { color: 0x7a7367, lift: 0.020, roughness: 1 }     // gravel
    case 12: return { color: 0x8a7e66, lift: 0.012, roughness: 1 }    // dry lakebed
    case 13: case 14: case 15: return null
    default:
      // X-Plane 12's weathered variants: 20–29 are asphalt, 30–38 concrete.
      if (surf >= 30 && surf <= 38) return { color: 0xbebeb7, lift: 0.047, roughness: 0.9 }
      return { color: 0x8c9094, lift: 0.031, roughness: 0.95 }
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

/** Ground height (m) at a point of the airport-local frame. */
export type GroundFn = (x: number, z: number) => number

/**
 * A sampler of the ground over an area: `sample` is evaluated once on a regular grid and looked up bilinearly,
 * so a pavement of tens of thousands of vertices costs a few tens of thousands of evaluations. Points outside the
 * area take the nearest edge. The spacing grows when the area would need more than `maxCells` samples.
 */
export function groundGrid(b: { minX: number; maxX: number; minZ: number; maxZ: number }, spacing: number, sample: GroundFn, maxCells = 160_000): GroundFn {
  const w = Math.max(b.maxX - b.minX, 1), h = Math.max(b.maxZ - b.minZ, 1)
  const step = Math.max(spacing, Math.sqrt((w * h) / maxCells))
  const nx = Math.ceil(w / step) + 1, nz = Math.ceil(h / step) + 1
  const ys = new Float32Array(nx * nz)
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) ys[j * nx + i] = sample(b.minX + i * step, b.minZ + j * step)
  return (x, z) => {
    const fx = Math.min(Math.max((x - b.minX) / step, 0), nx - 1), fz = Math.min(Math.max((z - b.minZ) / step, 0), nz - 1)
    const i = Math.min(Math.floor(fx), nx - 2), j = Math.min(Math.floor(fz), nz - 2)
    const tx = fx - i, tz = fz - j
    const a = ys[j * nx + i]!, c = ys[j * nx + i + 1]!, d = ys[(j + 1) * nx + i]!, e = ys[(j + 1) * nx + i + 1]!
    return (a * (1 - tx) + c * tx) * (1 - tz) + (d * (1 - tx) + e * tx) * tz
  }
}

/**
 * A polyline with no segment longer than `maxSeg` (extra points on the segments), so it can follow the ground.
 * With `ground`, a segment over which the ground is level (within `flatTol`, up to `maxFlat` long) is left whole.
 */
export function densify(pts: readonly XZ[], maxSeg: number, ground?: GroundFn, flatTol = FLAT_TOL_M, maxFlat = FLAT_MAX_SPAN_M): XZ[] {
  const out: XZ[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!
    out.push(a)
    const b = pts[i + 1]
    if (!b) break
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    if (ground && len <= maxFlat) {
      const ys = [ground(a.x, a.z), ground((a.x + b.x) / 2, (a.z + b.z) / 2), ground(b.x, b.z), ground(a.x + (b.x - a.x) / 4, a.z + (b.z - a.z) / 4), ground(a.x + ((b.x - a.x) * 3) / 4, a.z + ((b.z - a.z) * 3) / 4)]
      if (Math.max(...ys) - Math.min(...ys) <= flatTol) continue
    }
    const n = Math.ceil(len / maxSeg)
    for (let k = 1; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n })
  }
  return out
}

/** A runway's footprint on the ground (airport-local metres): the segment between its ends and its half-width. */
export interface RunwayRect { ax: number; az: number; bx: number; bz: number; hw: number }

/** The runways of X-Plane's layout that carry their end coordinates, as footprints. */
export function runwayRects(rwy: readonly AptRunway[], toLocal: (lat: number, lon: number) => XZ): RunwayRect[] {
  const out: RunwayRect[] = []
  for (const r of rwy) {
    const [a, b] = r.ends
    if (a.lat === undefined || a.lon === undefined || b.lat === undefined || b.lon === undefined) continue
    const pa = toLocal(a.lat, a.lon), pb = toLocal(b.lat, b.lon)
    if (Math.hypot(pb.x - pa.x, pb.z - pa.z) < 50) continue
    out.push({ ax: pa.x, az: pa.z, bx: pb.x, bz: pb.z, hw: Math.max(r.w, 8) / 2 })
  }
  return out
}

/** Whether a point is within `inset` metres inside a runway footprint (between its ends, inside its edges). */
export function insideRunway(x: number, z: number, rects: readonly RunwayRect[], inset = 0): boolean {
  for (const r of rects) {
    const dx = r.bx - r.ax, dz = r.bz - r.az, len2 = dx * dx + dz * dz
    const t = ((x - r.ax) * dx + (z - r.az) * dz) / len2
    if (t < 0 || t > 1) continue
    if (Math.hypot(x - (r.ax + t * dx), z - (r.az + t * dz)) < r.hw - inset) return true
  }
  return false
}

/** Whether a runway footprint (grown by `pad`) could touch a triangle: its distance to the triangle's centre is within the pad plus the triangle's own reach. */
function nearRunway(x0: number, z0: number, x1: number, z1: number, x2: number, z2: number, rects: readonly RunwayRect[], pad: number): boolean {
  const cx = (x0 + x1 + x2) / 3, cz = (z0 + z1 + z2) / 3
  const reach = Math.max(Math.hypot(x0 - cx, z0 - cz), Math.hypot(x1 - cx, z1 - cz), Math.hypot(x2 - cx, z2 - cz))
  for (const r of rects) {
    const dx = r.bx - r.ax, dz = r.bz - r.az, len2 = dx * dx + dz * dz
    const t = Math.min(Math.max(((cx - r.ax) * dx + (cz - r.az) * dz) / len2, 0), 1)
    if (Math.hypot(cx - (r.ax + t * dx), cz - (r.az + t * dz)) < r.hw + pad + reach) return true
  }
  return false
}

/**
 * Split triangles (flat x,y,z positions in the xz plane, y ignored) at the middle of their longest edge until no
 * edge exceeds `maxEdge`, so a pavement can follow the ground. Returns flat positions, three vertices per triangle.
 */
export function subdivideTriangles(pos: ArrayLike<number>, index: ArrayLike<number> | null, maxEdge: number, maxTriangles = 400_000, ground?: GroundFn, flatTol = FLAT_TOL_M, maxFlat = FLAT_MAX_SPAN_M, finer?: (x0: number, z0: number, x1: number, z1: number, x2: number, z2: number) => number | null): number[] {
  const out: number[] = []
  const vert = (i: number): [number, number] => [pos[i * 3]!, pos[i * 3 + 2]!]
  const stack: Array<[number, number, number, number, number, number]> = []
  const count = index ? index.length : pos.length / 3
  for (let t = 0; t + 2 < count; t += 3) {
    const [a, b, c] = index ? [index[t]!, index[t + 1]!, index[t + 2]!] : [t, t + 1, t + 2]
    const [ax, az] = vert(a), [bx, bz] = vert(b), [cx, cz] = vert(c)
    stack.push([ax, az, bx, bz, cx, cz])
    while (stack.length) {
      const [x0, z0, x1, z1, x2, z2] = stack.pop()!
      const e0 = Math.hypot(x1 - x0, z1 - z0), e1 = Math.hypot(x2 - x1, z2 - z1), e2 = Math.hypot(x0 - x2, z0 - z2)
      const longest = Math.max(e0, e1, e2)
      const limit = finer?.(x0, z0, x1, z1, x2, z2) ?? null     // a region that needs smaller triangles than the rest (the edges of a cut)
      if (longest <= (limit ?? maxEdge) || out.length / 9 >= maxTriangles) { out.push(x0, 0, z0, x1, 0, z1, x2, 0, z2); continue }
      if (limit === null && ground && longest <= maxFlat) {
        // Level ground (the whole of a flattened airport): a triangle that lies flat on it needs no more vertices.
        const cx = (x0 + x1 + x2) / 3, cz = (z0 + z1 + z2) / 3
        const ys = [ground(x0, z0), ground(x1, z1), ground(x2, z2), ground((x0 + x1) / 2, (z0 + z1) / 2), ground((x1 + x2) / 2, (z1 + z2) / 2), ground((x2 + x0) / 2, (z2 + z0) / 2), ground(cx, cz)]
        if (Math.max(...ys) - Math.min(...ys) <= flatTol) { out.push(x0, 0, z0, x1, 0, z1, x2, 0, z2); continue }
      }
      if (longest === e0) { const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2; stack.push([x0, z0, mx, mz, x2, z2], [mx, mz, x1, z1, x2, z2]) }
      else if (longest === e1) { const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2; stack.push([x1, z1, mx, mz, x0, z0], [mx, mz, x2, z2, x0, z0]) }
      else { const mx = (x2 + x0) / 2, mz = (z2 + z0) / 2; stack.push([x2, z2, mx, mz, x1, z1], [mx, mz, x0, z0, x1, z1]) }
    }
  }
  return out
}

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

function addRibbon(r: Ribbons, pts: readonly XZ[], width: number, y: number | GroundFn): void {
  const hw = width / 2
  const yAt = typeof y === 'function' ? y : (): number => y
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!
    const dx = b.x - a.x, dz = b.z - a.z
    const len = Math.hypot(dx, dz)
    if (len < 1e-6) continue
    const nx = (-dz / len) * hw, nz = (dx / len) * hw
    const ya = yAt(a.x, a.z), yb = yAt(b.x, b.z)
    const base = r.pos.length / 3
    r.pos.push(a.x + nx, ya, a.z + nz, a.x - nx, ya, a.z - nz, b.x + nx, yb, b.z + nz, b.x - nx, yb, b.z - nz)
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
/** Fraction of its own colour a pavement glows at full night. */
export const NIGHT_GLOW = 0.08
/** Give every X-Plane pavement its faint night glow (0 = day, 1 = full night). */
export function setAptNight(night: number): void {
  for (const m of pavementMaterials.values()) m.emissive.set(m.color).multiplyScalar(NIGHT_GLOW * Math.min(Math.max(night, 0), 1))
}
function pavementMaterial(surf: number): THREE.MeshStandardMaterial | null {
  const s = surfaceStyle(surf)
  if (!s) return null
  let m = pavementMaterials.get(surf)
  if (!m) {
    // Asphalt and concrete get the runway's procedural finish (grain, weathering, slab joints); turf, dirt and gravel stay plain.
    const paved = surf === 1 || surf === 2 || (surf >= 20 && surf <= 38)
    m = paved ? proceduralPavement(s.color, 'xz', isConcreteSurface(surf) ? 'concrete' : 'asphalt') : new THREE.MeshStandardMaterial({ color: s.color, roughness: s.roughness, envMapIntensity: 0.25 })
    m.side = THREE.DoubleSide
    m.userData.airportOwned = true
    pavementMaterials.set(surf, m)
  }
  return m
}

/** Pavement + painted lines as one group in the airport-local frame. */
export function buildAptMeshes(layout: AptLayout, toLocal: (lat: number, lon: number) => XZ, elevM: number): THREE.Group {
  const group = new THREE.Group()
  group.name = 'aptLayout'
  group.add(...buildAptPavement(layout, toLocal, elevM), ...buildAptPaint(layout, toLocal, elevM))
  return group
}

/** The pavement polygons, merged per surface (the expensive part: every polygon is triangulated). */
export function buildAptPavement(layout: AptLayout, toLocal: (lat: number, lon: number) => XZ, elevM: number, ground?: GroundFn, runways?: readonly RunwayRect[]): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  // ---- pavement, merged per surface
  const bySurface = new Map<number, THREE.BufferGeometry[]>()
  for (const p of layout.pav) {
    const style = surfaceStyle(p.surf)
    if (!style) continue
    try {
      const ring = (r: [number, number][]): THREE.Vector2[] => r.map(([lat, lon]) => { const q = toLocal(lat, lon); return new THREE.Vector2(q.x, q.z) })
      const shape = new THREE.Shape(ring(p.rings[0]!))
      for (const hole of p.rings.slice(1)) shape.holes.push(new THREE.Path(ring(hole)))
      const flat = new THREE.ShapeGeometry(shape)
      flat.rotateX(Math.PI / 2)
      let geo: THREE.BufferGeometry
      if (ground) {
        // Follow the ground: fine enough triangles, each vertex on the terrain surface plus the surface's own lift.
        // Where a runway lies, the pavement is cut out of its footprint (the runway is drawn there), so a crossing taxiway never covers it.
        const finer = runways?.length ? (x0: number, z0: number, x1: number, z1: number, x2: number, z2: number): number | null => (nearRunway(x0, z0, x1, z1, x2, z2, runways, RUNWAY_CUT_PAD_M) ? RUNWAY_CUT_EDGE_M : null) : undefined
        let tri = subdivideTriangles(flat.getAttribute('position').array, flat.index ? flat.index.array : null, PAVEMENT_MAX_EDGE_M, 400_000, ground, FLAT_TOL_M, FLAT_MAX_SPAN_M, finer)
        if (runways?.length) {
          const kept: number[] = []
          for (let i = 0; i < tri.length; i += 9) {
            const cx = (tri[i]! + tri[i + 3]! + tri[i + 6]!) / 3, cz = (tri[i + 2]! + tri[i + 5]! + tri[i + 8]!) / 3
            if (!insideRunway(cx, cz, runways, RUNWAY_CUT_INSET_M)) for (let k = 0; k < 9; k++) kept.push(tri[i + k]!)
          }
          tri = kept
          if (!tri.length) continue
        }
        for (let i = 0; i < tri.length; i += 3) tri[i + 1] = ground(tri[i]!, tri[i + 2]!) + style.lift + DRAPE_BIAS_M
        // The shape's triangles face down once laid on the xz plane: swap two corners of each so the surface is lit from above.
        for (let i = 0; i < tri.length; i += 9) for (let k = 0; k < 3; k++) { const t = tri[i + 3 + k]!; tri[i + 3 + k] = tri[i + 6 + k]!; tri[i + 6 + k] = t }
        geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3))
        geo.computeVertexNormals()
        flat.dispose()
      } else {
        geo = flat
        geo.translate(0, elevM + style.lift, 0)
      }
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
    out.push(mesh)
  }
  return out
}

/** The painted lines, merged per colour (+ one black border mesh). */
export function buildAptPaint(layout: AptLayout, toLocal: (lat: number, lon: number) => XZ, elevM: number, ground?: GroundFn): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  const paint = new Map<PaintColor, Ribbons>()
  const borders = ribbon()
  const yPaint: number | GroundFn = ground ? (x, z) => ground(x, z) + 0.15 : elevM + 0.09
  const yBorder: number | GroundFn = ground ? (x, z) => ground(x, z) + 0.13 : elevM + 0.075
  const fine = (pts: XZ[]): XZ[] => (ground ? densify(pts, PAINT_MAX_SEG_M, ground) : pts)
  for (const l of layout.lines) {
    const style = lineStyle(l.t)
    if (!style) continue
    const pts = l.p.map(([lat, lon]) => toLocal(lat, lon))
    const r = paint.get(style.color) ?? ribbon()
    paint.set(style.color, r)
    const lanes = style.lanes
    const span = Math.max(...lanes.map(Math.abs)) * 2 + style.width
    if (style.border) addRibbon(borders, fine(pts), span + 0.3, yBorder)
    for (const lane of lanes) {
      const line = offsetLine(pts, lane)
      const dashed = style.dash && (!style.dashedLanes || style.dashedLanes.includes(lane))
      if (dashed && style.dash) for (const run of dashRuns(line, style.dash[0], style.dash[1])) addRibbon(r, fine(run), style.width, yPaint)
      else addRibbon(r, fine(line), style.width, yPaint)
    }
  }
  const b = toMesh(borders, paintMaterial('border', 0x16181a), 'aptLineBorders')
  if (b) { b.renderOrder = 21; out.push(b) }
  for (const [color, r] of paint) {
    const m = toMesh(r, paintMaterial(color, PAINT[color]), `aptPaint-${color}`)
    if (m) { m.renderOrder = 22; out.push(m) }
  }
  return out
}

// ------------------------------------------------------------------ signs --

export type SignStyle = 'L' | 'R' | 'Y' | 'B'
export type SignItem = { text: string } | { arrow: string }
export interface SignPanel { style: SignStyle; items: SignItem[] }

const ARROWS = new Set(['l', 'lu', 'u', 'ru', 'r', 'rd', 'd', 'ld'])
const STYLES = new Set(['L', 'R', 'Y', 'B'])

/**
 * apt.dat sign text. {@L} location, {@Y} direction, {@R} mandatory and {@B} distance start a new panel
 * (a code list such as {@@,@L} applies each of its codes in turn); "|" starts a new panel in the same style;
 * {^l} {^ru} … are arrows. Pure.
 */
export function parseSignText(text: string): SignPanel[] {
  const panels: SignPanel[] = []
  let style: SignStyle = 'L'
  let items: SignItem[] = []
  let buf = ''
  const flushText = (): void => { if (buf) { items.push({ text: buf }); buf = '' } }
  const endPanel = (): void => { flushText(); if (items.length) panels.push({ style, items }); items = [] }
  for (const part of text.split(/(\{[^}]*\}|\|)/)) {
    if (part === '|') { endPanel(); continue }
    const code = /^\{(.*)\}$/.exec(part)
    if (!code) { buf += part; continue }
    for (const c of code[1]!.split(',')) {
      if (c.startsWith('@') && STYLES.has(c.slice(1))) { endPanel(); style = c.slice(1) as SignStyle }
      else if (c.startsWith('^') && ARROWS.has(c.slice(1))) { flushText(); items.push({ arrow: c.slice(1) }) }
    }
  }
  endPanel()
  return panels
}

/** Face height (m) of apt.dat sign size 1…6. */
export function signHeightM(size: number): number {
  const sizes = [0.4, 0.6, 0.8, 1.0, 1.2, 1.5]
  return sizes[Math.min(6, Math.max(1, Math.round(size) || 1)) - 1]!
}

/** Width (m) of one panel: characters about 0.6 of the height wide, an arrow a full height, plus a margin. */
export function signPanelWidth(panel: SignPanel, size: number): number {
  const h = signHeightM(size)
  const body = panel.items.reduce((w, it) => w + ('arrow' in it ? 1 : 0.62 * it.text.length), 0)
  return h * (body + 0.5)
}

/** Cell origins (pixels) for `count` signs on an atlas of `cols` columns; as many as fit when `rows` is given. Pure. */
export function layoutSignAtlas(count: number, o: { cols: number; cellW: number; cellH: number; rows?: number }): Array<{ x: number; y: number }> {
  const n = o.rows ? Math.min(count, o.cols * o.rows) : count
  return Array.from({ length: n }, (_, i) => ({ x: (i % o.cols) * o.cellW, y: Math.floor(i / o.cols) * o.cellH }))
}

const SIGN_COLORS: Record<SignStyle, { bg: string; fg: string; edge: string }> = {
  L: { bg: '#101010', fg: '#f2c500', edge: '#f2c500' },
  Y: { bg: '#f2c500', fg: '#111111', edge: '#111111' },
  R: { bg: '#b3141c', fg: '#ffffff', edge: '#ffffff' },
  B: { bg: '#101010', fg: '#ffffff', edge: '#ffffff' },
}

function drawArrow(c: CanvasRenderingContext2D, dir: string, cx: number, cy: number, s: number): void {
  // 0° = up; angles clockwise: u 0, ru 45, r 90, rd 135, d 180, ld 225, l 270, lu 315
  const deg = ({ u: 0, ru: 45, r: 90, rd: 135, d: 180, ld: 225, l: 270, lu: 315 } as Record<string, number>)[dir] ?? 0
  c.save(); c.translate(cx, cy); c.rotate((deg * Math.PI) / 180)
  c.beginPath(); c.moveTo(0, -s * 0.5); c.lineTo(s * 0.42, 0); c.lineTo(s * 0.16, 0); c.lineTo(s * 0.16, s * 0.5); c.lineTo(-s * 0.16, s * 0.5); c.lineTo(-s * 0.16, 0); c.lineTo(-s * 0.42, 0); c.closePath(); c.fill()
  c.restore()
}

/** One sign (all its panels) painted into a w × h cell. */
export function paintSign(c: CanvasRenderingContext2D, panels: SignPanel[], size: number, w: number, h: number): void {
  const widths = panels.map((p) => signPanelWidth(p, size))
  const total = widths.reduce((a, b) => a + b, 0) || 1
  let x = 0
  panels.forEach((panel, i) => {
    const pw = (widths[i]! / total) * w
    const col = SIGN_COLORS[panel.style]
    c.fillStyle = col.bg; c.fillRect(x, 0, pw, h)
    c.strokeStyle = col.edge; c.lineWidth = Math.max(2, h * 0.05); c.strokeRect(x + h * 0.06, h * 0.06, pw - h * 0.12, h * 0.88)
    c.fillStyle = col.fg; c.textAlign = 'center'; c.textBaseline = 'middle'
    const fontPx = h * 0.62
    c.font = `800 ${fontPx}px system-ui, "Helvetica Neue", Arial, sans-serif`
    const glyphs = panel.items.reduce((n, it) => n + ('arrow' in it ? 1 : 0.62 * it.text.length), 0) || 1
    let gx = x + (pw - (glyphs / (glyphs + 0.5)) * pw) / 2
    const unit = pw / (glyphs + 0.5)
    for (const it of panel.items) {
      if ('arrow' in it) { drawArrow(c, it.arrow, gx + unit / 2, h / 2, h * 0.62); gx += unit }
      else { const tw = 0.62 * it.text.length * unit; c.fillText(it.text, gx + tw / 2, h / 2 + h * 0.03); gx += tw }
    }
    x += pw
  })
}

/** X-Plane's concrete surface codes: 2 and the weathered 30–38. */
export const isConcreteSurface = (surf: number): boolean => surf === 2 || (surf >= 30 && surf <= 38)

/** "09L" and "9L" are the same runway end. */
const identKey = (id: string): string => id.trim().toUpperCase().replace(/^0+(?=\d)/, '')

type RunwayDetail = { li: string; hi: string; rl: RunwayLocal; detail: THREE.Group; setConcrete?: (on: boolean) => void }

/** apt.dat's runway that the old database's runway detail stands for (same two ends, either order). */
function aptRunwayFor(d: RunwayDetail, rwy: readonly AptRunway[]): AptRunway | undefined {
  const low = identKey(d.li), high = identKey(d.hi)
  return rwy.find((r) => { const a = identKey(r.ends[0].id), b = identKey(r.ends[1].id); return (a === low && b === high) || (a === high && b === low) })
}

/**
 * X-Plane's blast pads / overruns: the paved stretch beyond each runway end with its yellow chevrons.
 * The old runway data has none. Returns how many runways gained one.
 */
export function applyRunwayOverruns(group: THREE.Group, rwy: readonly AptRunway[]): number {
  const details = group.userData.runwayDetails as RunwayDetail[] | undefined
  if (!details) return 0
  let added = 0
  for (const d of details) {
    const m = aptRunwayFor(d, rwy)
    if (!m) continue
    const overOf = (k: string): number => m.ends.find((e) => identKey(e.id) === k)?.over ?? 0
    const overrunLowM = overOf(identKey(d.li)), overrunHighM = overOf(identKey(d.hi))
    const old = d.detail.getObjectByName('runwayOverruns')
    if (old) { d.detail.remove(old); disposeAirportObject(old) }
    if (!(overrunLowM >= 1 || overrunHighM >= 1)) continue
    const fresh = buildRunwayOverruns({ ...d.rl, overrunLowM, overrunHighM }, isConcreteSurface(m.surf))
    fresh.name = 'runwayOverruns'
    d.detail.add(fresh)
    added++
  }
  return added
}

/**
 * X-Plane's displaced thresholds: redraw each runway's markings with the landing threshold, arrows and bar
 * where the airport data puts them. Runways without a displacement keep their markings. Returns how many changed.
 */
export function applyDisplacedThresholds(group: THREE.Group, rwy: readonly AptRunway[]): number {
  const details = group.userData.runwayDetails as RunwayDetail[] | undefined
  if (!details) return 0
  let changed = 0
  for (const d of details) {
    const low = identKey(d.li), high = identKey(d.hi)
    const m = aptRunwayFor(d, rwy)
    if (!m) continue
    d.setConcrete?.(isConcreteSurface(m.surf))
    const endOf = (k: string): number => m.ends.find((e) => identKey(e.id) === k)?.dthr ?? 0
    const displacedLowM = endOf(low), displacedHighM = endOf(high)
    if (!(displacedLowM > 0 || displacedHighM > 0)) continue
    const old = d.detail.getObjectByName('runwayMarkings')
    if (old) { d.detail.remove(old); disposeAirportObject(old) }
    const fresh = buildRunwayMarkings({ ...d.rl, displacedLowM, displacedHighM })
    fresh.name = 'runwayMarkings'
    d.detail.add(fresh)
    changed++
  }
  return changed
}

const SIGN_ATLAS = { cols: 8, rows: 32, cellW: 256, cellH: 64 }
const SIGN_POST_M = 0.35

/** Every sign as one textured quad batch (one draw call) on a post, painted into a shared atlas. */
export function buildAptSigns(layout: AptLayout, toLocal: (lat: number, lon: number) => XZ, elevM: number, ground?: GroundFn): THREE.Group | null {
  const ranked = layout.signs
    .map((s) => ({ s, p: toLocal(s.lat, s.lon), panels: parseSignText(s.text) }))
    .filter((x) => x.panels.length)
    .sort((a, b) => Math.hypot(a.p.x, a.p.z) - Math.hypot(b.p.x, b.p.z))
  const cells = layoutSignAtlas(ranked.length, SIGN_ATLAS)
  if (!cells.length) return null
  const canvas = document.createElement('canvas')
  canvas.width = SIGN_ATLAS.cols * SIGN_ATLAS.cellW
  canvas.height = SIGN_ATLAS.rows * SIGN_ATLAS.cellH
  const c = canvas.getContext('2d')!
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  const posts: THREE.BufferGeometry[] = []
  cells.forEach((cell, i) => {
    const { s, p, panels } = ranked[i]!
    const h = signHeightM(s.size)
    const w = panels.reduce((a, pn) => a + signPanelWidth(pn, s.size), 0)
    const paintW = Math.min(SIGN_ATLAS.cellW, Math.round(SIGN_ATLAS.cellH * (w / h)))
    c.save(); c.translate(cell.x, cell.y); c.beginPath(); c.rect(0, 0, paintW, SIGN_ATLAS.cellH); c.clip()
    paintSign(c, panels, s.size, paintW, SIGN_ATLAS.cellH)
    c.restore()
    // The front faces approaching traffic: opposite the sign's heading.
    const H = (s.hdg * Math.PI) / 180
    const rx = Math.cos(H), rz = Math.sin(H)
    const base0 = ground ? ground(p.x, p.z) : elevM
    const y0 = base0 + SIGN_POST_M, y1 = y0 + h
    const u0 = cell.x / canvas.width, u1 = (cell.x + paintW) / canvas.width
    const v0 = 1 - (cell.y + SIGN_ATLAS.cellH) / canvas.height, v1 = 1 - cell.y / canvas.height
    const base = pos.length / 3
    pos.push(p.x - (rx * w) / 2, y0, p.z - (rz * w) / 2, p.x + (rx * w) / 2, y0, p.z + (rz * w) / 2, p.x + (rx * w) / 2, y1, p.z + (rz * w) / 2, p.x - (rx * w) / 2, y1, p.z - (rz * w) / 2)
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1)
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
    const post = new THREE.BoxGeometry(0.08, SIGN_POST_M, 0.08)
    post.translate(p.x, base0 + SIGN_POST_M / 2, p.z)
    posts.push(post)
  })
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  tex.userData.airportOwned = true
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  const group = new THREE.Group()
  group.name = 'aptSigns'
  const boardMat = ownMaterial(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }))
  // A real sign is lettered on its front only: its back is a plain dark panel, not the mirrored lettering.
  boardMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n  if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.045);')
  }
  boardMat.customProgramCacheKey = () => 'apt-sign-back'
  const boards = new THREE.Mesh(geo, boardMat)
  boards.name = 'aptSignBoards'
  boards.frustumCulled = false
  group.add(boards)
  const merged = mergeGeometries(posts, false)
  posts.forEach((g) => g.dispose())
  if (merged) {
    const m = new THREE.Mesh(merged, ownMaterial(new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.9 })))
    m.name = 'aptSignPosts'
    m.frustumCulled = false
    group.add(m)
  }
  return group
}

// ---------------------------------------------------------------- lights --

/** Colour and spacing (m) of a light-type code: 101 green centreline, 102 blue edge, the rest amber. */
export function lightStyle(code: number): { color: [number, number, number]; spacingM: number } {
  if (code === 101) return { color: [0.2, 1, 0.35], spacingM: 15 }
  if (code === 102) return { color: [0.25, 0.4, 1], spacingM: 40 }
  return { color: [1, 0.72, 0.15], spacingM: 12 }
}

/** Points every `spacing` metres along a polyline. Pure. */
export function samplePolyline(pts: readonly XZ[], spacing: number): XZ[] {
  const out: XZ[] = []
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    for (let d = carry === 0 ? 0 : spacing - carry; d < len; d += spacing) out.push({ x: a.x + ((b.x - a.x) * d) / len, z: a.z + ((b.z - a.z) * d) / len })
    carry = (carry + len) % spacing
  }
  return out
}

const MAX_LIGHTS = 12_000

/** The taxiway lights as one additive Points cloud (faded in at night by Airports.updateNight). */
export function buildAptLights(layout: AptLayout, toLocal: (lat: number, lon: number) => XZ, elevM: number, ground?: GroundFn): THREE.Points | null {
  const pos: number[] = [], col: number[] = []
  for (const run of layout.lights) {
    const style = lightStyle(run.l)
    for (const p of samplePolyline(run.p.map(([lat, lon]) => toLocal(lat, lon)), style.spacingM)) {
      if (pos.length / 3 >= MAX_LIGHTS) break
      pos.push(p.x, (ground ? ground(p.x, p.z) : elevM) + 0.18, p.z)
      col.push(...style.color)
    }
  }
  if (!pos.length) return null
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    map: lightGlowTexture(), size: 2.6, sizeAttenuation: false, vertexColors: true,
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  }))
  pts.name = 'aptLights'
  pts.renderOrder = 30
  pts.frustumCulled = false
  return pts
}

/** Fetch and build X-Plane's layout for `icao`; true when it was applied. */
export async function enhanceAirportWithXplane(group: THREE.Group, icao: string, refLat: number, refLon: number, elevM: number, groundAt?: (lat: number, lon: number) => number): Promise<boolean> {
  let layout: AptLayout | null
  const t0 = performance.now()
  try {
    const res = await fetch(`/api/apt/${icao}.json`)
    if (!res.ok) return false
    layout = normalizeApt(await res.json())
  } catch { return false }
  const tFetched = performance.now()
  if (!layout || group.userData.airportDisposed || group.getObjectByName('aptLayout')) return false
  const mLat = 111_320
  const mLon = 111_320 * Math.cos((refLat * Math.PI) / 180)
  const toLocal = (lat: number, lon: number): XZ => ({ x: (lon - refLon) * mLon, z: -(lat - refLat) * mLat })
  // Reject remote/corrupt coordinates before allocating geometry.
  const near = (r: [number, number][]): boolean => r.every(([lat, lon]) => { const q = toLocal(lat, lon); return Math.hypot(q.x, q.z) < 25_000 })
  layout = { ...layout, pav: layout.pav.map((p) => ({ ...p, rings: p.rings.filter(near) })).filter((p) => p.rings.length), lines: layout.lines.filter((l) => near(l.p)), lights: layout.lights.filter((l) => near(l.p)) }
  if (!layout.pav.length) return false
  // Built in stages with a frame between each: a big airport is a couple of hundred milliseconds of work.
  const built = new THREE.Group()
  built.name = 'aptLayout'
  group.add(built)
  const idle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
  const alive = (): boolean => !group.userData.airportDisposed
  // The ground under the airport, sampled once: pavement, paint, lights and signs follow it instead of one flat height.
  let ground: GroundFn | undefined
  if (groundAt) {
    const b = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 }
    const grow = (r: [number, number][]): void => { for (const [lat, lon] of r) { const q = toLocal(lat, lon); b.minX = Math.min(b.minX, q.x); b.maxX = Math.max(b.maxX, q.x); b.minZ = Math.min(b.minZ, q.z); b.maxZ = Math.max(b.maxZ, q.z) } }
    for (const p of layout.pav) grow(p.rings[0]!)
    const clampB = (v: number): number => Math.min(Math.max(v, -9000), 9000)
    if (b.minX <= b.maxX) {
      const area = { minX: clampB(b.minX) - 20, maxX: clampB(b.maxX) + 20, minZ: clampB(b.minZ) - 20, maxZ: clampB(b.maxZ) + 20 }
      ground = groundGrid(area, GROUND_GRID_M, (x, z) => groundAt(refLat - z / mLat, refLon + x / mLon))
      await idle(); if (!alive()) return false
    }
  }
  built.add(...buildAptPavement(layout, toLocal, elevM, ground, runwayRects(layout.rwy, toLocal)))
  await idle(); if (!alive()) return false
  built.add(...buildAptPaint(layout, toLocal, elevM, ground))
  await idle(); if (!alive()) return false
  group.userData.aptDisplaced = applyDisplacedThresholds(group, layout.rwy)
  // Decorative airplanes at the gates and tie-downs (scenery: no datablock, no radar entry).
  group.userData.aptParked = parkedAircraftFor(layout.ramps.map((r) => ({ ...toLocal(r.lat, r.lon), hdg: r.hdg, kind: r.kind, cats: r.cats, name: r.name }))).map((p) => ({ ...p, y: ground ? ground(p.x, p.z) : elevM }))
  group.userData.aptOverruns = applyRunwayOverruns(group, layout.rwy)
  const lights = buildAptLights(layout, toLocal, elevM, ground)
  if (lights) { group.add(lights); group.userData.aptLights = lights }
  const signs = buildAptSigns(layout, toLocal, elevM, ground)
  if (signs) group.add(signs)
  await idle(); if (!alive()) return false
  group.userData.aptTiming = { fetchMs: Math.round(tFetched - t0), buildMs: Math.round(performance.now() - tFetched), pavements: layout.pav.length, lines: layout.lines.length }

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
