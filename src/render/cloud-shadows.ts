import * as THREE from 'three'

/**
 * Cloud shadows on the ground. Each visible cloud mass's footprint is drawn,
 * soft-edged, into a small darkness map at the spot where the sun projects
 * it onto the ground. A low sun throws shadows far from the cloud, as on a
 * real afternoon. The map is centred on the camera and covers the clouds'
 * own 14 km draw range; the terrain shader dims its direct sunlight there.
 * It rebuilds only when the clouds, the sun or the camera change enough
 * (≈1 ms of JS for a few hundred masses), never per frame.
 */
export const SHADOW_MAP_PX = 256
export const SHADOW_HALF_M = 14_000

export interface CloudSource {
  version: number
  forEachCloud(fn: (x: number, y: number, z: number, rx: number, ry: number, rz: number) => void): void
}

/** Darkness of a cumulus shadow at the footprint centre (skylight still
 *  lights the ground under it). */
const CORE_DARKNESS = 0.72

/**
 * Rasterise cloud footprints into `out` (size² texels, 0 = sunlit, 1 = black),
 * centred on (cx, cz), projecting each cloud from its base along `sun` (unit,
 * render frame, y up) down to `groundY`. Returns the number drawn.
 */
export function rasterCloudShadows(
  out: Float32Array, size: number, halfM: number, cx: number, cz: number, groundY: number,
  sun: { x: number; y: number; z: number }, src: CloudSource,
): number {
  out.fill(0)
  if (sun.y <= 0.03) return 0 // sun at or below the horizon: no direct beams to shade
  const texel = (2 * halfM) / size
  let drawn = 0
  src.forEachCloud((x, y, z, rx, ry, rz) => {
    // Shade from the lower half of the mass: project its centre along the sun.
    const h = Math.max(y - 0.25 * ry - groundY, 0)
    const sx = x - (sun.x / sun.y) * h
    const sz = z - (sun.z / sun.y) * h
    // The visible body is ≈0.8 of the bounding radii (cloud shader support).
    const ax = 0.8 * rx, az = 0.8 * rz
    const i0 = Math.max(0, Math.floor((sx - ax - (cx - halfM)) / texel))
    const i1 = Math.min(size - 1, Math.ceil((sx + ax - (cx - halfM)) / texel))
    const j0 = Math.max(0, Math.floor((sz - az - (cz - halfM)) / texel))
    const j1 = Math.min(size - 1, Math.ceil((sz + az - (cz - halfM)) / texel))
    if (i0 > i1 || j0 > j1) return
    drawn++
    for (let j = j0; j <= j1; j++) {
      const pz = cz - halfM + (j + 0.5) * texel
      for (let i = i0; i <= i1; i++) {
        const px = cx - halfM + (i + 0.5) * texel
        const ex = (px - sx) / ax, ez = (pz - sz) / az
        const r = Math.sqrt(ex * ex + ez * ez)
        if (r >= 1) continue
        const t = Math.min(Math.max((r - 0.45) / 0.55, 0), 1)
        const a = CORE_DARKNESS * (1 - t * t * (3 - 2 * t))
        const k = j * size + i
        // Overlapping masses: transmissions multiply.
        out[k] = 1 - (1 - out[k]!) * (1 - a)
      }
    }
  })
  return drawn
}

export class CloudShadowMap {
  readonly texture: THREE.DataTexture
  /** (minX, minZ, 1/width, 1/depth) of the map in the render frame. */
  readonly rect = new THREE.Vector4(0, 0, 1 / (2 * SHADOW_HALF_M), 1 / (2 * SHADOW_HALF_M))
  /** 0 until the first build (the terrain ignores the map). */
  active = 0
  private readonly data = new Float32Array(SHADOW_MAP_PX * SHADOW_MAP_PX)
  private readonly bytes = new Uint8Array(SHADOW_MAP_PX * SHADOW_MAP_PX)
  private last = { version: -1, x: Infinity, z: Infinity, sx: 0, sy: 0, sz: 0 }

  constructor() {
    this.texture = new THREE.DataTexture(this.bytes, SHADOW_MAP_PX, SHADOW_MAP_PX, THREE.RedFormat)
    this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping
    this.texture.needsUpdate = true
  }

  /** Rebuild if the clouds, the sun (> ~1°) or the camera (> 1.5 km) moved. */
  update(src: CloudSource, camera: THREE.Vector3, groundY: number, sun: THREE.Vector3): boolean {
    const L = this.last
    const sunMoved = Math.abs(sun.x - L.sx) + Math.abs(sun.y - L.sy) + Math.abs(sun.z - L.sz) > 0.02
    if (src.version === L.version && !sunMoved && Math.hypot(camera.x - L.x, camera.z - L.z) < 1500) return false
    const drawn = rasterCloudShadows(this.data, SHADOW_MAP_PX, SHADOW_HALF_M, camera.x, camera.z, groundY, sun, src)
    for (let k = 0; k < this.data.length; k++) this.bytes[k] = Math.round(this.data[k]! * 255)
    this.texture.needsUpdate = true
    this.rect.set(camera.x - SHADOW_HALF_M, camera.z - SHADOW_HALF_M, 1 / (2 * SHADOW_HALF_M), 1 / (2 * SHADOW_HALF_M))
    this.active = drawn > 0 ? 1 : 0
    this.last = { version: src.version, x: camera.x, z: camera.z, sx: sun.x, sy: sun.y, sz: sun.z }
    return true
  }
}
