/**
 * Tier-B roster aggregator (12c/12d): the 15 curated proving types
 * (roster-core) plus the 12d expansion (roster-ext). One list, one API.
 */
import type { AircraftParams } from './params'
import { deriveParams } from './derive'
import { CORE_ROSTER } from './roster-core'
import { ROSTER_EXT } from './roster-ext'
import { Aircraft } from '../aircraft'
import { trim } from '../trim'
import { propEffectsYawNm } from '../prop-effects'
import { isa } from '../atmosphere'

/** Self-audit rigging (night-shift N4): derive.ts estimates the cruise
 *  prop moments analytically, but governed-prop torque diverges from the
 *  analytic guess (the all-types hands-off screen caught 17 turboprop/
 *  governed types spiraling at their own rig point). So the SIM AUDITS
 *  ITSELF: trim the finished params at the canonical rig point (CL 0.35,
 *  3,000 ft, level) through the type's own physics, read the actual
 *  thrust/torque, and set rigCn/rigCl to cancel exactly what the sim
 *  computes — cancellation by construction, every type. */
export function rigAuditPoint(p: AircraftParams, cruiseTasKt?: number, cruiseAltFt?: number): { tasMs: number; altM: number } {
  // Rig at the type's OWN operating cruise when known (a fixed tab can't
  // null every altitude — turboprops' 3,000 ft rig left them spiraling at
  // FL250; real types carry cockpit rudder trim for the rest, which this
  // sim does not model — recorded). Fallback: the canonical CL-0.35 point.
  if (cruiseTasKt && cruiseAltFt) {
    return { tasMs: cruiseTasKt * 0.85 * 0.5144, altM: Math.min(cruiseAltFt, 25_000) * 0.3048 }
  }
  const RHO_3000 = 1.121
  const mid = (p.emptyMassKg + Math.min(p.mtowKg, p.emptyMassKg + p.fuelCapacityKg)) / 2
  return { tasMs: Math.sqrt((2 * mid * 9.81) / (RHO_3000 * 0.35 * p.wingAreaM2)), altM: 914 }
}

function selfAuditRigging(p: AircraftParams, cruiseTasKt?: number, cruiseAltFt?: number): AircraftParams {
  if (!(p.pFactorK > 0)) return p
  try {
    const probe = new Aircraft({ ...p, rigCn: 0, rigCl: 0 })
    if (probe.massKg > p.mtowKg * 0.97) probe.fuelKg = Math.max(p.mtowKg * 0.97 - p.emptyMassKg, p.fuelCapacityKg * 0.2)
    const pt = rigAuditPoint(p, cruiseTasKt, cruiseAltFt)
    const air = { pressurePa: 0, temperatureK: 0, densityKgM3: 0, speedOfSoundMs: 0 }
    isa(pt.altM, air)
    const rho = air.densityKgM3
    const t = trim({ tasMs: pt.tasMs, altM: pt.altM, massKg: probe.massKg, flapsDeg: 0, gammaRad: 0, params: { ...p, rigCn: 0, rigCl: 0 } })
    if (!t.converged) return p // keep the analytic estimate (recorded path)
    probe.applyTrimState(pt.tasMs, t.alphaRad, pt.altM, 0, 0, t.elevatorRad, t.throttle, t.rpm)
    probe.step(1 / 120)
    const qS = 0.5 * rho * pt.tasMs * pt.tasMs * p.wingAreaM2
    const yawNm = propEffectsYawNm(
      { pFactorK: p.pFactorK, swirlK: p.swirlK },
      probe.prop.thrustN, probe.prop.torqueNm, pt.tasMs, t.alphaRad, rho, p.propDiameterM,
    )
    // Same physics as aero.ts (slipstream fixes): the offset fin acts in
    // TAIL q (freestream + propwash, dqProp = T/(2·disk)), so the
    // coefficient divides by that factor to null at the audit point; the
    // aileron rig cancels only the NET torque roll after swirl recovery.
    const qbar = 0.5 * rho * pt.tasMs * pt.tasMs
    const diskA = (Math.PI * p.propDiameterM * p.propDiameterM) / 4
    const tailQ = Math.min(Math.max((qbar + p.propwashTailFactor * (Math.max(probe.prop.thrustN, 0) / (2 * diskA))) / qbar, 1), 2.5)
    return {
      ...p,
      rigCn: -yawNm / (qS * p.spanM) / tailQ,
      rigCl: (probe.prop.torqueNm * (1 - (p.swirlRollRecovery ?? 0))) / (qS * p.spanM),
    }
  } catch {
    return p
  }
}

export type { RosterTargets, RosterEntry } from './roster-core'
export { variant } from './roster-core'

export const ROSTER = [...CORE_ROSTER, ...ROSTER_EXT]

const paramsCache = new Map<string, AircraftParams>()

export function rosterParams(designator: string): AircraftParams | null {
  const cached = paramsCache.get(designator)
  if (cached) return cached
  const entry = ROSTER.find((r) => r.spec.designator === designator)
  if (!entry) return null
  const p = selfAuditRigging(deriveParams(entry.spec, entry.opts), entry.targets?.cruiseTasKt, entry.targets?.cruiseAltFt)
  paramsCache.set(designator, p)
  return p
}

export function rosterDesignators(): string[] {
  return ROSTER.map((r) => r.spec.designator)
}
