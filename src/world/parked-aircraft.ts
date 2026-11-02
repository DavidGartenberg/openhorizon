/**
 * Decorative parked airplanes at the gates and tie-downs of X-Plane's airport layouts (pure).
 *
 * Each ramp start of apt.dat says what may park there (`cats`: heavy / jets / turboprops / props) and which way its
 * nose points. A fixed share of them hold an airplane, chosen by a hash of the spot's position so the same airport
 * always looks the same. These are scenery only: no datablock, no TCAS or radar entry, and they never stand where a
 * live target is on the ground (see ParkedAircraftLayer). Recorded in PROGRESS.md.
 */
import type { Object3D } from 'three'
import type { ArchetypeSpec } from './fleet-map'

export type ParkedKind = 'heavy' | 'jet' | 'turboprop' | 'prop'

export interface RampStart { x: number; z: number; hdg: number; kind: string; cats: readonly string[]; name?: string }
export interface ParkedSpot { id: string; x: number; z: number; hdg: number; kind: ParkedKind }

/** An airport's parked spots in its own frame (y = ground height there), and the group whose position places that frame in the world. */
export interface ParkedSource { id: string; group: Object3D; spots: ReadonlyArray<ParkedSpot & { y: number }> }

/** Share of gates / tie-downs that hold an airplane. */
export const GATE_OCCUPANCY = 0.45
export const TIEDOWN_OCCUPANCY = 0.6

/** A stable value in [0, 1) from a spot's position. */
export function spotHash(x: number, z: number): number {
  const h = Math.sin(Math.round(x * 4) * 127.1 + Math.round(z * 4) * 311.7) * 43758.5453
  return h - Math.floor(h)
}

/** What airplane a ramp start takes: the largest class it lists (heavy only when it lists nothing else big), or null. */
export function parkedKindFor(cats: readonly string[]): ParkedKind | null {
  const has = (c: string): boolean => cats.some((x) => x.toLowerCase() === c)
  if (has('jets')) return 'jet'
  if (has('heavy')) return 'heavy'
  if (has('turboprops')) return 'turboprop'
  if (has('props')) return 'prop'
  return null
}

/** The airplanes parked at an airport's ramp starts. Deterministic. */
export function parkedAircraftFor(ramps: readonly RampStart[], gateShare = GATE_OCCUPANCY, tieDownShare = TIEDOWN_OCCUPANCY): ParkedSpot[] {
  const out: ParkedSpot[] = []
  for (const r of ramps) {
    if (!Number.isFinite(r.x) || !Number.isFinite(r.z) || !Number.isFinite(r.hdg)) continue
    const kind = parkedKindFor(r.cats)
    if (!kind) continue
    const tie = /tie|misc|hangar/i.test(r.kind)
    const share = tie ? tieDownShare : gateShare
    // Light airplanes do not take a jet gate, nor jets a tie-down.
    if (tie && (kind === 'jet' || kind === 'heavy')) continue
    if (spotHash(r.x, r.z) >= share) continue
    out.push({ id: `${Math.round(r.x)},${Math.round(r.z)}`, x: r.x, z: r.z, hdg: ((r.hdg % 360) + 360) % 360, kind })
  }
  return out
}

/** The airplane shape each kind is drawn as (the nearest installed X-Plane model is scaled to it). */
export function parkedSpec(kind: ParkedKind): ArchetypeSpec {
  switch (kind) {
    case 'heavy': return { archetype: 'widebody', spanM: 60, lengthM: 64, engines: 2 }
    case 'jet': return { archetype: 'narrowbody', spanM: 34, lengthM: 37, engines: 2 }
    case 'turboprop': return { archetype: 'twin-turboprop', spanM: 16, lengthM: 13, engines: 2 }
    case 'prop': return { archetype: 'ga-high-wing', spanM: 11, lengthM: 8.3, engines: 1 }
  }
}

/** The spots nearest a point, within `radiusM`, none farther than the first `max`; `occupied` skips a live target's stand. */
export function nearestParked<T extends { x: number; z: number }>(spots: readonly T[], at: { x: number; z: number }, radiusM: number, max: number, occupied?: (s: T) => boolean): T[] {
  return spots
    .map((s) => ({ s, d: Math.hypot(s.x - at.x, s.z - at.z) }))
    .filter(({ s, d }) => d <= radiusM && !(occupied?.(s) ?? false))
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map(({ s }) => s)
}

/** How far the nose wheel is ahead of the centre of gravity, as a share of the airplane's length. X-Plane's ramp start is where the nose wheel goes. */
export const NOSE_GEAR_AHEAD_OF_CG = 0.33

/** Where an airplane's centre of gravity stands so that its nose wheel is on the ramp start: back along its heading. */
export function standOffset(spot: { x: number; z: number; hdg: number }, lengthM: number): { x: number; z: number } {
  const H = (spot.hdg * Math.PI) / 180, back = NOSE_GEAR_AHEAD_OF_CG * lengthM
  return { x: spot.x - Math.sin(H) * back, z: spot.z + Math.cos(H) * back }
}
