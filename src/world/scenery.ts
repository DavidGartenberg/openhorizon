/**
 * 3D scenery around the airplane: real buildings and trees standing on the photographed ground.
 *
 *  - Buildings come from OpenStreetMap footprints (server/osm-buildings.mjs), one z14 tile at a time within a few
 *    kilometres, built into one mesh per tile (buildings.ts) a few milliseconds per frame. Windows are drawn by the
 *    material from each wall's own layout: dark glass by day, a share of them lit at night.
 *  - Trees stand where the land cover says forest (the terrain tiles' land-cover codes, tiles.ts `coverAt`; United
 *    States only, where that data exists), as instanced low-polygon crowns per z16 cell.
 *
 * Both sit on the terrain's own heights and are placed by latitude and longitude, so they survive the floating
 * origin's rebase (`positionAll`). Airports draw their own buildings; their boxes are left empty here.
 */
import * as THREE from 'three'
import { metersPerDegree, lonToTileX, latToTileY, tileXToLon, tileYToLat } from '../math/geo'
import { patchAtmosphere } from '../render/atmosphere-materials'
import { BuildingMeshBuilder, buildingSeed, footprintMetres, hash01, type BuildingTileData } from './buildings'
import { COVER } from './nlcd-palette'

export interface SceneryBox { latS: number; latN: number; lonW: number; lonE: number }

export interface SceneryHost {
  /** Render-space position of a latitude / longitude: x east, z south, metres from the floating origin. */
  toLocal(lat: number, lon: number): { e: number; n: number }
  /** Ground height, metres above sea level (airports' levelling applied). */
  groundAt(lat: number, lon: number): number
  /** The finest terrain is loaded here, so ground heights can be trusted. */
  fineReady(lat: number, lon: number): boolean
  /** Land cover code (nlcd-palette.ts COVER). */
  coverAt(lat: number, lon: number): number
  /** A test for "an airport draws its own buildings here" (nothing is built or planted there), for points within `radiusM` of a place. */
  airportMask(lat: number, lon: number, radiusM: number): (lat: number, lon: number) => boolean
}

/** Shared by every scenery material: 0 by day … 1 at night (lit windows). */
export const sceneryUniforms = { uSceneryNight: { value: 0 }, uTreeFade: { value: new THREE.Vector2(2000, 2400) } }

export const BUILDING_Z = 14
export const TREE_Z = 16
/** Buildings are fetched within this distance of the airplane and dropped a little farther out. */
const BUILDING_RADIUS_M = 3400
const BUILDING_KEEP_M = 5200
const TREE_RADIUS_M = 2400
const TREE_KEEP_M = 3200
/** Above these heights nothing new is fetched or planted (it could not be told from the photograph). */
const BUILDING_MAX_AGL_M = 4500
const TREE_MAX_AGL_M = 2600
const TREE_SPACING_M = 11
const MAX_FETCHES = 3
const RETRY_MS = 30_000

const WINDOW_GLSL = /* glsl */ `
float sceneryHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// x: how much of this fragment is window glass; y: how much lit-window light it gives at night.
vec2 sceneryWindow(vec4 f) {
  float style = f.w;
  if (style < 0.5 || f.y < 0.0) return vec2(0.0);
  vec2 q = fract(f.xy);
  vec2 lo = style < 1.5 ? vec2(0.30, 0.34) : style < 2.5 ? vec2(0.14, 0.30) : vec2(0.05, 0.12);
  vec2 hi = style < 1.5 ? vec2(0.70, 0.76) : style < 2.5 ? vec2(0.86, 0.80) : vec2(0.95, 0.90);
  vec2 w = fwidth(f.xy) * 0.75;
  vec2 edge = smoothstep(lo - w, lo + w, q) * (1.0 - smoothstep(hi - w, hi + w, q));
  float pane = edge.x * edge.y;
  float coverage = (hi.x - lo.x) * (hi.y - lo.y);
  // Windows smaller than a couple of pixels: their average, not a shimmering pattern.
  float blur = smoothstep(0.3, 0.9, max(w.x, w.y));
  float litShare = style < 1.5 ? 0.34 : style < 2.5 ? 0.28 : 0.42;
  float lit = step(1.0 - litShare, sceneryHash(floor(f.xy) + f.z * 91.7));
  return vec2(mix(pane, coverage, blur), mix(pane * lit, coverage * litShare, blur));
}
`

function buildingMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSceneryNight = sceneryUniforms.uSceneryNight
    shader.vertexShader = 'attribute vec4 facade;\nvarying vec4 vFacade;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFacade = facade;')
    shader.fragmentShader = 'varying vec4 vFacade;\nuniform float uSceneryNight;\n' + WINDOW_GLSL + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
  vec2 sceneryWin = sceneryWindow(vFacade);
  // Walls darken toward the ground (the light a street and the neighbours take away); roofs do not.
  diffuseColor.rgb *= mix(1.0, mix(0.66, 1.0, smoothstep(-0.25, 0.7, vFacade.y)), step(-0.5, vFacade.w));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.04, 0.055, 0.07), sceneryWin.x * 0.88);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.1, sceneryWin.x);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += sceneryWin.y * uSceneryNight * vec3(1.0, 0.74, 0.42) * 1.5;')
    patchAtmosphere(shader)
  }
  m.customProgramCacheKey = () => 'scenery-buildings-v2'
  return m
}

function treeMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTreeFade = sceneryUniforms.uTreeFade
    // Trees shrink into the ground toward the edge of the planted area instead of popping in and out.
    shader.vertexShader = 'uniform vec2 uTreeFade;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  #ifdef USE_INSTANCING
    vec3 treeOrigin = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
    transformed *= 1.0 - smoothstep( uTreeFade.x, uTreeFade.y, distance( treeOrigin.xz, cameraPosition.xz ) );
  #endif`)
    patchAtmosphere(shader)
  }
  m.customProgramCacheKey = () => 'scenery-trees-v1'
  return m
}

/** A crown of unit height and unit radius standing on y = 0: smooth outward normals, darker underneath. */
function crownGeometry(kind: 'conifer' | 'broadleaf'): THREE.BufferGeometry {
  let g: THREE.BufferGeometry
  if (kind === 'broadleaf') {
    g = new THREE.IcosahedronGeometry(1, 0)
    g.scale(1, 0.5, 1); g.translate(0, 0.54, 0)
  } else {
    const lower = new THREE.ConeGeometry(1, 0.7, 6, 1, true); lower.translate(0, 0.43, 0)
    const upper = new THREE.ConeGeometry(0.62, 0.56, 6, 1, true); upper.rotateY(Math.PI / 6); upper.translate(0, 0.72, 0)
    const parts = [lower, upper].map((p) => p.toNonIndexed())
    g = new THREE.BufferGeometry()
    const pos = new Float32Array(parts.reduce((n, p) => n + p.getAttribute('position').array.length, 0))
    let o = 0
    for (const p of parts) { pos.set(p.getAttribute('position').array as Float32Array, o); o += p.getAttribute('position').array.length; p.dispose() }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    lower.dispose(); upper.dispose()
  }
  const pos = g.getAttribute('position')
  const normals = new Float32Array(pos.count * 3), colors = new Float32Array(pos.count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const shade = 0.5 + 0.5 * THREE.MathUtils.smoothstep(v.y, 0.1, 0.85)
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = shade
    // Outward from the trunk line, tilted up: reads as a rounded mass under the sun.
    v.set(v.x, kind === 'broadleaf' ? (v.y - 0.5) * 2 : 0.55, v.z).normalize()
    normals[i * 3] = v.x; normals[i * 3 + 1] = v.y; normals[i * 3 + 2] = v.z
  }
  g.deleteAttribute('normal'); g.deleteAttribute('uv')
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return g
}

/** Share of grid points that get a tree, by land cover. */
const TREE_DENSITY: Record<number, number> = {
  [COVER.deciduous]: 0.85, [COVER.evergreen]: 0.92, [COVER.mixed]: 0.88, [COVER.woodyWetland]: 0.6, [COVER.devOpen]: 0.1,
}
/** Share of the trees that are conifers, by land cover. */
const CONIFER_SHARE: Record<number, number> = {
  [COVER.deciduous]: 0.08, [COVER.evergreen]: 0.9, [COVER.mixed]: 0.5, [COVER.woodyWetland]: 0.2, [COVER.devOpen]: 0.3,
}

export interface TreeSpec { lat: number; lon: number; conifer: boolean; heightM: number; radiusM: number; tint: number }

/**
 * The trees of one cell: a jittered grid, each point kept by its land cover's density. Pure and deterministic — the
 * same cell always grows the same trees.
 */
export function plantCell(box: SceneryBox, coverAt: (lat: number, lon: number) => number, spacingM = TREE_SPACING_M): TreeSpec[] {
  const m = metersPerDegree((box.latS + box.latN) / 2)
  const nx = Math.max(1, Math.round(((box.lonE - box.lonW) * m.east) / spacingM)), ny = Math.max(1, Math.round(((box.latN - box.latS) * m.north) / spacingM))
  const base = (Math.imul(Math.round(box.latS * 1e4), 73856093) ^ Math.imul(Math.round(box.lonW * 1e4), 19349663)) | 0
  const out: TreeSpec[] = []
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const seed = (base + Math.imul(j, 4099) + i) | 0
      const lat = box.latS + ((j + 0.15 + 0.7 * hash01(seed, 1)) / ny) * (box.latN - box.latS)
      const lon = box.lonW + ((i + 0.15 + 0.7 * hash01(seed, 2)) / nx) * (box.lonE - box.lonW)
      const cover = coverAt(lat, lon)
      const density = TREE_DENSITY[cover]
      if (!density || hash01(seed, 3) > density) continue
      const conifer = hash01(seed, 4) < (CONIFER_SHARE[cover] ?? 0)
      const size = hash01(seed, 5)
      const heightM = conifer ? 13 + 13 * size : 8 + 9 * size
      out.push({ lat, lon, conifer, heightM, radiusM: heightM * (conifer ? 0.2 + 0.05 * hash01(seed, 6) : 0.42 + 0.14 * hash01(seed, 6)), tint: hash01(seed, 7) })
    }
  }
  return out
}

interface BuildingTile {
  key: string; x: number; y: number
  lat: number; lon: number
  box: SceneryBox
  state: 'fetching' | 'data' | 'building' | 'ready' | 'failed'
  data?: BuildingTileData
  mesh?: THREE.Mesh
  retryAt: number
  buildings: number
}

interface TreeCell { key: string; lat: number; lon: number; box: SceneryBox; state: 'waiting' | 'ready'; meshes: THREE.InstancedMesh[]; trees: number }

const boxOf = (z: number, x: number, y: number): SceneryBox => ({ latS: tileYToLat(y + 1, z), latN: tileYToLat(y, z), lonW: tileXToLon(x, z), lonE: tileXToLon(x + 1, z) })

export class Scenery {
  buildingsOn = true
  treesOn = true
  private readonly tiles = new Map<string, BuildingTile>()
  private readonly cells = new Map<string, TreeCell>()
  private readonly material = buildingMaterial()
  private readonly treeMat = treeMaterial()
  private readonly crowns = { conifer: crownGeometry('conifer'), broadleaf: crownGeometry('broadleaf') }
  private fetching = 0
  private job: Generator<void, void, void> | null = null
  private failures = 0
  private disposed = false

  constructor(private readonly scene: THREE.Scene, private readonly host: SceneryHost, private readonly fetchJson: (url: string) => Promise<BuildingTileData> = async (url) => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url}: ${res.status}`)
    return await res.json() as BuildingTileData
  }) {}

  /** Distance from a point to the nearest part of a box, metres. */
  private static distanceToBox(b: SceneryBox, lat: number, lon: number): number {
    const m = metersPerDegree(lat)
    const dLat = Math.max(b.latS - lat, 0, lat - b.latN), dLon = Math.max(b.lonW - lon, 0, lon - b.lonE)
    return Math.hypot(dLat * m.north, dLon * m.east)
  }

  /** Call every frame with the airplane's position: fetches, builds (within `budgetMs`) and drops scenery. */
  update(lat: number, lon: number, aglM: number, nowMs: number, budgetMs = 3): void {
    if (this.disposed) return
    this.updateBuildings(lat, lon, aglM, nowMs)
    this.updateTrees(lat, lon, aglM)
    const until = performance.now() + budgetMs
    while (performance.now() < until) {
      if (!this.job) this.job = this.nextJob()
      if (!this.job) break
      if (this.job.next().done) this.job = null
    }
  }

  private updateBuildings(lat: number, lon: number, aglM: number, nowMs: number): void {
    if (!this.buildingsOn) { for (const t of [...this.tiles.values()]) this.dropTile(t); return }
    const cx = Math.floor(lonToTileX(lon, BUILDING_Z)), cy = Math.floor(latToTileY(lat, BUILDING_Z))
    const wanted: Array<{ x: number; y: number; d: number }> = []
    if (aglM < BUILDING_MAX_AGL_M) {
      for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) {
        const d = Scenery.distanceToBox(boxOf(BUILDING_Z, x, y), lat, lon)
        if (d <= BUILDING_RADIUS_M) wanted.push({ x, y, d })
      }
    }
    wanted.sort((a, b) => a.d - b.d)
    for (const w of wanted) {
      const key = `${w.x}/${w.y}`
      let t = this.tiles.get(key)
      if (t?.state === 'failed' && nowMs >= t.retryAt) { this.tiles.delete(key); t = undefined }
      if (t || this.fetching >= MAX_FETCHES) continue
      const box = boxOf(BUILDING_Z, w.x, w.y)
      const tile: BuildingTile = { key, x: w.x, y: w.y, lat: (box.latS + box.latN) / 2, lon: (box.lonW + box.lonE) / 2, box, state: 'fetching', retryAt: 0, buildings: 0 }
      this.tiles.set(key, tile)
      this.fetching++
      this.fetchJson(`/api/osm-buildings/${BUILDING_Z}/${w.x}/${w.y}.json`).then((data) => {
        if (this.tiles.get(key) !== tile) return
        if (!data || !Array.isArray(data.b)) throw new Error('bad building tile')
        tile.data = data; tile.state = 'data'
      }).catch(() => {
        if (this.tiles.get(key) !== tile) return
        this.failures++
        tile.state = 'failed'; tile.retryAt = performance.now() + RETRY_MS
      }).finally(() => { this.fetching-- })
    }
    for (const t of [...this.tiles.values()]) if (Scenery.distanceToBox(t.box, lat, lon) > BUILDING_KEEP_M) this.dropTile(t)
  }

  private updateTrees(lat: number, lon: number, aglM: number): void {
    if (!this.treesOn) { for (const c of [...this.cells.values()]) this.dropCell(c); return }
    if (aglM < TREE_MAX_AGL_M) {
      const cx = Math.floor(lonToTileX(lon, TREE_Z)), cy = Math.floor(latToTileY(lat, TREE_Z))
      const reach = 8
      for (let y = cy - reach; y <= cy + reach; y++) for (let x = cx - reach; x <= cx + reach; x++) {
        const key = `${x}/${y}`
        if (this.cells.has(key)) continue
        const box = boxOf(TREE_Z, x, y)
        if (Scenery.distanceToBox(box, lat, lon) > TREE_RADIUS_M) continue
        this.cells.set(key, { key, lat: (box.latS + box.latN) / 2, lon: (box.lonW + box.lonE) / 2, box, state: 'waiting', meshes: [], trees: 0 })
      }
    }
    for (const c of [...this.cells.values()]) if (Scenery.distanceToBox(c.box, lat, lon) > TREE_KEEP_M) this.dropCell(c)
  }

  /** The next piece of building work: a tile whose data and terrain are both in, else a cell of trees. */
  private nextJob(): Generator<void, void, void> | null {
    for (const t of this.tiles.values()) if (t.state === 'data' && this.host.fineReady(t.lat, t.lon)) return this.buildTile(t)
    for (const c of this.cells.values()) if (c.state === 'waiting' && this.host.fineReady(c.lat, c.lon)) return this.plant(c)
    return null
  }

  private *buildTile(tile: BuildingTile): Generator<void, void, void> {
    tile.state = 'building'
    const data = tile.data!
    const centre = { lat: tile.lat, lon: tile.lon }
    const metres = metersPerDegree(centre.lat)
    const onAirport = this.host.airportMask(centre.lat, centre.lon, 8000)
    const builder = new BuildingMeshBuilder()
    let n = 0
    for (const record of data.b) {
      if (this.tiles.get(tile.key) !== tile) return
      const pts = footprintMetres(record, data, centre, metres)
      if (pts.length < 3) continue
      let cE = 0, cN = 0
      for (const p of pts) { cE += p[0]; cN += p[1] }
      cE /= pts.length; cN /= pts.length
      const cLat = centre.lat + cN / metres.north, cLon = centre.lon + cE / metres.east
      if (onAirport(cLat, cLon)) continue
      // The ground under the building: its centre and up to eight points of its outline.
      let lo = this.host.groundAt(cLat, cLon), hi = lo
      const step = Math.max(1, Math.ceil(pts.length / 8))
      for (let i = 0; i < pts.length; i += step) {
        const g = this.host.groundAt(centre.lat + pts[i]![1] / metres.north, centre.lon + pts[i]![0] / metres.east)
        if (g < lo) lo = g; if (g > hi) hi = g
      }
      // A building is level: on steep ground it stands on its uphill side only as far as a storey or two.
      builder.add(pts, lo, Math.min(hi, lo + 6), record, buildingSeed(record, data))
      if (++n % 40 === 0) yield
    }
    tile.data = undefined
    if (this.tiles.get(tile.key) !== tile) return
    if (builder.buildings > 0) {
      const b = builder.finish()
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(b.positions, 3))
      g.setAttribute('normal', new THREE.BufferAttribute(b.normals, 3))
      g.setAttribute('color', new THREE.BufferAttribute(b.colors, 3))
      g.setAttribute('facade', new THREE.BufferAttribute(b.facade, 4))
      g.setIndex(new THREE.BufferAttribute(b.indices, 1))
      g.computeBoundingSphere()
      const mesh = new THREE.Mesh(g, this.material)
      mesh.name = `buildings:${tile.key}`
      mesh.matrixAutoUpdate = false
      tile.mesh = mesh
      this.place(mesh, tile.lat, tile.lon)
      this.scene.add(mesh)
    }
    tile.buildings = builder.buildings
    tile.state = 'ready'
  }

  private *plant(cell: TreeCell): Generator<void, void, void> {
    const onAirport = this.host.airportMask(cell.lat, cell.lon, 6000)
    const trees = plantCell(cell.box, (lat, lon) => (onAirport(lat, lon) ? 0 : this.host.coverAt(lat, lon)))
    yield
    if (this.cells.get(cell.key) !== cell) return
    const metres = metersPerDegree(cell.lat)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(), p = new THREE.Vector3(), color = new THREE.Color()
    for (const kind of ['conifer', 'broadleaf'] as const) {
      const list = trees.filter((t) => t.conifer === (kind === 'conifer'))
      if (!list.length) continue
      const mesh = new THREE.InstancedMesh(this.crowns[kind], this.treeMat, list.length)
      mesh.name = `trees:${cell.key}:${kind}`
      let maxR = 0
      list.forEach((t, i) => {
        const e = (t.lon - cell.lon) * metres.east, n = (t.lat - cell.lat) * metres.north
        // Sunk a little, so no crown hangs over a slope.
        p.set(e, this.host.groundAt(t.lat, t.lon) - 0.4, -n)
        q.setFromAxisAngle(up, t.tint * Math.PI * 2)
        s.set(t.radiusM, t.heightM, t.radiusM)
        mesh.setMatrixAt(i, m.compose(p, q, s))
        // Conifers dark and blue-green, broadleaves from olive to a yellower green.
        if (kind === 'conifer') color.setRGB(0.05 + 0.025 * t.tint, 0.095 + 0.035 * t.tint, 0.055 + 0.02 * t.tint)
        else color.setRGB(0.075 + 0.05 * t.tint, 0.125 + 0.05 * t.tint, 0.045 + 0.02 * t.tint)
        mesh.setColorAt(i, color)
        maxR = Math.max(maxR, Math.hypot(e, n) + t.heightM)
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      // Heights span the cell's whole relief; a generous sphere avoids a bounds pass over every instance.
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, p.y, 0), maxR + 400)
      mesh.matrixAutoUpdate = false
      this.place(mesh, cell.lat, cell.lon)
      this.scene.add(mesh)
      cell.meshes.push(mesh)
      yield
    }
    cell.trees = trees.length
    cell.state = 'ready'
  }

  private place(o: THREE.Object3D, lat: number, lon: number): void {
    const l = this.host.toLocal(lat, lon)
    o.position.set(l.e, 0, -l.n)
    o.updateMatrix()
  }

  /** After the floating origin moved: everything back to where its latitude and longitude now are. */
  positionAll(): void {
    for (const t of this.tiles.values()) if (t.mesh) this.place(t.mesh, t.lat, t.lon)
    for (const c of this.cells.values()) for (const mesh of c.meshes) this.place(mesh, c.lat, c.lon)
  }

  private dropTile(t: BuildingTile): void {
    this.tiles.delete(t.key)
    if (t.mesh) { this.scene.remove(t.mesh); t.mesh.geometry.dispose() }
  }

  private dropCell(c: TreeCell): void {
    this.cells.delete(c.key)
    for (const mesh of c.meshes) { this.scene.remove(mesh); mesh.dispose() }
  }

  stats(): { buildingTiles: number; ready: number; fetching: number; failed: number; failures: number; buildings: number; treeCells: number; trees: number; triangles: number } {
    let ready = 0, failed = 0, buildings = 0, triangles = 0, trees = 0
    for (const t of this.tiles.values()) {
      if (t.state === 'ready') ready++
      if (t.state === 'failed') failed++
      buildings += t.buildings
      if (t.mesh) triangles += (t.mesh.geometry.index?.count ?? 0) / 3
    }
    for (const c of this.cells.values()) {
      trees += c.trees
      for (const mesh of c.meshes) triangles += mesh.count * ((mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3)
    }
    return { buildingTiles: this.tiles.size, ready, fetching: this.fetching, failed, failures: this.failures, buildings, treeCells: this.cells.size, trees, triangles }
  }

  /** Where the first few meshes are (verification). */
  debug(): Array<{ name: string; position: number[]; centre: number[]; radius: number; triangles: number; inScene: boolean }> {
    const meshes: THREE.Mesh[] = [...[...this.tiles.values()].flatMap((t) => (t.mesh ? [t.mesh] : [])), ...[...this.cells.values()].flatMap((c) => c.meshes)]
    return meshes.slice(0, 4).concat(meshes.filter((m) => m.name.startsWith('trees')).slice(0, 3)).map((m) => {
      const sphere = (m as THREE.InstancedMesh).boundingSphere ?? m.geometry.boundingSphere
      return {
        name: m.name, position: m.position.toArray().map((v) => Math.round(v)), centre: sphere ? sphere.center.toArray().map((v) => Math.round(v)) : [],
        radius: Math.round(sphere?.radius ?? 0), triangles: (m.geometry.index?.count ?? m.geometry.getAttribute('position').count) / 3, inScene: m.parent === this.scene,
      }
    })
  }

  dispose(): void {
    this.disposed = true
    for (const t of [...this.tiles.values()]) this.dropTile(t)
    for (const c of [...this.cells.values()]) this.dropCell(c)
    this.material.dispose(); this.treeMat.dispose()
    this.crowns.conifer.dispose(); this.crowns.broadleaf.dispose()
  }
}
