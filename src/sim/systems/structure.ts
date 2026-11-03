/**
 * Structural load limits: overstress and failure.
 *
 * Limit load factors follow the certification categories (14 CFR 23.337 /
 * 25.337, CS-22 for sailplanes):
 *   normal (GA)        +3.8 / −1.52 g
 *   utility (sailplanes) +5.3 / −2.65 g
 *   aerobatic          +6.0 / −3.0 g  (the Extra 300L is certified to ±10 g
 *                                      solo; `invertedCapable` types get that)
 *   transport          +2.5 / −1.0 g
 * With flaps out the positive limit drops to +2.0 g (and 0 g negative for
 * transports). Ultimate load is 1.5 × limit. Above limit the airframe is
 * overstressed (latched, reported, the airplane keeps flying); beyond
 * ultimate, held for a few hundredths of a second, a wing fails.
 */
import type { AircraftParams } from '../aircraft/params'

export type StructuralCategory = 'normal' | 'utility' | 'aerobatic' | 'transport'

export interface LoadLimits {
  category: StructuralCategory
  posG: number
  negG: number
  posFlapsG: number
  negFlapsG: number
}

export function structuralCategoryFor(P: AircraftParams): StructuralCategory {
  if (P.invertedCapable) return 'aerobatic'
  if (P.spoilers?.groundAutoDeploy === false && !P.jet) return 'utility' // sailplanes (airbrakes)
  if (P.jet || P.mtowKg > 5_700) return 'transport'
  return 'normal'
}

export function loadLimitsFor(P: AircraftParams): LoadLimits {
  const category = structuralCategoryFor(P)
  switch (category) {
    case 'aerobatic': return { category, posG: 10, negG: -10, posFlapsG: 2, negFlapsG: -1 }
    case 'utility': return { category, posG: 5.3, negG: -2.65, posFlapsG: 4, negFlapsG: -1.5 }
    case 'transport': return { category, posG: 2.5, negG: -1, posFlapsG: 2, negFlapsG: 0 }
    default: return { category, posG: 3.8, negG: -1.52, posFlapsG: 2, negFlapsG: -1 }
  }
}

export type StructureEvent = 'overstress' | 'failure'

export class StructureMonitor {
  readonly limits: LoadLimits
  maxG = 1
  minG = 1
  overstressed = false
  /** 0 intact; −1 left wing failed; +1 right wing failed. */
  wingFailure: -1 | 0 | 1 = 0
  private beyondUltimateS = 0
  private inExcursion = false
  /** Disable failures (overstress is still reported). */
  failuresEnabled = true

  constructor(P: AircraftParams) {
    this.limits = loadLimitsFor(P)
  }

  /** Current limits for the flap state. */
  limitsFor(flapsDeg: number): { pos: number; neg: number } {
    return flapsDeg > 0.5
      ? { pos: this.limits.posFlapsG, neg: this.limits.negFlapsG }
      : { pos: this.limits.posG, neg: this.limits.negG }
  }

  /**
   * @param nz load factor (g, + = seat pressing up)
   * @param rollRate body roll rate (rad/s): an asymmetric pull fails the
   *   wing on the side the roll loads most (the rising wing).
   * @returns the event that began this step, if any
   */
  step(dt: number, nz: number, flapsDeg: number, rollRate = 0): StructureEvent | null {
    if (!Number.isFinite(nz) || dt <= 0) return null
    this.maxG = Math.max(this.maxG, nz)
    this.minG = Math.min(this.minG, nz)
    const { pos, neg } = this.limitsFor(flapsDeg)
    const over = nz > pos * 1.02 || nz < neg * 1.02 - 0.02
    let event: StructureEvent | null = null
    if (over && !this.inExcursion) {
      this.inExcursion = true
      if (!this.overstressed) event = 'overstress'
      this.overstressed = true
    } else if (!over) {
      this.inExcursion = false
    }
    const ultimate = nz > pos * 1.5 || nz < neg * 1.5 - 0.02
    this.beyondUltimateS = ultimate ? this.beyondUltimateS + dt : 0
    if (this.failuresEnabled && this.wingFailure === 0 && this.beyondUltimateS > 0.04) {
      // Rolling right raises the left wing's angle of attack: it fails first.
      this.wingFailure = rollRate > 0 ? -1 : 1
      event = 'failure'
    }
    return event
  }

  reset(): void {
    this.maxG = 1
    this.minG = 1
    this.overstressed = false
    this.wingFailure = 0
    this.beyondUltimateS = 0
    this.inExcursion = false
  }
}
