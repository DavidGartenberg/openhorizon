import * as THREE from 'three'
import { trafficConfiguration, type TrafficConfiguration, type TrafficModelChoice } from './xplane-proxy'
import { loadLocalAircraft, type LocalAircraftInstance } from './local-aircraft'
import type { SurfaceState } from './aircraft-mesh'

/**
 * Traffic and AI aircraft drawn with the real X-Plane exterior models.
 *
 * The X-Plane aircraft the player can fly (737, A330, MD-82, 172, SR22, Baron,
 * Cub, ASK 21, Citation X) are loaded from the user's own install once per
 * model; every airplane that is not the player's is a cheap clone that shares
 * that geometry, material and textures, scaled to its type's real length and
 * posed (gear, flaps, prop disc) from its observed kinematics. Types with no
 * matching model, and targets beyond the near budget, keep their archetype
 * silhouette (one draw call).
 */

export { XP_NATIVE_SIZE, chooseTrafficModel, trafficConfiguration, type TrafficModelChoice, type TrafficKinematics, type TrafficConfiguration } from './xplane-proxy'

export interface TrafficModelInstance {
  group: THREE.Group
  /** Lift to add so the wheels (gear down) rest where the origin's ground contact is expected. */
  groundOffsetM: number
  pose: (c: TrafficConfiguration) => void
}

interface Proto { instantiate: () => LocalAircraftInstance; minY: number }

/** Loads each X-Plane exterior once and stamps out shared-geometry copies. */
export class TrafficModelLibrary {
  private readonly protos = new Map<string, Proto | 'loading' | 'failed'>()

  /** Start loading a model (once); false while it is not ready or has failed. */
  ensure(key: string): boolean {
    const p = this.protos.get(key)
    if (p === undefined) {
      this.protos.set(key, 'loading')
      void loadLocalAircraft(key).then((v) => {
        if (!v?.instantiate) { this.protos.set(key, 'failed'); return }
        v.surfaces({ flapFrac: 0, spoilerFrac: 0, gearPos: 1 })
        // Lowest point with the gear down (the tyres), in the model's own frame.
        const box = new THREE.Box3().setFromObject(v.group)
        this.protos.set(key, { instantiate: v.instantiate, minY: Number.isFinite(box.min.y) ? box.min.y : 0 })
      }).catch(() => this.protos.set(key, 'failed'))
      return false
    }
    return typeof p === 'object'
  }

  status(key: string): 'loading' | 'ready' | 'failed' | 'unrequested' {
    const p = this.protos.get(key)
    return p === undefined ? 'unrequested' : p === 'loading' ? 'loading' : p === 'failed' ? 'failed' : 'ready'
  }

  create(choice: TrafficModelChoice): TrafficModelInstance | null {
    const p = this.protos.get(choice.key)
    if (typeof p !== 'object') return null
    const inst = p.instantiate()
    const wrapper = new THREE.Group()
    wrapper.name = `traffic:${choice.key}`
    wrapper.scale.setScalar(choice.scale)
    wrapper.add(inst.group)
    let last = ''
    return {
      group: wrapper,
      groundOffsetM: -p.minY * choice.scale,
      pose: (c) => {
        const stamp = `${c.gearPos}|${c.flapFrac.toFixed(2)}|${c.rpm > 900}`
        if (stamp === last) return
        last = stamp
        const s: SurfaceState = { flapFrac: c.flapFrac, spoilerFrac: 0, gearPos: c.gearPos }
        inst.pose(s, c.rpm)
      },
    }
  }
}

/** The one library every traffic consumer shares, so a model is loaded once. */
export const sharedTrafficModels = new TrafficModelLibrary()

/**
 * Swaps one AI airplane's silhouette for its X-Plane exterior as soon as that
 * model has loaded, then keeps its gear / flaps / prop disc posed from how it
 * is flying. Vertical speed is derived from the altitude it reports.
 */
export class XpShipGraphics {
  private inst: TrafficModelInstance | null = null
  private prevAltFt = Number.NaN
  private vsFpm = 0

  constructor(
    private readonly choice: TrafficModelChoice | null,
    private readonly parent: THREE.Group,
    private readonly silhouette: readonly THREE.Object3D[],
    private readonly models: TrafficModelLibrary = sharedTrafficModels,
  ) {}

  get active(): boolean { return this.inst !== null }

  /** Take the shared exterior off the ship before the ship's own (silhouette) geometry is disposed. */
  release(): void {
    if (this.inst) this.parent.remove(this.inst.group)
    this.inst = null
  }

  update(k: { gnd: boolean; gsKt: number; aglFt: number; altFt: number }, dtS: number): void {
    if (Number.isFinite(this.prevAltFt) && dtS > 0) {
      const inst = ((k.altFt - this.prevAltFt) / dtS) * 60
      this.vsFpm += (inst - this.vsFpm) * Math.min(1, dtS / 1.5)
    }
    this.prevAltFt = k.altFt
    if (!this.choice) return
    if (!this.inst) {
      if (!this.models.ensure(this.choice.key)) return
      const inst = this.models.create(this.choice)
      if (!inst) return
      inst.group.position.y = inst.groundOffsetM
      this.parent.add(inst.group)
      for (const o of this.silhouette) o.visible = false
      this.inst = inst
    }
    this.inst.pose(trafficConfiguration({ gnd: k.gnd, gsKt: k.gsKt, aglFt: k.aglFt, vsFpm: this.vsFpm }))
  }
}
