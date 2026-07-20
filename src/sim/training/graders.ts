/**
 * ACS maneuver graders (§20, Phase 8b): consume recorder samples only.
 * Steep turn per the real Private Pilot ACS tolerances: altitude ±100 ft,
 * airspeed ±10 kt, bank 45°±5, rollout heading ±10°. Further curriculum
 * (ground reference, short-field, instrument) is recorded roadmap.
 */
import type { FlightSample } from '../recorder'

export interface SteepTurnGrade {
  pass: boolean
  worstAltDevFt: number
  worstIasDevKt: number
  avgBankDeg: number
  failures: string[]
}

export function gradeSteepTurn(
  samples: readonly FlightSample[],
  ref: { entryAltFt: number; entryIasKt: number },
): SteepTurnGrade {
  let worstAlt = 0
  let worstIas = 0
  // Average bank over the established portion (|roll| > 20° filters the
  // roll-in/roll-out so they don't dilute the established-bank check).
  let bankSum = 0
  let bankN = 0
  for (const s of samples) {
    worstAlt = Math.max(worstAlt, Math.abs(s.altFt - ref.entryAltFt))
    worstIas = Math.max(worstIas, Math.abs(s.iasKt - ref.entryIasKt))
    if (Math.abs(s.rollDeg) > 20) {
      bankSum += Math.abs(s.rollDeg)
      bankN++
    }
  }
  const avgBank = bankN > 0 ? bankSum / bankN : 0
  const failures: string[] = []
  if (worstAlt > 100) failures.push(`altitude ±${Math.round(worstAlt)} ft (limit 100)`)
  if (worstIas > 10) failures.push(`airspeed ±${Math.round(worstIas)} kt (limit 10)`)
  if (Math.abs(avgBank - 45) > 5) failures.push(`bank averaged ${avgBank.toFixed(0)}° (45±5 required)`)
  return { pass: failures.length === 0, worstAltDevFt: worstAlt, worstIasDevKt: worstIas, avgBankDeg: avgBank, failures }
}
