import type { ArchetypeSpec } from '../world/fleet-map'
import { archetypeFor } from '../world/fleet-map'
import { ROSTER } from '../sim/aircraft/roster'

/**
 * Which installed X-Plane exterior stands for an aircraft type, and at what scale (pure).
 *
 * The nine models the install carries are exact for their own types; every other
 * aircraft borrows the closest one, scaled to its real length. Traffic and AI airplanes
 * use this, and so do the player's own roster aircraft, so a 737 MAX flown by the
 * player and the same airplane parked on the ramp are drawn by the same model.
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


// ---------------------------------------------------------------- player --

export interface ResolvedLocalModel {
  /** The installed model that is drawn (a key of XP_MODELS). */
  model: string
  /** Uniform scale about the airplane's centre of gravity. */
  scale: number
  /** True when the model is this very type; false when it stands in for it. */
  exact: boolean
}

const EXACT_KEYS: Record<string, string> = { '172': 'C172', '737': 'B738' }

/** The body style of a roster aircraft whose designator the fleet map does not know. */
function derivedArchetype(s: { lengthM: number; powerplant: { kind: string } & Partial<{ count: number }>; gear: { layout: string } }): ArchetypeSpec['archetype'] {
  const n = s.powerplant.count ?? 1
  switch (s.powerplant.kind) {
    case 'jet': return s.lengthM >= 50 ? 'widebody' : s.lengthM >= 22 ? 'narrowbody' : 'bizjet'
    case 'turboprop': return n >= 2 ? 'twin-turboprop' : 'single-turboprop'
    case 'piston': return n >= 2 ? 'twin-piston' : s.gear.layout === 'taildragger' ? 'taildragger' : 'ga-low-wing'
    default: return 'glider'
  }
}

/**
 * The X-Plane exterior for a flyable aircraft: the exact model when the install has one, otherwise
 * the closest installed model scaled to the type's own length. Three- and four-engine types keep their
 * own procedural airframe (no installed model has the right engines); so do rotorcraft and unknown shapes.
 * `known` lists the models that exist (XP_MODELS keys).
 */
export function resolveLocalModel(key: string, known: ReadonlySet<string>): ResolvedLocalModel | null {
  const exact = EXACT_KEYS[key] ?? key
  if (known.has(exact)) return { model: exact, scale: 1, exact: true }
  const entry = ROSTER.find((r) => r.spec.designator === key)
  if (!entry) return null
  const s = entry.spec
  const engines = 'count' in s.powerplant ? s.powerplant.count : 1
  if (engines > 2) return null
  const fromMap = archetypeFor(key, '', '')
  const archetype = fromMap.archetype === 'generic' || fromMap.archetype === 'rotorcraft' ? derivedArchetype(s) : fromMap.archetype
  const choice = chooseTrafficModel({ archetype, spanM: s.spanM, lengthM: s.lengthM, engines }, key, { allowHeavy: true })
  return choice && known.has(choice.key) ? { model: choice.key, scale: choice.scale, exact: false } : null
}
