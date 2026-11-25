import { describe, expect, it } from 'vitest'
import { jetSecondary, OIL_QTY_SERVICED_PCT } from '../src/cockpit/jet-secondary'

describe('modeled secondary engine page (CFM56-7B-class)', () => {
  it('an engine that is not running reads zero, oil temperature following the air', () => {
    expect(jetSecondary(0, false, 20)).toMatchObject({ n2Pct: 0, oilPressPsi: 0, oilTempC: 20, vibN1: 0, vibN2: 0, oilQtyPct: OIL_QTY_SERVICED_PCT })
    expect(jetSecondary(40, false, 5).n2Pct).toBe(0)
    expect(jetSecondary(2, true, 5).n2Pct).toBe(0)
  })
  it('N2 follows N1 from about 62 % at idle to about 98 % at takeoff thrust', () => {
    expect(jetSecondary(22, true, 15).n2Pct).toBeCloseTo(62, 1)
    expect(jetSecondary(100, true, 15).n2Pct).toBeCloseTo(98, 1)
    expect(jetSecondary(60, true, 15).n2Pct).toBeGreaterThan(jetSecondary(40, true, 15).n2Pct)
  })
  it('oil is in a healthy running band and warms with thrust and a hot day', () => {
    const idle = jetSecondary(22, true, 15), to = jetSecondary(100, true, 15)
    expect(idle.oilPressPsi).toBeGreaterThanOrEqual(40); expect(to.oilPressPsi).toBeLessThanOrEqual(60)
    expect(to.oilTempC).toBeGreaterThan(idle.oilTempC); expect(jetSecondary(100, true, 40).oilTempC).toBeGreaterThan(to.oilTempC)
    expect(to.vibN1).toBeLessThan(1)
  })
  it('never produces NaN from bad input', () => {
    for (const v of Object.values(jetSecondary(NaN, true, NaN))) expect(Number.isFinite(v)).toBe(true)
    for (const v of Object.values(jetSecondary(1e9, true, 1e9))) expect(Number.isFinite(v)).toBe(true)
  })
})
