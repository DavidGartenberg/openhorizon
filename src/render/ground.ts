import * as THREE from 'three'

/**
 * Phase 1 test field: a grass island at the origin with a 1000 m runway
 * heading north, sitting in the Phase 0 ocean. Real terrain and real
 * airports arrive in Phase 2 — this exists so ground handling, takeoffs and
 * landings can be hand-verified now.
 */
export function buildTestField(scene: THREE.Scene): void {
  // Grass island (render frame: x east, z south; north = -z).
  const grassTex = makeNoiseTexture('#3d5c35', '#47683c', 512)
  grassTex.repeat.set(40, 40)
  const island = new THREE.Mesh(
    new THREE.CircleGeometry(2500, 48),
    new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }),
  )
  island.rotation.x = -Math.PI / 2
  island.position.y = 0.02
  island.receiveShadow = true
  scene.add(island)

  // Runway: 1000 m × 23 m, from origin extending north.
  const asphaltTex = makeNoiseTexture('#3a3d40', '#43464a', 256)
  asphaltTex.repeat.set(2, 40)
  const runway = new THREE.Mesh(
    new THREE.PlaneGeometry(23, 1000),
    new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.95 }),
  )
  runway.rotation.x = -Math.PI / 2
  runway.position.set(0, 0.04, -500 + 30) // aircraft spawns ~30 m in
  runway.receiveShadow = true
  scene.add(runway)

  // Centerline dashes + threshold bars.
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xd8d8d0 })
  const dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 18), stripeMat, 26)
  const m = new THREE.Matrix4()
  const rot = new THREE.Matrix4().makeRotationX(-Math.PI / 2)
  for (let i = 0; i < 26; i++) {
    m.copy(rot).setPosition(0, 0.06, -i * 36 - 40 + 30)
    dashes.setMatrixAt(i, m)
  }
  scene.add(dashes)
  for (const end of [22, -952]) {
    for (let s = 0; s < 6; s++) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 12), stripeMat)
      bar.rotation.x = -Math.PI / 2
      bar.position.set(-8.75 + s * 3.5, 0.06, end)
      scene.add(bar)
    }
  }

  // A windsock pole by the runway (static visual for now).
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 5, 6),
    new THREE.MeshStandardMaterial({ color: 0xcccccc }),
  )
  pole.position.set(25, 2.5, -100)
  scene.add(pole)
  const sock = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 1.6, 8),
    new THREE.MeshStandardMaterial({ color: 0xe8641b }),
  )
  sock.rotation.z = Math.PI / 2
  sock.position.set(25.9, 4.8, -100)
  scene.add(sock)
}

function makeNoiseTexture(colorA: string, colorB: string, size: number): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = colorA
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = colorB
  for (let i = 0; i < size * 14; i++) {
    ctx.globalAlpha = 0.2 + Math.random() * 0.5
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2)
  }
  ctx.globalAlpha = 1
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
