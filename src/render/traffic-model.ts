import * as THREE from 'three'
import type { ArchetypeSpec } from '../world/fleet-map'
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

/** Real length / span (m) of each model, to scale it to the type it stands for. */
export const XP_NATIVE_SIZE: Record<string, { lengthM: number; spanM: number }> = {
  B738: { lengthM: 39.47, spanM: 35.8 },
  A333: { lengthM: 63.7, spanM: 60.3 },
  MD82: { lengthM: 45.1, spanM: 32.9 },
  C750: { lengthM: 22.0, spanM: 19.4 },
  C172: { lengthM: 8.28, spanM: 11.0 },
  SR22: { lengthM: 7.9, spanM: 11.7 },
  BE58: { lengthM: 9.1, spanM: 11.5 },
  PA18: { lengthM: 6.9, spanM: 10.7 },
  AS21: { lengthM: 8.35, spanM: 17.0 },
}

const MD80_FAMILY = new Set(['MD80', 'MD81', 'MD82', 'MD83', 'MD87', 'MD88', 'MD90'])
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export interface TrafficModelChoice { key: string; scale: number }

/**
 * Which installed X-Plane model stands for a traffic type, and the uniform
 * scale that matches its real length. Pure. `allowHeavy: false` keeps the very
 * large A330 model (600k triangles) off crowded ramps: widebodies then use the
 * 737, stretched.
 */
export function chooseTrafficModel(spec: ArchetypeSpec, designator: string, opts: { allowHeavy?: boolean } = {}): TrafficModelChoice | null {
  const allowHeavy = opts.allowHeavy ?? true
  const fit = (key: string, lo: number, hi: number, by: 'lengthM' | 'spanM' = 'lengthM'): TrafficModelChoice => ({
    key, scale: clamp(spec[by] / XP_NATIVE_SIZE[key]![by], lo, hi),
  })
  if (MD80_FAMILY.has(designator.toUpperCase())) return fit('MD82', 0.85, 1.15)
  switch (spec.archetype) {
    case 'narrowbody': return fit('B738', 0.6, 1.4)
    case 'widebody': return allowHeavy ? fit('A333', 0.8, 1.4) : fit('B738', 1.0, 2.2)
    case 'bizjet': return fit('C750', 0.6, 1.6)
    case 'ga-high-wing': return fit('C172', 0.8, 1.5)
    case 'ga-low-wing': return fit('SR22', 0.8, 1.4)
    case 'taildragger': return fit('PA18', 0.8, 1.6)
    case 'twin-piston': return fit('BE58', 0.85, 1.5)
    case 'single-turboprop': return fit('SR22', 1, 2)
    case 'twin-turboprop': return spec.lengthM <= 20 ? fit('BE58', 1, 2.2) : null
    case 'glider': return fit('AS21', 0.8, 1.6)
    default: return null
  }
}

export interface TrafficKinematics { gnd: boolean; gsKt: number; aglFt: number; vsFpm: number }
export interface TrafficConfiguration { gearPos: number; flapFrac: number; rpm: number }

/**
 * What an airplane's gear, flaps and props look like given how it is moving.
 * ADS-B and the AI pilots carry no configuration, so this is a cosmetic
 * inference (recorded): gear and flaps out low and slow near the ground,
 * clean above that; props always turning once rolling or flying.
 */
export function trafficConfiguration(k: TrafficKinematics): TrafficConfiguration {
  const gs = Number.isFinite(k.gsKt) ? k.gsKt : 0
  const agl = Number.isFinite(k.aglFt) ? k.aglFt : 5000
  const vs = Number.isFinite(k.vsFpm) ? k.vsFpm : 0
  if (k.gnd) return { gearPos: 1, flapFrac: 0, rpm: gs > 3 ? 1200 : 0 }
  const low = agl < 1800 && gs < 200
  let flapFrac = 0
  if (low && vs < 0 && agl < 2500 && gs < 180) flapFrac = 0.5 + 0.5 * clamp((170 - gs) / 60, 0, 1)
  else if (low && vs >= 0 && gs < 190) flapFrac = 0.25
  return { gearPos: low ? 1 : 0, flapFrac, rpm: 2300 }
}

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
