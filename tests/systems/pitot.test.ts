import { describe, expect, it } from 'vitest'
import { PitotStaticSystem, type PitotStaticInputs } from '../../src/sim/systems/pitot'

function baseInputs(overrides: Partial<PitotStaticInputs> = {}): PitotStaticInputs {
  return {
    trueIasKt: 100,
    trueAltFt: 5000,
    trueVsiFpm: 0,
    pitotHeatOn: true,
    icingConditions: false,
    staticBlocked: false,
    ...overrides,
  }
}

describe('pitot-static instrument model', () => {
  it('normal (heat on / no icing): reads true IAS/alt/VSI', () => {
    const sys = new PitotStaticSystem()
    const r = sys.step(baseInputs({ trueVsiFpm: 500 }))
    expect(r.iasKt).toBeCloseTo(100, 6)
    expect(r.altFt).toBe(5000)
    expect(r.vsiFpm).toBe(500)
    expect(r.pitotBlocked).toBe(false)
  })

  it('no icing conditions: heat off is fine, reads true values', () => {
    const sys = new PitotStaticSystem()
    const r = sys.step(baseInputs({ pitotHeatOn: false, icingConditions: false }))
    expect(r.pitotBlocked).toBe(false)
    expect(r.iasKt).toBeCloseTo(100, 6)
  })

  it('pitot blocked in a climb: frozen reading behaves like an altimeter (IAS rises)', () => {
    const sys = new PitotStaticSystem()
    const inp = baseInputs({ pitotHeatOn: false, icingConditions: true, trueIasKt: 100, trueAltFt: 5000 })
    const atBlock = sys.step(inp)
    expect(atBlock.pitotBlocked).toBe(true)
    expect(atBlock.iasKt).toBeCloseTo(100, 1) // reads true value right at the instant of blockage

    // Climb 2000 ft while true IAS actually stays ~100 (pilot holds speed).
    const climbing = sys.step({ ...inp, trueAltFt: 7000 })
    expect(climbing.iasKt).toBeGreaterThan(atBlock.iasKt)
  })

  it('pitot blocked in a descent: frozen reading falls like an altimeter', () => {
    const sys = new PitotStaticSystem()
    const inp = baseInputs({ pitotHeatOn: false, icingConditions: true, trueIasKt: 100, trueAltFt: 5000 })
    const atBlock = sys.step(inp)
    const descending = sys.step({ ...inp, trueAltFt: 3000 })
    expect(descending.iasKt).toBeLessThan(atBlock.iasKt)
  })

  it('static blocked: altimeter/VSI freeze, airspeed stays roughly correct', () => {
    const sys = new PitotStaticSystem()
    const inp = baseInputs({ trueAltFt: 6000, trueVsiFpm: 300, staticBlocked: true })
    const atBlock = sys.step(inp)
    expect(atBlock.altFt).toBe(6000)
    expect(atBlock.vsiFpm).toBe(0)
    expect(atBlock.iasKt).toBeCloseTo(inp.trueIasKt, 6)

    const later = sys.step({ ...inp, trueAltFt: 8000, trueVsiFpm: 400, trueIasKt: 110 })
    expect(later.altFt).toBe(6000) // frozen at blockage altitude
    expect(later.vsiFpm).toBe(0)
    expect(later.iasKt).toBeCloseTo(110, 6) // airspeed unaffected by static blockage
  })

  it('unblocking (heat restored) returns to true readings', () => {
    const sys = new PitotStaticSystem()
    sys.step(baseInputs({ pitotHeatOn: false, icingConditions: true }))
    const restored = sys.step(baseInputs({ pitotHeatOn: true, icingConditions: true }))
    expect(restored.pitotBlocked).toBe(false)
    expect(restored.iasKt).toBeCloseTo(100, 6)
  })
})
