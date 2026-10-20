import * as THREE from 'three'
import type { CloudSlab } from '../sim/weather/clouds-model'

/** Bounded single-scattering volumes, anchored to deterministic world cells.
 * METAR supplies coverage/base; tops remain the weather model's approximation.
 * These are independent cumulus masses, not a simulated evolving weather field.
 * Back-face boxes cover the complete ray interval, including observers inside.
 * Transparent volumes are sorted by distance; intersecting masses/layers still
 * approximate compositing. Depth tests use the first density sample, not opaque-scene depth
 * integration: terrain intersecting a mass can occlude its interior imperfectly.
 */
const VERT = /* glsl */ `
  attribute vec3 offset;
  attribute vec3 radii;
  attribute float seed;
  varying vec3 vPosition;
  varying vec3 vCenter;
  varying vec3 vRadii;
  varying float vSeed;
  void main() {
    vCenter = offset;
    vRadii = radii;
    vSeed = seed;
    vPosition = offset + position * radii;
    gl_Position = projectionMatrix * viewMatrix * vec4(vPosition, 1.0);
  }
`
const FRAG = /* glsl */ `
  precision highp sampler3D;
  uniform mat4 projectionMatrix;
  uniform sampler3D uNoise;
  uniform float uDayness;
  uniform vec3 uSunDir;
  uniform float uDusk;
  uniform float uCoverage;
  uniform float uNearSteps;
  uniform float uFarSteps;
  varying vec3 vPosition;
  varying vec3 vCenter;
  varying vec3 vRadii;
  varying float vSeed;

  float density(vec3 p) {
    // p is ellipsoid-local; all noise is object/world anchored, never screen UV.
    // Shadow rays share precisely the visible bounded support. Macro noise
    // may expand lobes, but may never leak density through the proxy box.
    if (any(greaterThanEqual(abs(p), vec3(1.0)))) return 0.0;
    float sideSupport = 1.0 - smoothstep(0.72, 1.0, length(p.xz));
    float h = p.y * 0.5 + 0.5;
    float base = smoothstep(0.0, 0.12, h);
    float top = 1.0 - smoothstep(0.72, 1.0, h);
    vec3 q = p * vec3(1.7, 1.35, 1.7) + vSeed * 23.7;
    float macro = texture(uNoise, q * 0.055).r;
    float detail = texture(uNoise, q * 0.25 + 0.37).r;
    // Broad lobes carve a coherent rounded silhouette; finer erosion only
    // affects the boundary, preserving substantial optically thick interiors.
    float envelope = 1.0 - dot(p.xz, p.xz) - pow(max(p.y, 0.0), 2.0) * 0.65;
    float structure = envelope;
    if (uCoverage < 0.6) {
      float billowA = 1.0 - length((p - vec3(-0.32, 0.04, 0.1)) / vec3(0.62, 0.96, 0.64));
      float billowB = 1.0 - length((p - vec3(0.3, 0.22, -0.14)) / vec3(0.54, 0.77, 0.64));
      float billowC = 1.0 - length((p - vec3(0.15, -0.2, 0.37)) / vec3(0.69, 0.67, 0.49));
      structure = max(max(billowA, billowB), billowC) * 1.8;
    }
    float body = structure + (macro - 0.5) * 1.2 - 0.08;
    float d = smoothstep(0.0, 0.36, body - (1.0 - detail) * 0.16);
    return d * base * top * sideSupport * (0.65 + macro * 0.65);
  }

  void main() {
    vec3 ray = normalize(vPosition - cameraPosition);
    vec3 origin = (cameraPosition - vCenter) / vRadii;
    vec3 direction = ray / vRadii;
    // Robust slab intersection, including rays exactly parallel to a face.
    vec3 safeDir = mix(vec3(0.00000001), direction, greaterThan(abs(direction), vec3(0.00000001)));
    vec3 a = (-vec3(1.0) - origin) / safeDir;
    vec3 b = ( vec3(1.0) - origin) / safeDir;
    vec3 nearT = min(a, b);
    vec3 farT = max(a, b);
    float entry = max(max(nearT.x, nearT.y), nearT.z);
    float exitT = min(min(farT.x, farT.y), farT.z);
    // The density's radial support is a unit cylinder. Intersect it before
    // marching to eliminate the box's empty corners and grazing empty spans.
    float radialA = dot(direction.xz, direction.xz);
    float radialB = dot(origin.xz, direction.xz);
    float radialC = dot(origin.xz, origin.xz) - 1.0;
    if (radialA > 0.000000000001) {
      float discriminant = radialB * radialB - radialA * radialC;
      if (discriminant <= 0.0) discard;
      float root = sqrt(discriminant);
      entry = max(entry, (-radialB - root) / radialA);
      exitT = min(exitT, (-radialB + root) / radialA);
    } else if (radialC >= 0.0) discard;
    entry = max(entry, 0.5);
    if (exitT <= entry) discard;
    float distanceToCloud = length((vCenter - cameraPosition).xz);
    float fade = 1.0 - smoothstep(10000.0, 14000.0, distanceToCloud);
    if (fade < 0.005) discard;
    // Quality-controlled near/far steps, early opacity termination. Three sun taps
    // are amortized over four view samples. No screen-space temporal history.
    float steps = floor(mix(uNearSteps, uFarSteps, smoothstep(2500.0, 11000.0, distanceToCloud)) + 0.5);
    float stepM = (exitT - entry) / steps;
    vec3 sun = normalize(uSunDir);
    vec3 sunStep = sun / vRadii * 190.0;
    float extinction = mix(0.0042, 0.007, uCoverage);
    float transmittance = 1.0;
    float firstDensityT = -1.0;
    vec3 accumulated = vec3(0.0);
    float shadow = 1.0;
    // Low sun: a wider forward lobe so cloud edges glow toward the sun, and
    // brighter (HDR — the post chain blooms it) golden light.
    // Clouds aloft stay in direct sun after the ground is in twilight.
    float sunUp = max(uDayness, uDusk * 0.95);
    float forward = pow(max(dot(ray, sun), 0.0), mix(12.0, 5.0, uDusk));
    vec3 sunlight = mix(vec3(1.0, 0.97, 0.91), vec3(1.0, 0.42, 0.12), uDusk) * (1.0 + 2.6 * uDusk);
    for (int i = 0; i < 24; i++) {
      if (float(i) >= steps || transmittance < 0.025) break;
      float t = entry + (float(i) + 0.5) * stepM;
      vec3 p = origin + direction * t;
      float d = density(p);
      if (d < 0.005) continue;
      if (firstDensityT < 0.0) firstDensityT = t;
      if (i == 0 || i / 4 * 4 == i || shadow == 1.0) {
        float optical = density(p + sunStep) * 190.0;
        optical += density(p + sunStep * 2.7) * 320.0;
        optical += density(p + sunStep * 5.0) * 440.0;
        shadow = exp(-optical * extinction);
      }
      float heightLight = smoothstep(-0.8, 0.8, p.y);
      vec3 ambient = mix(vec3(0.022, 0.029, 0.048), vec3(0.23, 0.29, 0.38), uDayness);
      ambient *= mix(0.55, 1.25, heightLight);
      // Dusk: shaded undersides pick up the violet-rose of the sky, tops stay warm.
      vec3 duskAmbient = mix(vec3(0.10, 0.11, 0.25), vec3(0.50, 0.27, 0.24), heightLight) * (0.3 + uDayness * 0.9);
      ambient = mix(ambient, duskAmbient, uDusk * 0.85);
      // A bounded forward lobe produces silver edges without a white clip.
      vec3 direct = sunlight * sunUp * (0.85 + forward * (1.7 + 3.0 * uDusk)) * shadow;
      vec3 multipleScatter = sunlight * sunUp * 0.16 * (1.0 - shadow);
      float absorbed = 1.0 - exp(-d * extinction * stepM);
      accumulated += transmittance * absorbed * (ambient + direct + multipleScatter);
      transmittance *= 1.0 - absorbed;
    }
    float alpha = 1.0 - transmittance;
    if (alpha < 0.005) discard;
    // Distance haze blends the field into the atmosphere before the outer
    // cell boundary. Straight alpha is required by Three's normal blending.
    vec3 radiance = accumulated / max(alpha, 0.001);
    vec3 haze = mix(vec3(0.012, 0.02, 0.042), vec3(0.36, 0.47, 0.61), uDayness);
    haze = mix(haze, vec3(0.66, 0.40, 0.31) * (0.4 + uDayness * 0.7), uDusk * 0.6); // warm horizon haze
    radiance = mix(radiance, haze, 1.0 - exp(-distanceToCloud * 0.000025));
    gl_FragColor = vec4(radiance, alpha * fade);
    vec4 clipEntry = projectionMatrix * viewMatrix * vec4(cameraPosition + ray * firstDensityT, 1.0);
    // r180 reversed-Z perspective uses zero-to-one clip control. Conventional
    // projection has a negative [2][2]; preserve either renderer convention.
    float ndcDepth = clipEntry.z / clipEntry.w;
    gl_FragDepth = projectionMatrix[2][2] >= 0.0 ? ndcDepth : ndcDepth * 0.5 + 0.5;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const COVERAGE: Record<string, number> = { FEW: 0.14, SCT: 0.35, BKN: 0.68, OVC: 1, VV: 1 }
const CELL_M = 2400
const FIELD_RADIUS_M = 14000
function layerCellSize(slab: CloudSlab): number {
  if (slab.cover === 'FEW' || slab.cover === 'SCT') {
    return Math.max(600, Math.min(1100, (slab.topMslFt - slab.baseMslFt) * 0.3048 * 3))
  }
  return CELL_M
}
function hash2(ix: number, iy: number, k: number): number {
  let h = (ix * 374761393 + iy * 668265263 + k * 2246822519) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Small periodic coherent lattice, trilinearly filtered on GPU. */
function makeNoise(): THREE.Data3DTexture {
  const size = 32
  const data = new Uint8Array(size ** 3)
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    data[x + size * (y + size * z)] = Math.floor(hash2(x + y * size, z, 91) * 255)
  }
  const texture = new THREE.Data3DTexture(data, size, size, size)
  texture.format = THREE.RedFormat
  texture.type = THREE.UnsignedByteType
  texture.minFilter = texture.magFilter = THREE.LinearFilter
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping
  texture.unpackAlignment = 1
  texture.needsUpdate = true
  return texture
}
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** CPU equivalent of WebGL LINEAR + REPEAT sampling of normalized R8 noise.
 * Texture coordinates address texel centers, hence the half-texel subtraction.
 */
function sampleNoise(data: Uint8Array, x: number, y: number, z: number): number {
  const tx = x * 32 - 0.5, ty = y * 32 - 0.5, tz = z * 32 - 0.5
  const ix = Math.floor(tx), iy = Math.floor(ty), iz = Math.floor(tz)
  const fx = tx - ix, fy = ty - iy, fz = tz - iz
  let value = 0
  for (let dz = 0; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
    const index = ((ix + dx) & 31) + 32 * (((iy + dy) & 31) + 32 * ((iz + dz) & 31))
    value += data[index]! / 255 * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz)
  }
  return value
}

/** Keep this CPU density evaluation paired with density() in FRAG. It is used
 * for local immersion only, not a second world-field/weather approximation.
 */
function localDensity(data: Uint8Array, x: number, y: number, z: number, seed: number, cover: number): number {
  if (Math.abs(x) >= 1 || Math.abs(y) >= 1 || Math.abs(z) >= 1) return 0
  const radial = Math.hypot(x, z)
  if (radial >= 1) return 0
  const side = 1 - smoothstep(0.72, 1, radial)
  const h = y * 0.5 + 0.5
  const base = smoothstep(0, 0.12, h), top = 1 - smoothstep(0.72, 1, h)
  const qx = x * 1.7 + seed * 23.7, qy = y * 1.35 + seed * 23.7, qz = z * 1.7 + seed * 23.7
  const macro = sampleNoise(data, qx * 0.055, qy * 0.055, qz * 0.055)
  const detail = sampleNoise(data, qx * 0.25 + 0.37, qy * 0.25 + 0.37, qz * 0.25 + 0.37)
  let structure = 1 - x * x - z * z - Math.max(y, 0) ** 2 * 0.65
  if (cover < 0.6) {
    const a = 1 - Math.hypot((x + 0.32) / 0.62, (y - 0.04) / 0.96, (z - 0.1) / 0.64)
    const b = 1 - Math.hypot((x - 0.3) / 0.54, (y - 0.22) / 0.77, (z + 0.14) / 0.64)
    const c = 1 - Math.hypot((x - 0.15) / 0.69, (y + 0.2) / 0.67, (z - 0.37) / 0.49)
    structure = Math.max(a, b, c) * 1.8
  }
  const body = structure + (macro - 0.5) * 1.2 - 0.08
  return smoothstep(0, 0.36, body - (1 - detail) * 0.16) * base * top * side * (0.65 + macro * 0.65)
}

interface LayerField { mesh: THREE.Mesh; material: THREE.ShaderMaterial; slab: CloudSlab }

export class Clouds {
  private layers: LayerField[] = []
  private layersKey = ''
  private quality: 'performance' | 'high' | 'ultra' = 'high'
  private lastCellX = Infinity
  private lastCellZ = Infinity
  private noise = makeNoise()
  private lastSortPosition = new THREE.Vector3(Infinity, Infinity, Infinity)
  constructor(private readonly scene: THREE.Scene) {}

  /** Local cloud extinction in inverse metres at a render-frame position.
   * Call after update() / rebase so the queried and rendered anchors agree.
   * Gaps in sparse METAR layers are clear; overlapping masses add optical depth.
   * FogExp2 remains a local uniform-fog approximation to this volumetric field.
   */
  extinctionAt(cameraPos: THREE.Vector3): number {
    const data = this.noise.image.data as Uint8Array
    let extinction = 0
    for (const layer of this.layers) {
      if (cameraPos.y <= layer.slab.baseMslFt * 0.3048 || cameraPos.y >= layer.slab.topMslFt * 0.3048) continue
      const geometry = layer.mesh.geometry as THREE.InstancedBufferGeometry
      const centers = geometry.getAttribute('offset'), radii = geometry.getAttribute('radii'), seeds = geometry.getAttribute('seed')
      const cover = COVERAGE[layer.slab.cover] ?? 0.5
      for (let i = 0; i < geometry.instanceCount; i++) {
        const x = (cameraPos.x - centers.getX(i)) / radii.getX(i)
        const y = (cameraPos.y - centers.getY(i)) / radii.getY(i)
        const z = (cameraPos.z - centers.getZ(i)) / radii.getZ(i)
        extinction += localDensity(data, x, y, z, seeds.getX(i), cover) * (0.0042 + (0.007 - 0.0042) * cover)
      }
    }
    return extinction
  }

  setQuality(quality: 'performance' | 'high' | 'ultra'): void {
    this.quality = quality
    const budget = quality === 'performance' ? [12, 8] : quality === 'ultra' ? [24, 16] : [18, 12]
    for (const layer of this.layers) {
      layer.material.uniforms.uNearSteps!.value = budget[0]
      layer.material.uniforms.uFarSteps!.value = budget[1]
    }
  }

  update(slabs: CloudSlab[], cameraPos: THREE.Vector3, worldOffsetE: number, worldOffsetN: number,
    dayness: number, sunDir?: THREE.Vector3, dusk = 0): void {
    const key = slabs.map(s => `${s.cover}${s.baseMslFt}-${s.topMslFt}`).join('|')
    const cellX = Math.floor((cameraPos.x + worldOffsetE) / CELL_M)
    const cellZ = Math.floor((-cameraPos.z + worldOffsetN) / CELL_M)
    if (key !== this.layersKey) {
      this.dispose()
      this.layersKey = key
      for (const slab of slabs) this.layers.push(this.buildLayer(slab))
      this.setQuality(this.quality)
    }
    // Re-sort at modest spatial intervals rather than doing per-frame CPU work.
    if (cellX !== this.lastCellX || cellZ !== this.lastCellZ ||
      this.lastSortPosition.distanceToSquared(cameraPos) > 250 ** 2 || this.layers.some(l => l.mesh.userData.dirty)) {
      for (const l of this.layers) this.fillLayer(l, cellX, cellZ, worldOffsetE, worldOffsetN, cameraPos)
      this.lastCellX = cellX
      this.lastCellZ = cellZ
      this.lastSortPosition.copy(cameraPos)
    }
    for (const l of this.layers) {
      l.material.uniforms.uDayness!.value = dayness
      if (sunDir) (l.material.uniforms.uSunDir!.value as THREE.Vector3).copy(sunDir)
      l.material.uniforms.uDusk!.value = dusk
      l.mesh.renderOrder = 50 - Math.abs((l.slab.baseMslFt + l.slab.topMslFt) * 0.1524 - cameraPos.y) / 100000
    }
  }

  private buildLayer(slab: CloudSlab): LayerField {
    const radiusCells = Math.ceil(FIELD_RADIUS_M / layerCellSize(slab)) + 1
    const count = (radiusCells * 2 + 1) ** 2
    const box = new THREE.BoxGeometry(2, 2, 2)
    const geo = new THREE.InstancedBufferGeometry()
    geo.index = box.index
    geo.attributes = box.attributes
    geo.instanceCount = 0
    geo.setAttribute('offset', new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3))
    geo.setAttribute('radii', new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3))
    geo.setAttribute('seed', new THREE.InstancedBufferAttribute(new Float32Array(count), 1))
    const material = new THREE.ShaderMaterial({
      uniforms: { uNoise: { value: this.noise }, uDayness: { value: 1 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uDusk: { value: 0 },
        uCoverage: { value: COVERAGE[slab.cover] ?? 0.5 }, uNearSteps: { value: 18 }, uFarSteps: { value: 12 } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, side: THREE.BackSide,
    })
    const mesh = new THREE.Mesh(geo, material)
    mesh.frustumCulled = false
    mesh.userData.dirty = true
    this.scene.add(mesh)
    return { mesh, material, slab }
  }

  private fillLayer(l: LayerField, cellX: number, cellZ: number, offE: number, offN: number, camera: THREE.Vector3): void {
    const geo = l.mesh.geometry as THREE.InstancedBufferGeometry
    const offsets = geo.getAttribute('offset') as THREE.InstancedBufferAttribute
    const radii = geo.getAttribute('radii') as THREE.InstancedBufferAttribute
    const seeds = geo.getAttribute('seed') as THREE.InstancedBufferAttribute
    const cover = COVERAGE[l.slab.cover] ?? 0.5
    const baseM = l.slab.baseMslFt * 0.3048
    const thickM = Math.max(1, (l.slab.topMslFt - l.slab.baseMslFt) * 0.3048)
    const cellSize = layerCellSize(l.slab)
    const radiusCells = Math.ceil(FIELD_RADIUS_M / cellSize) + 1
    cellX = Math.floor((camera.x + offE) / cellSize)
    cellZ = Math.floor((-camera.z + offN) / cellSize)
    const sparse = l.slab.cover === 'FEW' || l.slab.cover === 'SCT'
    const instances: { x: number; z: number; gx: number; gz: number; distance: number }[] = []
    for (let dz = -radiusCells; dz <= radiusCells; dz++) for (let dx = -radiusCells; dx <= radiusCells; dx++) {
      const gx = cellX + dx, gz = cellZ + dz
      if (hash2(gx, gz, 1) >= cover) continue
      const jitter = cover > 0.6 ? 0.45 : 0.8
      const x = (gx + 0.5 + (hash2(gx, gz, 2) - 0.5) * jitter) * cellSize - offE
      const z = -((gz + 0.5 + (hash2(gx, gz, 3) - 0.5) * jitter) * cellSize - offN)
      const distance = (x - camera.x) ** 2 + (z - camera.z) ** 2
      if (distance > FIELD_RADIUS_M ** 2) continue
      instances.push({ x, z, gx, gz, distance })
    }
    instances.sort((a, b) => b.distance - a.distance)
    for (let i = 0; i < instances.length; i++) {
      const p = instances[i]!
      offsets.setXYZ(i, p.x, baseM + thickM * 0.5, p.z)
      const radius = cellSize * (sparse ? 0.48 + hash2(p.gx, p.gz, 5) * 0.19 : 0.72 + cover * 0.18 + hash2(p.gx, p.gz, 5) * 0.13)
      radii.setXYZ(i, radius, thickM * 0.5, radius * (0.85 + hash2(p.gx, p.gz, 7) * 0.3))
      seeds.setX(i, hash2(p.gx, p.gz, 6))
    }
    geo.instanceCount = instances.length
    offsets.needsUpdate = radii.needsUpdate = seeds.needsUpdate = true
    l.mesh.userData.dirty = false
  }
  onRebase(): void {
    this.lastCellX = Infinity
    for (const l of this.layers) l.mesh.userData.dirty = true
  }
  private dispose(): void {
    for (const l of this.layers) {
      this.scene.remove(l.mesh)
      l.mesh.geometry.dispose()
      l.material.dispose()
    }
    this.layers = []
  }
}
