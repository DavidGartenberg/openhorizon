import { describe, expect, it } from 'vitest'
import { parseMetar } from '../../src/sim/weather/metar'

describe('parseMetar', () => {
  it('parses a typical KSFO METAR', () => {
    const m = parseMetar('KSFO 191956Z 28014KT 10SM FEW008 SCT200 17/11 A3001 RMK AO2 SLP164')
    expect(m.station).toBe('KSFO')
    expect(m.windDirDeg).toBe(280)
    expect(m.windKt).toBe(14)
    expect(m.gustKt).toBeUndefined()
    expect(m.visibilitySm).toBe(10)
    expect(m.clouds).toEqual([
      { cover: 'FEW', baseFt: 800 },
      { cover: 'SCT', baseFt: 20000 },
    ])
    expect(m.tempC).toBe(17)
    expect(m.dewpointC).toBe(11)
    expect(m.altimeterInHg).toBeCloseTo(30.01, 2)
  })

  it('parses gusts, broken/overcast layers, and negative temps', () => {
    const m = parseMetar('KDEN 192053Z 04018G29KT 3SM -SN BKN012 OVC025 M03/M07 A2965')
    expect(m.windDirDeg).toBe(40)
    expect(m.windKt).toBe(18)
    expect(m.gustKt).toBe(29)
    expect(m.visibilitySm).toBe(3)
    expect(m.weather).toContain('-SN')
    expect(m.clouds).toEqual([
      { cover: 'BKN', baseFt: 1200 },
      { cover: 'OVC', baseFt: 2500 },
    ])
    expect(m.tempC).toBe(-3)
    expect(m.dewpointC).toBe(-7)
    expect(m.altimeterInHg).toBeCloseTo(29.65, 2)
  })

  it('parses calm wind and clear skies', () => {
    const m = parseMetar('KTRK 191950Z 00000KT 10SM CLR 22/M01 A3025')
    expect(m.windKt).toBe(0)
    expect(m.windDirDeg).toBe(0)
    expect(m.clouds).toEqual([])
    expect(m.tempC).toBe(22)
    expect(m.dewpointC).toBe(-1)
  })

  it('parses variable wind and fractional visibility', () => {
    const m = parseMetar('KHAF 191935Z VRB04KT 1 1/2SM BR OVC004 14/13 A3010')
    expect(m.windDirDeg).toBe('VRB')
    expect(m.windKt).toBe(4)
    expect(m.visibilitySm).toBeCloseTo(1.5, 3)
    expect(m.weather).toContain('BR')
    expect(m.clouds).toEqual([{ cover: 'OVC', baseFt: 400 }])
  })

  it('parses P6SM, M1/4SM, and vertical visibility', () => {
    expect(parseMetar('KXYZ 191950Z 18005KT P6SM SKC 20/10 A2992').visibilitySm).toBe(6)
    const fog = parseMetar('KXYZ 191950Z 00000KT M1/4SM FG VV002 10/10 A2992')
    expect(fog.visibilitySm).toBeCloseTo(0.25, 3)
    expect(fog.clouds).toEqual([{ cover: 'VV', baseFt: 200 }])
  })

  it('ignores everything after RMK and never fabricates missing fields', () => {
    const m = parseMetar('KSJC 191953Z 32009KT 10SM SCT030 21/12 A3000 RMK AO2 T02110122 10SM')
    expect(m.clouds).toEqual([{ cover: 'SCT', baseFt: 3000 }])
    const partial = parseMetar('KABC 191950Z 10SM CLR')
    expect(partial.windKt).toBeUndefined()
    expect(partial.tempC).toBeUndefined()
    expect(partial.altimeterInHg).toBeUndefined()
  })

  it('is honest on garbage: returns station/raw only, no invented numbers', () => {
    const junk = parseMetar('NOT A METAR AT ALL')
    expect(junk.station).toBe('NOT')
    expect(junk.windKt).toBeUndefined()
    expect(junk.visibilitySm).toBeUndefined()
    expect(junk.clouds).toEqual([])
  })
})
