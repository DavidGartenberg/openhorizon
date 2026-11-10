/**
 * Buildings from real footprints (pure geometry; scenery.ts fetches, places and draws them).
 *
 * A footprint (OpenStreetMap, through /api/osm-buildings) becomes walls up to its height, and a roof: a flat one
 * triangulated from the outline, or — on a small, nearly rectangular outline, a house — a gabled or hipped one over the
 * outline's bounding rectangle. Where OSM gives no height the building gets one typical of its size. Every wall
 * carries its own window layout (so many windows across, so many storeys up) for the shader to draw.
 *
 * Coordinates: metres east and north of the tile's centre, heights in metres above sea level; the mesh is written
 * x east, y up, z south.
 */
import * as THREE from 'three'

export interface BuildingRecord {
  /** Height above ground, metres; null when the data has none. */
  h: number | null
  /** Height of the base above ground (a building part that starts above the street). */
  m: number
  /** 1 when the outline was cut at the tile's edge (the rest is the neighbouring tile's). */
  t: number
  /** Outline as micro-degree offsets from the tile's south-west corner: dLat, dLon, … */
  p: number[]
}
export interface BuildingTileData { v: number; s: number; w: number; n: number; e: number; b: BuildingRecord[] }

export type Pt = [number, number]

/** Signed area in the east-north plane: positive when the outline runs counter-clockwise seen from above. */
export function ringArea(pts: readonly Pt[]): number {
  let a = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j]![0] * pts[i]![1] - pts[i]![0] * pts[j]![1]
  return a / 2
}

/** A deterministic 0…1 value from an integer (and a salt, for independent draws from one seed). */
export function hash01(n: number, salt = 0): number {
  let h = (Math.imul(n | 0, 0x9e3779b1) ^ Math.imul((salt + 1) | 0, 0x85ebca6b)) >>> 0
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

export interface OrientedBox { cx: number; cy: number; ax: number; ay: number; halfL: number; halfW: number; area: number }

/** The smallest rectangle around an outline that lies along one of its edges: centre, long-axis unit vector, half length and half width. */
export function orientedBox(pts: readonly Pt[]): OrientedBox {
  let best: OrientedBox | null = null
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 0.5) continue
    const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len
    let lo = Infinity, hi = -Infinity, lo2 = Infinity, hi2 = -Infinity
    for (const p of pts) {
      const s = p[0] * ux + p[1] * uy, t = -p[0] * uy + p[1] * ux
      if (s < lo) lo = s; if (s > hi) hi = s; if (t < lo2) lo2 = t; if (t > hi2) hi2 = t
    }
    const area = (hi - lo) * (hi2 - lo2)
    if (!best || area < best.area) {
      const cs = (lo + hi) / 2, ct = (lo2 + hi2) / 2
      const long = hi - lo >= hi2 - lo2
      best = {
        cx: cs * ux - ct * uy, cy: cs * uy + ct * ux,
        ax: long ? ux : -uy, ay: long ? uy : ux,
        halfL: Math.max(hi - lo, hi2 - lo2) / 2, halfW: Math.min(hi - lo, hi2 - lo2) / 2, area,
      }
    }
  }
  return best ?? { cx: 0, cy: 0, ax: 1, ay: 0, halfL: 0, halfW: 0, area: 0 }
}

export type RoofKind = 'flat' | 'gable' | 'hip'
export interface BuildingStyle {
  /** Wall height above the highest ground under the building, metres. */
  wallH: number
  roof: RoofKind
  /** Ridge height above the walls (pitched roofs). */
  rise: number
  wall: number
  roofColor: number
  /** Window style for the shader: 0 none, 1 house, 2 block, 3 glass tower. */
  windows: 0 | 1 | 2 | 3
  /** Storey height the windows are laid out on, metres. */
  floorH: number
}

const HOUSE_WALLS = [0xd9d0c0, 0xc9c2b4, 0xb9a48c, 0xa7b0b5, 0x9c8f80, 0xe2ddd3, 0xb5b9a8, 0xc8b59a]
const HOUSE_ROOFS = [0x5b5148, 0x4a4a4c, 0x6b5a4e, 0x6e4a40, 0x55504a, 0x3f4245]
const BLOCK_WALLS = [0xb8b4ab, 0xa9a59c, 0xc4bfb3, 0x9aa0a4, 0xb09f8d, 0x8f959a]
const FLAT_ROOFS = [0x8e8c88, 0x9c9a95, 0x7b7a78, 0xb4b2ad, 0xa39c90, 0x6d6e70]
const BIG_ROOFS = [0xc9c8c4, 0xb9b8b3, 0xd6d4ce, 0x9fa1a2]
const TOWER_WALLS = [0x6f7f8c, 0x5f6e7a, 0x7d8a92, 0x8a8f94, 0x596670]
const pick = (list: readonly number[], r: number): number => list[Math.min(list.length - 1, Math.floor(r * list.length))]!

const HOUSE_MAX_AREA = 330
const OUTBUILDING_AREA = 45
const TOWER_HEIGHT = 40

/**
 * How a building of this size is dressed. `rectangular` is how much of its bounding rectangle the outline fills
 * (0…1) and `halfW` that rectangle's half width; `cut` buildings (split at a tile edge) take nothing from their
 * own piece's size, so both pieces come out alike.
 */
export function buildingStyle(areaM2: number, heightM: number | null, seed: number, rectangular: number, halfW: number, cut = false): BuildingStyle {
  const r = (salt: number): number => hash01(seed, salt)
  const house = !cut && areaM2 < HOUSE_MAX_AREA && (heightM === null || heightM < 9.5)
  const pitched = house && areaM2 >= OUTBUILDING_AREA * 0.6 && rectangular > 0.8 && halfW >= 1.8
  let total = heightM
  if (total === null) {
    if (cut) total = 6
    else if (areaM2 < OUTBUILDING_AREA) total = 2.8 + 0.6 * r(1)
    else if (house) total = r(1) < 0.3 ? 6.2 + 1.2 * r(2) : 3.4 + 0.8 * r(2)        // one storey mostly, two for about a third
    else if (areaM2 < 1500) total = 6.5 + 5 * r(1)
    else total = 7.5 + 4.5 * r(1)                                                    // sheds and stores: big and low
  }
  total = Math.max(total, 2.4)
  const rise = pitched ? Math.min(Math.max(0.47 * halfW, 0.8), 3.2) : 0
  // A given height is the building's whole height, roof included; a default one is its walls.
  const wallH = pitched && heightM !== null ? Math.max(2.4, total - rise) : total
  if (total >= TOWER_HEIGHT) return { wallH, roof: 'flat', rise: 0, wall: pick(TOWER_WALLS, r(3)), roofColor: pick(FLAT_ROOFS, r(4)), windows: 3, floorH: 3.9 }
  if (house) {
    return {
      wallH, roof: pitched ? (r(5) < 0.35 ? 'hip' : 'gable') : 'flat', rise,
      wall: pick(HOUSE_WALLS, r(3)), roofColor: pitched ? pick(HOUSE_ROOFS, r(4)) : pick(FLAT_ROOFS, r(4)),
      windows: areaM2 < OUTBUILDING_AREA ? 0 : 1, floorH: 3,
    }
  }
  return {
    wallH, roof: 'flat', rise: 0, wall: pick(BLOCK_WALLS, r(3)),
    roofColor: areaM2 > 1500 && !cut ? pick(BIG_ROOFS, r(4)) : pick(FLAT_ROOFS, r(4)), windows: 2, floorH: 3.4,
  }
}

/** Window cell width along a wall, metres, per window style. */
const CELL_W = [3, 3.4, 3, 2.4] as const
/** How far the walls go below the lowest ground, so sloping ground and the curve of the earth never show under them. */
export const FOUNDATION_M = 2.5
const ROOF_OVERHANG_M = 0.35
const MIN_AREA_M2 = 10
/** The window style roof surfaces carry: not a wall. */
export const ROOF_STYLE = -1

const _color = new THREE.Color()

/** Growable buffers for one tile's buildings. `facade` is (window cells across, storeys up, building seed, window style) per vertex; roofs carry ROOF_STYLE. */
export class BuildingMeshBuilder {
  readonly positions: number[] = []
  readonly normals: number[] = []
  readonly colors: number[] = []
  readonly facade: number[] = []
  readonly indices: number[] = []
  buildings = 0

  get vertexCount(): number { return this.positions.length / 3 }
  get triangleCount(): number { return this.indices.length / 3 }

  private vertex(e: number, y: number, n: number, nx: number, ny: number, nz: number, rgb: readonly [number, number, number], u: number, v: number, seed: number, style: number): number {
    this.positions.push(e, y, -n)
    this.normals.push(nx, ny, nz)
    this.colors.push(rgb[0], rgb[1], rgb[2])
    this.facade.push(u, v, seed, style)
    return this.positions.length / 3 - 1
  }

  /** A flat triangle facing up (roof surfaces): given in any order. */
  private roofTri(a: readonly [number, number, number], b: readonly [number, number, number], c: readonly [number, number, number], rgb: readonly [number, number, number], seed: number): void {
    // Points are (east, y, north); the mesh is (east, y, −north).
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = -(b[2] - a[2])
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = -(c[2] - a[2])
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz)
    if (len < 1e-9) return
    const flip = ny < 0
    if (flip) { nx = -nx; ny = -ny; nz = -nz }
    nx /= len; ny /= len; nz /= len
    const ia = this.vertex(a[0], a[1], a[2], nx, ny, nz, rgb, 0, 0, seed, ROOF_STYLE)
    const ib = this.vertex(b[0], b[1], b[2], nx, ny, nz, rgb, 0, 0, seed, ROOF_STYLE)
    const ic = this.vertex(c[0], c[1], c[2], nx, ny, nz, rgb, 0, 0, seed, ROOF_STYLE)
    if (flip) this.indices.push(ia, ic, ib)
    else this.indices.push(ia, ib, ic)
  }

  /**
   * Add one building. `pts` is its outline (east, north metres, any winding, no repeated closing point), `groundMin`
   * and `groundMax` the lowest and highest ground under it, `seed` an integer that fixes its looks.
   * Returns false when the outline is too small or degenerate to build.
   */
  add(ptsIn: readonly Pt[], groundMin: number, groundMax: number, record: Pick<BuildingRecord, 'h' | 'm' | 't'>, seed: number): boolean {
    let pts: Pt[] = []
    for (const p of ptsIn) { const q = pts[pts.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) pts.push(p) }
    if (pts.length > 1 && Math.hypot(pts[0]![0] - pts[pts.length - 1]![0], pts[0]![1] - pts[pts.length - 1]![1]) <= 0.05) pts.pop()
    if (pts.length < 3) return false
    const signed = ringArea(pts)
    const area = Math.abs(signed)
    if (!(area >= MIN_AREA_M2) || !Number.isFinite(groundMin) || !Number.isFinite(groundMax)) return false
    if (signed < 0) pts = pts.slice().reverse()
    const box = orientedBox(pts)
    const cut = record.t === 1
    const style = buildingStyle(area, record.h, seed, box.area > 0 ? area / box.area : 0, box.halfW, cut)
    const seed01 = hash01(seed, 9)
    const wallRgb = _color.setHex(style.wall, THREE.SRGBColorSpace).toArray() as [number, number, number]
    const shade = 0.9 + 0.2 * hash01(seed, 7)
    wallRgb[0] *= shade; wallRgb[1] *= shade; wallRgb[2] *= shade
    const roofRgb = _color.setHex(style.roofColor, THREE.SRGBColorSpace).toArray() as [number, number, number]
    // A part that starts above the street keeps its own base; everything else stands in the ground.
    const raised = record.m > 0.5
    const base = raised ? groundMax + Math.min(record.m, style.wallH - 1) : groundMin - FOUNDATION_M
    const top = groundMax + style.wallH
    const floors = Math.max(1, Math.round(style.wallH / style.floorH))
    const floor0 = top - floors * style.floorH
    const vAt = (y: number): number => (y - floor0) / style.floorH
    // ---- walls: one quad each, flat normals, outward for a counter-clockwise outline
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!, b = pts[(i + 1) % pts.length]!
      const de = b[0] - a[0], dn = b[1] - a[1], len = Math.hypot(de, dn)
      if (len < 0.05) continue
      const nx = dn / len, nz = de / len
      const cells = style.windows && len >= 2.2 ? Math.max(1, Math.round(len / CELL_W[style.windows])) : 0
      const st = cells ? style.windows : 0
      const i0 = this.vertex(a[0], base, a[1], nx, 0, nz, wallRgb, 0, vAt(base), seed01, st)
      const i1 = this.vertex(b[0], base, b[1], nx, 0, nz, wallRgb, cells, vAt(base), seed01, st)
      const i2 = this.vertex(b[0], top, b[1], nx, 0, nz, wallRgb, cells, vAt(top), seed01, st)
      const i3 = this.vertex(a[0], top, a[1], nx, 0, nz, wallRgb, 0, vAt(top), seed01, st)
      this.indices.push(i0, i1, i2, i0, i2, i3)
    }
    // ---- roof
    if (style.roof === 'flat') {
      const faces = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), [])
      for (const f of faces) {
        const a = pts[f[0]!]!, b = pts[f[1]!]!, c = pts[f[2]!]!
        this.roofTri([a[0], top, a[1]], [b[0], top, b[1]], [c[0], top, c[1]], roofRgb, seed01)
      }
    } else {
      const { cx, cy, ax, ay, halfL, halfW } = box
      const L = halfL + ROOF_OVERHANG_M, W = halfW + ROOF_OVERHANG_M
      // The roof's slope passes through the top of the walls, so the overhung eave hangs a little below it.
      const ridgeY = top + style.rise
      const eaveY = top - style.rise * (ROOF_OVERHANG_M / halfW)
      const ridgeHalf = style.roof === 'hip' ? Math.max(halfL - halfW, 0) : L
      const at = (s: number, t: number, y: number): [number, number, number] => [cx + s * ax - t * ay, y, cy + s * ay + t * ax]
      const e00 = at(-L, -W, eaveY), e10 = at(L, -W, eaveY), e11 = at(L, W, eaveY), e01 = at(-L, W, eaveY)
      const r0 = at(-ridgeHalf, 0, ridgeY), r1 = at(ridgeHalf, 0, ridgeY)
      this.roofTri(e00, e10, r1, roofRgb, seed01); this.roofTri(e00, r1, r0, roofRgb, seed01)
      this.roofTri(e11, e01, r0, roofRgb, seed01); this.roofTri(e11, r0, r1, roofRgb, seed01)
      // The ends: sloping roof on a hipped house, a triangle of wall under a gable.
      for (const side of [-1, 1]) {
        if (style.roof === 'hip') { this.roofTri(at(side * L, -W, eaveY), at(side * L, W, eaveY), side < 0 ? r0 : r1, roofRgb, seed01); continue }
        // A gable end is a wall: its normal points along the ridge, outward.
        const a = at(side * halfL, -halfW, top), b = at(side * halfL, halfW, top), apex = at(side * halfL, 0, ridgeY)
        const nx = side * ax, nz = -side * ay
        // Above the storeys: no windows, and none of the darkening walls get near the ground.
        const ia = this.vertex(a[0], a[1], a[2], nx, 0, nz, wallRgb, 0, floors + 1, seed01, 0)
        const ib = this.vertex(b[0], b[1], b[2], nx, 0, nz, wallRgb, 0, floors + 1, seed01, 0)
        const ic = this.vertex(apex[0], apex[1], apex[2], nx, 0, nz, wallRgb, 0, floors + 1, seed01, 0)
        if (side > 0) this.indices.push(ia, ib, ic)
        else this.indices.push(ia, ic, ib)
      }
    }
    this.buildings++
    return true
  }

  /** The finished buffers (the builder can be dropped afterwards). */
  finish(): { positions: Float32Array; normals: Float32Array; colors: Float32Array; facade: Float32Array; indices: Uint32Array } {
    return {
      positions: new Float32Array(this.positions), normals: new Float32Array(this.normals), colors: new Float32Array(this.colors),
      facade: new Float32Array(this.facade), indices: new Uint32Array(this.indices),
    }
  }
}

/** A building's outline in metres east and north of `centre`, from its record and its tile's south-west corner. */
export function footprintMetres(record: BuildingRecord, tile: Pick<BuildingTileData, 's' | 'w'>, centre: { lat: number; lon: number }, metres: { north: number; east: number }): Pt[] {
  const pts: Pt[] = []
  for (let i = 0; i + 1 < record.p.length; i += 2) {
    const lat = tile.s + record.p[i]! * 1e-6, lon = tile.w + record.p[i + 1]! * 1e-6
    pts.push([(lon - centre.lon) * metres.east, (lat - centre.lat) * metres.north])
  }
  return pts
}

/** An integer that fixes a building's looks: from where it stands, or (for a piece cut at a tile edge) from its height alone, so both pieces match. */
export function buildingSeed(record: BuildingRecord, tile: Pick<BuildingTileData, 's' | 'w'>): number {
  if (record.t === 1) return Math.round((record.h ?? 6) * 10) + 7919
  const lat = Math.round((tile.s + record.p[0]! * 1e-6) * 1e5), lon = Math.round((tile.w + record.p[1]! * 1e-6) * 1e5)
  return (Math.imul(lat, 73856093) ^ Math.imul(lon, 19349663)) | 0
}
