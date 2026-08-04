/**
 * C172S weight & balance (15c — closes the 9b deferral). POH station
 * arms: empty CG 39.0 in (representative for the sim's empty weight),
 * lumped payload split 50/50 front (37.0) / rear (73.0) — the sim
 * carries one payload mass, not per-seat entries (recorded) — and fuel
 * at 48.0 in. Normal-category envelope per the POH: forward limit 35.0
 * to 2,350 lb tapering to 40.5 at 2,550; aft 47.3.
 */
import { describe, expect, it } from 'vitest'
import { c172WeightBalance, C172S_ENVELOPE } from '../src/sim/weight-balance'

describe('c172WeightBalance', () => {
  it('empty + zero payload/fuel sits at the empty CG', () => {
    const wb = c172WeightBalance(794, 0, 0)
    expect(wb.grossLb).toBeCloseTo(794 * 2.20462, 0)
    expect(wb.cgIn).toBeCloseTo(39.0, 2)
    expect(wb.within).toBe(true)
  })
  it('a normal load (2 up front, full fuel) stays inside the envelope', () => {
    // 170 kg payload (~two adults), 144 kg fuel (~53 gal).
    const wb = c172WeightBalance(794, 170, 144)
    expect(wb.within).toBe(true)
    expect(wb.cgIn).toBeGreaterThan(35)
    expect(wb.cgIn).toBeLessThan(47.3)
  })
  it('gross beyond 2,550 lb falls outside', () => {
    const wb = c172WeightBalance(794, 400, 160)
    expect(wb.grossLb).toBeGreaterThan(2550)
    expect(wb.within).toBe(false)
  })
  it('the forward limit tapers with weight (heavier = less forward room)', () => {
    expect(C172S_ENVELOPE.fwdLimitIn(2350)).toBeCloseTo(35.0, 3)
    expect(C172S_ENVELOPE.fwdLimitIn(2550)).toBeCloseTo(40.5, 3)
    const mid = C172S_ENVELOPE.fwdLimitIn(2450)
    expect(mid).toBeGreaterThan(35)
    expect(mid).toBeLessThan(40.5)
  })
})
