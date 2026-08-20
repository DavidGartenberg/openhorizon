import * as THREE from 'three'
import { liveryMaterial } from './livery'
import type { AircraftMesh, SurfaceState } from './aircraft-mesh'

/**
 * Config-driven airliner exteriors (night-shift N2): the study 737's
 * builder generalized so every roster airliner renders at the same
 * standard — real overall dimensions from its spec, family traits from
 * a small table, and the full animated-surface set (Fowler flaps,
 * flight spoilers, retracting gear).
 *
 * Model frame matches aircraft-mesh.ts: nose −z, up +y, right +x.
 */
export interface AirlinerCfg {
  /** Designator for the painted livery (window rows, cheatline, titles).
   *  Absent = plain white (traffic silhouettes skip the paint cost). */
  designator?: string
  lengthM: number
  spanM: number
  fuseRadiusM: number
  sweepDeg: number
  engines: { count: 2 | 3 | 4; mounted: 'wing' | 'tail' }
  tTail?: boolean
  winglet: 'none' | 'blended' | 'sharklet' | 'raked'
  hump?: '747' | 'a380' | 'none'
  /** Gear legs in body coords (visual only; physics has its own). */
  gear: { x: number; y: number; z: number; nose?: boolean }[]
}

const WHITE = new THREE.MeshStandardMaterial({ color: 0xf2f3f5, roughness: 0.3, metalness: 0.12 }) // gloss livery paint (env-lit)
const RED = new THREE.MeshStandardMaterial({ color: 0xa31621, roughness: 0.6 })
const DARK = new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.9 })
const BELLY = new THREE.MeshStandardMaterial({ color: 0xb9c0c7, roughness: 0.5, metalness: 0.25 })
const SILVER = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.32, metalness: 0.5 })
const SURFACE = new THREE.MeshStandardMaterial({
  color: 0xaeb4bb, roughness: 0.45, metalness: 0.3,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
})

function placeBody(m: THREE.Object3D, x: number, y: number, z: number): void {
  m.position.set(y, -z, -x)
}

function taperedPanel(
  rootLeX: number, rootChord: number, tipLeX: number, tipChord: number,
  y0: number, y1: number, thick: number, mat: THREE.Material,
): THREE.Mesh {
  const s = new THREE.Shape()
  s.moveTo(y0, rootLeX)
  s.lineTo(y1, tipLeX)
  s.lineTo(y1, tipLeX - tipChord)
  s.lineTo(y0, rootLeX - rootChord)
  s.closePath()
  const geo = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false })
  geo.rotateX(-Math.PI / 2)
  const m = new THREE.Mesh(geo, mat)
  m.castShadow = true
  return m
}

export function buildAirliner(cfg: AirlinerCfg): AircraftMesh {
  const reverserSleeves: THREE.Mesh[] = []
  const g = new THREE.Group()
  const add = (mesh: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D => {
    placeBody(mesh, x, y, z)
    mesh.castShadow = true
    g.add(mesh)
    return mesh
  }
  const L = cfg.lengthM
  const R = cfg.fuseRadiusM
  const halfSpan = cfg.spanM / 2
  const sweep = (cfg.sweepDeg * Math.PI) / 180

  // ---- fuselage ----
  const tubeLen = L * 0.72
  const fuse = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, tubeLen, 18),
    cfg.designator ? liveryMaterial(cfg.designator, L) : WHITE,
  )
  fuse.rotation.x = Math.PI / 2
  add(fuse, L * 0.02, 0, -R * 0.32)
  const nose = new THREE.Mesh(new THREE.SphereGeometry(R, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), WHITE)
  nose.rotation.x = -Math.PI / 2
  nose.scale.set(1, 1, 1.7)
  add(nose, L * 0.02 + tubeLen / 2, 0, -R * 0.32)
  const tailCone = new THREE.Mesh(new THREE.ConeGeometry(R * 0.99, L * 0.21, 16), WHITE)
  tailCone.rotation.x = Math.PI / 2 + 0.06
  add(tailCone, L * 0.02 - tubeLen / 2 - L * 0.093, 0, -R * 0.32 - R * 0.22)
  // window strips (box fallback only when unpainted — livery paints real
  // window rows into the wrap)
  if (!cfg.designator) {
    for (const side of [-1, 1]) {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.02, R * 0.14, tubeLen * 0.85), DARK), L * 0.03, side * (R - 0.01), -R * 0.6)
    }
  }
  add(new THREE.Mesh(new THREE.BoxGeometry(R * 1.3, R * 0.27, R * 0.5), DARK), L * 0.02 + tubeLen / 2 + R * 0.1, 0, -R * 0.7)
  // hump (747 forward upper deck / A380 full-length)
  if (cfg.hump === '747') {
    const hump = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.62, R * 0.62, tubeLen * 0.34, 14), WHITE)
    hump.rotation.x = Math.PI / 2
    add(hump, L * 0.02 + tubeLen * 0.27, 0, -R * 1.05)
  } else if (cfg.hump === 'a380') {
    const hump = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.78, R * 0.78, tubeLen * 0.92, 14), WHITE)
    hump.rotation.x = Math.PI / 2
    add(hump, L * 0.02, 0, -R * 1.02)
  }

  // ---- wings + animated surfaces ----
  const flapPivots: THREE.Group[] = []
  const spoilerPivots: THREE.Group[] = []
  const wingRootX = L * 0.1
  const rootChord = L * 0.185
  const tipChord = rootChord * 0.22
  const wingDrop = R * 0.66 // low wing
  for (const side of [-1, 1]) {
    const wingGroup = new THREE.Group()
    const y0 = R * 0.85
    const y1 = halfSpan - (cfg.winglet === 'none' ? 0 : 0.4)
    const tipLeX = wingRootX - Math.tan(sweep) * (y1 - y0)
    const panel = taperedPanel(wingRootX, rootChord, tipLeX, tipChord, side * y0, side * y1, R * 0.16, BELLY)
    panel.position.y = -wingDrop
    wingGroup.add(panel)
    if (cfg.winglet !== 'none') {
      const h = cfg.winglet === 'raked' ? 1.2 : cfg.winglet === 'sharklet' ? 2.0 : 2.35
      // Same axis fix as buildB738's winglet: shape in (−bodyX, height),
      // one rotateY(−π/2) → thickness X, height Y, chord Z.
      const wlShape = new THREE.Shape()
      wlShape.moveTo(-tipLeX, 0)
      wlShape.lineTo(-(tipLeX - tipChord * 0.25), h)
      wlShape.lineTo(-(tipLeX - tipChord * 0.62), h)
      wlShape.lineTo(-(tipLeX - tipChord), 0)
      wlShape.closePath()
      const wlGeo = new THREE.ExtrudeGeometry(wlShape, { depth: 0.1, bevelEnabled: false })
      wlGeo.rotateY(-Math.PI / 2)
      const wl = new THREE.Mesh(wlGeo, BELLY)
      wl.castShadow = true
      wl.position.set(side * y1, -wingDrop, 0)
      wl.rotation.z = side * (cfg.winglet === 'raked' ? -0.9 : -0.26)
      wingGroup.add(wl)
    }
    wingGroup.rotation.z = side * -0.105 // dihedral
    g.add(wingGroup)

    // Fowler flaps (two sections) + 4 spoiler panels, scaled spanwise.
    for (const [f0, f1, cFrac] of [
      [0.13, 0.32, 0.26],
      [0.35, 0.72, 0.2],
    ] as const) {
      const fy0 = y0 + (y1 - y0) * f0
      const fy1 = y0 + (y1 - y0) * f1
      const chord = rootChord * cFrac
      const leX = wingRootX - Math.tan(sweep) * ((fy0 + fy1) / 2 - y0) - rootChord * 0.62
      const pivot = new THREE.Group()
      placeBody(pivot, leX, 0, wingDrop * 0.82)
      const flap = taperedPanel(0, chord, -Math.tan(sweep) * (fy1 - fy0) * 0.9, chord * 0.85, side * fy0, side * fy1, R * 0.085, SURFACE)
      flap.position.y = -R * 0.16
      pivot.add(flap)
      wingGroup.add(pivot)
      flapPivots.push(pivot)
    }
    for (let i = 0; i < 4; i++) {
      const sy = y0 + (y1 - y0) * (0.16 + i * 0.14)
      const pivot = new THREE.Group()
      const leX = wingRootX - Math.tan(sweep) * (sy - y0) - rootChord * 0.55
      placeBody(pivot, leX, side * sy, wingDrop * 0.7)
      const panel = new THREE.Mesh(new THREE.BoxGeometry((y1 - y0) * 0.12, 0.05, rootChord * 0.12), SURFACE)
      panel.position.set(0, 0.05, rootChord * 0.06)
      panel.castShadow = true
      pivot.add(panel)
      wingGroup.add(pivot)
      spoilerPivots.push(pivot)
    }

    // ---- engines ----
    if (cfg.engines.mounted === 'wing') {
      const perSide = cfg.engines.count === 4 ? 2 : 1
      for (let ei = 0; ei < perSide; ei++) {
        const ey = cfg.engines.count === 4 ? halfSpan * (ei === 0 ? 0.36 : 0.62) : halfSpan * 0.34
        const engLen = R * 2.2
        const engR = R * 0.7
        const ex = wingRootX - Math.tan(sweep) * (ey - y0) + rootChord * 0.35
        const eng = new THREE.Mesh(new THREE.CylinderGeometry(engR, engR * 0.8, engLen, 16), SILVER)
        eng.rotation.x = Math.PI / 2
        eng.scale.y = 0.92
        add(eng, ex, side * ey, wingDrop * 0.55 + engR * 0.75)
        const inlet = new THREE.Mesh(new THREE.CylinderGeometry(engR * 1.02, engR * 1.02, 0.3, 16), DARK)
        inlet.rotation.x = Math.PI / 2
        inlet.scale.y = 0.92
        add(inlet, ex + engLen / 2, side * ey, wingDrop * 0.55 + engR * 0.75)
        const pylon = new THREE.Mesh(new THREE.BoxGeometry(engR * 0.3, engR * 0.9, engLen * 0.7), BELLY)
        add(pylon, ex - engLen * 0.15, side * ey, wingDrop * 0.25)
        // Reverser sleeve: aft nacelle ring that translates AFT on deploy,
        // showing a dark cascade band.
        const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(engR * 1.04, engR * 0.86, engLen * 0.4, 16), SILVER)
        sleeve.rotation.x = Math.PI / 2
        sleeve.scale.y = 0.92
        add(sleeve, ex - engLen * 0.32, side * ey, wingDrop * 0.55 + engR * 0.75)
        sleeve.userData.stowZ = sleeve.position.z
        reverserSleeves.push(sleeve)
        const cascade = new THREE.Mesh(new THREE.CylinderGeometry(engR * 0.98, engR * 0.98, engLen * 0.36, 16), DARK)
        cascade.rotation.x = Math.PI / 2
        cascade.scale.y = 0.92
        add(cascade, ex - engLen * 0.32, side * ey, wingDrop * 0.55 + engR * 0.75)
      }
    } else {
      // tail-mounted pods (MD-80/CRJ class)
      const engLen = R * 2.6
      const engR = R * 0.52
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(engR, engR * 0.85, engLen, 14), SILVER)
      eng.rotation.x = Math.PI / 2
      add(eng, -tubeLen * 0.36, side * (R + engR * 0.9), -R * 0.5)
      const inlet = new THREE.Mesh(new THREE.CylinderGeometry(engR * 1.02, engR * 1.02, 0.25, 14), DARK)
      inlet.rotation.x = Math.PI / 2
      add(inlet, -tubeLen * 0.36 + engLen / 2, side * (R + engR * 0.9), -R * 0.5)
    }
  }

  // ---- empennage ----
  const finRootX = -L * 0.32
  const finH = L * 0.155
  const fin = taperedPanel(finRootX, L * 0.16, finRootX - L * 0.13, L * 0.05, 0, finH, R * 0.13, WHITE)
  fin.rotation.z = -Math.PI / 2
  placeBody(fin, 0, R * 0.03, -R * 0.9)
  g.add(fin)
  const flash = new THREE.Mesh(new THREE.BoxGeometry(R * 0.14, finH * 0.32, L * 0.04), RED)
  add(flash, finRootX - L * 0.115, 0, -R * 0.9 - finH * 0.83)
  // Trijet center engine (MD-11/DC-10 class): S-duct pod at the fin base.
  if (cfg.engines.count === 3) {
    const cR = R * 0.58
    const ceng = new THREE.Mesh(new THREE.CylinderGeometry(cR, cR * 0.82, R * 2.4, 14), SILVER)
    ceng.rotation.x = Math.PI / 2
    add(ceng, finRootX + L * 0.02, 0, -R * 1.05)
    const cinlet = new THREE.Mesh(new THREE.CylinderGeometry(cR * 1.02, cR * 1.02, 0.25, 14), DARK)
    cinlet.rotation.x = Math.PI / 2
    add(cinlet, finRootX + L * 0.02 + R * 1.2, 0, -R * 1.05)
  }
  const stabZ = cfg.tTail ? -R * 0.9 - finH * 0.92 : -R * 0.25
  const stabX = cfg.tTail ? finRootX - L * 0.1 : -L * 0.38
  for (const side of [-1, 1]) {
    const stab = taperedPanel(stabX, L * 0.085, stabX - L * 0.075, L * 0.032, side * R * 0.2, side * halfSpan * 0.38, R * 0.09, BELLY)
    stab.position.y = -stabZ
    g.add(stab)
  }

  // ---- gear (animated) ----
  const gearGroups: { grp: THREE.Group; nose: boolean }[] = []
  for (const leg of cfg.gear) {
    const grp = new THREE.Group()
    const strutLen = leg.z * 0.66
    placeBody(grp, leg.x, leg.y, leg.z - strutLen)
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.07, R * 0.07, strutLen, 8), SILVER)
    strut.position.y = -strutLen / 2
    strut.castShadow = true
    grp.add(strut)
    for (const wy of leg.nose ? [-R * 0.13, R * 0.13] : [-R * 0.16, R * 0.16]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(leg.nose ? R * 0.2 : R * 0.29, leg.nose ? R * 0.2 : R * 0.29, R * 0.18, 14), DARK)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(wy, -strutLen, 0)
      wheel.castShadow = true
      grp.add(wheel)
    }
    g.add(grp)
    gearGroups.push({ grp, nose: !!leg.nose })
  }

  // invisible prop slot (interface uniformity)
  const propDisc = new THREE.Mesh(new THREE.CircleGeometry(0.01, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }))
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), new THREE.MeshStandardMaterial({ transparent: true, opacity: 0 }))
  propDisc.userData.blade = blade
  g.add(propDisc)
  g.add(blade)

  const surfaces = (s: SurfaceState): void => {
    for (const p of flapPivots) {
      p.userData.z0 ??= p.position.z
      p.userData.y0 ??= p.position.y
      p.position.z = (p.userData.z0 as number) + s.flapFrac * rootChord * 0.15
      p.position.y = (p.userData.y0 as number) - s.flapFrac * R * 0.12
      p.rotation.x = s.flapFrac * 0.62
    }
    for (const p of spoilerPivots) p.rotation.x = -s.spoilerFrac * 0.87
    for (const sl of reverserSleeves) sl.position.z = (sl.userData.stowZ as number) + (s.reverseFrac ?? 0) * 0.85
    for (const { grp, nose } of gearGroups) {
      if (nose) grp.rotation.x = (1 - s.gearPos) * 1.5
      else grp.rotation.z = (1 - s.gearPos) * (grp.position.x > 0 ? 1.5 : -1.5)
      grp.visible = s.gearPos > 0.02
    }
  }
  // Real exterior-light anchors (nav/strobe at the wingtips, tail/beacon
  // on the fin) — the bounding-box fallback floats lights mid-air on
  // low-wing jets (found by the user on the 737).
  {
    const yTip = halfSpan - (cfg.winglet === 'none' ? 0 : 0.4)
    const zTip = -(wingRootX - Math.tan(sweep) * (yTip - R * 0.85)) + 0.2
    const tipUp = -wingDrop + Math.sin(0.105) * yTip + 0.12
    g.userData.lightAnchors = {
      wingtipL: new THREE.Vector3(-yTip, tipUp, zTip),
      wingtipR: new THREE.Vector3(yTip, tipUp, zTip),
      tail: new THREE.Vector3(0, R * 0.9 + finH * 0.55, -finRootX + L * 0.1),
    }
  }
  return { group: g, propDisc, surfaces }
}

/** Family traits by designator (engines/mount from the spec drive the
 *  rest; this table only holds what the spec can't say). */
const FAMILY: Record<string, Partial<AirlinerCfg>> = {
  // T-tail, tail-mounted twins
  CRJ2: { engines: { count: 2, mounted: 'tail' }, tTail: true, winglet: 'blended' },
  CRJ7: { engines: { count: 2, mounted: 'tail' }, tTail: true, winglet: 'blended' },
  CRJ9: { engines: { count: 2, mounted: 'tail' }, tTail: true, winglet: 'blended' },
  CRJX: { engines: { count: 2, mounted: 'tail' }, tTail: true, winglet: 'blended' },
  E135: { engines: { count: 2, mounted: 'tail' }, tTail: true, winglet: 'none' },
  E145: { engines: { count: 2, mounted: 'tail' }, tTail: true, winglet: 'none' },
  MD82: { engines: { count: 2, mounted: 'tail' }, tTail: true, winglet: 'none' },
  MD88: { engines: { count: 2, mounted: 'tail' }, tTail: true, winglet: 'none' },
  B712: { engines: { count: 2, mounted: 'tail' }, tTail: true, winglet: 'none' },
  // humps
  B744: { hump: '747', winglet: 'blended' },
  B748: { hump: '747', winglet: 'raked' },
  A388: { hump: 'a380', winglet: 'blended' },
  // raked-tip modern widebodies
  B788: { winglet: 'raked' },
  B789: { winglet: 'raked' },
  B78X: { winglet: 'raked' },
  A359: { winglet: 'sharklet' },
  A35K: { winglet: 'sharklet' },
  B77W: { winglet: 'raked' },
  B77L: { winglet: 'raked' },
  // sharklets
  A20N: { winglet: 'sharklet' },
  A21N: { winglet: 'sharklet' },
  BCS1: { winglet: 'sharklet' },
  BCS3: { winglet: 'sharklet' },
  // classic no-winglet types
  B38M: { winglet: 'sharklet' },
  B39M: { winglet: 'sharklet' },
  B752: { winglet: 'none' },
  B762: { winglet: 'none' },
  B763: { winglet: 'none' },
  B772: { winglet: 'none' },
  A342: { winglet: 'blended' },
  A343: { winglet: 'blended' },
  A346: { winglet: 'blended' },
}

export function airlinerCfgFor(spec: {
  designator: string
  lengthM: number
  spanM: number
  powerplant: { kind: string; count?: number }
}): AirlinerCfg {
  const fam = FAMILY[spec.designator] ?? {}
  const R = Math.max(spec.lengthM * 0.047, 1.35)
  const L = spec.lengthM
  const count = (fam.engines?.count ?? (spec.powerplant.count === 4 ? 4 : 2)) as 2 | 3 | 4
  const mounted = fam.engines?.mounted ?? 'wing'
  const zGround = L * 0.115
  const gear: AirlinerCfg['gear'] = [
    { x: L * 0.37, y: 0, z: zGround, nose: true },
    { x: -L * 0.028, y: -R * 1.5, z: zGround },
    { x: -L * 0.028, y: R * 1.5, z: zGround },
  ]
  return {
    designator: spec.designator,
    lengthM: L,
    spanM: spec.spanM,
    fuseRadiusM: R,
    sweepDeg: 25,
    engines: { count, mounted },
    tTail: fam.tTail ?? false,
    winglet: fam.winglet ?? 'blended',
    hump: fam.hump ?? 'none',
    gear,
    ...((): Partial<AirlinerCfg> => ({}))(),
  }
}
