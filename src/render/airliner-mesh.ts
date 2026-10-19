import { tailFlagMaterial } from './jet-finish'
import { isBusinessLivery } from './livery'
import * as THREE from 'three'
import { buildJetShell } from './jet-shell'
import { jetProfileFor, type JetProfile } from './jet-profiles'
import { profiledPanel as taperedPanel, buildTurbofan, buildAircraftWheel } from './aircraft-components'
import { aircraftPaint, aircraftMetal } from './aircraft-materials'
import { fowlerPose, spoileronRise } from './fowler'
import { standardGearZ } from '../sim/aircraft/derive'
import type { AircraftMesh, SurfaceState } from './aircraft-mesh'
import { createHingeFrame, attachSkin, cutSkin, type HingeFrame } from './procedural-surfaces'
import { profiledPanelGeometry } from './aircraft-components'

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
  wingAreaM2?: number
  profile?: JetProfile
  engines: { count: 2 | 3 | 4; mounted: 'wing' | 'tail' | 'overwing' }
  tTail?: boolean
  winglet: JetProfile['winglet']
  hump?: '747' | 'a380' | 'none'
  /** Gear legs in body coords (visual only; physics has its own). */
  gear: { x: number; y: number; z: number; nose?: boolean }[]
}

const WHITE = aircraftPaint(0xf2f3f5)
const BELLY = aircraftPaint(0xb9c0c7, { roughness: .39, metalness: .2 })
const SILVER = aircraftMetal()
const SURFACE = aircraftPaint(0xaeb4bb, {
  roughness: .4, metalness: .22,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
})

function placeBody(m: THREE.Object3D, x: number, y: number, z: number): void {
  m.position.set(y, -z, -x)
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

  // One fair loft from radome to tail, including any upper deck.
  const profile = cfg.profile
  g.add(buildJetShell(L, R, WHITE, cfg.designator, cfg.hump))
  g.userData.jetProfile = profile
  g.userData.designator = cfg.designator

  // Wing-body fairing: the belly bulge at the wing root (its absence
  // made wings knife into a bare tube — part of the "shape correct" ask).
  {
    const fair = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), BELLY)
    fair.scale.set(R * 1.12, R * 0.55, L * 0.115)
    placeBody(fair, L * 0.1 - L * 0.06, 0, R * 0.52)
    fair.castShadow = true
    g.add(fair)
  }

  // ---- wings + animated surfaces ----
  const flapPivots: THREE.Group[] = []
  const spoilerPivots: THREE.Group[] = []
  const wingRootX = L * 0.1
  const rootChord = cfg.wingAreaM2 ? cfg.wingAreaM2 / (cfg.spanM * .61) : L * 0.185
  const tipChord = rootChord * 0.22
  const wingDrop = R * 0.66 // low wing
  for (const side of [-1, 1]) {
    const wingGroup = new THREE.Group()
    const y0 = R * 0.85
    const tipExtension = cfg.winglet === 'raked' ? halfSpan * .09 : cfg.winglet === 'none' ? 0 : R * .22
    const y1 = halfSpan - tipExtension
    const tipLeX = wingRootX - Math.tan(sweep) * (y1 - y0)
    // Chord / trailing-edge locus at a span station (taper nearly cancels
    // the LE sweep) — flaps and canoe fairings hug the TE, not the LE.
    const chordAt = (fy: number): number => rootChord - (rootChord - tipChord) * (fy - y0) / (y1 - y0)
    const teXAt = (fy: number): number => wingRootX - Math.tan(sweep) * (fy - y0) - chordAt(fy)
    const panel = taperedPanel(wingRootX, rootChord, tipLeX, tipChord, side * y0, side * y1, R * 0.16, BELLY)
    panel.position.y = -wingDrop
    wingGroup.add(panel)
    if (cfg.winglet === 'raked') {
      const tip = taperedPanel(tipLeX, tipChord, tipLeX - tipChord*.65, tipChord*.18, side*y1, side*halfSpan, R*.045, BELLY)
      tip.position.y = -wingDrop
      wingGroup.add(tip)
    } else if (cfg.winglet !== 'none') {
      const h = R * (cfg.winglet === 'fence' ? .35 : cfg.winglet === 'sharklet' ? 1.05 : .85)
      for (const direction of cfg.winglet === 'fence' || cfg.winglet === 'split' ? [1,-1] : [1]) {
        const wlShape = new THREE.Shape()
        const height = h * direction * (direction < 0 ? .55 : 1)
        wlShape.moveTo(-tipLeX,0)
        wlShape.lineTo(-(tipLeX-tipChord*.45),height)
        wlShape.lineTo(-(tipLeX-tipChord*.76),height)
        wlShape.lineTo(-(tipLeX-tipChord),0)
        wlShape.closePath()
        const geo = new THREE.ExtrudeGeometry(wlShape,{depth:R*.035,bevelEnabled:false});geo.rotateY(-Math.PI/2)
        const wl = new THREE.Mesh(geo,BELLY);wl.name='winglet';wl.castShadow=true
        wl.position.set(side*y1,-wingDrop,0)
        wl.rotation.z = -side * .15
        wingGroup.add(wl)
      }
    }
    // Dihedral: positive side*θ raises the tip. (side * −0.105 DROPPED
    // both tips — 6° of anhedral on every jet in the fleet.)
    wingGroup.rotation.z = side * 0.105 // ~6° dihedral
    g.add(wingGroup)

    // Flap-track canoe fairings, SPLIT: fixed forward half buried in the
    // wing underside; aft half parented to the flap (added below) so the
    // hardware visibly stays connected at every setting.
    for (const ff of [0.28, 0.52]) {
      const fy = y0 + (y1 - y0) * ff
      const fixedCanoe = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), BELLY)
      fixedCanoe.scale.set(R * .08, R * .11, rootChord * .2)
      // Centered just ahead of the TE locus: buried in the wing
      // underside, protruding aft to meet the flap-riding aft half.
      placeBody(fixedCanoe, teXAt(fy) + rootChord * 0.11, side * fy, wingDrop + R * 0.07)
      fixedCanoe.castShadow = true
      wingGroup.add(fixedCanoe)
    }

    // ONE continuous Fowler flap per wing + ONE spoiler panel (user:
    // "make the flaps one piece together and spoilers one piece").
    // The flap follows the wing TRAILING-EDGE sweep, not the LE sweep —
    // the old 0.9·LE-sweep panel detached the outboard end (same fix as
    // buildB738). LE nests 90% of the flap chord under the wing so full
    // extension (35% chord) never leaves the TE shadow.
    for (const [f0, f1, cFrac] of [
      [0.14, 0.68, 0.23],
    ] as const) {
      const fy0 = y0 + (y1 - y0) * f0
      const fy1 = y0 + (y1 - y0) * f1
      const chord = rootChord * cFrac
      const leX = teXAt(fy0) + chord * 0.9
      const pivot = new THREE.Group()
      placeBody(pivot, leX, 0, wingDrop * 0.82)
      const flap = taperedPanel(0, chord, teXAt(fy1) - teXAt(fy0), chord * 0.85, side * fy0, side * fy1, R * 0.085, SURFACE)
      flap.position.y = -R * 0.16
      pivot.add(flap)
      // Aft canoe halves ride the flap.
      for (const ff of [0.28, 0.52]) {
        const fy = y0 + (y1 - y0) * ff
        const zLE = teXAt(fy0) - teXAt(fy) // pivot-local aft offset of the flap LE here
        const aftCanoe = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), BELLY)
        aftCanoe.scale.set(R * .075, R * .09, chord * .4)
        aftCanoe.position.set(side * fy, -R * 0.26, zLE + chord * 0.45)
        aftCanoe.castShadow = true
        pivot.add(aftCanoe)
      }
      wingGroup.add(pivot)
      flapPivots.push(pivot)
    }
    for (let i = 0; i < 1; i++) {
      const sy = y0 + (y1 - y0) * 0.41 // single panel centered over the flap span
      const pivot = new THREE.Group()
      const leX = wingRootX - Math.tan(sweep) * (sy - y0) - rootChord * 0.55
      placeBody(pivot, leX, side * sy, wingDrop * 0.7)
      const panel = new THREE.Mesh(new THREE.BoxGeometry((y1 - y0) * 0.5, 0.05, rootChord * 0.13), SURFACE)
      panel.position.set(0, 0.05, rootChord * 0.065)
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
        const engLen = profile?.engineLength ?? R * 2.2
        const engR = profile?.engineRadius ?? R * 0.7
        // Pod center barely ahead of the local LE — the old +35% of root
        // chord hung the engine in space ahead of the wing (user: "make
        // the engines actually on the plane").
        const ex = wingRootX - Math.tan(sweep) * (ey - y0) + rootChord * 0.06
        // Pod depth: close-coupled under the LE with the nacelle top
        // proud of the wing plane, so the bottom clears the runway by
        // ~0.5 m at the REAL 0.073L stance (the old 0.55/0.75 constants
        // were tuned for gear twice as tall — pods touched the ground).
        const engZ = wingDrop * 0.35 + engR * 0.45
        const eng = buildTurbofan(engR, engLen * .92, WHITE)
        eng.scale.y = .92
        eng.userData.jetEngine = true
        add(eng, ex, side * ey, engZ)
        const sleeve = eng.userData.reverserSleeve as THREE.Mesh
        reverserSleeves.push(sleeve)
        // Rounded pylon fairing retains the original attachment envelope.
        const pylon = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), BELLY)
        pylon.scale.set(engR * .17, engR * .55, engLen * .425)
        add(pylon, ex - engLen * .2, side * ey, wingDrop * .5)
      }
    } else if (cfg.engines.mounted === 'tail') {
      // tail-mounted pods (MD-80/CRJ class)
      const engLen = profile?.engineLength ?? R * 2.6
      const engR = profile?.engineRadius ?? R * 0.52
      const eng = buildTurbofan(engR, engLen, WHITE)
      eng.userData.jetEngine = true
      reverserSleeves.push(eng.userData.reverserSleeve as THREE.Mesh)
      add(eng, -L * .29, side * (R + engR * .85), -R * .65)
      // Short blended support joins the barrel to the aft fuselage.
      const support = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), BELLY)
      support.scale.set(engR * 1.1, engR * .16, engLen * .28)
      add(support, -L * .29, side * R, -R * .65)
    } else {
      const er = profile?.engineRadius ?? R*.45, el = profile?.engineLength ?? R*2
      const ex = -L*.11, ey = halfSpan*.36, up = R*.95
      const eng = buildTurbofan(er,el,WHITE);eng.userData.jetEngine=true
      add(eng,ex,side*ey,-up)
      reverserSleeves.push(eng.userData.reverserSleeve as THREE.Mesh)
      const support = new THREE.Mesh(new THREE.SphereGeometry(1,20,12),BELLY)
      support.scale.set(er*.22,up*.85,el*.36)
      add(support,ex-el*.13,side*ey,-up*.22)
    }
  }

  // ---- empennage ----
  const finRootX = -L * 0.32
  const finH = profile?.finHeight ?? L * 0.155
  const finRootLe = finRootX, finRootChord = L * 0.16, finTipLe = finRootX - L * 0.105, finTipChord = L * 0.045, finThick = R * 0.13
  const finMat = cfg.designator && isBusinessLivery(cfg.designator) ? aircraftPaint(0x213d59) : tailFlagMaterial()
  // Rz(+π/2) points the panel's span axis UP — the original −π/2 pointed
  // it DOWN, burying the whole fin inside/below the fuselage (the same
  // rotation-sign bug class as the winglets; user: "make the tail
  // upright").
  const finGroup = new THREE.Group()
  finGroup.rotation.z = Math.PI / 2
  placeBody(finGroup, 0, R * 0.03, -R * 0.9)
  g.add(finGroup)
  // Rudder: the aft 32% of the fin, hinged on the line joining its root and
  // tip stations, cut from the SAME skin (no re-lofted airfoil) with the
  // panel UVs restored so the tail livery runs unbroken across the hinge.
  const finGeo = profiledPanelGeometry(finRootLe, finRootChord, finTipLe, finTipChord, 0, finH, finThick)
  const hingeU = 0.68
  const hingeAt = (t: number): THREE.Vector3 => new THREE.Vector3(
    finH * t, finThick / 2,
    -THREE.MathUtils.lerp(finRootLe, finTipLe, t) + THREE.MathUtils.lerp(finRootChord, finTipChord, t) * hingeU,
  )
  const hA = hingeAt(0), hB = hingeAt(1)
  const cutNormal = new THREE.Vector3(-(hB.z - hA.z), 0, hB.x - hA.x).normalize()
  const cutPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(cutNormal, hA)
  const restoreUv = (geo: THREE.BufferGeometry): THREE.BufferGeometry => {
    const pos = geo.getAttribute('position'), uv = new Float32Array(pos.count * 2)
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp(pos.getX(i) / finH, 0, 1)
      const le = -THREE.MathUtils.lerp(finRootLe, finTipLe, t), chord = THREE.MathUtils.lerp(finRootChord, finTipChord, t)
      uv[i * 2] = t; uv[i * 2 + 1] = THREE.MathUtils.clamp((pos.getZ(i) - le) / chord, 0, 1)
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    return geo
  }
  const fin = new THREE.Mesh(restoreUv(cutSkin(finGeo, cutPlane.clone().negate())), finMat)
  fin.name = 'verticalFin'
  fin.castShadow = fin.receiveShadow = true
  finGroup.add(fin)
  const rudderSkin = new THREE.Mesh(restoreUv(cutSkin(finGeo, cutPlane)), finMat)
  rudderSkin.name = 'rudder'
  rudderSkin.castShadow = rudderSkin.receiveShadow = true
  finGroup.add(rudderSkin)
  const rudderHinge: HingeFrame = createHingeFrame(finGroup, 'rudder-hinge', hA, hB)
  attachSkin(rudderHinge, rudderSkin)
  // Trijet center engine (MD-11/DC-10 class): S-duct pod at the fin base.
  if (cfg.engines.count === 3) {
    const cR = profile?.engineRadius ?? R * .58
    const ceng = buildTurbofan(cR, profile?.engineLength ?? R * 2.4, WHITE)
    ceng.userData.jetEngine = true
    reverserSleeves.push(ceng.userData.reverserSleeve as THREE.Mesh)
    add(ceng, finRootX + L * .015, 0, -R * (cfg.engines.mounted === 'tail' ? 1.12 : 1.8))
  }
  const tailHeight = cfg.tTail ? .92 : profile?.stabilizerHeight ?? 0
  const stabZ = tailHeight ? -R*.9-finH*tailHeight : -R*.25
  const stabX = tailHeight ? finRootX-L*.065*tailHeight/.92 : -L*.36
  for (const side of [-1, 1]) {
    const stab = taperedPanel(stabX, L * 0.085, stabX - L * 0.075, L * 0.032, side * R * 0.2, side * halfSpan * 0.38, R * 0.09, BELLY)
    stab.position.y = -stabZ
    g.add(stab)
  }

  // ---- gear (animated) + bay doors (Slice 2) ----
  // Doors are SIBLINGS of the leg group (never children) so they don't
  // inherit the stowed-leg visibility pop; doorFrac = clamp(gearPos*3)
  // means they trail the retraction and cover the pop (≤6% crack).
  const zBelly = R * 0.68 // tube bottom: fuse center sits 0.32R above origin
  const gearGroups: { grp: THREE.Group; nose: boolean; fold: number }[] = []
  const doorPivots: { pivot: THREE.Group; open: number }[] = []
  const visualGear = cfg.gear.map(leg => ({...leg, axles: leg.nose ? 1 : profile?.mainAxles ?? 1}))
  const main = cfg.gear.find(leg=>!leg.nose)
  if(main && profile?.bodyBogies) for(let i=0;i<profile.bodyBogies;i++) {
    visualGear.push({...main, x:main.x-L*.035, y:profile.bodyBogies===1?0:(i===0?-1:1)*R*.48, axles:cfg.hump==='a380'?3:profile.bodyBogies===1?1:2})
  }
  for (const leg of visualGear) {
    const grp = new THREE.Group()
    grp.name = 'jetGear'
    grp.userData.contact = { x: leg.x, y: leg.y, z: leg.z }
    const wheelR = leg.nose ? R * 0.2 : R * 0.29
    const strutLen = leg.z * 0.66
    const wheelArm = strutLen - wheelR // pivot → wheel center
    placeBody(grp, leg.x, leg.y, leg.z - strutLen)
    // Strut runs pivot→axle; the wheel CENTER rides one radius above the
    // contact point so the tire bottom meets the runway (wheels used to
    // be centered AT contact — half a tire under the pavement).
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.07, R * 0.07, wheelArm, 8), SILVER)
    strut.position.y = -wheelArm / 2
    strut.castShadow = true
    grp.add(strut)
    for (let axle=0;axle<leg.axles;axle++) for (const wy of leg.nose ? [-R * 0.13, R * 0.13] : [-R * 0.16, R * 0.16]) {
      const wheel = buildAircraftWheel(wheelR, R * .18)
      wheel.position.set(wy, -wheelArm, (axle-(leg.axles-1)/2)*wheelR*2.3)
      wheel.castShadow = true
      grp.add(wheel)
    }
    g.add(grp)
    // Per-leg fold angle: swing the wheel inboard until it sits just
    // short of the centerline; an arm shorter than the span means a full
    // 90° horizontal stow (A320-class) — a fixed angle would either
    // under-fold long legs or cross short-armed wheels past the keel.
    const fold = leg.nose ? 1.5 : Math.asin(THREE.MathUtils.clamp((Math.abs(leg.y) - wheelR * 0.4) / wheelArm, 0, 1))
    gearGroups.push({ grp, nose: !!leg.nose, fold })
    if (!leg.nose) {
      // Main bay door: hinged on the KEEL side (an outboard hinge would
      // sweep through the fixed canoe fairing on CRJ-scale types),
      // swinging about the fore-aft axis, closed flush with the belly.
      const sgn = leg.y > 0 ? 1 : -1
      const w = Math.max(R*.3, Math.abs(leg.y) - R * 0.18 + wheelR * 0.5)
      const doorPivot = new THREE.Group()
      placeBody(doorPivot, leg.x, sgn * R * 0.18, zBelly)
      const panel = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, wheelR * 2.6), BELLY)
      panel.position.set(sgn * w / 2, 0, 0)
      panel.castShadow = true
      doorPivot.add(panel)
      g.add(doorPivot)
      doorPivots.push({ pivot: doorPivot, open: -sgn * 1.35 })
    } else {
      // Nose clamshell halves: hinged at the bay's outboard edges along
      // the fore-aft axis (the leg itself folds forward about X — the
      // two motions are independent). Bay runs forward of the pivot to
      // cover the stowed leg + wheel.
      const bayLen = wheelArm + wheelR * 2
      for (const sgn of [-1, 1] as const) {
        const doorPivot = new THREE.Group()
        placeBody(doorPivot, leg.x + (wheelArm + wheelR) / 2, sgn * R * 0.17, zBelly)
        const w = R * 0.17
        const panel = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, bayLen), BELLY)
        panel.position.set(-sgn * w / 2, 0, 0)
        panel.castShadow = true
        doorPivot.add(panel)
        g.add(doorPivot)
        doorPivots.push({ pivot: doorPivot, open: sgn * 1.5 })
      }
    }
  }

  // invisible prop slot (interface uniformity)
  const propDisc = new THREE.Mesh(new THREE.CircleGeometry(0.01, 6), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0 }))
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, opacity: 0 }))
  propDisc.userData.blade = blade
  g.add(propDisc)
  g.add(blade)

  const surfaces = (s: SurfaceState): void => {
    rudderHinge.setAngle(Math.max(-1, Math.min(1, s.yaw ?? 0)) * 0.4)
    for (const p of flapPivots) {
      p.userData.z0 ??= p.position.z
      p.userData.y0 ??= p.position.y
      // Hooked-track Fowler schedule (fowler.ts): aft extension first
      // (slot opens by mid-travel), rotation late — extend OUT, then DOWN.
      const fp = fowlerPose(s.flapFrac)
      // ~60% of the flap's own chord (0.23·rootChord): stays tucked at
      // the wing TE; near-flat drop keeps ground clearance at full flaps.
      // Tight slot (~35% of flap chord) + 29° visual cap: connected at
      // every setting, clear of the ground tail-down.
      p.position.z = (p.userData.z0 as number) + fp.ext * rootChord * 0.08
      p.position.y = (p.userData.y0 as number) - fp.drop * R * 0.04
      p.rotation.x = fp.rot * 0.5
    }
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
    // Doors trail the gear: fully open through most of the travel, then
    // close over the bay as the leg reaches its stowed position.
    const doorFrac = Math.min(Math.max(s.gearPos * 3, 0), 1)
    for (const d of doorPivots) d.pivot.rotation.z = d.open * doorFrac
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
      // Fin TIP (the old 55%-height point sat inside the fin skin);
      // beacon on the fuselage spine.
      tail: new THREE.Vector3(0, R * 0.9 + finH, 0.5 * L),
      beacon: new THREE.Vector3(0, R * 1.35, 0),
    }
  }
  return { group: g, propDisc, surfaces }
}

/** Uses real family diameters and exact physics contacts when supplied. */
export function airlinerCfgFor(spec: {
  designator: string; lengthM: number; spanM: number; wingAreaM2?: number
  powerplant: { kind: string; count?: number }
}, contacts?: Record<string, {x:number;y:number;z:number}>): AirlinerCfg {
  const profile = jetProfileFor(spec.designator)
  const L=spec.lengthM, R=profile.diameter/2, depth=standardGearZ(L)
  const track=Math.max(spec.spanM*.16,1.7)
  const gear: AirlinerCfg['gear'] = contacts ? Object.entries(contacts).map(([name,leg])=>({...leg,nose:name==='nose'})) : [
    {x:L*.38,y:0,z:depth*.98,nose:true},
    {x:-L*.028,y:-track/2,z:depth},
    {x:-L*.028,y:track/2,z:depth},
  ]
  return { designator:spec.designator,lengthM:L,spanM:spec.spanM,wingAreaM2:spec.wingAreaM2,
    fuseRadiusM:R,sweepDeg:profile.sweep,engines:{count:(spec.powerplant.count??2) as 2|3|4,mounted:profile.mount},
    tTail:profile.tTail,winglet:profile.winglet,hump:profile.hump,gear,profile }
}
