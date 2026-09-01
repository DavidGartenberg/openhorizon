import * as THREE from 'three'
import { liveryMaterial } from './livery'
import { fowlerPose, spoileronRise } from './fowler'

/**
 * Primitive aircraft exteriors, proportioned from published dimensions
 * (user goal: "make the planes actually resemble their ones in real
 * life"). Still primitives — no glTF — but the silhouettes now follow
 * the real airframes:
 *  - C172S: 8.28 m × 11.0 m span, strut-braced high wing, wheel spats,
 *    dorsal fillet, ANIMATED slotted flaps.
 *  - J-3 Cub: 6.83 m × 10.74 m, Cub-yellow, rounded rudder and wingtips,
 *    exposed A-65 cylinders, bungee-sprung gear, boot cowl.
 *  - 737-800 (Boeing ACAP class data): 39.47 m long, 35.8 m span with
 *    blended winglets, 12.55 m tail, 3.76 m tube, 25° sweep; ANIMATED
 *    Fowler flaps (aft translation + droop), flight spoilers, and
 *    retracting gear.
 *
 * Model frame: nose −z, up +y, right wing +x (body x,y,z → model
 * y→+x, z→−y, x→−z applied at placement time).
 */
export interface SurfaceState {
  /** Flap deflection as a fraction of full travel [0,1]. */
  flapFrac: number
  /** Spoiler/speedbrake actuator position [0,1]. */
  spoilerFrac: number
  /** Roll input −1..1 for spoileron mixing (optional). */
  roll?: number
  /** Landing-gear position: 1 down … 0 retracted. */
  gearPos: number
  /** Reverser sleeve position: 0 stowed … 1 deployed. */
  reverseFrac?: number
}

export interface AircraftMesh {
  group: THREE.Group
  propDisc: THREE.Mesh
  /** Present when the mesh has animated control surfaces / gear. */
  surfaces?: (s: SurfaceState) => void
}

const WHITE = new THREE.MeshStandardMaterial({ color: 0xf2f3f5, roughness: 0.32, metalness: 0.12 })
const RED = new THREE.MeshStandardMaterial({ color: 0xa31621, roughness: 0.6 })
const DARK = new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.9 })
const BELLY = new THREE.MeshStandardMaterial({ color: 0xb9c0c7, roughness: 0.5, metalness: 0.25 })
// Animated-surface material: polygonOffset pulls flap/spoiler faces off
// the wing skin in depth so near-coplanar pairs never z-fight (N5
// "flashing" hunt — the 737's flap panels sat within centimetres of the
// wing underside and shimmered at distance).
const SURFACE = new THREE.MeshStandardMaterial({
  color: 0xaeb4bb, roughness: 0.45, metalness: 0.3,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
})
// Semi-transparent windshield hint — see the Task 2d note in git history:
// opaque glass read as a black void from the cockpit camera.
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

/** Tapered swept wing panel as a plan-view shape extruded to thickness.
 *  Corners in BODY coords: rootX = LE x at root, rootChord, tipX = LE x
 *  at tip, tipChord, from spanwise y0 to y1 (one side). Returns a mesh
 *  lying in the body x/y plane (thickness along z). */
function taperedPanel(
  rootLeX: number, rootChord: number, tipLeX: number, tipChord: number,
  y0: number, y1: number, thick: number, mat: THREE.Material,
): THREE.Mesh {
  const s = new THREE.Shape()
  // Shape space: (u,v) = (body y, body x)
  s.moveTo(y0, rootLeX)
  s.lineTo(y1, tipLeX)
  s.lineTo(y1, tipLeX - tipChord)
  s.lineTo(y0, rootLeX - rootChord)
  s.closePath()
  const geo = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false })
  // Shape lies in (x=bodyY, y=bodyX) with depth along +z. Rotate so the
  // panel lies flat: model x = bodyY (shape x ✓), model −z = bodyX (shape
  // y must map to model −z), extrusion depth becomes model y (up).
  geo.rotateX(-Math.PI / 2) // shape y → model −z? shape (x,y,z)→(x, z, −y): y→−z ✓ depth z→y ✓
  const m = new THREE.Mesh(geo, mat)
  m.castShadow = true
  return m
}

export function buildC172(): AircraftMesh {
  const g = new THREE.Group()
  const add = (mesh: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh => {
    placeBody(mesh, x, y, z)
    mesh.castShadow = true
    g.add(mesh)
    return mesh
  }

  // Fuselage: cabin box + tapering tail cone + cowl + dorsal fillet.
  add(new THREE.Mesh(new THREE.BoxGeometry(1.12, 1.3, 2.6), WHITE), 0.35, 0, -0.15)
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.55, 3.1, 8), WHITE)
  tail.rotation.x = Math.PI / 2
  add(tail, -2.5, 0, -0.28)
  const cowl = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.85, 0.85), RED)
  add(cowl, 1.75, 0, -0.05)
  const dorsal = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.42, 1.5), WHITE)
  dorsal.rotation.x = 0.25
  add(dorsal, -3.05, 0, -0.72)
  add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 0.12), GLASS), 1.12, 0, -0.72)

  // Wing: constant-chord center + tapered outer panels (the 172's planform),
  // struts, and ANIMATED flap sections on the inboard trailing edge.
  add(new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.15, 1.63), WHITE), 0.3, 0, -1.06)
  for (const side of [-1, 1]) {
    const outer = taperedPanel(1.11, 1.63, 0.86, 1.13, side * 2.7, side * 5.5, 0.13, WHITE)
    outer.position.y = 1.0 // model up = −body z (wing plane at z −1.06)
    g.add(outer)
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.05, 6), WHITE)
    strut.rotation.z = side * 0.55
    add(strut, 0.45, side * 1.35, -0.45)
  }
  // Flaps: single-slotted sections, body y ±(0.7 … 2.65), chord 0.53.
  const flapPivots: THREE.Group[] = []
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group()
    placeBody(pivot, -0.47, side * 1.68, -1.02) // hinge line at flap LE
    const flap = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.09, 0.53), SURFACE)
    flap.position.set(0, -0.07, 0.27) // clear of the wing underside (N5)
    flap.castShadow = true
    pivot.add(flap)
    g.add(pivot)
    flapPivots.push(pivot)
  }

  // Empennage.
  add(new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 1.15), WHITE), -3.9, 0, -0.35)
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.5, 1.25), RED)
  add(fin, -3.95, 0, -1.05)

  // Gear: struts + wheels + SPATS at the physics contact points.
  const wheelGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.15, 12)
  for (const [x, y, z] of [
    [1.3, 0, 1.3],
    [-0.35, -1.15, 1.32],
    [-0.35, 1.15, 1.32],
  ] as const) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6), WHITE)
    add(strut, x, y, z - 0.55)
    const wheel = new THREE.Mesh(wheelGeo, DARK)
    wheel.rotation.z = Math.PI / 2
    add(wheel, x, y, z - 0.19)
    const spat = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.2, 10, 1, false, 0, Math.PI), WHITE)
    spat.rotation.z = Math.PI / 2
    add(spat, x, y, z - 0.22)
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
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 1.9, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.9, transparent: true }),
  )
  placeBody(blade, 2.31, 0, -0.05)
  propDisc.userData.blade = blade
  g.add(blade)

  const surfaces = (s: SurfaceState): void => {
    for (const p of flapPivots) {
      // Single-slotted Fowler-type flap on tracks: slides AFT first (the
      // slot opens), then rotates to 30° late in the travel (fowler.ts).
      p.userData.z0 ??= p.position.z
      p.userData.y0 ??= p.position.y
      const fp = fowlerPose(s.flapFrac)
      p.position.z = (p.userData.z0 as number) + fp.ext * 0.16
      p.position.y = (p.userData.y0 as number) - fp.drop * 0.03
      p.rotation.x = fp.rot * 0.52 // trailing edge DOWN 30° (sign was inverted — user report N0)
    }
  }
  return { group: g, propDisc, surfaces }
}

const YELLOW = new THREE.MeshStandardMaterial({ color: 0xe6b800, roughness: 0.55 })
const SILVER = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.4, metalness: 0.35 })

/** Piper J-3 Cub: Cub-yellow taildragger — rounded rudder and wingtips,
 *  exposed A-65 cylinders, bungee gear, wheels at the physics points. */
export function buildCub(): AircraftMesh {
  const g = new THREE.Group()
  const add = (mesh: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh => {
    placeBody(mesh, x, y, z)
    mesh.castShadow = true
    g.add(mesh)
    return mesh
  }
  // Slab-sided fuselage + boot cowl + exposed cylinder heads.
  add(new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.05, 2.4), YELLOW), 0.2, 0, -0.2)
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.42, 3.0, 8), YELLOW)
  tail.rotation.x = Math.PI / 2
  add(tail, -2.4, 0, -0.3)
  add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.68, 0.6), DARK), 1.45, 0, -0.12)
  for (const side of [-1, 1]) {
    add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.34), DARK), 1.62, side * 0.32, -0.3)
  }
  add(new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 0.1), GLASS), 0.95, 0, -0.75)
  // High wing + rounded tips + struts.
  add(new THREE.Mesh(new THREE.BoxGeometry(10.1, 0.13, 1.6), YELLOW), 0.15, 0, -1.0)
  for (const side of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.13, 12, 1, false, side > 0 ? -Math.PI / 2 : Math.PI / 2, Math.PI), YELLOW)
    add(tip, 0.15, side * 5.05, -1.0)
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.9, 6), YELLOW)
    strut.rotation.z = side * 0.55
    add(strut, 0.3, side * 1.2, -0.45)
    const strut2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.9, 6), YELLOW)
    strut2.rotation.z = side * 0.62
    add(strut2, -0.15, side * 1.2, -0.45)
  }
  // Empennage: stab + the Cub's ROUNDED rudder (half-disc + slab).
  add(new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.09, 1.0), YELLOW), -3.75, 0, -0.4)
  add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.7), YELLOW), -3.6, 0, -0.85)
  const rudder = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 14, 1, false, 0, Math.PI), YELLOW)
  rudder.rotation.z = Math.PI / 2
  rudder.rotation.y = Math.PI / 2
  add(rudder, -4.0, 0, -1.05)
  // Bungee gear: V struts + wheels at the physics contact points.
  const wheelGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.12, 12)
  for (const [x, y, z] of [
    [0.25, -0.9, 1.25],
    [0.25, 0.9, 1.25],
  ] as const) {
    for (const lean of [-0.5, 0.35]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.05, 6), DARK)
      strut.rotation.x = lean
      add(strut, x + lean * 0.35, y * 0.85, z - 0.55)
    }
    const wheel = new THREE.Mesh(wheelGeo, DARK)
    wheel.rotation.z = Math.PI / 2
    add(wheel, x, y, z - 0.2)
  }
  const tailWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 8), DARK)
  tailWheel.rotation.z = Math.PI / 2
  add(tailWheel, -4.11, 0, 0.52)
  // Prop.
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.25, 10), SILVER)
  spinner.rotation.x = -Math.PI / 2
  add(spinner, 2.0, 0, -0.1)
  const propDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.915, 24),
    new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.18, side: THREE.DoubleSide }),
  )
  placeBody(propDisc, 2.02, 0, -0.1)
  g.add(propDisc)
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 1.8, 0.035),
    new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.9, transparent: true }),
  )
  placeBody(blade, 2.01, 0, -0.1)
  propDisc.userData.blade = blade
  g.add(blade)
  return { group: g, propDisc }
}

/** Boeing 737-800 — proportioned from the ACAP class dimensions
 *  (39.47 m × 35.8 m with winglets × 12.55 m tail, 3.76 m tube, 25°
 *  sweep). ANIMATED: Fowler flaps (aft travel + droop), flight
 *  spoilers, retracting gear. The prop-disc slot carries an invisible
 *  disc so updateProp stays a visual no-op for jets. */
export function buildB738(): AircraftMesh {
  const g = new THREE.Group()
  const reverserSleeves: THREE.Mesh[] = []
  const add = (mesh: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D => {
    placeBody(mesh, x, y, z)
    mesh.castShadow = true
    g.add(mesh)
    return mesh
  }
  // ---- fuselage: 3.76 m tube, nose + raked tail cone, window strip ----
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(1.88, 1.88, 28.6, 18), liveryMaterial('B738', 39.47))
  fuse.rotation.x = Math.PI / 2
  add(fuse, 0.9, 0, -0.6)
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1.88, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), WHITE)
  nose.rotation.x = -Math.PI / 2
  nose.scale.set(1, 1.7, 1) // dome axis is local Y — see airliner-mesh nose note
  add(nose, 15.2, 0, -0.6)
  const tailCone = new THREE.Mesh(new THREE.ConeGeometry(1.86, 8.2, 16), WHITE)
  // π/2 alone sends the apex aft; the extra Rz(π) that was here flipped
  // the apex FORWARD — a rearward-opening trumpet where the tail cone
  // should taper. MINUS the rake angle tilts the apex up.
  tailCone.rotation.x = Math.PI / 2 - 0.06 // apex aft, raked up
  add(tailCone, -17.5, 0, -1.05)
  // Window rows are painted into the livery wrap now; the cockpit glass
  // band stays geometric (it sits on the untextured nose cone).
  const cockpitGlass = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.9), DARK)
  add(cockpitGlass, 15.4, 0, -1.35)

  // ---- wings: 25° sweep, 6° dihedral, tapered; flaps + spoilers ----
  const flapPivots: THREE.Group[] = []
  const spoilerPivots: THREE.Group[] = []
  for (const side of [-1, 1]) {
    const wingGroup = new THREE.Group()
    // Panel in body coords from the root: LE at x 3.1 sweeping back.
    const y0 = 1.7, y1 = 16.6
    const rootChord = 7.2, tipChord = 1.55
    // Wing chord / trailing-edge locus at a span station — the taper
    // nearly cancels the LE sweep, so the TE sweeps only ~0.087 m/m.
    // Everything that must hug the TE (flaps, canoe fairings) derives
    // from these instead of the LE sweep.
    const chordAt = (fy: number): number => rootChord - (rootChord - tipChord) * (fy - y0) / (y1 - y0)
    const teX = (fy: number): number => 3.1 - Math.tan(0.436) * (fy - y0) - chordAt(fy)
    const panel = taperedPanel(3.1, rootChord, 3.1 - Math.tan(0.436) * (y1 - y0), tipChord, side * y0, side * y1, 0.3, BELLY)
    panel.position.y = -1.25 // low wing: plane near the belly line
    wingGroup.add(panel)
    // Blended winglet: a 2.4 m blade standing at the tip, canted ~15° out.
    const tipLeX = 3.1 - Math.tan(0.436) * (y1 - y0)
    // Shape space (chordZ, height): chordZ = −bodyX (same mapping as
    // taperedPanel), height straight up. One rotateY(−π/2) then puts
    // thickness on X, height on Y, chord on Z. (The original double
    // rotateY landed the blade's chord axis VERTICAL, burying the whole
    // winglet metres below the wing — found by the user: "the winglets
    // aren't on the plane".)
    const wlShape = new THREE.Shape()
    wlShape.moveTo(-tipLeX, 0)
    wlShape.lineTo(-(tipLeX - 0.35), 2.35)
    wlShape.lineTo(-(tipLeX - 0.95), 2.35)
    wlShape.lineTo(-(tipLeX - tipChord), 0)
    wlShape.closePath()
    const wlGeo = new THREE.ExtrudeGeometry(wlShape, { depth: 0.1, bevelEnabled: false })
    wlGeo.rotateY(-Math.PI / 2) // (x,y,z)→(−z,y,x): thickness, height ↑, chord
    const wl = new THREE.Mesh(wlGeo, BELLY)
    wl.castShadow = true
    wl.position.set(side * 16.55, -1.25, 0)
    wl.rotation.z = side * -0.26 // ~15° outward cant
    wingGroup.add(wl)
    // Dihedral for the whole wing side: positive side*θ raises the tip
    // (side * −0.105 DROPPED both tips — 6° of anhedral).
    wingGroup.rotation.z = side * 0.105 // ~6°
    g.add(wingGroup)

    // Fowler flaps: ONE continuous Fowler flap per wing (user request).
    // The flap follows the wing TRAILING-EDGE sweep, not the LE sweep —
    // the old 0.9·LE-sweep panel dragged the outboard end ~3 m behind
    // the wing at every setting (user: "every part of the flaps" must
    // stay connected). The LE nests 90% of the flap chord under the
    // wing, so even at full extension (35% chord) it never leaves the
    // TE shadow anywhere along the span.
    for (const [fy0, fy1, chord] of [
      [2.2, 12.0, 1.55],
    ] as const) {
      const pivot = new THREE.Group()
      const leX = teX(fy0) + chord * 0.9
      placeBody(pivot, leX, 0, 1.05)
      const flap = taperedPanel(0, chord, teX(fy1) - teX(fy0), chord * 0.85, side * fy0, side * fy1, 0.16, SURFACE)
      flap.position.y = -0.30 // real clearance below the wing skin (N5)
      pivot.add(flap)
      // Aft canoe halves ride the flap (split-fairing realism).
      for (const fy of [3.6, 6.8, 10.0]) {
        const zLE = teX(fy0) - teX(fy) // pivot-local aft offset of the flap LE here
        const aftCanoe = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 1.5), BELLY)
        aftCanoe.position.set(side * fy, -0.5, zLE + chord * 0.45)
        aftCanoe.castShadow = true
        pivot.add(aftCanoe)
      }
      wingGroup.add(pivot)
      flapPivots.push(pivot)
    }
    // Flap-track canoe fairings, SPLIT like the real thing (user: "the
    // connectors have to be filled in and connected to the wing"): a
    // fixed forward half whose top is buried in the wing underside, and
    // an aft half parented to the FLAP so it rides out and tilts with
    // it — the pair stays visually joined at every setting.
    // (Aft halves are added as flap-pivot children right after the flap
    // is built below; see flapCanoeStations.)
    for (const fy of [3.6, 6.8, 10.0]) {
      // Center just ahead of the TE locus: buried in the wing underside,
      // protruding ~0.4 m aft to meet the flap-riding aft half.
      const fixedCanoe = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.42, 1.8), BELLY)
      placeBody(fixedCanoe, teX(fy) + 0.5, side * fy, 1.18)
      fixedCanoe.castShadow = true
      wingGroup.add(fixedCanoe)
    }

    // Flight spoiler: ONE panel per wing ahead of the flap (user request).
    {
      const sy = 6.4
      const pivot = new THREE.Group()
      const leX = 3.1 - Math.tan(0.436) * (sy - 1.7) - 4.0
      placeBody(pivot, leX, side * sy, 0.88)
      const panel = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.05, 0.9), SURFACE)
      panel.position.set(0, 0.09, 0.45) // clear of the wing top skin (N5)
      panel.castShadow = true
      pivot.add(panel)
      wingGroup.add(pivot)
      spoilerPivots.push(pivot)
    }

    // ---- engines: CFM pods slung forward and below on pylons ----
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(1.32, 1.05, 4.2, 16), SILVER)
    eng.rotation.x = Math.PI / 2
    eng.scale.y = 0.92 // the CFM56's flattened bottom
    add(eng, 4.4, side * 5.75, 1.15)
    const inlet = new THREE.Mesh(new THREE.CylinderGeometry(1.34, 1.34, 0.35, 16), DARK)
    inlet.rotation.x = Math.PI / 2
    inlet.scale.y = 0.92
    add(inlet, 6.55, side * 5.75, 1.15)
    const spin = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.7, 12), SILVER)
    spin.rotation.x = Math.PI / 2
    add(spin, 6.8, side * 5.75, 1.15)
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.1, 2.6), BELLY)
    add(pylon, 3.4, side * 5.75, 0.15)
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(1.36, 1.1, 1.7, 16), SILVER)
    sleeve.rotation.x = Math.PI / 2
    sleeve.scale.y = 0.92
    add(sleeve, 3.1, side * 5.75, 1.15)
    sleeve.userData.stowZ = sleeve.position.z
    reverserSleeves.push(sleeve)
    const cascade = new THREE.Mesh(new THREE.CylinderGeometry(1.28, 1.28, 1.5, 16), DARK)
    cascade.rotation.x = Math.PI / 2
    cascade.scale.y = 0.92
    add(cascade, 3.1, side * 5.75, 1.15)
  }

  // ---- empennage: swept fin to 12.55 m, swept stabs ----
  const fin = taperedPanel(-12.6, 6.4, -18.8, 1.9, 0, 7.7, 0.26, WHITE)
  // +π/2 stands the span UP — the original −π/2 pointed it down into the
  // belly; the "fin" every screenshot showed was just the red flash box
  // at the fin-top position (user: "make the tail upright").
  fin.rotation.z = Math.PI / 2
  placeBody(fin, 0, 0.05, -2.2)
  g.add(fin)
  const finFlash = new THREE.Mesh(new THREE.BoxGeometry(0.26, 2.2, 1.4), RED)
  add(finFlash, -17.6, 0, -7.6)
  // American-style flag tail on both fin faces.
  {
    const cols = [0xb61f2e, 0xeef0f2, 0x1f3a93]
    cols.forEach((col, i) => {
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 6.9, 1.05),
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.45 }),
      )
      add(slab, -14.6 - i * 1.15, 0, -5.7)
      slab.rotation.x = 0.62 // follow the fin sweep
    })
  }
  for (const side of [-1, 1]) {
    const stab = taperedPanel(-15.6, 3.4, -18.9, 1.2, side * 0.4, side * 7.2, 0.16, BELLY)
    stab.position.y = 0.9
    g.add(stab)
  }

  // ---- gear: retracting; twin-wheel nose, twin-wheel main bogies ----
  const gearGroups: { grp: THREE.Group; nose: boolean; fold: number }[] = []
  const mkWheel = (r: number, w: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14), DARK)
    m.rotation.z = Math.PI / 2
    m.castShadow = true
    return m
  }
  const doorPivots: { pivot: THREE.Group; open: number }[] = []
  for (const [x, y, z, isNose] of [
    [14.6, 0, 2.84, true],
    [-1.0, -2.86, 2.9, false],
    [-1.0, 2.86, 2.9, false],
  ] as const) {
    const grp = new THREE.Group()
    placeBody(grp, x, y, z - 1.9) // pivot at the top of the strut
    const r = isNose ? 0.38 : 0.55
    // Strut runs pivot→axle; the wheel CENTER rides one radius above the
    // physics contact point (body z above) so the tire bottom meets the
    // runway — wheels used to be centered AT contact, sinking half a
    // tire (0.55 m mains) into the pavement.
    const strutLen = 1.9 - r
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, strutLen, 8), SILVER)
    strut.position.y = -strutLen / 2
    strut.castShadow = true
    grp.add(strut)
    for (const wy of isNose ? [-0.25, 0.25] : [-0.3, 0.3]) {
      const wheel = mkWheel(r, 0.34)
      wheel.position.set(wy, -(1.9 - r), 0)
      grp.add(wheel)
    }
    g.add(grp)
    // Per-leg fold: swing inboard to just short of the centerline; the
    // short 737 arm caps at 90° so the stowed wheel lands at |x|≈1.5,
    // its face near-flush with the belly (the real 737 look).
    const fold = isNose ? 1.5 : Math.asin(Math.min((Math.abs(y) - r * 0.4) / strutLen, 1))
    gearGroups.push({ grp, nose: isNose, fold })
    if (isNose) {
      // Nose clamshell doors (the ONLY doors on a real 737 — the mains
      // ride exposed with hubcaps flush against the belly, recorded as
      // the honest type difference). Hinged at the bay's outboard edges,
      // swinging about the fore-aft axis; the leg folds forward about X.
      const bayLen = strutLen + r * 2
      for (const sgn of [-1, 1] as const) {
        const doorPivot = new THREE.Group()
        placeBody(doorPivot, x + (strutLen + r) / 2, sgn * 0.4, 1.15)
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, bayLen), BELLY)
        panel.position.set(-sgn * 0.21, 0, 0)
        panel.castShadow = true
        doorPivot.add(panel)
        g.add(doorPivot)
        doorPivots.push({ pivot: doorPivot, open: sgn * 1.5 })
      }
    }
  }
  // Doorless main wells: dark discs on the belly at the stowed wheel
  // stations — open wells with the gear down, flush hubcaps with it up.
  for (const sgn of [-1, 1]) {
    const well = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.03, 16), DARK)
    placeBody(well, -1.0, sgn * 1.51, 1.27)
    g.add(well)
  }

  // Invisible prop-disc slot (interface uniformity; jets spin nothing).
  const propDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.01, 6),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
  )
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.01, 0.01, 0.01),
    new THREE.MeshStandardMaterial({ transparent: true, opacity: 0 }),
  )
  propDisc.userData.blade = blade
  g.add(propDisc)
  g.add(blade)

  const surfaces = (s: SurfaceState): void => {
    // Fowler motion: translate aft + down, then droop. Model frame:
    // aft = +z, down = −y.
    for (const p of flapPivots) {
      p.position.z = p.userData.z0 ?? (p.userData.z0 = p.position.z)
      p.position.y = p.userData.y0 ?? (p.userData.y0 = p.position.y)
      // Hooked-track Fowler schedule (fowler.ts): aft extension completes
      // by mid-travel, the big rotation arrives late — extend OUT, then DOWN.
      const fp = fowlerPose(s.flapFrac)
      // Extension capped at ~60% of the flap's own chord so the panel's
      // LE stays tucked under the wing TE (user: "the flap still has to
      // be attached to the wing"); near-flat tracks (tiny drop) keep the
      // panel well clear of the ground at flaps 40.
      // Slot stays tight (~35% of flap chord): the panel never leaves the
      // wing's shadow, and 30° max visual deflection keeps the trailing
      // edge clear of the runway even tail-down in the flare (user: "the
      // flaps cannot go into the ground").
      p.position.z += fp.ext * 0.55
      p.position.y -= fp.drop * 0.06
      p.rotation.x = fp.rot * 0.52
    }
    // Spoilerons: the down-going wing's panel rises with roll input, on
    // top of the speedbrake setting (real flight-spoiler mixing); full
    // deploy stands ~60° like real ground spoilers.
    spoilerPivots.forEach((p, i) => {
      p.rotation.x = -spoileronRise(s.spoilerFrac, s.roll ?? 0, i === 0 ? 0 : 1) * 1.05
    })
    for (const sl of reverserSleeves) sl.position.z = (sl.userData.stowZ as number) + (s.reverseFrac ?? 0) * 0.85
    for (const { grp, nose, fold } of gearGroups) {
      // Nose folds forward; mains fold INBOARD toward the belly (the old
      // sign swung them outboard up through the wing).
      if (nose) grp.rotation.x = (1 - s.gearPos) * fold
      else grp.rotation.z = (1 - s.gearPos) * (grp.position.x > 0 ? -fold : fold)
      grp.visible = s.gearPos > 0.02
    }
    // Nose doors trail the gear (clamp(gearPos*3)): open through most of
    // the travel, closing over the bay as the leg stows.
    const doorFrac = Math.min(Math.max(s.gearPos * 3, 0), 1)
    for (const d of doorPivots) d.pivot.rotation.z = d.open * doorFrac
  }
  // Real light anchors: winglet bases and fin (the box fallback put the
  // nav lights metres above the low wing — user-reported). Wingtips
  // recomputed for the fixed dihedral: (16.55, −1.25) rotated by +0.105
  // about the root lands the winglet base at (±16.59, +0.49).
  g.userData.lightAnchors = {
    wingtipL: new THREE.Vector3(-16.59, 0.49, 4.2),
    wingtipR: new THREE.Vector3(16.59, 0.49, 4.2),
    // Tail nav at the FIN TIP (was 55% up, inside the skin); beacon on
    // the fuselage spine like the real 737's upper anti-collision light.
    tail: new THREE.Vector3(0, 9.9, 19.7),
    beacon: new THREE.Vector3(0, 2.55, 3),
  }
  return { group: g, propDisc, surfaces }
}

/** Spin the prop visuals; blade visible at low RPM, blur disc at high. */
export function updateProp(mesh: AircraftMesh, rpm: number, dt: number): void {
  const omega = (rpm * Math.PI) / 30
  const blade = mesh.propDisc.userData.blade as THREE.Mesh
  blade.rotation.z += omega * dt
  const blur = Math.min(Math.max((rpm - 400) / 500, 0), 1)
  // Faint: from the cockpit eyepoint the disc fills the forward view and
  // read as a grey dome at 0.2 opacity (cockpit polish pass); a real
  // spinning prop is a barely-there shimmer.
  ;(mesh.propDisc.material as THREE.MeshBasicMaterial).opacity = 0.015 + 0.06 * blur
  ;(blade.material as THREE.MeshStandardMaterial).opacity = 1 - blur * 0.85
  ;(blade.material as THREE.MeshStandardMaterial).transparent = true
}
