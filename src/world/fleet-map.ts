/**
 * Designator → visual archetype + scale (Phase 12b). Pure module (no
 * three.js) so the mapping is unit-testable; `src/render/fleet-mesh.ts`
 * turns the result into geometry.
 *
 * Two layers, honestly ranked:
 *  1. OVERRIDES — real span/length (and wing placement) for the common
 *     types, from published data.
 *  2. Family fallback from the Doc-8643 desc code + WTC: silhouette family
 *     by kind/engine-type/engine-count, size bucket by WTC. An unknown
 *     designator gets the generic silhouette at light-GA scale — visibly a
 *     placeholder, never a fake specific type.
 */
import { parseDesc } from './aircraft-types'

export type Archetype =
  | 'ga-high-wing' | 'ga-low-wing' | 'taildragger' | 'twin-piston'
  | 'single-turboprop' | 'twin-turboprop' | 'bizjet' | 'narrowbody'
  | 'widebody' | 'glider' | 'rotorcraft' | 'generic'

export interface ArchetypeSpec {
  archetype: Archetype
  spanM: number
  lengthM: number
  engines: number
  /** Four-engine wing layout (747/A380/C-130 class). */
  quad?: boolean
}

/** Published span/length (m) + archetype for common types. */
const OVERRIDES: Record<string, [Archetype, number, number, number?]> = {
  // GA pistons
  C172: ['ga-high-wing', 11.0, 8.3], C152: ['ga-high-wing', 10.2, 7.3],
  C182: ['ga-high-wing', 11.0, 8.8], C206: ['ga-high-wing', 11.0, 8.6],
  C210: ['ga-high-wing', 11.2, 8.6],
  P28A: ['ga-low-wing', 10.7, 7.3], P28R: ['ga-low-wing', 10.8, 7.5],
  PA24: ['ga-low-wing', 11.0, 7.6], M20P: ['ga-low-wing', 11.0, 8.1],
  SR20: ['ga-low-wing', 11.7, 7.9], SR22: ['ga-low-wing', 11.7, 7.9],
  BE33: ['ga-low-wing', 10.2, 8.1], BE36: ['ga-low-wing', 10.2, 8.4],
  DA40: ['ga-low-wing', 11.9, 8.1],
  J3: ['taildragger', 10.7, 6.8], PA18: ['taildragger', 10.7, 6.9],
  DHC2: ['taildragger', 14.6, 9.2], CH7A: ['taildragger', 10.2, 6.9],
  // Piston twins
  BE58: ['twin-piston', 11.5, 9.1], PA34: ['twin-piston', 11.9, 8.7],
  DA42: ['twin-piston', 13.6, 8.6], C310: ['twin-piston', 11.3, 9.7],
  // Turboprops
  PC12: ['single-turboprop', 16.3, 14.4], TBM9: ['single-turboprop', 12.8, 10.7],
  TBM8: ['single-turboprop', 12.7, 10.6], C208: ['single-turboprop', 15.9, 11.5],
  EPIC: ['single-turboprop', 13.1, 11.0],
  BE20: ['twin-turboprop', 16.6, 13.3], B350: ['twin-turboprop', 17.7, 14.2],
  DHC6: ['twin-turboprop', 19.8, 15.8], AT76: ['twin-turboprop', 27.1, 27.2],
  DH8D: ['twin-turboprop', 28.4, 32.8], SF34: ['twin-turboprop', 21.4, 19.7],
  C130: ['twin-turboprop', 40.4, 29.8, 4],
  // Bizjets
  C25A: ['bizjet', 15.2, 14.4], C56X: ['bizjet', 17.2, 16.0],
  C68A: ['bizjet', 22.0, 20.9], CL35: ['bizjet', 21.0, 20.9],
  GLF4: ['bizjet', 23.7, 26.9], GLF5: ['bizjet', 28.5, 29.4],
  GLF6: ['bizjet', 30.4, 30.4], GL7T: ['bizjet', 31.7, 33.8],
  E55P: ['bizjet', 16.2, 15.6], PC24: ['bizjet', 17.0, 16.8],
  LJ35: ['bizjet', 12.0, 14.8],
  // Regional jets
  E75L: ['narrowbody', 26.0, 31.7], E75S: ['narrowbody', 26.0, 31.7],
  E190: ['narrowbody', 28.7, 36.2], CRJ2: ['narrowbody', 21.2, 26.8],
  CRJ7: ['narrowbody', 23.2, 32.3], CRJ9: ['narrowbody', 24.9, 36.4],
  // Narrowbody airliners
  B737: ['narrowbody', 35.8, 33.6], B738: ['narrowbody', 35.8, 39.5],
  B739: ['narrowbody', 35.8, 42.1], B38M: ['narrowbody', 35.9, 39.5],
  B39M: ['narrowbody', 35.9, 42.2], B752: ['narrowbody', 38.0, 47.3],
  A319: ['narrowbody', 35.8, 33.8], A320: ['narrowbody', 35.8, 37.6],
  A321: ['narrowbody', 35.8, 44.5], A20N: ['narrowbody', 35.8, 37.6],
  A21N: ['narrowbody', 35.8, 44.5], BCS3: ['narrowbody', 35.1, 38.7],
  MD88: ['narrowbody', 32.8, 45.1],
  // Widebodies
  B763: ['widebody', 47.6, 54.9], B772: ['widebody', 60.9, 63.7],
  B77W: ['widebody', 64.8, 73.9], B788: ['widebody', 60.1, 56.7],
  B789: ['widebody', 60.1, 62.8], A332: ['widebody', 60.3, 58.8],
  A333: ['widebody', 60.3, 63.7], A339: ['widebody', 64.0, 63.7],
  A359: ['widebody', 64.8, 66.8], B744: ['widebody', 64.4, 70.7, 4],
  B748: ['widebody', 68.4, 76.3, 4], A388: ['widebody', 79.8, 72.7, 4],
  MD11: ['widebody', 51.7, 61.2, 3],
  // Gliders / rotorcraft
  GLID: ['glider', 15.0, 6.5], AS21: ['glider', 17.0, 8.4],
  DISC: ['glider', 15.0, 6.4],
  R22: ['rotorcraft', 7.7, 8.7], R44: ['rotorcraft', 10.1, 11.7],
  EC35: ['rotorcraft', 10.2, 12.2], B06: ['rotorcraft', 10.2, 12.0],
  S76: ['rotorcraft', 13.4, 16.0], H60: ['rotorcraft', 16.4, 19.8],
}

/** Size bucket by WTC when no override exists: [span, length] metres. */
const WTC_SCALE: Record<string, [number, number]> = {
  L: [11, 8.5],
  M: [30, 33],
  H: [60, 65],
  J: [79.8, 72.7],
}

export function archetypeFor(designator: string, desc: string, wtc: string): ArchetypeSpec {
  const d = (designator || '').trim().toUpperCase()
  const o = OVERRIDES[d]
  if (o) {
    const parsed = parseDesc(desc)
    const engines = o[3] ?? (parsed.engines || defaultEngines(o[0]))
    return { archetype: o[0], spanM: o[1], lengthM: o[2], engines, quad: engines >= 4 }
  }

  const p = parseDesc(desc)
  const [spanM, lengthM] = WTC_SCALE[wtc] ?? WTC_SCALE['L']!
  if (p.kind === 'helicopter' || p.kind === 'gyrocopter' || p.kind === 'tiltrotor') {
    return { archetype: 'rotorcraft', spanM: Math.min(spanM, 12), lengthM: Math.min(lengthM, 14), engines: p.engines }
  }
  if (p.kind === 'glider') return { archetype: 'glider', spanM: 15, lengthM: 6.5, engines: 0 }
  if (p.kind === 'unknown') return { archetype: 'generic', spanM: 11, lengthM: 8.5, engines: 0 }
  // Fixed-wing families by powerplant.
  if (p.engineType === 'jet') {
    if (wtc === 'H' || wtc === 'J') return { archetype: 'widebody', spanM, lengthM, engines: Math.max(p.engines, 2), quad: p.engines >= 4 }
    if (wtc === 'M') return { archetype: 'narrowbody', spanM, lengthM, engines: Math.max(p.engines, 2) }
    return { archetype: 'bizjet', spanM: 17, lengthM: 16, engines: Math.max(p.engines, 2) }
  }
  if (p.engineType === 'turboprop') {
    if (p.engines >= 2) return { archetype: 'twin-turboprop', spanM: Math.max(spanM, 17), lengthM: Math.max(lengthM, 14), engines: p.engines, quad: p.engines >= 4 }
    return { archetype: 'single-turboprop', spanM: 14, lengthM: 12, engines: 1 }
  }
  // Piston (and electric/unknown-powered light types).
  if (p.engines >= 2) return { archetype: 'twin-piston', spanM: 11.5, lengthM: 9, engines: p.engines }
  return { archetype: 'ga-high-wing', spanM, lengthM, engines: 1 }
}

function defaultEngines(a: Archetype): number {
  switch (a) {
    case 'twin-piston': case 'twin-turboprop': case 'bizjet': case 'narrowbody': case 'widebody':
      return 2
    case 'glider':
      return 0
    default:
      return 1
  }
}
