import { describe, expect, it } from 'vitest'
import { makeCarbIceState, stepCarbIce, carbIcePowerFactor, type CarbIceInputs } from '../../src/sim/systems/carb-ice'

function run(seconds: number, inp: CarbIceInputs, st = makeCarbIceState()) {
  for (let i = 0; i < seconds * 10; i++) stepCarbIce(st, 0.1, inp)
  return st
}

const HUMID_GLIDE: CarbIceInputs = {
  carburetor: true, carbHeatOn: false, powerFrac: 0.2, oatC: 15, dewpointC: 13,
}

describe('carb ice (§ Phase 11b — serious-icing envelope model)', () => {
  it('accretes on a humid-day low-power descent and saps engine power', () => {
    const st = run(300, HUMID_GLIDE)
    expect(st.iceFraction).toBeGreaterThan(0.5)
    expect(carbIcePowerFactor(st, false)).toBeLessThan(0.75)
  })

  it('carb heat applied in time melts the ice and restores power (minus heat penalty)', () => {
    const st = run(300, HUMID_GLIDE)
    run(30, { ...HUMID_GLIDE, carbHeatOn: true }, st)
    expect(st.iceFraction).toBeLessThan(0.05)
    const f = carbIcePowerFactor(st, true)
    expect(f).toBeGreaterThan(0.85) // heat costs ~10%, ice gone
    expect(f).toBeLessThan(0.95)
  })

  it('left untreated, full blockage kills the engine; heat still recovers it', () => {
    const st = run(1800, HUMID_GLIDE)
    expect(st.iceFraction).toBeGreaterThan(0.95)
    expect(carbIcePowerFactor(st, false)).toBeLessThan(0.05) // effectively stopped
    run(45, { ...HUMID_GLIDE, carbHeatOn: true }, st)
    expect(carbIcePowerFactor(st, true)).toBeGreaterThan(0.85)
  })

  it('a fuel-injected engine never accretes (C172S path unchanged)', () => {
    const st = run(1800, { ...HUMID_GLIDE, carburetor: false })
    expect(st.iceFraction).toBe(0)
    expect(carbIcePowerFactor(st, false)).toBe(1)
  })

  it('dry air or out-of-band OAT accretes negligibly', () => {
    const dry = run(600, { ...HUMID_GLIDE, dewpointC: -5 })
    expect(dry.iceFraction).toBeLessThan(0.05)
    const cold = run(600, { ...HUMID_GLIDE, oatC: -20, dewpointC: -21 })
    expect(cold.iceFraction).toBeLessThan(0.05)
  })

  it('full cruise power is far less vulnerable than glide power', () => {
    const glide = run(240, HUMID_GLIDE)
    const cruise = run(240, { ...HUMID_GLIDE, powerFrac: 1 })
    expect(cruise.iceFraction).toBeLessThan(glide.iceFraction * 0.35)
  })
})
