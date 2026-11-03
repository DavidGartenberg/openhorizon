import { describe, expect, it } from 'vitest'
import { contrailThresholdC, contrailStrength, vaporStrength } from '../src/render/contrails'
import { SurfaceWeatherState, precipIntensity } from '../src/sim/weather/surface-state'
import { isa } from '../src/sim/atmosphere'

describe('contrail formation (Schmidt–Appleman, Schumann 1996 fit)', () => {
  it('needs about −40 °C at airliner cruise and colder air higher up', () => {
    const p250 = 25_000
    const t250 = contrailThresholdC(p250)
    expect(t250).toBeGreaterThan(-44)
    expect(t250).toBeLessThan(-39)
    expect(contrailThresholdC(20_000)).toBeLessThan(t250) // lower pressure → colder threshold
    expect(contrailThresholdC(50_000)).toBeGreaterThan(t250)
  })

  it('forms at FL350 in a standard atmosphere, never at low altitude on a mild day', () => {
    const fl350 = isa(35_000 * 0.3048)
    expect(contrailStrength(fl350.temperatureK - 273.15, fl350.pressurePa)).toBe(1)
    const low = isa(5_000 * 0.3048)
    expect(contrailStrength(low.temperatureK - 273.15, low.pressurePa)).toBe(0)
    // ISA+15 at FL300 is too warm for a contrail.
    const fl300 = isa(30_000 * 0.3048)
    expect(contrailStrength(fl300.temperatureK - 273.15 + 15, fl300.pressurePa)).toBe(0)
  })

  it('tip vapour needs humid air and high lift', () => {
    expect(vaporStrength(1, 0, 1.3, 1)).toBeGreaterThan(0.5) // humid, slow and draggy on approach
    expect(vaporStrength(12, 0, 1.3, 2.5)).toBe(0) // dry air: nothing
    expect(vaporStrength(1, 0, 0.4, 1)).toBe(0) // cruise lift: nothing
    expect(vaporStrength(99, 1, 0.5, 2.6)).toBeGreaterThan(0.5) // in cloud, pulling g
  })
})

describe('surface weather state', () => {
  it('reads precipitation intensity from METAR groups', () => {
    expect(precipIntensity([])).toBe(0)
    expect(precipIntensity(['-RA', 'BR'])).toBe(0.4)
    expect(precipIntensity(['RA'])).toBe(0.7)
    expect(precipIntensity(['+TSRA'])).toBe(1)
    expect(precipIntensity(['VCSH'])).toBe(0)
  })

  it('rain wets the ground in minutes and it dries over the next half hour', () => {
    const s = new SurfaceWeatherState()
    for (let t = 0; t < 300; t++) s.step(1, ['RA'], 12, 40)
    expect(s.wetness).toBe(1)
    for (let t = 0; t < 600; t++) s.step(1, [], 12, 40)
    expect(s.wetness).toBeGreaterThan(0.4)
    for (let t = 0; t < 3000; t++) s.step(1, [], 12, 40)
    expect(s.wetness).toBe(0)
  })

  it('snow builds cover below freezing, melts (and wets) above', () => {
    const s = new SurfaceWeatherState()
    for (let t = 0; t < 1200; t++) s.step(1, ['SN'], -4, 20)
    expect(s.snow).toBeGreaterThan(0.8)
    expect(s.wetness).toBe(0)
    for (let t = 0; t < 600; t++) s.step(1, [], 6, 40)
    expect(s.snow).toBeLessThan(0.8)
    expect(s.wetness).toBeGreaterThan(0.5)
    const warm = new SurfaceWeatherState()
    for (let t = 0; t < 1200; t++) warm.step(1, ['SN'], 4, 20)
    expect(warm.snow).toBe(0) // wet snow that does not settle
    expect(warm.wetness).toBe(1)
  })
})
