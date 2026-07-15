import { describe, expect, it } from 'vitest'
import {
  makeEngineTemps,
  stepEngineTemps,
  approachExp,
  OIL_TEMP_MAX_C,
  CHT_MAX_C,
  OIL_PRESS_MAX_PSI,
} from '../../src/sim/systems/engine-temps'

const REDLINE_RPM = 2700

describe('approachExp (first-order thermal-lag math)', () => {
  it('does not move when current already equals target', () => {
    expect(approachExp(50, 50, 10, 100)).toBeCloseTo(50, 9)
  })

  it('moves toward target, never past it, for a positive dt', () => {
    const next = approachExp(20, 100, 30, 180)
    expect(next).toBeGreaterThan(20)
    expect(next).toBeLessThan(100)
  })

  it('approaches ~63% of the gap after one time constant (tau)', () => {
    const tau = 60
    const next = approachExp(0, 100, tau, tau)
    expect(next).toBeCloseTo(63.2, 0)
  })

  it('a zero dt leaves the value unchanged', () => {
    expect(approachExp(42, 100, 0, 60)).toBeCloseTo(42, 9)
  })
})

describe('stepEngineTemps (oil temp / oil pressure / CHT model)', () => {
  it('starts cold: a fresh state reads at ambient with zero oil pressure', () => {
    const st = makeEngineTemps(15)
    expect(st.oilTempC).toBe(15)
    expect(st.chtC).toBe(15)
    expect(st.oilPressPsi).toBe(0)
  })

  it('rises toward an equilibrium value under sustained power', () => {
    const st = makeEngineTemps(15)
    for (let i = 0; i < 3600; i++) stepEngineTemps(st, 1, REDLINE_RPM, REDLINE_RPM, true, 15)
    expect(st.oilTempC).toBeGreaterThan(60)
    expect(st.chtC).toBeGreaterThan(100)
    expect(st.oilPressPsi).toBeGreaterThan(20)
  })

  it('does not exceed the modeled redline even after a long soak at full power', () => {
    const st = makeEngineTemps(15)
    for (let i = 0; i < 20000; i++) stepEngineTemps(st, 1, REDLINE_RPM, REDLINE_RPM, true, 15)
    expect(st.oilTempC).toBeLessThanOrEqual(OIL_TEMP_MAX_C + 1e-6)
    expect(st.chtC).toBeLessThanOrEqual(CHT_MAX_C + 1e-6)
    expect(st.oilPressPsi).toBeLessThanOrEqual(OIL_PRESS_MAX_PSI + 1e-6)
  })

  it('does not jump to the redline instantly on a single small step', () => {
    const st = makeEngineTemps(15)
    stepEngineTemps(st, 1, REDLINE_RPM, REDLINE_RPM, true, 15)
    expect(st.oilTempC).toBeLessThan(20) // moved only a little in 1s given a ~180s tau
    expect(st.chtC).toBeLessThan(30)
  })

  it('cools back toward ambient once the engine is shut down', () => {
    const st = makeEngineTemps(15)
    for (let i = 0; i < 3600; i++) stepEngineTemps(st, 1, REDLINE_RPM, REDLINE_RPM, true, 15)
    const hotOilTemp = st.oilTempC
    for (let i = 0; i < 3600; i++) stepEngineTemps(st, 1, 0, REDLINE_RPM, false, 15)
    expect(st.oilTempC).toBeLessThan(hotOilTemp)
    expect(st.oilPressPsi).toBeCloseTo(0, 6) // exponential decay asymptotes toward but never exactly hits 0
  })

  it('oil pressure responds quickly (short tau) relative to oil temp (long tau)', () => {
    const stPress = makeEngineTemps(15)
    const stTemp = makeEngineTemps(15)
    stepEngineTemps(stPress, 5, REDLINE_RPM, REDLINE_RPM, true, 15)
    stepEngineTemps(stTemp, 5, REDLINE_RPM, REDLINE_RPM, true, 15)
    // After the same short dt, oil pressure should have covered much more of
    // its gap-to-equilibrium than oil temp has.
    const pressFracOfGap = stPress.oilPressPsi / 70 // rough cruise target
    const tempFracOfGap = stTemp.oilTempC / 90
    expect(pressFracOfGap).toBeGreaterThan(tempFracOfGap)
  })
})
