/**
 * Contrail / wingtip-vapour preview: flies a dummy 737-sized emitter group
 * along a straight track for `secs` seconds, then renders the real Trails
 * ribbons against the real SkyDome. Query: ?mode=contrail|vapor&sun=deg&secs=s
 */
import * as THREE from 'three'
import { SkyDome } from '../../src/render/sky'
import { Trails } from '../../src/render/contrails'

const qs = new URLSearchParams(location.search)
const mode = qs.get('mode') ?? 'contrail'
const result: { done: boolean; errors: string[] } = { done: false, errors: [] }
;(window as unknown as { __preview: typeof result }).__preview = result
const origError = console.error
console.error = (...a: unknown[]) => { result.errors.push(a.map(String).join(' ')); origError(...a) }

const W = 1280, H = 720
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setSize(W, H)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMappingExposure = 0.8
document.body.appendChild(renderer.domElement)
const scene = new THREE.Scene()
const sky = new SkyDome(scene)
const date = new Date(qs.get('date') ?? '2026-07-15T20:30:00Z')
const sunDir = sky.update(date, 37.5, -122.0)
const trails = new Trails(scene, sky.radianceTexture)
const span = 35.8
trails.setEmitters(Trails.layoutFor(span, 2, 0.17 * span))
const group = new THREE.Group()
const box = new THREE.Mesh(new THREE.BoxGeometry(span, 2, 38), new THREE.MeshBasicMaterial({ color: 0xdddddd }))
group.add(box)
scene.add(group)
const alt = mode === 'contrail' ? 10_500 : 600
const speed = mode === 'contrail' ? 230 : 75
const camera = new THREE.PerspectiveCamera(60, W / H, 1, 2_000_000)
const secs = Number(qs.get('secs') ?? (mode === 'contrail' ? 40 : 3))
trails.contrailLifeS = 150
trails.contrailSpacingM = (speed * trails.contrailLifeS) / 190
// Fly north (−z) from z = 0.
for (let t = 0; t <= secs; t += 1 / 30) {
  group.position.set(0, alt, -speed * t)
  if (mode === 'vapor') group.rotation.z = 0.0
  trails.update(t, group, camera, mode === 'contrail' ? 1 : 0, mode === 'vapor' ? 1 : 0, sunDir, 1)
}
const head = -speed * secs
if (mode === 'contrail') { camera.position.set(1800, alt - 900, head + 4200); camera.lookAt(0, alt, head + 2600) }
else { camera.position.set(28, alt + 4, head + 70); camera.lookAt(0, alt, head) }
trails.update(secs, group, camera, mode === 'contrail' ? 1 : 0, mode === 'vapor' ? 1 : 0, sunDir, 1)
sky.updateEnvironment(renderer, scene, camera.position)
let frames = 0
function loop(): void {
  renderer.render(scene, camera)
  if (++frames < 3) { requestAnimationFrame(loop); return }
  result.done = true
}
loop()
