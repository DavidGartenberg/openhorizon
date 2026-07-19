/**
 * Standard traffic-pattern legs around a runway (§13, Phase 6d): upwind →
 * crosswind → downwind (pattern altitude +1000 AGL) → base → final →
 * threshold. Pure geometry.
 */
import type { TrafficLeg } from './pointmass'

export interface PatternRunway {
  thrLat: number
  thrLon: number
  headingDeg: number
  elevFt: number
}

export function makePatternLegs(rwy: PatternRunway, dir: 'left' | 'right'): TrafficLeg[] {
  const mLat = 111_320
  const mLon = mLat * Math.cos((rwy.thrLat * Math.PI) / 180)
  const h = (rwy.headingDeg * Math.PI) / 180
  const side = dir === 'left' ? -1 : 1 // left pattern = turns to the left
  const sideRad = h + (side * Math.PI) / 2
  const pt = (alongM: number, offM: number, altFt: number, gsKt: number): TrafficLeg => ({
    lat: rwy.thrLat + (Math.cos(h) * alongM + Math.cos(sideRad) * offM) / mLat,
    lon: rwy.thrLon + (Math.sin(h) * alongM + Math.sin(sideRad) * offM) / mLon,
    altFt,
    gsKt,
  })
  const e = rwy.elevFt
  return [
    pt(1600, 0, e + 500, 75), // upwind
    pt(1600, 1300, e + 800, 80), // crosswind
    pt(600, 1300, e + 1000, 90), // downwind entry (abeam the numbers next)
    pt(-2200, 1300, e + 1000, 90), // downwind end
    pt(-2800, 650, e + 500, 80), // base
    pt(-1900, 0, e + 300, 70), // final ~1 nm
    pt(0, 0, e, 62), // threshold
  ]
}

/** Index of the downwind-entry leg (for the AI's position call). */
export const DOWNWIND_LEG_INDEX = 2
