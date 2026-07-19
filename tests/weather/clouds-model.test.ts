import { describe, expect, it } from 'vitest'
import { cloudSlabs, inCloudFactor } from '../../src/sim/weather/clouds-model'
import { parseMetar } from '../../src/sim/weather/metar'

describe('cloud slabs + in-cloud obscuration', () => {
  const m = parseMetar('KHAF 191935Z 28008KT 4SM BKN008 OVC015 14/12 A3010')
  const slabs = cloudSlabs(m.clouds, 66)

  it('converts AGL bases to MSL slabs with documented thickness', () => {
    expect(slabs[0]).toEqual({ cover: 'BKN', baseMslFt: 866, topMslFt: 2866 })
    expect(slabs[1]).toEqual({ cover: 'OVC', baseMslFt: 1566, topMslFt: 4566 })
  })

  it('is clear below, obscured inside, clear above', () => {
    expect(inCloudFactor(slabs, 400)).toBe(0)
    expect(inCloudFactor(slabs, 1800)).toBeGreaterThan(0.9) // inside the OVC
    expect(inCloudFactor(slabs, 1200)).toBeGreaterThanOrEqual(0.8) // inside BKN only
    expect(inCloudFactor(slabs, 6000)).toBe(0)
  })

  it('fades across layer edges instead of switching', () => {
    const below = inCloudFactor(slabs, 866 - 140)
    const at = inCloudFactor(slabs, 866)
    const inside = inCloudFactor(slabs, 1100)
    expect(below).toBeGreaterThan(0)
    expect(below).toBeLessThan(at)
    expect(at).toBeLessThan(inside)
  })

  it('VV obscures from the surface up', () => {
    const fog = cloudSlabs(parseMetar('KXYZ 191950Z 00000KT M1/4SM FG VV002 10/10 A2992').clouds, 100)
    expect(inCloudFactor(fog, 120)).toBeGreaterThan(0.9)
    expect(inCloudFactor(fog, 2600)).toBe(0)
  })
})
