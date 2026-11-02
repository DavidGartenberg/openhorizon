import * as THREE from 'three'
import { chooseTrafficModel, trafficConfiguration } from './xplane-proxy'
import { sharedTrafficModels, type TrafficModelInstance } from './traffic-model'
import { nearestParked, parkedSpec, standOffset, type ParkedSource, type ParkedSpot } from '../world/parked-aircraft'

/** At most this many parked airplanes are drawn at once (the nearest to the camera), each within this distance (m). */
export const MAX_PARKED = 6
export const PARKED_RADIUS_M = 1400

interface Entry { key: string; source: ParkedSource; spot: ParkedSpot & { y: number }; at: { x: number; z: number }; inst: TrafficModelInstance }

/**
 * Scenery airplanes at the nearest gates and tie-downs, drawn with the installed X-Plane exteriors (shared
 * geometry, gear down, engines off). Not traffic: no label, no radar or TCAS entry.
 */
export class ParkedAircraftLayer {
  private readonly root = new THREE.Group()
  private readonly entries = new Map<string, Entry>()

  constructor(scene: THREE.Scene) { this.root.name = 'parkedAircraft'; scene.add(this.root) }

  /** Choose which spots are drawn (about once a second): the nearest free ones to the camera. */
  update(sources: readonly ParkedSource[], camera: THREE.Vector3, occupied: (worldX: number, worldZ: number) => boolean): void {
    const world = (s: ParkedSource, p: ParkedSpot & { y: number }): { x: number; z: number } => ({ x: s.group.position.x + p.x, z: s.group.position.z + p.z })
    const candidates = sources.flatMap((source) => source.spots.map((spot) => ({ source, spot, ...world(source, spot) })))
    const wanted = nearestParked(candidates, { x: camera.x, z: camera.z }, PARKED_RADIUS_M, MAX_PARKED, (c) => occupied(c.x, c.z))
    const keep = new Set(wanted.map((w) => `${w.source.id}:${w.spot.id}`))
    for (const [key, e] of this.entries) {
      if (!keep.has(key)) { this.root.remove(e.inst.group); this.entries.delete(key) }
    }
    for (const w of wanted) {
      const key = `${w.source.id}:${w.spot.id}`
      if (this.entries.has(key)) continue
      const choice = chooseTrafficModel(parkedSpec(w.spot.kind), '', { allowHeavy: false })
      if (!choice || !sharedTrafficModels.ensure(choice.key)) continue          // starts loading; drawn on a later pass
      const inst = sharedTrafficModels.create(choice)
      if (!inst) continue
      inst.pose(trafficConfiguration({ gnd: true, gsKt: 0, aglFt: 0, vsFpm: 0 }))
      inst.group.rotation.y = -(w.spot.hdg * Math.PI) / 180
      this.root.add(inst.group)
      this.entries.set(key, { key, source: w.source, spot: w.spot, at: standOffset(w.spot, parkedSpec(w.spot.kind).lengthM), inst })
    }
    this.follow()
  }

  /** Keep each airplane on its stand as the world origin moves (every frame). */
  follow(): void {
    for (const e of this.entries.values()) {
      const g = e.source.group.position
      e.inst.group.position.set(g.x + e.at.x, g.y + e.spot.y + e.inst.groundOffsetM, g.z + e.at.z)
    }
  }

  get count(): number { return this.entries.size }

  /** Where each drawn airplane is, in render space (verification). */
  positions(): Array<[number, number, number]> { return [...this.entries.values()].map((e) => [e.inst.group.position.x, e.inst.group.position.y, e.inst.group.position.z]) }

  /** Take the airplanes off the scene (the shared exteriors stay loaded). */
  dispose(): void { this.root.removeFromParent(); this.entries.clear() }
}
