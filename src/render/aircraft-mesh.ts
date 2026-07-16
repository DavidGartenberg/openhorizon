import * as THREE from 'three'

/**
 * Phase 1 placeholder C172 built from primitives — correct proportions and
 * gear positions matching the physics contact points (§ plan). The proper
 * glTF exterior arrives with Phase 3's cockpit work.
 *
 * Model frame: nose −z, up +y, right wing +x (body x,y,z → model y→+x,
 * z→−y, x→−z applied at placement time).
 */
export interface AircraftMesh {
  group: THREE.Group
  propDisc: THREE.Mesh
}

const WHITE = new THREE.MeshStandardMaterial({ color: 0xf2f3f5, roughness: 0.55, metalness: 0.1 })
const RED = new THREE.MeshStandardMaterial({ color: 0xa31621, roughness: 0.6 })
const DARK = new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.9 })
// Semi-transparent (was fully opaque): this box is a flat "windshield hint",
// never meant to be looked at face-on — from outside it only ever appeared
// as a small, oblique, mostly-shadowed sliver, so its opacity never
// mattered. Task 2d's cockpit camera is the first view that looks straight
// through it, filling much of the frame, and this face happens to point
// away from the sun (dim hemisphere-ambient-only lighting, no direct
// light), so as an opaque solid it rendered as a large flat black void
// rather than a windshield. Real glass is transmissive; making this one
// partially see-through (rather than juicing its lit brightness, which
// would just be a differently-wrong flat color) lets the actual sky/exterior
// show through, which is what a windshield is supposed to do. metalness 0
// (was 0.4) also avoids `MeshStandardMaterial`'s "black metal with no
// envMap" trap for the still-visible tinted portion.
const GLASS = new THREE.MeshStandardMaterial({
  color: 0x223138,
  roughness: 0.15,
  metalness: 0,
  transparent: true,
  opacity: 0.25,
})

/** Place a mesh using BODY coordinates (x fwd, y right, z down). */
function placeBody(m: THREE.Object3D, x: number, y: number, z: number): void {
  m.position.set(y, -z, -x)
}

export function buildC172(): AircraftMesh {
  const g = new THREE.Group()
  const add = (mesh: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh => {
    placeBody(mesh, x, y, z)
    mesh.castShadow = true
    g.add(mesh)
    return mesh
  }

  // Fuselage: cabin box + tapering tail cone + cowl.
  add(new THREE.Mesh(new THREE.BoxGeometry(1.12, 1.3, 2.6), WHITE), 0.35, 0, -0.15)
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.55, 3.1, 8), WHITE)
  tail.rotation.x = Math.PI / 2 // axis along model z
  add(tail, -2.5, 0, -0.28)
  const cowl = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.85, 0.85), RED)
  add(cowl, 1.75, 0, -0.05)
  // Windshield hint. Depth (fore-aft) was 0.6, spanning body-x 0.75-1.35 —
  // fine as a small oblique sliver seen from outside, but that range
  // physically overlaps `cockpit.ts`'s panel bezel/PFD/MFD (body-x
  // ~0.99-1.05), which Task 2d's cockpit camera looks at head-on for the
  // first time. With this box now semi-transparent (see GLASS, above) so it
  // doesn't read as a solid black void, that overlap meant the glass sat
  // *in front of* the avionics screens from the pilot's eyepoint, tinting/
  // dimming them. Shrunk to 0.12 and moved forward so its aft face (~1.06)
  // clears the PFD/MFD screen plane (~0.99) — still overlaps the thin bezel
  // box by a hair, but that's opaque and unaffected by any of this.
  add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 0.12), GLASS), 1.12, 0, -0.72)

  // Wing (high, slight visible thickness), struts.
  add(new THREE.Mesh(new THREE.BoxGeometry(11.0, 0.15, 1.5), WHITE), 0.25, 0, -1.05)
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.05, 6), WHITE)
    strut.rotation.z = side * 0.55
    add(strut, 0.45, side * 1.35, -0.45)
  }

  // Empennage.
  add(new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 1.15), WHITE), -3.9, 0, -0.35) // h-stab
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.5, 1.25), RED)
  add(fin, -3.95, 0, -1.05)

  // Gear: struts + wheels at the physics contact points.
  const wheelGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.15, 12)
  for (const [x, y, z] of [
    [1.3, 0, 1.3],
    [-0.35, -1.15, 1.32],
    [-0.35, 1.15, 1.32],
  ] as const) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6), WHITE)
    add(strut, x, y, z - 0.55)
    const wheel = new THREE.Mesh(wheelGeo, DARK)
    wheel.rotation.z = Math.PI / 2 // roll axis lateral
    add(wheel, x, y, z - 0.19)
  }

  // Prop: spinner + translucent disc that spins with RPM.
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.35, 10), WHITE)
  spinner.rotation.x = -Math.PI / 2
  add(spinner, 2.3, 0, -0.05)
  const propDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.965, 24),
    new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.18, side: THREE.DoubleSide }),
  )
  placeBody(propDisc, 2.32, 0, -0.05)
  g.add(propDisc)
  // Two blade hints (visible when slow).
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.9, 0.04), DARK)
  placeBody(blade, 2.31, 0, -0.05)
  propDisc.userData.blade = blade
  g.add(blade)

  return { group: g, propDisc }
}

/** Spin the prop visuals; blade visible at low RPM, blur disc at high. */
export function updateProp(mesh: AircraftMesh, rpm: number, dt: number): void {
  const omega = (rpm * Math.PI) / 30
  const blade = mesh.propDisc.userData.blade as THREE.Mesh
  blade.rotation.z += omega * dt
  const blur = Math.min(Math.max((rpm - 400) / 500, 0), 1)
  ;(mesh.propDisc.material as THREE.MeshBasicMaterial).opacity = 0.05 + 0.16 * blur
  ;(blade.material as THREE.MeshStandardMaterial).opacity = 1 - blur * 0.85
  ;(blade.material as THREE.MeshStandardMaterial).transparent = true
}
