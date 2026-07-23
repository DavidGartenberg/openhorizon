/**
 * Tier-B roster validation (Phase 12c) — DELIBERATELY coarser than §5.6:
 *  - stall: ±3 kt of the published anchor (CALIBRATED by construction —
 *    this row validates plumbing, not prediction)
 *  - cruise (props): predicted max-level TAS at the published cruise
 *    altitude within ±5% of the published 75%-power figure (density does
 *    the derating at altitude — same convention as the C172 suite)
 *  - cruise (jets): thrust-required at published cruise Mach/alt within
 *    [35%, 92%] of available (drag model inside the envelope)
 *  - climb: published Vy climb ±20% (jets: lower-bound only)
 *  - glider: best L/D ±20%
 *  - approach: landing-config trim on a −3° path converges
 * Handling is INHERITED from class anchors and NOT validated here (the
 * honesty ladder is documented in derive.ts / PROGRESS).
 */
import { describe, expect, it } from 'vitest'
import { ROSTER, rosterParams } from '../../src/sim/aircraft/roster'
import { trim, stallTasMs } from '../../src/sim/trim'
import { isa, KT, FT } from '../../src/sim/atmosphere'
import { thrustAvailableN } from '../../src/sim/turbofan'

/** Max level TAS (kt) at altitude: bisect where level-flight throttle = 1. */
function maxLevelTasKt(P: NonNullable<ReturnType<typeof rosterParams>>, altFt: number, massKg: number, loKt: number, hiKt: number): number {
  const altM = altFt * FT
  let lo = loKt
  let hi = hiKt
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2
    const t = trim({ tasMs: mid * KT, altM, massKg, flapsDeg: 0, gammaRad: 0, params: P })
    if (!t.converged || t.throttle >= 1) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}

describe('Tier-B roster validation (15 proving types)', () => {
  for (const entry of ROSTER) {
    const { spec, targets } = entry
    describe(`${spec.designator} — ${spec.label}`, () => {
      const P = rosterParams(spec.designator)!
      const massKg = spec.mtowKg

      it('derives and the stall anchor round-trips (±3 kt)', () => {
        expect(P).not.toBeNull()
        const vsKcas = stallTasMs(massKg, 0, 0, P) / KT // CAS at sea level
        expect(vsKcas).toBeGreaterThan(spec.stallCleanKcas - 3)
        expect(vsKcas).toBeLessThan(spec.stallCleanKcas + 3)
      })

      if (targets.cruiseTasKt) {
        it(`predicts cruise ${targets.cruiseTasKt} KTAS ±5% at ${targets.cruiseAltFt} ft`, () => {
          const got = maxLevelTasKt(P, targets.cruiseAltFt!, massKg, targets.cruiseTasKt! * 0.6, targets.cruiseTasKt! * 1.45)
          expect(got).toBeGreaterThan(targets.cruiseTasKt! * 0.95)
          expect(got).toBeLessThan(targets.cruiseTasKt! * 1.05)
        })
      }

      if (targets.jetCruise) {
        it(`cruise drag at M${targets.jetCruise.mach}/FL${targets.jetCruise.altFt / 100} sits inside the thrust envelope`, () => {
          const altM = targets.jetCruise!.altFt * FT
          const air = isa(altM)
          const tas = targets.jetCruise!.mach * air.speedOfSoundMs
          const t = trim({ tasMs: tas, altM, massKg: massKg * 0.85, flapsDeg: 0, gammaRad: 0, params: P })
          expect(t.converged).toBe(true)
          const avail = thrustAvailableN(air.densityKgM3, targets.jetCruise!.mach, P.jet!)
          const frac = t.thrustN / avail
          expect(frac).toBeGreaterThan(0.35)
          expect(frac).toBeLessThan(0.92)
        })
      }

      if (targets.climbFpm) {
        it(`climbs ~${targets.climbFpm} fpm at Vy (sea level, MTOW)`, () => {
          const tas = spec.vSpeeds.vyKcas * KT * Math.sqrt(1.225 / isa(100).densityKgM3)
          const t = trim({ tasMs: tas, altM: 100, massKg, flapsDeg: 0, throttle: 1, params: P })
          expect(t.converged).toBe(true)
          const vsFpm = Math.sin(t.gammaRad) * tas * 196.85
          if (targets.climbIsMinimum) {
            expect(vsFpm).toBeGreaterThanOrEqual(targets.climbFpm!)
          } else {
            expect(vsFpm).toBeGreaterThan(targets.climbFpm! * 0.8)
            expect(vsFpm).toBeLessThan(targets.climbFpm! * 1.2)
          }
        })
      }

      if (targets.glideRatio) {
        it(`glides at L/D ≈ ${targets.glideRatio} ±20%`, () => {
          const tas = spec.vSpeeds.glideKcas * KT
          const t = trim({ tasMs: tas, altM: 1000, massKg, flapsDeg: 0, throttle: 0, params: P })
          expect(t.converged).toBe(true)
          expect(t.gammaRad).toBeLessThan(0)
          const ld = -1 / Math.tan(t.gammaRad)
          expect(ld).toBeGreaterThan(targets.glideRatio! * 0.8)
          expect(ld).toBeLessThan(targets.glideRatio! * 1.2)
        })
      }

      // Gliders can't hold −3° at best-glide without spoilers (not
      // modeled) — their approach check is the glide row above.
      const approachIt = spec.powerplant.kind === 'none' ? it.skip : it
      approachIt('approach-config trim on a −3° path converges', () => {
        const flaps = spec.flapDetentsDeg[spec.flapDetentsDeg.length - 1]!
        const tas = spec.vSpeeds.approachKcas * KT
        const gearCd = P.gearRetractable ? P.gearRetractable.dCdExtended : 0
        const t = trim({ tasMs: tas, altM: 300, massKg: massKg * 0.9, flapsDeg: flaps, gammaRad: -0.0524, params: P, extraCd: gearCd })
        expect(t.converged).toBe(true)
        expect(t.throttle).toBeGreaterThanOrEqual(0)
        expect(t.throttle).toBeLessThanOrEqual(1)
      })
    })
  }
})
