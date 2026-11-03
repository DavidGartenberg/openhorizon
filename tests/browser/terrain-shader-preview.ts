/**
 * Terrain shader preview harness: renders a procedural alpine heightfield
 * through the REAL terrain program (TERRAIN_VERT / TERRAIN_FRAG) and the real
 * SkyDome, so shader edits can be compile-checked and eyeballed without
 * downloading tiles. Query: ?view=far|near|dusk|snow&imagery=0|1
 *
 * Results are published on window.__preview: { done, errors, programs }.
 */
import * as THREE from 'three'
import { SkyDome } from '../../src/render/sky'
import { TERRAIN_VERT, TERRAIN_FRAG } from '../../src/world/terrain-shader'

const params = new URLSearchParams(location.search)
const view = params.get('view') ?? 'far'
const withImagery = params.get('imagery') === '1'
const result: { done: boolean; errors: string[]; programs: number } = { done: false, errors: [], programs: 0 }
;(window as unknown as { __preview: typeof result }).__preview = result
const origError = console.error
console.error = (...a: unknown[]) => { result.errors.push(a.map(String).join(' ')); origError(...a) }
window.addEventListener('error', e => result.errors.push(String(e.message)))

const W = 1280, H = 720
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true })
renderer.setSize(W, H)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMappingExposure = 0.8
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const sky = new SkyDome(scene)

// ---- procedural alpine heightfield (x east, z south, y up; metres) --------
function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}
function terrainHeight(x: number, z: number): number {
  let sum = 0, amp = 1, f = 1 / 5200, norm = 0
  for (let i = 0; i < 7; i++) {
    const n = 1 - Math.abs(2 * vnoise(x * f + 11.3 * i, z * f - 7.1 * i) - 1) // ridged
    sum += amp * n * n
    norm += amp
    amp *= 0.5
    f *= 2.07
  }
  const ridge = sum / norm
  const basin = Math.min(1, Math.max(0, (-z + 2500) / 5000)) // rises to the north
  return 90 + ridge * 3300 * (0.25 + 0.75 * basin)
}

const SIZE = 14000, N = 360
const pos = new Float32Array(N * N * 3)
const nor = new Float32Array(N * N * 3)
const col = new Float32Array(N * N * 3)
const uv = new Float32Array(N * N * 2)
const urban = new Float32Array(N * N)
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const x = (i / (N - 1) - 0.5) * SIZE, z = (j / (N - 1) - 0.5) * SIZE
  const h = terrainHeight(x, z), k = j * N + i
  pos.set([x, h, z], k * 3)
  const e = SIZE / (N - 1)
  const dx = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e)
  const dz = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e)
  const l = Math.hypot(dx, 1, dz)
  nor.set([-dx / l, 1 / l, -dz / l], k * 3)
  // Same elevation/slope ramp the terrain worker uses (see colorFor).
  const slope = Math.hypot(dx, dz)
  let r: number, g: number, b: number
  if (h < 400) { r = 0.30; g = 0.42; b = 0.22 } else if (h < 1600) { r = 0.36; g = 0.44; b = 0.26 }
  else if (h < 3000) { r = 0.48; g = 0.46; b = 0.44 } else { r = 0.88; g = 0.9; b = 0.94 }
  const rocky = Math.min(slope * 1.6, 1) * (h > 200 ? 1 : 0.3)
  col.set([r * (1 - rocky) + 0.45 * rocky, g * (1 - rocky) + 0.42 * rocky, b * (1 - rocky) + 0.4 * rocky], k * 3)
  uv.set([i / (N - 1), 1 - j / (N - 1)], k * 2)
  urban[k] = 0
}
const idx = new Uint32Array((N - 1) * (N - 1) * 6)
let p = 0
for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
  const a = j * N + i, b = a + 1, c = a + N, d = c + 1
  idx.set([a, c, b, b, c, d], p); p += 6
}
const geo = new THREE.BufferGeometry()
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
geo.setAttribute('urban', new THREE.BufferAttribute(urban, 1))
geo.setIndex(new THREE.BufferAttribute(idx, 1))

// Optional fake "photo" so the imagery branch is exercised too.
const imgData = new Uint8Array(256 * 256 * 4)
for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
  const n = vnoise(x / 9, y / 9) * 0.5 + vnoise(x / 3, y / 3) * 0.5
  imgData.set([70 + 70 * n, 90 + 60 * n, 55 + 40 * n, 255], (y * 256 + x) * 4)
}
const imagery = new THREE.DataTexture(imgData, 256, 256)
imagery.colorSpace = THREE.SRGBColorSpace
imagery.minFilter = THREE.LinearMipmapLinearFilter
imagery.generateMipmaps = true
imagery.needsUpdate = true
const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
white.needsUpdate = true
const coverage = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat)
coverage.needsUpdate = true

const material = new THREE.ShaderMaterial({
  uniforms: {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uDayness: { value: 1 },
    uLowSun: { value: 0 },
    uSunTransmission: { value: 1 },
    uCloudDensity: { value: 0 },
    uCloudColor: { value: new THREE.Color(0xc8ccd2) },
    uFogDensity: { value: 1.2e-5 },
    uImagery: { value: withImagery ? imagery : white },
    uSky: { value: sky.radianceTexture },
    uWorldOffset: { value: new THREE.Vector2() },
    uHasImagery: { value: withImagery ? 1 : 0 },
    uNormalScale: { value: new THREE.Vector2(1, 1) },
    uCoverage: { value: coverage },
    uCoverageSize: { value: 0 },
    uCoverageRows: { value: new Array(65).fill(0) },
  },
  vertexShader: TERRAIN_VERT,
  fragmentShader: TERRAIN_FRAG,
})
scene.add(new THREE.Mesh(geo, material))

// ---- cameras / time of day -------------------------------------------------
const camera = new THREE.PerspectiveCamera(70, W / H, 2, 2_000_000)
const when: Record<string, string> = {
  far: '2026-07-15T20:30:00Z', near: '2026-07-15T21:00:00Z',
  snow: '2026-07-15T19:30:00Z', dusk: '2026-07-16T02:50:00Z',
}
const date = new Date(when[view] ?? when.far!)
const sunDir = sky.update(date, 37.5, -122.0)
const elev = sky.elevationDeg
material.uniforms.uSunDir!.value.copy(sunDir)
material.uniforms.uDayness!.value = THREE.MathUtils.smoothstep(elev, -4, 10)
material.uniforms.uLowSun!.value = 1 - THREE.MathUtils.smoothstep(elev, 0, 25)

if (view === 'near') { camera.position.set(-300, 900, 700); camera.lookAt(500, 700, -2200) }
else if (view === 'snow') { camera.position.set(0, 2600, 3200); camera.lookAt(0, 2300, -3000) }
else if (view === 'dusk') { camera.position.set(0, 1600, 5200); camera.lookAt(0, 900, -3000) }
else { camera.position.set(0, 1700, 6200); camera.lookAt(0, 800, -3000) }
camera.updateMatrixWorld()
sky.updateEnvironment(renderer, scene, camera.position)

// Render a few frames (sky lookup bake settles), then publish.
let frames = 0
function loop(): void {
  renderer.render(scene, camera)
  if (++frames < 4) { requestAnimationFrame(loop); return }
  result.programs = renderer.info.programs?.length ?? 0
  result.done = true
}
loop()
