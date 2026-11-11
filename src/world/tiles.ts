import * as THREE from 'three'
import { SKY_LOOKUP } from '../render/atmosphere-shader'
import { loadDetailedImagery } from './imagery-detail'
import {
  lonToTileX, latToTileY, tileXToLon, tileYToLat, toNedMeters, fromNedMeters,
  metersPerDegree, type LatLon,
} from '../math/geo'
import { cloudShadowUniforms, CLOUD_SHADOW_GLSL } from '../render/cloud-shadows'
import { snowUniforms, wetnessUniforms } from '../render/wetness'
import { TerrainCoverage, TERRAIN_COVERAGE_GLSL, sampleTerrainTriangles } from './terrain-coverage'
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
  /** Kept in the worker protocol; READY coverage now resolves overlap. */
  depthBiasM: number
}

/** How many of the finest tiles nearest the airplane wear the detailed (z16) photograph: the block of four around it, so the
 *  ground is sharp in every direction. Each is a 2048² texture (about 21 MB with its mipmaps). */
const DETAIL_TILES = 4

const RINGS: Ring[] = [
  { z: 13, radiusM: 10_000, grid: 96, skirt: 45, depthBiasM: 0 },
  { z: 11, radiusM: 48_000, grid: 96, skirt: 120, depthBiasM: 0 },
  { z: 9, radiusM: 180_000, grid: 64, skirt: 400, depthBiasM: 0 },
  { z: 7, radiusM: 700_000, grid: 48, skirt: 1200, depthBiasM: 0 },
]

export interface RunwayFlatten {
  la1: number
  lo1: number
  la2: number
  lo2: number
  e1M: number
  e2M: number
  halfWidthM: number
  /** An airport's level disk (a zero-length runway): never lifts open water. */
  disk?: boolean
  /** Not a runway: a circle (centre la1, lo1; radius halfWidthM) of land below sea level, where the elevation data's negative heights are kept instead of being clamped to sea. */
  lowland?: boolean
  /** A run of land (a stretch of a reclaimed field's pavement): levelled only where the elevation data says sea. */
  land?: boolean
}

interface Tile {
  key: string
  requestId: number
  baseMat?: THREE.ShaderMaterial
  coverage?: TerrainCoverage
  coverageTexture?: THREE.DataTexture
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
  /** Land-cover codes of the finest ring's tiles (terrain-worker.ts `cover`). */
  cover?: Uint8Array
  coverSize?: number
  state: 'loading' | 'ready' | 'failed'
  lastWanted: number
  /** Satellite imagery (13b) — near rings only (z ≥ 11). */
  imTex?: THREE.Texture
  detailTex?: THREE.Texture
  imMat?: THREE.ShaderMaterial
  imQueued?: boolean
}

const TERRAIN_VERT = /* glsl */ `
  uniform vec2 uNormalScale;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying float vDist, vCloudDepth;
  varying vec2 vUv;
  varying float vUrban;
  varying vec2 vWXZ;
  varying float vAltitude;
  attribute vec3 color;
  attribute float urban;
  void main() {
    vColor = color;
    vUv = uv;
    vUrban = urban;
    vNormal = normalize(mat3(modelMatrix) * (normal * vec3(uNormalScale.x, 1.0, uNormalScale.y)));
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWXZ = wp.xz;
    vAltitude = wp.y;
    float dx = wp.x - cameraPosition.x;
    float dz = wp.z - cameraPosition.z;
    float d2 = dx*dx + dz*dz;
    wp.y -= d2 / (2.0 * 6371000.0); // earth curvature drop
    vDist = sqrt(d2);
    vCloudDepth = -(viewMatrix * wp).z;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`
const TERRAIN_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uDayness, uLowSun, uFogDensity, uHasImagery, uSunTransmission, uCloudDensity, uWet, uSnow;
  uniform vec3 uCloudColor;
  uniform sampler2D uImagery, uSky;
  uniform vec2 uWorldOffset;
  varying vec3 vColor, vNormal;
  varying float vDist, vUrban, vAltitude, vCloudDepth;
  varying vec2 vUv, vWXZ;
  ${SKY_LOOKUP}
  ${TERRAIN_COVERAGE_GLSL}
  ${CLOUD_SHADOW_GLSL}
  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx)*0.1031);
    p3 += dot(p3,p3.yzx+33.33);
    return fract((p3.x+p3.y)*p3.z);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
      mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
  }
  // Ground relief in metres, from the wavelengths a pixel can still resolve (each octave fades out as its wavelength
  // approaches the pixel footprint, so distant ground goes smooth instead of shimmering). Slopes are ~equal per octave.
  float terrainRelief(vec2 g, float footprint, float amplitude) {
    float h = 0.0;
    float freq = 0.045;
    for (int i = 0; i < 5; i++) {
      float fade = 1.0 - smoothstep(0.3, 0.75, footprint * freq);
      h += (noise(g * freq + float(i) * 7.3) - 0.5) * (amplitude / freq) * fade;
      freq *= 2.6;
    }
    return h;
  }
  void main() {
    if (coveredByReadyTerrain(vUv)) discard;
    vec2 ground = vWXZ + uWorldOffset;
    float footprint = max(length(dFdx(ground)),length(dFdy(ground)));
    vec3 worldP = vec3(vWXZ.x, vAltitude, vWXZ.y);
    vec3 baseN = normalize(vNormal);
    vec4 tex = texture2D(uImagery,vUv);
    float imW = uHasImagery*tex.a*(1.0-smoothstep(38000.0,46000.0,vDist));
    // Surface-gradient bump (no tangents needed): the relief tilts the normal, so the sun finds small slopes. A photo already
    // carries its own shading, so over imagery only a little is added.
    // Ground that is exactly level (an airfield's pad, a polder) is graded, not natural: it gets a fraction of the relief.
    float graded = smoothstep(0.9995, 0.99999, baseN.y);
    float relief = terrainRelief(ground, footprint, mix(0.30, 0.12, imW) * mix(1.0, 0.25, graded));
    vec3 dpx = dFdx(worldP), dpy = dFdy(worldP);
    vec3 r1 = cross(dpy, baseN), r2 = cross(baseN, dpx);
    float det = dot(dpx, r1);
    vec3 nrm = normalize(abs(det) * baseN - sign(det) * (dFdx(relief) * r1 + dFdy(relief) * r2) + baseN * 1e-9);
    float ndl = max(dot(nrm,normalize(uSunDir)),0.0);
    vec3 sunTint = vec3(1.0,1.0-0.35*uLowSun,1.0-0.65*uLowSun);
    // Vertex palette is authored as display RGB; imagery is tagged sRGB
    // on upload and is decoded by the texture sampler into linear light.
    vec3 albedo = pow(max(vColor,vec3(0)),vec3(2.2));
    // Steep ground sheds its cover: rock and bare soil, only where there is no photograph to say otherwise.
    float steep = smoothstep(0.28, 0.62, 1.0 - baseN.y) * (1.0 - imW);
    vec3 rock = vec3(0.30,0.27,0.24) * (0.75 + 0.5 * noise(ground * 0.05)) * (0.8 + 0.4 * noise(ground * 0.31));
    albedo = mix(albedo, rock, steep * 0.75);
    // Broad colour drift (fields, scrub, forest patches) at two scales, warm to cool, so flat ground is not one tone.
    float drift = noise(ground * 0.0045 + 3.7) - 0.5;
    float drift2 = noise(ground * 0.0012 + 11.3) - 0.5;
    albedo *= vec3(1.0 + 0.16 * drift + 0.10 * drift2, 1.0 + 0.05 * drift, 1.0 - 0.18 * drift - 0.10 * drift2) * (1.0 - 0.1 * imW);
    albedo = mix(albedo,tex.rgb,imW);
    float macro = noise(ground*0.018);
    float detail = noise(ground*0.7);
    float nearDetail = (1.0-smoothstep(1.0,5.0,footprint));
    // Broad biome variation is suppressed on photos; fine grain fades by
    // pixel footprint, keeping low passes detailed and distant hills stable.
    albedo *= mix(0.82+0.36*macro,1.0,imW*0.9);
    albedo *= 1.0+(detail-0.5)*0.16*nearDetail;
    // Rain-soaked ground is darker and a little richer in colour (less so over a photograph, which was taken in whatever weather it was).
    float wetLuma = dot(albedo, vec3(0.2126,0.7152,0.0722));
    albedo = mix(vec3(wetLuma), albedo, 1.0 + 0.3 * uWet);
    albedo *= 1.0 - 0.3 * uWet * (1.0 - 0.4 * imW);
    // Snow lies on level and gently sloping ground, patchy at first and at its edges, and thins on steep faces.
    float snowPatch = 0.78 + 0.44 * noise(ground * 0.011 + 5.1) + 0.2 * (noise(ground * 0.09) - 0.5);
    float snowCover = clamp(uSnow * snowPatch * 1.15, 0.0, 1.0) * smoothstep(0.45, 0.86, nrm.y);
    albedo = mix(albedo, vec3(0.80, 0.84, 0.90), snowCover * 0.94);
    float direct = mix(ndl,mix(1.0,ndl,0.4),imW);
    vec3 lit = albedo*(vec3(0.015)+vec3(0.35,0.43,0.53)*uDayness*(0.78+0.22*nrm.y)+
      sunTint*0.65*uDayness*direct*cloudShadowAt(vec3(vWXZ.x,vAltitude,vWXZ.y)));
    float night = clamp(1.0-uDayness*1.6,0.0,1.0);
    if (night>0.001 && vUrban>0.001) {
      // Town lights: one lamp at a jittered point in some cells of a street-sized grid, a soft disc a few metres across that
      // never shrinks below a pixel (its light is kept, spread thinner), in sodium orange, warm white and a few cool LEDs.
      // Far away, where a cell is smaller than a pixel, the lamps merge into their average glow.
      const float CELL = 26.0;
      vec2 gc = ground / CELL;
      vec2 id = floor(gc);
      float h = hash(id);
      float share = 0.16 + 0.34 * vUrban;                       // lit cells: sparse suburbs to dense centres
      float on = step(1.0 - share, h);
      vec2 lamp = (vec2(hash(id + 17.3), hash(id + 41.9)) - 0.5) * 0.7 + 0.5;
      float radius = max(2.6 / CELL, 0.9 * footprint / CELL);
      float d = length(fract(gc) - lamp) / radius;
      float disc = exp(-d * d * 1.6) * min(1.0, (2.6 / CELL) * (2.6 / CELL) / (radius * radius));
      float kind = fract(h * 37.7);
      vec3 lampColor = kind < 0.55 ? vec3(1.0,0.56,0.2) : kind < 0.9 ? vec3(1.0,0.82,0.56) : vec3(0.78,0.88,1.0);
      float merge = smoothstep(0.35, 1.2, footprint / CELL);
      vec3 points = lampColor * on * disc * (0.6 + 0.8 * fract(h * 9.7)) * 9.0;
      vec3 glow = vec3(1.0,0.66,0.38) * share * 0.15;                // the lamps' own average over a cell
      lit += vUrban * night * (mix(points, glow, merge) + albedo * vec3(1.0,0.7,0.42) * 0.05 * share);
    }
    vec3 direction = normalize(vec3(vWXZ.x-cameraPosition.x,
      vAltitude-cameraPosition.y,vWXZ.y-cameraPosition.z)+vec3(1e-5));
    vec3 hazeDir = normalize(vec3(direction.x,max(direction.y,0.015),direction.z));
    vec3 haze = skyRadiance(uSky,hazeDir);
    // Integrate an exponential height density along the viewing segment.
    float h0 = max(cameraPosition.y,0.0)/8000.0;
    float h1 = max(vAltitude,0.0)/8000.0;
    float dh = h1-h0;
    float meanDensity = abs(dh)<0.01 ? exp(-0.5*(h0+h1)) : (exp(-h0)-exp(-h1))/dh;
    float distance = length(vec3(vDist,vAltitude-cameraPosition.y,0.0));
    float fog = 1.0-exp(-distance*uFogDensity*meanDensity);
    lit = mix(lit,haze,fog);
    gl_FragColor = vec4(lit,1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // Match standard materials: cloud fog is composed in output color space.
    gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(uCloudColor,1.0)).rgb,
      1.0-exp(-vCloudDepth*vCloudDepth*uCloudDensity*uCloudDensity));
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
  private nextRequestId = 0
  // Satellite imagery (13b): per-tile material clones share the base
  // material's uniform OBJECTS for light/fog (one write updates all) and
  // its GLSL source (three compiles one program for the lot).
  private imageryOn = true
  private imLoading = 0
  private readonly imQueue: string[] = []
  private imFailStreak = 0
  private detailEnabled = true
  private detailLoading: { key: string; controller: AbortController } | null = null
  private detailWanted = new Set<string>()
  private detailRetry = new Map<string, number>()
  private lastDetailUpdate = -Infinity

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
        uSunTransmission: { value: 1 },
        ...cloudShadowUniforms,
        ...wetnessUniforms,
        ...snowUniforms,
        uCloudDensity: { value: 0 },
        uCloudColor: { value: new THREE.Color(0xc8ccd2) },
        uFogDensity: { value: 9e-6 },
        uImagery: { value: white },
        uSky: { value: white },
        uWorldOffset: { value: new THREE.Vector2() },
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

  setSky(texture: THREE.Texture): void { this.material.uniforms.uSky!.value = texture }
  setCloudFog(fog: THREE.FogExp2): void {
    this.material.uniforms.uCloudDensity!.value = fog.density
    ;(this.material.uniforms.uCloudColor!.value as THREE.Color).copy(fog.color)
  }
  setDetailEnabled(enabled: boolean): void { this.detailEnabled = enabled; this.lastDetailUpdate = -Infinity }

  /** At most two 2048px mosaics (~43 MB with mipmaps), loaded one at a
   * time with four requests in flight. Base photos stay visible on failure. */
  updateDetail(north: number, east: number, aglM: number, now: number): void {
    if (now - this.lastDetailUpdate < 2000) return
    this.lastDetailUpdate = now
    const near = this.imageryOn && this.detailEnabled && aglM < 1800
      ? [...this.tiles.values()].filter(t => t.z === 13 && t.imTex && t.imMat)
        .map(t => { const p = this.frame.toLocal(t.latC, t.lonC); return { t, d: Math.hypot(p.n-north, p.e-east) } })
        .filter(p => p.d < 5600).sort((a,b) => a.d-b.d).slice(0,DETAIL_TILES).map(p => p.t)
      : []
    this.detailWanted = new Set(near.map(t => t.key))
    for (const t of this.tiles.values()) if (t.detailTex && !this.detailWanted.has(t.key)) {
      if (t.imMat) t.imMat.uniforms.uImagery!.value = t.imTex
      t.detailTex.dispose()
      t.detailTex = undefined
    }
    if (this.detailLoading && !this.detailWanted.has(this.detailLoading.key)) this.detailLoading.controller.abort()
    if (this.detailLoading) return
    const tile = near.find(t => !t.detailTex && (this.detailRetry.get(t.key) ?? 0) < now)
    if (!tile) return
    const controller = new AbortController()
    this.detailLoading = { key: tile.key, controller }
    loadDetailedImagery(tile.key, AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]))
      .then(texture => {
        if (this.tiles.get(tile.key) !== tile || !this.detailWanted.has(tile.key) || !tile.imMat || !this.imageryOn) {
          texture.dispose()
          return
        }
        tile.detailTex = texture
        tile.imMat.uniforms.uImagery!.value = texture
        this.detailRetry.delete(tile.key)
      })
      .catch(() => { this.detailRetry.set(tile.key, performance.now()+60_000) })
      .finally(() => { this.detailLoading = null; this.lastDetailUpdate = -Infinity })
  }
  get fogDensity(): number { return this.material.uniforms.uFogDensity!.value as number }
  setWorldOffset(east: number, north: number): void {
    ;(this.material.uniforms.uWorldOffset!.value as THREE.Vector2).set(east,-north)
  }

  setLight(sunDir: THREE.Vector3, dayness: number, lowSun = 0, sunTransmission = 1): void {
    ;(this.material.uniforms.uSunDir!.value as THREE.Vector3).copy(sunDir)
    this.material.uniforms.uDayness!.value = dayness
    this.material.uniforms.uLowSun!.value = lowSun
    this.material.uniforms.uSunTransmission!.value = sunTransmission
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
    const m = metersPerDegree(this.frame.anchor.lat)
    const tile: Tile = {
      key, requestId: ++this.nextRequestId, z: ring.z, latC, lonC, latN, latS, lonW, lonE,
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
      if (this.tiles.get(tile.key) !== tile) continue
      const ring = RINGS.find((r) => r.z === tile.z)!
      // Preserve the geometry build frame even if queued across a rebase.
      const m = { east: tile.sizeEastM / (tile.lonE - tile.lonW), north: tile.sizeNorthM / (tile.latN - tile.latS) }
      const runways = this.runwaysInBounds(tile.latS - 0.02, tile.latN + 0.02, tile.lonW - 0.02, tile.lonE + 0.02)
        .map((rw) => ({
          ax: (rw.lo1 - tile.lonC) * m.east,
          ay: (rw.la1 - tile.latC) * m.north,
          bx: (rw.lo2 - tile.lonC) * m.east,
          by: (rw.la2 - tile.latC) * m.north,
          ha: rw.e1M,
          hb: rw.e2M,
          halfW: rw.halfWidthM,
          ...(rw.disk ? { disk: true } : {}),
          ...(rw.lowland ? { lowland: true } : {}),
          ...(rw.land ? { land: true } : {}),
        }))
      this.inFlight++
      const worker = this.workers[this.nextWorker++ % this.workers.length]!
      const [z, x, y] = tile.key.split('/')
      worker.postMessage({
        key: tile.key,
        requestId: tile.requestId,
        url: `/proxy/terrain/${z}/${x}/${y}.png`,
        // NLCD biome coloring for the near rings only (z11/z13) — far rings
        // keep the elevation ramp to bound WMS load; the visual difference
        // at 60+ km is negligible under haze.
        landcoverUrl: tile.z >= 11 ? `/proxy/landcover/${z}/${x}/${y}.png` : undefined,
        wantCover: tile.z === RINGS[0]!.z,
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
    if (!tile || resp.requestId !== tile.requestId) return
    if (resp.error) {
      tile.state = 'failed'
      // 9C: a failed fetch left a PERMANENT terrain hole — the entry
      // blocked any re-request. Forget it after 15 s so the normal
      // update pass re-creates and refetches the tile.
      setTimeout(() => {
        if (this.tiles.get(resp.key) === tile && tile.state === 'failed') this.tiles.delete(resp.key)
      }, 15_000)
      return
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(resp.positions, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(resp.normals, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(resp.colors, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(resp.uvs, 2))
    geo.setAttribute('urban', new THREE.BufferAttribute(resp.urban, 1))
    geo.setIndex(new THREE.BufferAttribute(resp.indices, 1))
    tile.coverage = new TerrainCoverage(tile.key)
    tile.coverageTexture = new THREE.DataTexture(tile.coverage.cells, tile.coverage.size, tile.coverage.size, THREE.RedFormat)
    tile.coverageTexture.minFilter = tile.coverageTexture.magFilter = THREE.NearestFilter
    tile.coverageTexture.generateMipmaps = false
    tile.coverageTexture.needsUpdate = true
    tile.baseMat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.material.uniforms,
        uNormalScale: { value: new THREE.Vector2(1, 1) },
        uCoverage: { value: tile.coverageTexture },
        uCoverageSize: { value: tile.coverage.size },
        uCoverageRows: { value: tile.coverage.rows },
      },
      vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG,
    })
    const mesh = new THREE.Mesh(geo, tile.baseMat)
    mesh.userData.terrainKey = tile.key
    mesh.frustumCulled = true
    // Lower zooms render first (underneath overlapping high-res tiles).
    mesh.renderOrder = tile.z
    tile.mesh = mesh
    tile.heights = resp.heights
    if (resp.cover && resp.coverSize) { tile.cover = resp.cover; tile.coverSize = resp.coverSize }
    tile.gridSize = resp.gridSize
    tile.state = 'ready'
    this.placeTile(tile)
    this.scene.add(mesh)
    this.refreshCoverage(tile)
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
      this.detailLoading?.controller.abort()
      this.detailWanted.clear()
      for (const t of this.tiles.values()) {
        t.imQueued = false
        if (t.imMat && t.mesh) t.mesh.material = t.baseMat!
        t.imTex?.dispose()
        t.detailTex?.dispose()
        t.imMat?.dispose()
        t.imTex = undefined
        t.detailTex = undefined
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
        const img = (t.detailTex ?? t.imTex).image as { width?: number; height?: number } | undefined
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
      detailed: [...this.tiles.values()].filter(t => t.detailTex).map(t => t.key),
      detailLoading: this.detailLoading?.key ?? null,
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
            tex.colorSpace = THREE.SRGBColorSpace
            tex.anisotropy = 8
            t.imTex = tex
            t.imMat = new THREE.ShaderMaterial({
              uniforms: {
                // Lighting is shared globally; coverage belongs to this tile.
                ...t.baseMat!.uniforms,
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
    const m = metersPerDegree(this.frame.anchor.lat)
    tile.mesh.scale.set((tile.lonE - tile.lonW) * m.east / tile.sizeEastM, 1,
      (tile.latN - tile.latS) * m.north / tile.sizeNorthM)
    ;(tile.baseMat!.uniforms.uNormalScale!.value as THREE.Vector2).set(
      1 / tile.mesh.scale.x ** 2, 1 / tile.mesh.scale.z ** 2)
  }

  /** Reposition every tile after an anchor rebase. */
  onRebase(): void {
    for (const tile of this.tiles.values()) this.placeTile(tile)
    this.lastUpdatePos = { n: Infinity, e: Infinity }
  }

  /** Drop every tile within `radiusM` of a point so it is built again with the airports' current runway list. */
  reloadAround(lat: number, lon: number, radiusM: number): void {
    const dLat = radiusM / 111_319.5, dLon = radiusM / (111_319.5 * Math.cos((lat * Math.PI) / 180))
    for (const t of [...this.tiles.values()]) {
      if (t.latS > lat + dLat || t.latN < lat - dLat || t.lonW > lon + dLon || t.lonE < lon - dLon) continue
      if (t.mesh) { this.scene.remove(t.mesh); t.mesh.geometry.dispose() }
      t.imTex?.dispose(); t.detailTex?.dispose(); t.imMat?.dispose(); t.baseMat?.dispose(); t.coverageTexture?.dispose()
      this.tiles.delete(t.key)
      this.detailRetry.delete(t.key)
    }
    this.refreshCoverage()
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
      t.detailTex?.dispose()
      t.imMat?.dispose()
      t.baseMat?.dispose()
      t.coverageTexture?.dispose()
      this.tiles.delete(t.key)
      this.detailRetry.delete(t.key)
    }
    this.refreshCoverage()
  }

  private refreshCoverage(changed?: Tile): void {
    const ready = [...this.tiles.values()].filter(t => t.state === 'ready' && t.mesh).map(t => t.key)
    for (const tile of this.tiles.values()) {
      if (!tile.coverage || !tile.coverageTexture) continue
      // A new READY tile can affect only itself and its loaded ancestors.
      // Eviction refreshes the retained set once after the entire batch.
      if (changed && tile !== changed && (tile.z >= changed.z ||
        changed.lonW < tile.lonW || changed.lonE > tile.lonE ||
        changed.latS < tile.latS || changed.latN > tile.latN)) continue
      tile.coverage.rebuild(ready)
      tile.coverageTexture.needsUpdate = true
    }
  }

  /** CPU equivalent of production fragment visibility for terrain inspection.
   * Ray hits still include hidden geometry, so filter them using this predicate. */
  isSurfaceVisible(object: THREE.Object3D, lat: number, lon: number): boolean {
    const tile = this.tiles.get(object.userData.terrainKey as string)
    if (!tile || tile.mesh !== object || tile.state !== 'ready' || !object.visible) return false
    const u = (lon - tile.lonW) / (tile.lonE - tile.lonW)
    const v = (tile.latN - lat) / (tile.latN - tile.latS)
    return !tile.coverage?.covered(u, v)
  }

  /** True when the finest terrain tile at a position (the one a nearby aircraft flies over) has loaded. */
  fineReady(lat: number, lon: number): boolean {
    const ring = RINGS[0]!
    return this.tiles.get(`${ring.z}/${Math.floor(lonToTileX(lon, ring.z))}/${Math.floor(latToTileY(lat, ring.z))}`)?.state === 'ready'
  }

  /** Land cover (nlcd-palette.ts COVER) at lat/lon from the finest ring's tile: 0 where there is none loaded or nothing to plant. */
  coverAt(lat: number, lon: number): number {
    const ring = RINGS[0]!
    const tile = this.tiles.get(`${ring.z}/${Math.floor(lonToTileX(lon, ring.z))}/${Math.floor(latToTileY(lat, ring.z))}`)
    if (!tile?.cover || !tile.coverSize) return 0
    const n = tile.coverSize
    const px = Math.min(n - 1, Math.max(0, Math.floor(((lon - tile.lonW) / (tile.lonE - tile.lonW)) * n)))
    const py = Math.min(n - 1, Math.max(0, Math.floor(((tile.latN - lat) / (tile.latN - tile.latS)) * n)))
    return tile.cover[py * n + px]!
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
        const h = sampleTerrainTriangles(tile.heights, tile.gridSize, fx, fy)
        // Flaky decode → non-finite sample: fall through to a coarser ring.
        if (Number.isFinite(h)) return h
      }
    }
    return 0
  }

  /** Release a streamed scene (also used by the isolated inspection harness). */
  dispose(): void {
    this.queue.length = 0
    this.imQueue.length = 0
    this.setImagery(false)
    this.detailLoading?.controller.abort()
    for (const worker of this.workers) worker.terminate()
    for (const tile of this.tiles.values()) {
      if (tile.mesh) {
        this.scene.remove(tile.mesh)
        tile.mesh.geometry.dispose()
      }
      tile.imTex?.dispose()
      tile.detailTex?.dispose()
      tile.imMat?.dispose()
      tile.baseMat?.dispose()
      tile.coverageTexture?.dispose()
    }
    this.tiles.clear()
    ;(this.material.uniforms.uImagery!.value as THREE.Texture).dispose()
    this.material.dispose()
  }

  get readyCount(): number {
    let n = 0
    for (const t of this.tiles.values()) if (t.state === 'ready') n++
    return n
  }
}
