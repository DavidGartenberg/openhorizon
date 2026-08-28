/**
 * Player aircraft exterior lights (13c): nav (red/green/white), rotating
 * beacon, wingtip strobes — six additive glow points parented to the
 * aircraft group — plus a fake landing-light ground spot (the terrain's
 * custom shader can't receive a real THREE.SpotLight; recorded).
 * Timing comes from the pure sim/lights module. All lights need the
 * electrical bus: the no-electrical J-3 Cub honestly flies dark.
 */
import * as THREE from 'three'
import { beaconOn, strobeOn } from '../sim/lights'
import { lightGlowTexture } from './light-glow'

const OFF = new THREE.Color(0, 0, 0)
const NAV_L = new THREE.Color(1, 0.1, 0.08)
const NAV_R = new THREE.Color(0.08, 1, 0.22)
const NAV_TAIL = new THREE.Color(1, 1, 0.92)
const BEACON_RED = new THREE.Color(1, 0.08, 0.06)
const STROBE_WHITE = new THREE.Color(1, 1, 1)

interface Anchors {
  wingtipL: THREE.Vector3
  wingtipR: THREE.Vector3
  tail: THREE.Vector3
  /** Rotating-beacon fixture (fuselage spine on transports). Absent =
   *  just below the tail/fin-tip anchor. */
  beacon?: THREE.Vector3
}

export class AircraftLights {
  private pts: THREE.Points | null = null
  private colorAttr: THREE.BufferAttribute | null = null
  private readonly disc: THREE.Mesh
  private readonly discMat: THREE.MeshBasicMaterial
  landingOn = false

  constructor(scene: THREE.Scene) {
    this.discMat = new THREE.MeshBasicMaterial({
      map: lightGlowTexture(), color: 0xfff0d0, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    })
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(1, 24), this.discMat)
    this.disc.rotation.x = -Math.PI / 2
    this.disc.renderOrder = 26
    scene.add(this.disc)
  }

  /** Parent the six glow points to the aircraft. Archetype silhouettes
   *  carry real wingtip/tail anchors; Tier-A meshes fall back to their
   *  bounding box (wingtips ARE the ±x extremes). */
  attach(group: THREE.Group): void {
    let anchors: Anchors | null = null
    group.traverse((o) => {
      if (!anchors && (o.userData.lightAnchors as Anchors | undefined)) anchors = o.userData.lightAnchors as Anchors
    })
    if (!anchors) {
      group.updateWorldMatrix(true, true)
      const box = new THREE.Box3().setFromObject(group)
      const wingZ = (box.min.z + box.max.z) * 0.3
      // Clamp the vertical reference: a model built below the origin
      // (X-Plane OBJ8 exports) has box.max.y ≈ 0, and scaling it put
      // every light at the belly line.
      const topY = Math.max(box.max.y, 0.4)
      anchors = {
        wingtipL: new THREE.Vector3(box.min.x + 0.08, topY * 0.62, wingZ),
        wingtipR: new THREE.Vector3(box.max.x - 0.08, topY * 0.62, wingZ),
        tail: new THREE.Vector3(0, topY * 0.55, box.max.z - 0.05),
      }
    }
    const a = anchors as Anchors
    // Beacon: at the builder's fixture when given, else just under the
    // tail anchor (the old tail.z*0.82 scaling landed it 5 m below the
    // 737's fin tip, buried mid-fin).
    const beacon = a.beacon ?? new THREE.Vector3(0, a.tail.y - 0.35, a.tail.z - 0.6)
    // Physical lens fixtures ON the airframe (user: "put the lights on
    // the plane") — the additive glows float at these same points; the
    // lenses make the hardware visible up close and in daylight.
    const lens = (x: number, y: number, z: number, color: number, r = 0.09): void => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(r, 8, 6),
        new THREE.MeshBasicMaterial({ color }),
      )
      m.position.set(x, y, z)
      group.add(m)
    }
    lens(a.wingtipL.x, a.wingtipL.y, a.wingtipL.z, 0xff2a2a)
    lens(a.wingtipR.x, a.wingtipR.y, a.wingtipR.z, 0x27d75a)
    lens(a.tail.x, a.tail.y, a.tail.z, 0xffffff, 0.07)
    lens(beacon.x, beacon.y, beacon.z, 0xff2020, 0.1)
    const p: THREE.Vector3[] = [
      a.wingtipL,
      a.wingtipR,
      new THREE.Vector3(a.tail.x, a.tail.y, a.tail.z),
      beacon,
      new THREE.Vector3(a.wingtipL.x, a.wingtipL.y + 0.14, a.wingtipL.z),
      new THREE.Vector3(a.wingtipR.x, a.wingtipR.y + 0.14, a.wingtipR.z),
    ]
    const pos = new Float32Array(p.length * 3)
    p.forEach((v, i) => pos.set([v.x, v.y, v.z], i * 3))
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.colorAttr = new THREE.BufferAttribute(new Float32Array(p.length * 3), 3)
    geo.setAttribute('color', this.colorAttr)
    const mat = new THREE.PointsMaterial({
      map: lightGlowTexture(), size: 1.6, sizeAttenuation: true, vertexColors: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    this.pts = new THREE.Points(geo, mat)
    this.pts.frustumCulled = false // six points, moves with the ship
    group.add(this.pts)
  }

  update(tS: number, powered: boolean, aglM: number, group: THREE.Group, groundYAt: (xE: number, zS: number) => number): void {
    if (this.colorAttr) {
      const set = (i: number, c: THREE.Color, on: boolean): void => {
        const cc = on ? c : OFF
        this.colorAttr!.setXYZ(i, cc.r, cc.g, cc.b)
      }
      set(0, NAV_L, powered)
      set(1, NAV_R, powered)
      set(2, NAV_TAIL, powered)
      set(3, BEACON_RED, powered && beaconOn(tS))
      const s = powered && strobeOn(tS)
      set(4, STROBE_WHITE, s)
      set(5, STROBE_WHITE, s)
      this.colorAttr.needsUpdate = true
    }
    // Landing-light ground spot: an additive ellipse projected ahead along
    // the beam, brightness falling off with throw distance.
    if (!this.landingOn || !powered || aglM > 150) {
      this.discMat.opacity = 0
      return
    }
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(group.quaternion)
    const fl = Math.hypot(fwd.x, fwd.z) || 1e-6
    const dist = Math.min(Math.max((aglM + 1.5) * 5.5, 8), 200)
    const px = group.position.x + (fwd.x / fl) * dist
    const pz = group.position.z + (fwd.z / fl) * dist
    // +0.3 m: the runway strip renders above the terrain surface (and is
    // sloped) — a hair of lift keeps the spot from sinking under it.
    this.disc.position.set(px, groundYAt(px, pz) + 0.3, pz)
    const s = 4 + dist * 0.5
    this.disc.scale.set(s, s * 2.1, 1)
    this.disc.rotation.z = Math.atan2(-fwd.x, -fwd.z)
    this.discMat.opacity = Math.min(14 / dist, 0.5)
  }
}
