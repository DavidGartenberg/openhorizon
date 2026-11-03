/**
 * 737 cabin preview: the real flight deck + cabin inside the real B738
 * fuselage with the exterior skin hidden (as in the sim's cockpit view).
 * Query: ?view=aft|turned|aisle|window|door|wing|cross|rear|forward|sidewin
 * Results on window.__preview: { done, errors }.
 */
import * as THREE from 'three'
import { buildB738 } from '../../src/render/aircraft-mesh'
import { buildCockpit } from '../../src/render/cockpit'
import { cockpitProfile } from '../../src/render/cockpit-profile'
import { B738 } from '../../src/sim/aircraft/b738'
import { WINDSCREEN_WEATHER } from '../../src/render/windscreen'
import { B738_DECK_NOSE_SHIFT_M } from '../../src/render/cockpit-profile'
import { CABIN } from '../../src/render/cabin-737'

const qs = new URLSearchParams(location.search)
const view = qs.get('view') ?? 'aft'
WINDSCREEN_WEATHER.uRain.value = Number(qs.get('rain') ?? 0)
WINDSCREEN_WEATHER.uIce.value = Number(qs.get('ice') ?? 0)
WINDSCREEN_WEATHER.uSpeed.value = Number(qs.get('speed') ?? 0)
WINDSCREEN_WEATHER.uTime.value = 37.3
const result: { done: boolean; errors: string[] } = { done: false, errors: [] }
;(window as unknown as { __preview: typeof result }).__preview = result
const origError = console.error
console.error = (...a: unknown[]) => { result.errors.push(a.map(String).join(' ')); origError(...a) }
window.addEventListener('error', e => result.errors.push(String(e.message)))

const W = 1280, H = 720
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setSize(W, H)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMappingExposure = 0.8
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x7fa6d0)
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x6b7a52, 0.9))
const sun = new THREE.DirectionalLight(0xfff2dc, 2.6)
sun.position.set(-18, 26, -8)
sun.castShadow = true
sun.shadow.camera.left = -14; sun.shadow.camera.right = 14; sun.shadow.camera.top = 14; sun.shadow.camera.bottom = -14
sun.shadow.camera.far = 90
sun.shadow.mapSize.set(2048, 2048)
sun.target.position.set(0, 0, 4)
scene.add(sun, sun.target)
const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0x5d7a45, roughness: 1 }))
ground.rotation.x = -Math.PI / 2
ground.position.y = -4
ground.receiveShadow = true
scene.add(ground)

const mesh = buildB738()
const profile = cockpitProfile('737', B738, { label: 'Boeing 737-800', powerplant: { kind: 'jet', count: 2 } })
buildCockpit(mesh.group, profile, B738.flapDetentsDeg, { speedbrake: true })
// The sim hides exterior skin + glazing in the cockpit view.
mesh.group.traverse(o => { if (o.userData.exteriorCabin) o.visible = false })
mesh.group.traverse(o => {
  if (!(o instanceof THREE.Mesh)) return
  const ms = Array.isArray(o.material) ? o.material : [o.material]
  if (ms.every(m => m instanceof THREE.MeshStandardMaterial && !m.transparent)) { o.castShadow = true; o.receiveShadow = true }
})
scene.add(mesh.group)

const camera = new THREE.PerspectiveCamera(view === 'cross' ? 60 : 75, W / H, 0.05, 5000)
const S = B738_DECK_NOSE_SHIFT_M, F = CABIN.frontFwd
const at: Record<string, [number[], number[]]> = {
  // [camera, target] in body frame (x lat, y up, z = -forward). The deck sits
  // at the nose station (S m forward); the cabin fills the barrel behind it.
  aft: [[-0.5, 1.03, -0.45 - S], [0, 0.85, 8 - S]],
  forward: [[-0.5, 1.03, -0.45 - S], [-0.5, 0.9, -12 - S]],
  sidewin: [[-0.5, 1.03, -0.45 - S], [-6, 0.9, -1.2 - S]],
  // What the sim's turn-around camera shows (CockpitCamera aftEye blend).
  turned: [[0, 1.2, -(F - 0.18)], [0, 0.95, 9]],
  aisle: [[0, 1.2, -(F - 0.6)], [0, 0.95, 9]],
  window: [[0.75, 0.9, -0.5], [-1.9, 0.95, -1.2]],
  door: [[0, 1.15, -(F - 4.5)], [0, 1.0, -(F + 1)]],
  wing: [[1.1, 0.85, -0.5], [4.5, 0.2, -1.5]],
  cross: [[0, 0.7, -(F - 6.4)], [0, 0.7, -F]],
  rear: [[0, 1.2, 5.5], [0, 0.9, -F]],
}
const [cp, tp] = at[view] ?? at.aft!
camera.position.set(cp![0]!, cp![1]!, cp![2]!)
camera.lookAt(tp![0]!, tp![1]!, tp![2]!)
// Let the real emissive interior fill run at full daylight.
let frames = 0
function loop(): void {
  renderer.render(scene, camera)
  if (++frames < 3) { requestAnimationFrame(loop); return }
  result.done = true
}
loop()
