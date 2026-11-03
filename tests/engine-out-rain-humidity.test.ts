/** Engine-out asymmetry, the heavy-rain penalty and humid air. */
import { describe, expect, it } from 'vitest'
import { deadSideOf, engineOutYawNm, ENGINE_ARM_SPAN_FRACTION } from '../src/sim/systems/engine-out'
import { heavyRainPenalty, rainRateMmH } from '../src/sim/weather/heavy-rain'
import { humidDensity, humidDensityRatio, humidPowerFactor, vapourPressureHpa } from '../src/sim/weather/humidity'

describe('engine-out asymmetry', () => {
  it('yaws toward the dead engine, from the live thrust and the dead engine’s drag', () => {
    expect(engineOutYawNm(1, 100_000, 5_000, 34.3)).toBeGreaterThan(0) // right engine out → nose right
    expect(engineOutYawNm(-1, 100_000, 5_000, 34.3)).toBeLessThan(0) // left engine out → nose left
    expect(engineOutYawNm(0, 100_000, 5_000, 34.3)).toBe(0)
    const arm = ENGINE_ARM_SPAN_FRACTION * 34.3
    expect(engineOutYawNm(1, 100_000, 5_000, 34.3)).toBeCloseTo(arm * 105_000, 3)
    expect(arm).toBeCloseTo(5.5, 0) // the 737-800's engines sit ±5.75 m out
  })
  it('a four-engine type loses a side pair further out', () => {
    expect(engineOutYawNm(1, 200_000, 0, 64.4, 4)).toBeCloseTo(0.255 * 64.4 * 200_000, 0)
    expect(engineOutYawNm(1, 200_000, 0, 64.4, 4)).toBeGreaterThan(engineOutYawNm(1, 200_000, 0, 64.4, 2))
  })
  it('knows which side died', () => {
    expect(deadSideOf(true, false)).toBe(1)
    expect(deadSideOf(false, true)).toBe(-1)
    expect(deadSideOf(true, true)).toBe(0)
    expect(deadSideOf(false, false)).toBe(0)
  })
})

describe('heavy rain on the airframe', () => {
  it('reads rain rate from METAR intensity', () => {
    expect(rainRateMmH(['-RA'])).toBe(2)
    expect(rainRateMmH(['RA'])).toBe(6)
    expect(rainRateMmH(['+RA'])).toBe(25)
    expect(rainRateMmH(['+TSRA'])).toBe(60)
    expect(rainRateMmH(['-SN', 'BR'])).toBe(0)
  })
  it('costs nothing in drizzle, a few per cent of CLmax and some drag in a downpour', () => {
    expect(heavyRainPenalty(0)).toEqual({ clMaxFactor: 1, dCd: 0 })
    const ts = heavyRainPenalty(60)
    expect(ts.clMaxFactor).toBeLessThan(0.96)
    expect(ts.clMaxFactor).toBeGreaterThan(0.9)
    expect(ts.dCd).toBeGreaterThan(0.002)
    expect(heavyRainPenalty(6).clMaxFactor).toBeGreaterThan(0.98)
    expect(heavyRainPenalty(2)).toEqual({ clMaxFactor: 1, dCd: 0 }) // −RA: nothing
    let prev = 1
    for (let r = 0; r <= 400; r += 0.5) { const f = heavyRainPenalty(r).clMaxFactor; expect(f).toBeLessThanOrEqual(prev); prev = f } // monotone, no step
    expect(heavyRainPenalty(10_000).clMaxFactor).toBe(0.88) // capped
  })
})

describe('humid air', () => {
  it('Magnus vapour pressure: 6.1 hPa at 0 °C, ~42 hPa at 30 °C', () => {
    expect(vapourPressureHpa(0)).toBeCloseTo(6.11, 1)
    expect(vapourPressureHpa(30)).toBeCloseTo(42.4, 0)
  })
  it('a hot, muggy day is ~1.5% thinner and costs a piston engine ~3.5%', () => {
    const r = humidDensityRatio(101_325, 26) // dew point 26 °C
    expect(r).toBeLessThan(0.99)
    expect(r).toBeGreaterThan(0.98)
    expect(humidPowerFactor(101_325, 26)).toBeCloseTo(0.966, 2)
    const dry = 101_325 / (287.05 * 303.15)
    expect(humidDensity(101_325, 303.15, 26)).toBeLessThan(dry)
    expect(humidDensityRatio(101_325, -30)).toBeGreaterThan(0.999) // cold air holds almost none
  })
})
