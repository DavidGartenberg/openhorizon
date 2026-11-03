import { describe, expect, it } from 'vitest'
import { WetnessModel, wetnessFromWeather, wetnessUniforms } from '../../src/render/wetness'

describe('wetness from present weather', () => {
  it('is dry with nothing reported and soaked in heavy rain', () => {
    expect(wetnessFromWeather([])).toBe(0)
    expect(wetnessFromWeather(undefined)).toBe(0)
    expect(wetnessFromWeather(['+RA'])).toBe(1)
    expect(wetnessFromWeather(['TSRA'])).toBeGreaterThan(0.8)
  })
  it('grades light rain below rain, mist and fog as damp, snow as slightly wet', () => {
    const light = wetnessFromWeather(['-RA']), rain = wetnessFromWeather(['RA'])
    expect(light).toBeGreaterThan(0.4)
    expect(light).toBeLessThan(rain)
    expect(wetnessFromWeather(['BR'])).toBeLessThan(light)
    expect(wetnessFromWeather(['FG'])).toBeGreaterThan(wetnessFromWeather(['BR']))
    expect(wetnessFromWeather(['-SN'])).toBeGreaterThan(0)
    expect(wetnessFromWeather(['-SN'])).toBeLessThan(light)
  })
  it('counts rain in the vicinity for little, and takes the wettest of several groups', () => {
    expect(wetnessFromWeather(['VCSH'])).toBeLessThan(0.4)
    expect(wetnessFromWeather(['BR', '-RA'])).toBe(wetnessFromWeather(['-RA']))
    expect(wetnessFromWeather(['HZ'])).toBe(0)
  })
})

describe('wetness over time', () => {
  it('wets in about two minutes and dries in about fifteen', () => {
    const m = new WetnessModel()
    m.setTarget(1)
    m.update(0)
    expect(m.update(60)).toBeCloseTo(0.5, 1)
    expect(m.update(120)).toBeCloseTo(1, 5)
    m.setTarget(0)
    const run = (from: number, to: number) => { let v = 1; for (let t = from + 30; t <= to; t += 30) v = m.update(t); return v }
    expect(run(120, 120 + 450)).toBeCloseTo(0.5, 1)
    expect(run(120 + 450, 120 + 900)).toBeCloseTo(0, 5)
  })
  it('does not leap on a long pause, snaps on request, and drives the shared uniform', () => {
    const m = new WetnessModel()
    m.setTarget(1)
    m.update(0)
    expect(m.update(100_000)).toBeLessThanOrEqual(1)                    // a pause counts as at most two minutes
    const n = new WetnessModel()
    n.setTarget(0.6)
    n.snap()
    expect(n.value).toBe(0.6)
    expect(wetnessUniforms.uWet.value).toBe(0.6)
    n.setTarget(2)
    n.snap()
    expect(n.value).toBe(1)                                             // the target is clamped
  })
})
