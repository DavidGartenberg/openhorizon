/**
 * C172S weight & balance (15c — closes the 9b W&B-plot deferral). Pure.
 * Station arms are POH-representative: empty CG 39.0 in at the sim's
 * empty weight, the single lumped payload split 50/50 across the front
 * (37.0 in) and rear (73.0 in) seats — the sim carries one payload
 * mass, not per-seat entries (recorded deviation) — and fuel at
 * 48.0 in. Normal-category envelope: forward 35.0 in up to 2,350 lb
 * tapering linearly to 40.5 in at 2,550 lb; aft 47.3 in; max 2,550 lb.
 */

const LB_PER_KG = 2.20462

const EMPTY_ARM_IN = 39.0
const FRONT_ARM_IN = 37.0
const REAR_ARM_IN = 73.0
const FUEL_ARM_IN = 48.0

export const C172S_ENVELOPE = {
  maxGrossLb: 2550,
  aftLimitIn: 47.3,
  /** Forward CG limit (in) as a function of gross weight (lb). */
  fwdLimitIn(grossLb: number): number {
    if (grossLb <= 2350) return 35.0
    return 35.0 + ((Math.min(grossLb, 2550) - 2350) / 200) * (40.5 - 35.0)
  },
}

export interface WeightBalance {
  grossLb: number
  cgIn: number
  within: boolean
}

export function c172WeightBalance(emptyKg: number, payloadKg: number, fuelKg: number): WeightBalance {
  const emptyLb = emptyKg * LB_PER_KG
  const payloadLb = payloadKg * LB_PER_KG
  const fuelLb = fuelKg * LB_PER_KG
  const grossLb = emptyLb + payloadLb + fuelLb
  const momentLbIn =
    emptyLb * EMPTY_ARM_IN +
    (payloadLb / 2) * FRONT_ARM_IN +
    (payloadLb / 2) * REAR_ARM_IN +
    fuelLb * FUEL_ARM_IN
  const cgIn = grossLb > 0 ? momentLbIn / grossLb : EMPTY_ARM_IN
  const within =
    grossLb <= C172S_ENVELOPE.maxGrossLb &&
    cgIn >= C172S_ENVELOPE.fwdLimitIn(grossLb) &&
    cgIn <= C172S_ENVELOPE.aftLimitIn
  return { grossLb, cgIn, within }
}
