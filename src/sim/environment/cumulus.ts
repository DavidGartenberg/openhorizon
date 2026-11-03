/**
 * Fair-weather cumulus over the thermals (the soaring pilot's marker of
 * lift).
 *
 * A thermal's air condenses at the lifting condensation level, about 125 m
 * above the ground per °C of surface dewpoint spread. When that level lies
 * below the top of the convective boundary layer the thermal is capped by a
 * cumulus whose base sits at the condensation level and whose top reaches
 * roughly the inversion. When it lies above, the thermals stay "blue" (no
 * clouds). Each cloud follows its own thermal: it appears once the thermal
 * matures, grows, and dissipates with it, displaced downwind by the drift
 * the rising air picks up.
 */
import { boundaryLayerDepthM, convectiveVelocity, type ThermalField } from './thermals'

export interface CumulusCloud {
  /** Centre north/east in the thermal lattice frame (m). */
  n: number
  e: number
  /** Base and thickness above the local ground (m). */
  baseAglM: number
  thicknessM: number
  /** Horizontal radius (m), already scaled by the life cycle. */
  radiusM: number
  seed: number
}

/** Lifting condensation level above ground (m) from the dewpoint spread (°C). */
export function condensationLevelM(dewpointSpreadC: number): number {
  return Math.max(0, dewpointSpreadC) * 125
}

export function thermalCumulus(field: ThermalField, n: number, e: number, timeS: number, strength: number,
  dewpointSpreadC: number, windN = 0, windE = 0, radiusM = 15_000): CumulusCloud[] {
  if (strength < 0.15) return []
  const zi = boundaryLayerDepthM(strength)
  const lcl = condensationLevelM(dewpointSpreadC)
  if (lcl > zi - 150) return [] // blue thermals
  const wStar = convectiveVelocity(strength)
  const thickness = Math.min(2000, (zi - lcl) * 1.1 + 300 * strength)
  const drift = lcl / Math.max(1.5 * wStar, 0.5) // seconds to rise to the base
  const cells = Math.ceil(radiusM / field.cellM)
  const ci = Math.floor(n / field.cellM), cj = Math.floor(e / field.cellM)
  const out: CumulusCloud[] = []
  for (let di = -cells; di <= cells; di++) for (let dj = -cells; dj <= cells; dj++) {
    const t = field.thermalInCell(ci + di, cj + dj, timeS)
    if (!t || t.life < 0.35) continue
    const cn = t.n + windN * drift, ce = t.e + windE * drift
    if ((cn - n) ** 2 + (ce - e) ** 2 > radiusM * radiusM) continue
    const grow = Math.min(1, (t.life - 0.35) / 0.35)
    out.push({
      n: cn,
      e: ce,
      baseAglM: lcl,
      thicknessM: thickness * (0.5 + 0.5 * grow),
      radiusM: (250 + 450 * strength * t.strength) * (0.45 + 0.55 * grow),
      seed: ((ci + di) * 92821 + (cj + dj) * 68917) % 1000 / 1000,
    })
  }
  return out
}
