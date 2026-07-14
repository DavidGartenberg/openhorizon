import * as THREE from 'three'
import {
  lonToTileX, latToTileY, tileXToLon, tileYToLat, toNedMeters, fromNedMeters,
  metersPerDegree, sampleGrid, type LatLon,
} from '../math/geo'
import type { TileResponse } from './terrain-worker'

/** Floating-origin world frame (§4.3): NED meters around a movable anchor. */
export class WorldFrame {
  anchor: LatLon
  constructor(anchor: LatLon) {
    this.anchor = { ...anchor }
  }
  toLocal(lat: number, lon: number): { n: number; e: number } {
    const r = toNedMeters(lat, lon, this.anchor)
    return { n: r.north, e: r.east }
  }
  fromLocal(n: number, e: number): LatLon {
    return fromNedMeters(n, e, this.anchor)
  }
}

interface Ring {
  z: number
  radiusM: number
  grid: number
  skirt: number
}

const RINGS: Ring[] = [
  { z: 13, radiusM: 10_000, grid: 96, skirt: 45 },
  { z: 11, radiusM: 48_000, grid: 96, skirt: 120 },
  { z: 9, radiusM: 180_000, grid: 64, skirt: 400 },
  { z: 7, radiusM: 700_000, grid: 48, skirt: 1200 },
]

export interface RunwayFlatten {
  la1: number
  lo1: number
  la2: number
  lo2: number
  e1M: number
  e2M: number
  halfWidthM: number
}

interface Tile {
  key: string
  z: number
  latC: number
  lonC: number
  latN: number
  latS: number
  lonW: number
  lonE: number
  sizeEastM: number
  sizeNorthM: number
  mesh?: THREE.Mesh
  heights?: Float32Array
  gridSize?: number
  state: 'loading' | 'ready' | 'failed'
  lastWanted: number
}

const TERRAIN_VERT = /* glsl */ `
  varying vec3 vColor;
  varying vec3 vNormal;
  varying float vDist;
  attribute vec3 color;
  void main() {
    vColor = color;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float dx = wp.x - cameraPosition.x;
    float dz = wp.z - cameraPosition.z;
    float d2 = dx*dx + dz*dz;
    wp.y -= d2 / (2.0 * 6371000.0); // earth curvature drop
    vDist = sqrt(d2);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`
const TERRAIN_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uDayness;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying float vDist;
  void main() {
    float ndl = max(dot(normalize(vNormal), normalize(uSunDir)), 0.0);
    vec3 lit = vColor * (0.08 + 0.30 * uDayness + 0.85 * uDayness * ndl);
    vec3 haze = mix(vec3(0.02, 0.03, 0.05), vec3(0.63, 0.71, 0.82), uDayness);
    float fog = 1.0 - exp(-vDist * 9e-6);
    gl_FragColor = vec4(mix(lit, haze, fog * 0.85), 1.0);
  }
`

export class TileManager {
  private readonly tiles = new Map<string, Tile>()
  private readonly workers: Worker[] = []
  private nextWorker = 0
  private inFlight = 0
  private readonly queue: Tile[] = []
  readonly material: THREE.ShaderMaterial
  private lastUpdatePos = { n: Infinity, e: Infinity }
  private stamp = 0

  constructor(
    private readonly scene: THREE.Scene,
    private readonly frame: WorldFrame,
    /** Provides runways for flattening within a lat/lon bbox. */
    private readonly runwaysInBounds: (latS: number, latN: number, lonW: number, lonE: number) => RunwayFlatten[],
  ) {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uDayness: { value: 1 } },
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
    })
    for (let i = 0; i < 2; i++) {
      const w = new Worker(new URL('./terrain-worker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (ev: MessageEvent<TileResponse>) => this.onTileBuilt(ev.data)
      this.workers.push(w)
    }
  }

  setLight(sunDir: THREE.Vector3, dayness: number): void {
    ;(this.material.uniforms.uSunDir!.value as THREE.Vector3).copy(sunDir)
    this.material.uniforms.uDayness!.value = dayness
  }

  /** Call regularly with the aircraft position (frame-local NED meters). */
  update(nedN: number, nedE: number): void {
    const moved = Math.hypot(nedN - this.lastUpdatePos.n, nedE - this.lastUpdatePos.e)
    if (moved < 400 && this.stamp > 0) return
    this.lastUpdatePos = { n: nedN, e: nedE }
    this.stamp++
    const pos = this.frame.fromLocal(nedN, nedE)

    for (const ring of RINGS) {
      const tx = lonToTileX(pos.lon, ring.z)
      const ty = latToTileY(pos.lat, ring.z)
      const sizeM = (Math.cos((pos.lat * Math.PI) / 180) * 40_075_017) / 2 ** ring.z
      const span = Math.ceil(ring.radiusM / sizeM)
      for (let dy = -span; dy <= span; dy++) {
        for (let dx = -span; dx <= span; dx++) {
          const x = Math.floor(tx) + dx
          const y = Math.floor(ty) + dy
          const cLat = tileYToLat(y + 0.5, ring.z)
          const cLon = tileXToLon(x + 0.5, ring.z)
          const d = this.frame.toLocal(cLat, cLon)
          const dist = Math.hypot(d.n - nedN, d.e - nedE)
          if (dist > ring.radiusM + sizeM) continue
          // Annulus: skip if a higher-resolution ring owns this area.
          const prev = RINGS[RINGS.indexOf(ring) - 1]
          if (prev && dist + sizeM * 0.5 < prev.radiusM * 0.82) continue
          this.want(ring, x, y)
        }
      }
    }
    this.evict(nedN, nedE)
    this.pump()
  }

  private want(ring: Ring, x: number, y: number): void {
    const key = `${ring.z}/${x}/${y}`
    const existing = this.tiles.get(key)
    if (existing) {
      existing.lastWanted = this.stamp
      return
    }
    const latN = tileYToLat(y, ring.z)
    const latS = tileYToLat(y + 1, ring.z)
    const lonW = tileXToLon(x, ring.z)
    const lonE = tileXToLon(x + 1, ring.z)
    const latC = (latN + latS) / 2
    const lonC = (lonW + lonE) / 2
    const m = metersPerDegree(latC)
    const tile: Tile = {
      key, z: ring.z, latC, lonC, latN, latS, lonW, lonE,
      sizeEastM: (lonE - lonW) * m.east,
      sizeNorthM: (latN - latS) * m.north,
      state: 'loading',
      lastWanted: this.stamp,
    }
    this.tiles.set(key, tile)
    this.queue.push(tile)
  }

  private pump(): void {
    while (this.inFlight < 8 && this.queue.length > 0) {
      const tile = this.queue.shift()!
      if (!this.tiles.has(tile.key)) continue
      const ring = RINGS.find((r) => r.z === tile.z)!
      const m = metersPerDegree(tile.latC)
      const runways = this.runwaysInBounds(tile.latS - 0.02, tile.latN + 0.02, tile.lonW - 0.02, tile.lonE + 0.02)
        .map((rw) => ({
          ax: (rw.lo1 - tile.lonC) * m.east,
          ay: (rw.la1 - tile.latC) * m.north,
          bx: (rw.lo2 - tile.lonC) * m.east,
          by: (rw.la2 - tile.latC) * m.north,
          ha: rw.e1M,
          hb: rw.e2M,
          halfW: rw.halfWidthM,
        }))
      this.inFlight++
      const worker = this.workers[this.nextWorker++ % this.workers.length]!
      const [z, x, y] = tile.key.split('/')
      worker.postMessage({
        key: tile.key,
        url: `/proxy/terrain/${z}/${x}/${y}.png`,
        gridSize: ring.grid,
        sizeEastM: tile.sizeEastM,
        sizeNorthM: tile.sizeNorthM,
        runways,
        skirtDepthM: ring.skirt,
      })
    }
  }

  private onTileBuilt(resp: TileResponse): void {
    this.inFlight--
    this.pump()
    const tile = this.tiles.get(resp.key)
    if (!tile) return
    if (resp.error) {
      tile.state = 'failed'
      return
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(resp.positions, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(resp.normals, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(resp.colors, 3))
    geo.setIndex(new THREE.BufferAttribute(resp.indices, 1))
    const mesh = new THREE.Mesh(geo, this.material)
    mesh.frustumCulled = true
    // Lower zooms render first (underneath overlapping high-res tiles).
    mesh.renderOrder = tile.z
    tile.mesh = mesh
    tile.heights = resp.heights
    tile.gridSize = resp.gridSize
    tile.state = 'ready'
    this.placeTile(tile)
    this.scene.add(mesh)
  }

  private placeTile(tile: Tile): void {
    if (!tile.mesh) return
    const p = this.frame.toLocal(tile.latC, tile.lonC)
    tile.mesh.position.set(p.e, 0, -p.n)
  }

  /** Reposition every tile after an anchor rebase. */
  onRebase(): void {
    for (const tile of this.tiles.values()) this.placeTile(tile)
    this.lastUpdatePos = { n: Infinity, e: Infinity }
  }

  private evict(nedN: number, nedE: number): void {
    if (this.tiles.size < 340) return
    const candidates = [...this.tiles.values()]
      .filter((t) => t.lastWanted < this.stamp)
      .sort((a, b) => {
        const da = this.frame.toLocal(a.latC, a.lonC)
        const db = this.frame.toLocal(b.latC, b.lonC)
        return (
          Math.hypot(db.n - nedN, db.e - nedE) - Math.hypot(da.n - nedN, da.e - nedE)
        )
      })
    for (const t of candidates.slice(0, this.tiles.size - 300)) {
      if (t.mesh) {
        this.scene.remove(t.mesh)
        t.mesh.geometry.dispose()
      }
      this.tiles.delete(t.key)
    }
  }

  /** Terrain elevation (m MSL) at lat/lon from the best loaded tile. */
  elevationAt(lat: number, lon: number): number {
    for (const ring of RINGS) {
      const x = Math.floor(lonToTileX(lon, ring.z))
      const y = Math.floor(latToTileY(lat, ring.z))
      const tile = this.tiles.get(`${ring.z}/${x}/${y}`)
      if (tile?.state === 'ready' && tile.heights && tile.gridSize) {
        const fx = (lon - tile.lonW) / (tile.lonE - tile.lonW)
        const fy = (tile.latN - lat) / (tile.latN - tile.latS)
        const h = sampleGrid(tile.heights, tile.gridSize, fx, fy)
        // Flaky decode → non-finite sample: fall through to a coarser ring.
        if (Number.isFinite(h)) return h
      }
    }
    return 0
  }

  get readyCount(): number {
    let n = 0
    for (const t of this.tiles.values()) if (t.state === 'ready') n++
    return n
  }
}
