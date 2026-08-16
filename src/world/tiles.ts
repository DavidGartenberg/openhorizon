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
  /** Coarse rings render this many meters low so fine rings win the depth
   *  test where they overlap. A z9 tile spans ~60 km — its near edge
   *  reaches under the aircraft even when its center passes the annulus
   *  skip, and its coarse height sampling used to crest through z13/z11
   *  (found by 13b imagery, but as old as the rings). Render-only:
   *  heights/elevationAt are unbiased. */
  depthBiasM: number
}

const RINGS: Ring[] = [
  { z: 13, radiusM: 10_000, grid: 96, skirt: 45, depthBiasM: 0 },
  { z: 11, radiusM: 48_000, grid: 96, skirt: 120, depthBiasM: 0.5 },
  { z: 9, radiusM: 180_000, grid: 64, skirt: 400, depthBiasM: 6 },
  { z: 7, radiusM: 700_000, grid: 48, skirt: 1200, depthBiasM: 18 },
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
  /** Satellite imagery (13b) — near rings only (z ≥ 11). */
  imTex?: THREE.Texture
  imMat?: THREE.ShaderMaterial
  imQueued?: boolean
}

const TERRAIN_VERT = /* glsl */ `
  varying vec3 vColor;
  varying vec3 vNormal;
  varying float vDist;
  varying vec2 vUv;
  varying float vUrban;
  varying vec2 vWXZ;
  attribute vec3 color;
  attribute float urban;
  void main() {
    vColor = color;
    vUv = uv;
    vUrban = urban;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWXZ = wp.xz;
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
  uniform float uLowSun;
  uniform float uFogDensity;
  uniform sampler2D uImagery;
  uniform float uHasImagery;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying float vDist;
  varying vec2 vUv;
  varying float vUrban;
  varying vec2 vWXZ;
  void main() {
    float ndl = max(dot(normalize(vNormal), normalize(uSunDir)), 0.0);
    vec3 lit = vColor * (0.08 + 0.30 * uDayness + 0.85 * uDayness * ndl);
    // Satellite imagery (13b): the photo albedo has real-sun shading baked
    // in, so the normal term is flattened to avoid double-shading slopes;
    // the day/night curve still applies. Weighted by texture alpha (USGS
    // no-data tiles are transparent — offshore/cross-border pixels fall
    // back to the stylized ground) and faded out before the textured z11
    // ring runs out — no hard imagery seam.
    vec4 tex = texture2D(uImagery, vUv);
    vec3 litIm = tex.rgb * (0.10 + 0.40 * uDayness + 0.60 * uDayness * mix(1.0, ndl, 0.4));
    float imW = uHasImagery * tex.a * (1.0 - smoothstep(38000.0, 46000.0, vDist));
    lit = mix(lit, litIm, imW);
    // City glow (13c): NLCD developed classes emit a warm speckle at
    // night — procedural cells, NOT real light points (recorded).
    float night = clamp(1.0 - uDayness * 1.6, 0.0, 1.0);
    if (night > 0.001 && vUrban > 0.001) {
      // Sparse 12 m cells, faded in with distance: from altitude the city
      // reads as a warm point-field; near the ground it stays dark (the
      // hard cell edges would otherwise read as glowing tiles).
      vec2 cell = floor(vWXZ / 12.0);
      float h = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
      float speck = smoothstep(0.86, 0.93, h) * (0.5 + 0.5 * fract(h * 9.7));
      float far = smoothstep(150.0, 700.0, vDist);
      lit += vUrban * night * vec3(1.0, 0.72, 0.42) * (0.015 + 0.5 * speck * far);
    }
    // MSFS-look G3: sun-aware aerial perspective — the haze warms toward
    // the sun's azimuth as it drops (golden-hour terrain), stays cool
    // blue-gray away from it and at high sun.
    float sunAmt = max(dot(normalize(vWXZ - cameraPosition.xz), normalize(uSunDir.xz + vec2(1e-5))), 0.0);
    vec3 hazeDay = mix(vec3(0.60, 0.69, 0.81), vec3(1.0, 0.70, 0.42), uLowSun * pow(sunAmt, 3.0) * 0.85);
    vec3 haze = mix(vec3(0.02, 0.03, 0.05), hazeDay, uDayness);
    float fog = 1.0 - exp(-vDist * uFogDensity);
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
  // Satellite imagery (13b): per-tile material clones share the base
  // material's uniform OBJECTS for light/fog (one write updates all) and
  // its GLSL source (three compiles one program for the lot).
  private imageryOn = true
  private imLoading = 0
  private readonly imQueue: string[] = []
  private imFailStreak = 0

  constructor(
    private readonly scene: THREE.Scene,
    private readonly frame: WorldFrame,
    /** Provides runways for flattening within a lat/lon bbox. */
    private readonly runwaysInBounds: (latS: number, latN: number, lonW: number, lonE: number) => RunwayFlatten[],
  ) {
    // 1×1 white placeholder keeps uImagery a valid sampler on the base
    // (vertex-color) material; uHasImagery=0 ignores the sample.
    const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
    white.needsUpdate = true
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uDayness: { value: 1 },
        uLowSun: { value: 0 },
        uFogDensity: { value: 9e-6 },
        uImagery: { value: white },
        uHasImagery: { value: 0 },
      },
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
    })
    for (let i = 0; i < 2; i++) {
      const w = new Worker(new URL('./terrain-worker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (ev: MessageEvent<TileResponse>) => this.onTileBuilt(ev.data)
      this.workers.push(w)
    }
  }

  setLight(sunDir: THREE.Vector3, dayness: number, lowSun = 0): void {
    ;(this.material.uniforms.uSunDir!.value as THREE.Vector3).copy(sunDir)
    this.material.uniforms.uDayness!.value = dayness
    this.material.uniforms.uLowSun!.value = lowSun
  }

  /** Meteorological visibility → exponential fog (95% obscuration at the
   *  visibility distance). "10SM" is a report cap, treated as ~45 SM. */
  setVisibilityM(visM: number): void {
    this.material.uniforms.uFogDensity!.value = Math.min(Math.max(3 / Math.max(visM, 400), 4e-6), 8e-3)
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
        // NLCD biome coloring for the near rings only (z11/z13) — far rings
        // keep the elevation ramp to bound WMS load; the visual difference
        // at 60+ km is negligible under haze.
        landcoverUrl: tile.z >= 11 ? `/proxy/landcover/${z}/${x}/${y}.png` : undefined,
        gridSize: ring.grid,
        sizeEastM: tile.sizeEastM,
        sizeNorthM: tile.sizeNorthM,
        runways,
        skirtDepthM: ring.skirt,
        depthBiasM: ring.depthBiasM,
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
    geo.setAttribute('uv', new THREE.BufferAttribute(resp.uvs, 2))
    geo.setAttribute('urban', new THREE.BufferAttribute(resp.urban, 1))
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
    this.queueImagery(tile)
  }

  // ---- satellite imagery (13b) ----

  /** Toggle satellite imagery (near rings). OFF reverts every tile to the
   *  stylized vertex-color ground and frees textures. */
  setImagery(on: boolean): void {
    if (on === this.imageryOn) return
    this.imageryOn = on
    this.imFailStreak = 0
    if (on) {
      for (const t of this.tiles.values()) if (t.state === 'ready') this.queueImagery(t)
    } else {
      this.imQueue.length = 0
      for (const t of this.tiles.values()) {
        t.imQueued = false
        if (t.imMat && t.mesh) t.mesh.material = this.material
        t.imTex?.dispose()
        t.imMat?.dispose()
        t.imTex = undefined
        t.imMat = undefined
      }
    }
  }

  get imageryEnabled(): boolean {
    return this.imageryOn
  }

  /** Acceptance/debug snapshot for `__ohTiles` (13b). */
  debugImagery(probeKey?: string): Record<string, unknown> {
    let ready = 0
    let withTex = 0
    let queued = 0
    let sample: Record<string, unknown> | null = null
    const bare: string[] = []
    if (probeKey) {
      const t = this.tiles.get(probeKey)
      if (!t) return { probe: probeKey, state: 'absent' }
      const uv = t.mesh?.geometry.getAttribute('uv')
      const uvHead: number[] = []
      let uMax = -Infinity
      if (uv) {
        for (let i = 0; i < Math.min(uv.count, 4); i++) uvHead.push(+uv.getX(i).toFixed(3), +uv.getY(i).toFixed(3))
        for (let i = 0; i < uv.count; i++) if (uv.getX(i) > uMax) uMax = uv.getX(i)
      }
      const urb = t.mesh?.geometry.getAttribute('urban')
      let urbanMax = 0
      let urbanNonZero = 0
      if (urb) {
        for (let i = 0; i < urb.count; i++) {
          const v = urb.getX(i)
          if (v > urbanMax) urbanMax = v
          if (v > 0) urbanNonZero++
        }
      }
      return {
        probe: probeKey, state: t.state, hasMesh: !!t.mesh, hasTex: !!t.imTex,
        queued: !!t.imQueued,
        material: t.mesh ? (t.mesh.material === t.imMat ? 'imagery' : 'base') : 'none',
        visible: t.mesh?.visible ?? false,
        renderOrder: t.mesh?.renderOrder ?? -1,
        uvCount: uv?.count ?? 0, posCount: t.mesh?.geometry.getAttribute('position')?.count ?? 0,
        uvHead, uMax, urbanMax, urbanNonZero,
      }
    }
    for (const t of this.tiles.values()) {
      if (t.state === 'ready') ready++
      if (t.imTex) withTex++
      if (t.imQueued) queued++
      if (t.z >= 11 && t.state === 'ready' && !t.imTex && bare.length < 24) bare.push(t.key)
      if (!sample && t.imTex && t.mesh) {
        const uv = t.mesh.geometry.getAttribute('uv')
        let uMin = Infinity
        let uMax = -Infinity
        let vMin = Infinity
        let vMax = -Infinity
        if (uv) {
          for (let i = 0; i < uv.count; i++) {
            const u = uv.getX(i)
            const v = uv.getY(i)
            if (u < uMin) uMin = u
            if (u > uMax) uMax = u
            if (v < vMin) vMin = v
            if (v > vMax) vMax = v
          }
        }
        const img = t.imTex.image as { width?: number; height?: number } | undefined
        sample = {
          key: t.key,
          material: t.mesh.material === t.imMat ? 'imagery' : 'base',
          hasUv: !!uv,
          uvRange: uv ? [uMin, uMax, vMin, vMax] : null,
          imgPx: img?.width ?? 0,
          uHasImagery: t.imMat?.uniforms.uHasImagery?.value ?? null,
        }
      }
    }
    return {
      on: this.imageryOn, tiles: this.tiles.size, ready, withTex, queued,
      loading: this.imLoading, failStreak: this.imFailStreak, bare, sample,
    }
  }

  private queueImagery(tile: Tile): void {
    if (!this.imageryOn || tile.z < 11 || tile.imTex || tile.imQueued || !tile.mesh) return
    tile.imQueued = true
    this.imQueue.push(tile.key)
    this.pumpImagery()
  }

  /** 16b: z13 near-ring textures composite their four z14 children
   *  (512 px ≈ 7.6 m/px) with fallback to the single z13 tile; z11
   *  keeps single tiles. Alpha is preserved (no-coverage children stay
   *  transparent → the shader's per-pixel fallback still works). */
  private async loadImageryTexture(key: string): Promise<THREE.Texture> {
    const parts = key.split('/')
    const z = Number(parts[0])
    const x = Number(parts[1])
    const y = Number(parts[2])
    const fetchBitmap = async (u: string): Promise<ImageBitmap> => {
      const res = await fetch(u)
      if (!res.ok) throw new Error(`imagery ${u}: ${res.status}`)
      return createImageBitmap(await res.blob())
    }
    if (z === 13) {
      try {
        const kids = await Promise.all([0, 1, 2, 3].map((i) =>
          fetchBitmap(`/proxy/imagery/14/${x * 2 + (i % 2)}/${y * 2 + (i >> 1)}`)))
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 512
        const ctx = canvas.getContext('2d')!
        kids.forEach((bmp, i) => {
          ctx.drawImage(bmp, (i % 2) * 256, (i >> 1) * 256, 256, 256)
          bmp.close()
        })
        return new THREE.CanvasTexture(canvas)
      } catch {
        // fall through to the single z13 tile
      }
    }
    const bmp = await fetchBitmap(`/proxy/imagery/${key}`)
    const canvas = document.createElement('canvas')
    canvas.width = bmp.width
    canvas.height = bmp.height
    canvas.getContext('2d')!.drawImage(bmp, 0, 0)
    bmp.close()
    return new THREE.CanvasTexture(canvas)
  }

  private pumpImagery(): void {
    while (this.imLoading < 4 && this.imQueue.length > 0) {
      const key = this.imQueue.shift()!
      const tile = this.tiles.get(key)
      if (!tile || !this.imageryOn || tile.imTex) {
        if (tile) tile.imQueued = false
        continue
      }
      this.imLoading++
      this.loadImageryTexture(key)
        .then((tex) => {
          this.imLoading--
          this.imFailStreak = 0
          const t = this.tiles.get(key)
          if (!t || !this.imageryOn || t.imTex || !t.mesh) {
            tex.dispose()
          } else {
            tex.wrapS = THREE.ClampToEdgeWrapping
            tex.wrapT = THREE.ClampToEdgeWrapping
            tex.anisotropy = 4
            t.imTex = tex
            t.imMat = new THREE.ShaderMaterial({
              uniforms: {
                // Shared objects — TileManager.setLight/setVisibilityM
                // writes reach every clone through the base material.
                uSunDir: this.material.uniforms.uSunDir!,
                uDayness: this.material.uniforms.uDayness!,
                uLowSun: this.material.uniforms.uLowSun!,
                uFogDensity: this.material.uniforms.uFogDensity!,
                uImagery: { value: tex },
                uHasImagery: { value: 1 },
              },
              vertexShader: TERRAIN_VERT,
              fragmentShader: TERRAIN_FRAG,
            })
            t.mesh.material = t.imMat
          }
          if (t) t.imQueued = false
          this.pumpImagery()
        })
        .catch(() => {
          this.imLoading--
          const t = this.tiles.get(key)
          if (t) t.imQueued = false
          // Missing tiles keep their stylized look (never a black world);
          // a failure streak turns the feature off to stop hammering.
          this.imFailStreak++
          if (this.imFailStreak >= 8 && this.imageryOn) {
            this.imageryOn = false
            console.warn('[openhorizon] satellite imagery auto-off after repeated failures — stylized terrain fallback (IMAGERY ON to retry)')
          }
          this.pumpImagery()
        })
    }
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
      t.imTex?.dispose()
      t.imMat?.dispose()
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
