import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { fowlerPose, spoileronRise } from './fowler'
import { aircraftPaint, aircraftMetal, aircraftRubber } from './aircraft-materials'
import { profiledPanel, profiledPanelGeometry, buildTurbofan, buildAircraftWheel } from './aircraft-components'
import { finishC172Body, finishC172Wing } from './c172-finish'
import { addC172Details, c172PropGeometry } from './c172-details'
import { tailFlagMaterial } from './jet-finish'
import { buildJetShell } from './jet-shell'
import { buildDetailedCub } from './cub-mesh'
import { createHingeFrame, attachSkin, type HingeFrame } from './procedural-surfaces'

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
  /** Effective pull/nose-up and right-pedal commands, −1..1. */
  pitch?: number
  yaw?: number
  /** Actual elevator-only aerodynamic angle: negative is trailing edge up.
   * Trimmable-stabilizer contribution must be separate. */
  elevatorRad?: number
  stabilizerRad?: number
  /** Pre-trim elevator command and separate trim authority. Native aircraft
   * may have a stabilizer even when a generic physics anchor uses tabs. */
  elevatorCommandRad?: number
  trimRad?: number
  /** Normalized trim inputs for original authored trim tabs. */
  trim?: number
  rudderTrim?: number
  /** Landing-gear position: 1 down … 0 retracted. */
  gearPos: number
  /** Reverser sleeve position: 0 stowed … 1 deployed. */
  reverseFrac?: number
  /** Signed DG-800S common-mode flap position, trailing-edge down positive. */
  flapsDeg?: number
  /** Explicit final DG-800S mixed flaperon angles; down is positive. */
  flaperonLeftRad?: number
  flaperonRightRad?: number
}

export interface AircraftMesh {
  /** Optional native-model propeller/fan animator. */
  updateProp?: (rpm: number, dt: number) => void
  group: THREE.Group
  propDisc: THREE.Mesh
  /** Present when the mesh has animated control surfaces / gear. */
  surfaces?: (s: SurfaceState) => void
}

const WHITE = aircraftPaint(0xf2f3f5)
const RED = aircraftPaint(0xa31621)
const DARK = aircraftRubber()
const BELLY = aircraftPaint(0xb9c0c7, {roughness:.43,metalness:.18})
// Animated-surface material: polygonOffset pulls flap/spoiler faces off
// the wing skin in depth so near-coplanar pairs never z-fight (N5
// "flashing" hunt — the 737's flap panels sat within centimetres of the
// wing underside and shimmered at distance).
const SURFACE = aircraftPaint(0xaeb4bb, {
  roughness: 0.45, metalness: 0.3,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
})
// Semi-transparent windshield hint — see the Task 2d note in git history:
// opaque glass read as a black void from the cockpit camera.
const GLASS = new THREE.MeshPhysicalMaterial({
  color: 0x223138,
  roughness: 0.15,
  metalness: 0,
  transparent: true,
  opacity: 0.25,
  clearcoat: 0.8, clearcoatRoughness: 0.06,
  depthWrite: false,
  side: THREE.DoubleSide,
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
  return profiledPanel(rootLeX,rootChord,tipLeX,tipChord,y0,y1,thick,mat)
}

/** A closed, rounded leading-edge section, lofted over the 172 planform.
 * Stations retain the original span/chord and trailing-edge flap attachments.
 * This is a visual airfoil approximation, not aerodynamic simulation geometry. */
function c172WingGeometry(): THREE.BufferGeometry {
  const positions: number[] = [], indices: number[] = []
  const section: [number, number][] = []
  const steps = 24
  for (const side of [1, -1]) {
    for (let i = 0; i <= steps; i++) {
      const q = (1 - Math.cos(Math.PI * (side === 1 ? i : steps - i) / steps)) / 2
      const h = 5 * (0.2969 * Math.sqrt(q) - 0.126 * q - 0.3516 * q * q + 0.2843 * q ** 3 - 0.1036 * q ** 4)
      section.push([q, side * h])
    }
  }
  const stations = [-5.5, -2.7, 0, 2.7, 5.5]
  const n = section.length
  for (const x of stations) {
    const taper = Math.max(0, (Math.abs(x) - 2.7) / 2.8)
    const chord = 1.63 - taper * 0.5
    const leading = 1.115 - taper * 0.255
    const thickness = 0.15 - taper * 0.02
    for (const [q, h] of section) positions.push(x, 1.06 + Math.abs(x) * .026 + h * thickness, -leading + q * chord)
  }
  for (let k = 0; k < stations.length - 1; k++) {
    for (let j = 0; j < n; j++) {
      const a = k * n + j, an = k * n + (j + 1) % n
      const b = a + n, bn = an + n
      indices.push(a, bn, b, a, an, bn)
    }
  }
  for (let j = 1; j < n - 1; j++) {
    indices.push(0, j + 1, j)
    const last = (stations.length - 1) * n
    indices.push(last, last + j, last + j + 1)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** Thin vertical profile: input pairs are (aft, up), in model metres. */
function c172VerticalProfile(points: [number, number][], thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  points.forEach(([aft, up], i) => i === 0 ? shape.moveTo(aft, up) : shape.lineTo(aft, up))
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, steps: 1 })
  geo.translate(0, 0, -thickness / 2)
  geo.rotateY(-Math.PI / 2)
  return geo
}

/** Cabin belly into the tapered aft fuselage: one continuous skin, with
 * squared cabin shoulders easing into a round tailcone. */
function c172FuselageGeometry(): THREE.BufferGeometry {
  const stations = [
    [-1.66,.38,-.035,.39],[-1.4,.53,-.035,.455],[-.8,.56,-.035,.465],
    [0,.56,-.025,.465],[.7,.54,.10,.51],[1.0,.51,.25,.48],
    [1.5,.46,.27,.43],[2.3,.365,.29,.355],[3.2,.27,.31,.27],
    [4.2,.17,.34,.19],[5.0,.10,.36,.12],[5.55,.035,.37,.055],
  ]
  const positions:number[]=[], indices:number[]=[], segments=48
  for(const [z,rx,cy,ry] of stations) {
    const exponent=z!<.8 ? .74 : .94
    for(let j=0;j<=segments;j++){
      const theta=j/segments*Math.PI*2,c=Math.cos(theta),t=Math.sin(theta)
      positions.push(Math.sign(c)*Math.abs(c)**exponent*rx!,cy!+Math.sign(t)*Math.abs(t)**exponent*ry!,z!)
    }
  }
  for(let i=0;i<stations.length-1;i++)for(let j=0;j<segments;j++){
    const a=i*(segments+1)+j,b=a+segments+1
    indices.push(a,a+1,b,b,a+1,b+1)
  }
  // End caps have separate normals from the longitudinal skin.
  for(const [station,reverse] of [[0,true],[stations.length-1,false]] as const){
    const [z,,cy]=stations[station]!, start=positions.length/3
    positions.push(0,cy!,z!)
    for(let j=0;j<=segments;j++){
      const source=(station*(segments+1)+j)*3
      positions.push(positions[source]!,positions[source+1]!,positions[source+2]!)
    }
    for(let j=0;j<segments;j++)indices.push(start, start+j+(reverse?2:1), start+j+(reverse?1:2))
  }
  const geometry=new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  geometry.setIndex(indices);geometry.computeVertexNormals();return geometry
}

export function buildC172(): AircraftMesh {
  const g = new THREE.Group()
  const add = (mesh: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh => {
    placeBody(mesh, x, y, z)
    mesh.castShadow = true
    g.add(mesh)
    return mesh
  }

  // Rounded lower cabin with actual open window apertures. The old solid
  // box relied on back-face culling to appear hollow from the pilot's eye.
  const cabin = add(new THREE.Mesh(c172FuselageGeometry(), WHITE), 0, 0, 0)
  cabin.name = 'c172Fuselage'
  finishC172Body(cabin)
  add(new THREE.Mesh(new RoundedBoxGeometry(1.07, 0.10, 1.95, 3, 0.045), WHITE), 0.08, 0, -0.99)
  add(new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.58, 0.24, 3, 0.10), WHITE), -0.83, 0, -0.65)
  const cowl = new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.85, 0.85, 4, 0.17), RED)
  add(cowl, 1.75, 0, -0.05)
  finishC172Body(cowl)

  const glazing = (corners: number[]): void => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(corners, 3))
    geo.setIndex([0, 1, 2, 0, 2, 3]); geo.computeVertexNormals()
    const pane = new THREE.Mesh(geo, GLASS)
    pane.userData.exteriorCabin = true
    g.add(pane)
  }
  // Raked windshield and two side windows. No opaque face crosses the
  // 0.75 m pilot eyepoint; the shared interior adds its own narrow framing.
  glazing([-0.50,0.47,-1.56, 0.50,0.47,-1.56, 0.49,0.94,-0.93, -0.49,0.94,-0.93])
  const frame = (a: THREE.Vector3, b: THREE.Vector3): void => {
    const delta = b.clone().sub(a)
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, delta.length(), 8), WHITE)
    post.position.copy(a).add(b).multiplyScalar(0.5)
    post.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize())
    post.castShadow = true
    post.userData.exteriorCabin = true
    g.add(post)
  }
  for (const side of [-1, 1]) {
    const x = side * 0.53
    glazing([x,0.45,-1.35, x,0.45,0.70, x,0.94,0.70, x,0.94,-0.93])
    frame(new THREE.Vector3(side * 0.5, 0.47, -1.56), new THREE.Vector3(side * 0.49, 0.94, -0.93))
    frame(new THREE.Vector3(x, 0.44, 0.02), new THREE.Vector3(x, 0.94, 0.02))
  }

  const interior=new THREE.Group();interior.name='c172ExteriorInterior';interior.userData.exteriorCabin=true
  const upholstery=new THREE.MeshStandardMaterial({color:0x37434c,roughness:.92})
  for(const x of [-.28,.28])for(const z of [-.1,.48]) {
    const seat=new THREE.Mesh(new RoundedBoxGeometry(.39,.40,.12,3,.04),upholstery)
    seat.position.set(x,.46,z);seat.rotation.x=-.09;interior.add(seat)
    const headrest=new THREE.Mesh(new RoundedBoxGeometry(.23,.13,.105,3,.035),upholstery)
    headrest.position.set(x,.71,z+.02);interior.add(headrest)
  }
  const dashboard=new THREE.Mesh(new RoundedBoxGeometry(.92,.09,.25,3,.025),DARK)
  dashboard.position.set(0,.49,-1.22);interior.add(dashboard);g.add(interior)

  // Continuous airfoil wing, with rounded leading edge and thin trailing
  // edge. The planform and animated inboard flap stations are unchanged.
  const wing = new THREE.Mesh(c172WingGeometry(), WHITE)
  wing.name = 'c172Wing'
  finishC172Wing(wing)
  wing.castShadow = true
  g.add(wing)
  // Flaps: single-slotted sections, body y ±(0.7 … 2.65), chord 0.53.
  const flapPivots: THREE.Group[] = []
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group()
    placeBody(pivot, -0.47, side * 1.68, -1.02 - 1.68 * .026) // hinge line at flap LE
    const flap = new THREE.Mesh(profiledPanelGeometry(.265,.53,.265,.53,-.975,.975,.09).translate(0,-.045,0), SURFACE)
    flap.rotation.z = side * .026
    flap.position.set(0, -0.07, 0.27) // clear of the wing underside (N5)
    flap.castShadow = true
    pivot.add(flap)
    g.add(pivot)
    flapPivots.push(pivot)
  }

  // Swept fin/rudder outline and curved stabilizer edges. The fin stays
  // at the corrected tail station, giving the published 8.28 m overall length.
  for(const side of [-1,1]) {
    const stabilizer=profiledPanel(-4.55,1.05,-4.83,.69,side*.08,side*1.7,.095,WHITE)
    stabilizer.position.y=.35;stabilizer.castShadow=true;g.add(stabilizer)
  }
  const fin = new THREE.Mesh(c172VerticalProfile([[2.8,0.4], [3.3,0.72], [3.93,1.78], [4.17,1.78], [4.23,0.4]], 0.08), WHITE)
  fin.position.z = 1.23
  fin.name = 'c172Fin'
  fin.castShadow = true
  g.add(fin)
  const rudder = new THREE.Mesh(c172VerticalProfile([[4.18,1.78], [4.45,1.72], [4.56,0.42], [4.24,0.4]], 0.065), RED)
  rudder.position.z = 1.23
  rudder.name = 'c172Rudder'
  rudder.castShadow = true
  g.add(rudder)
  // Hinged on the fin's trailing edge (the profile's forward edge, raked
  // 0.06 m over its 1.38 m height). +yaw = right pedal = trailing edge RIGHT.
  const rudderHinge: HingeFrame = createHingeFrame(g, 'c172Rudder-hinge', new THREE.Vector3(0, 0.4, 1.23 + 4.24), new THREE.Vector3(0, 1.78, 1.23 + 4.18))
  attachSkin(rudderHinge, rudder)

  // Tires keep the calibrated contact points; profiled fairings expose the tread.
  for (const [x, y, z] of [[1.3,0,1.3],[-.35,-1.15,1.32],[-.35,1.15,1.32]] as const) {
    const wheel=buildAircraftWheel(.19,.15)
    placeBody(wheel,x,y,z-.19);g.add(wheel)
    const spat=new THREE.Mesh(new THREE.SphereGeometry(1,32,16,0,Math.PI*2,0,Math.PI*.70),WHITE)
    spat.scale.set(.155,.20,.36)
    add(spat,x,y,z-.25)
  }
  addC172Details(g)

  // Prop: spinner + translucent disc that spins with RPM.
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.35, 40), WHITE)
  spinner.rotation.x = -Math.PI / 2
  add(spinner, 2.3, 0, -0.05)
  const propDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.965, 24),
    new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, depthWrite: false, opacity: 0.18, side: THREE.DoubleSide }),
  )
  placeBody(propDisc, 2.32, 0, -0.05)
  g.add(propDisc)
  const blade = new THREE.Mesh(
    c172PropGeometry(),
    new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors:true, roughness:.43, metalness:.25, transparent:true,depthWrite:false }),
  )
  placeBody(blade, 2.31, 0, -0.05)
  propDisc.userData.blade = blade
  g.add(blade)

  const surfaces = (s: SurfaceState): void => {
    rudderHinge.setAngle(Math.max(-1, Math.min(1, s.yaw ?? 0)) * 0.42)
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
  g.userData.lightAnchors = {
    wingtipL: new THREE.Vector3(-5.47,1.207,-.12),
    wingtipR: new THREE.Vector3(5.47,1.207,-.12),
    tail: new THREE.Vector3(0,.50,5.77),
    beacon: new THREE.Vector3(0,1.80,5.33),
  }
  return { group: g, propDisc, surfaces }
}

const SILVER = aircraftMetal(0xb8bcc2,.3)

/** Piper J-3 Cub: Cub-yellow taildragger — rounded rudder and wingtips,
 *  exposed A-65 cylinders, bungee gear, wheels at the physics points. */
export function buildCub(): AircraftMesh { return buildDetailedCub() }

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
  // One loft from radome to tailcone, with the actual 3.76 m diameter.
  // Keep calibrated wing/gear stations in body space unchanged.
  const fuselage=buildJetShell(39.47,1.88,WHITE,'B738')
  fuselage.position.y=.6-1.88*.32
  g.add(fuselage)
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
        const aftCanoe = new THREE.Mesh(new RoundedBoxGeometry(.3,.34,1.5,3,.14), BELLY)
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
      const fixedCanoe = new THREE.Mesh(new RoundedBoxGeometry(.32,.42,1.8,3,.15), BELLY)
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
    const engine=buildTurbofan(1.34,4.5,WHITE)
    engine.scale.y=.92
    add(engine,4.475,side*5.75,1.15)
    reverserSleeves.push(engine.userData.reverserSleeve as THREE.Mesh)
    const pylon = new THREE.Mesh(new RoundedBoxGeometry(.35,1.1,2.6,3,.13),BELLY)
    add(pylon,3.4,side*5.75,.15)

  }

  // ---- empennage: swept fin to 12.55 m, swept stabs ----
  const fin = taperedPanel(-12.6, 6.4, -18.8, 1.9, 0, 7.7, 0.26, WHITE)
  // +π/2 stands the span UP — the original −π/2 pointed it down into the
  // belly; the "fin" every screenshot showed was just the red flash box
  // at the fin-top position (user: "make the tail upright").
  fin.rotation.z = Math.PI / 2
  placeBody(fin, 0, 0.05, -2.2)
  g.add(fin)
  fin.material = tailFlagMaterial()
  for (const side of [-1, 1]) {
    const stab = taperedPanel(-15.6, 3.4, -18.9, 1.2, side * 0.4, side * 7.2, 0.16, BELLY)
    stab.position.y = 0.9
    g.add(stab)
  }

  // ---- gear: retracting; twin-wheel nose, twin-wheel main bogies ----
  const gearGroups: { grp: THREE.Group; nose: boolean; fold: number }[] = []
  const mkWheel = (r: number, w: number): THREE.Group => buildAircraftWheel(r,w)
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
    new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0 }),
  )
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.01, 0.01, 0.01),
    new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, opacity: 0 }),
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
  if (mesh.updateProp) { mesh.updateProp(rpm, dt); return }
  const discs = (mesh.group.userData.propDiscs as THREE.Mesh[] | undefined) ?? [mesh.propDisc]
  const omega = (rpm * Math.PI) / 30
  const blur = Math.min(Math.max((rpm - 400) / 500, 0), 1)
  for (const disc of discs) {
    const blade = disc.userData.blade as THREE.Mesh | undefined
    if (!blade) { disc.visible = false; continue }
    disc.visible = rpm > 100
    blade.rotation.z += omega * dt
    ;(disc.material as THREE.Material).opacity = 0.008 + 0.022 * blur
    const materials = Array.isArray(blade.material) ? blade.material : [blade.material]
    for (const material of materials) {
      material.opacity = 1 - blur * 0.85
      material.transparent = true
    }
  }
}
