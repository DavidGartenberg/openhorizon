import * as THREE from 'three'

export interface SceneContext {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
}

export function createScene(container: HTMLElement): SceneContext {
  // reversedDepthBuffer (user: "the entire screen is flashing on final"):
  // the scene spans a 0.02 m cockpit near plane to a 2,000 km far plane —
  // a ratio no 24-bit depth buffer survives. At 3 km the depth resolution
  // was ~27 m, so the y=0 ocean and near-sea-level coastal terrain on the
  // KHAF final z-fought as giant flickering wedges across the whole
  // cockpit view. Reversed-Z (EXT_clip_control, all modern browsers)
  // makes precision near-uniform at every distance; where the extension
  // is missing three silently falls back, and the raised COCKPIT_NEAR in
  // main.ts still buys 4x the old precision.
  const renderer = new THREE.WebGLRenderer({ antialias: true, reversedDepthBuffer: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.62 // msfs-look: punchier mids (was 0.55)
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()

  // Far plane must contain the sky dome (450 km scale); a single ocean plane
  // means no depth-fighting risk at Phase 0.
  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.5,
    2_000_000,
  )
  camera.position.set(0, 60, 0)

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  return { renderer, scene, camera }
}
