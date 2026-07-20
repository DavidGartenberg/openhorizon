/**
 * §15 TAWS/GPWS scripted CFIT tests (§24: right modes, right order, and a
 * normal ILS approach triggers nothing).
 */
import { describe, expect, it } from 'vitest'
import { TawsComputer, type TawsInput } from '../src/sim/taws'

function base(over: Partial<TawsInput>): TawsInput {
  return {
    aglFt: 3000, altFt: 3000, vsFpm: 0, gsKt: 100, headingDeg: 0,
    rollDeg: 0, flapsDeg: 0, sinceTakeoffS: 600,
    terrainAheadFt: (_lookaheadS: number) => 0,
    nearRunwayFinal: false, gsDeviation: null,
    ...over,
  }
}

function collect(taws: TawsComputer, inputs: TawsInput[], dt = 1): string[] {
  const auras: string[] = []
  for (const inp of inputs) {
    const out = taws.step(dt, inp)
    if (out.newAural && out.aural) auras.push(out.aural)
  }
  return auras
}

describe('GPWS modes', () => {
  it('mode 1: excessive sink escalates SINK RATE → PULL UP', () => {
    const taws = new TawsComputer()
    const seq: TawsInput[] = []
    for (let agl = 2400; agl > 300; agl -= 60) seq.push(base({ aglFt: agl, vsFpm: -3600 }))
    const a = collect(taws, seq)
    expect(a[0]).toBe('SINK RATE')
    expect(a).toContain('PULL UP')
    expect(a.indexOf('PULL UP')).toBeGreaterThan(a.indexOf('SINK RATE'))
  })

  it('mode 2: rising terrain ahead escalates TERRAIN → PULL UP', () => {
    const taws = new TawsComputer()
    const seq: TawsInput[] = []
    // Level flight; terrain ribbon rises toward own altitude (ridge).
    for (let i = 0; i < 60; i++) {
      const ridge = 1000 + i * 40 // ft, growing under/ahead
      seq.push(base({
        altFt: 3000, aglFt: 3000 - ridge, vsFpm: 0,
        terrainAheadFt: (la) => ridge + (la >= 45 ? 500 : la >= 20 ? 300 : 0),
      }))
    }
    const a = collect(taws, seq)
    expect(a).toContain('TERRAIN AHEAD')
    expect(a).toContain('TERRAIN AHEAD, PULL UP')
    expect(a.indexOf('TERRAIN AHEAD, PULL UP')).toBeGreaterThan(a.indexOf('TERRAIN AHEAD'))
  })

  it('mode 3: altitude loss right after takeoff → DON\'T SINK', () => {
    const taws = new TawsComputer()
    const seq = [
      base({ aglFt: 200, vsFpm: 700, sinceTakeoffS: 20 }),
      base({ aglFt: 260, vsFpm: 500, sinceTakeoffS: 25 }),
      base({ aglFt: 240, vsFpm: -400, sinceTakeoffS: 30 }),
      base({ aglFt: 200, vsFpm: -500, sinceTakeoffS: 35 }),
    ]
    expect(collect(taws, seq, 5)).toContain("DON'T SINK")
  })

  it('mode 4: low without landing flaps away from a runway → TOO LOW FLAPS', () => {
    const taws = new TawsComputer()
    const seq = [base({ aglFt: 180, vsFpm: -300, flapsDeg: 0, nearRunwayFinal: false })]
    expect(collect(taws, seq)).toContain('TOO LOW, FLAPS')
  })

  it('mode 5: below glideslope on approach → GLIDESLOPE', () => {
    const taws = new TawsComputer()
    // Fly-up deviation beyond 1.3 dots low, established on final.
    const seq = [base({ aglFt: 800, vsFpm: -700, nearRunwayFinal: true, flapsDeg: 20, gsDeviation: -0.45 })]
    expect(collect(taws, seq)).toContain('GLIDESLOPE')
  })

  it('mode 6: five-hundred callout once, and BANK ANGLE', () => {
    const taws = new TawsComputer()
    const seq = [
      base({ aglFt: 620, vsFpm: -500, nearRunwayFinal: true, flapsDeg: 30 }),
      base({ aglFt: 490, vsFpm: -500, nearRunwayFinal: true, flapsDeg: 30 }),
      base({ aglFt: 470, vsFpm: -500, nearRunwayFinal: true, flapsDeg: 30 }),
      base({ aglFt: 2000, rollDeg: 50 }),
    ]
    const a = collect(taws, seq)
    expect(a.filter((x) => x === 'FIVE HUNDRED')).toHaveLength(1)
    expect(a).toContain('BANK ANGLE')
  })
})

describe('§24 CFIT + silence criteria', () => {
  it('a normal 3° ILS descent to minimums is completely silent except FIVE HUNDRED', () => {
    const taws = new TawsComputer()
    const seq: TawsInput[] = []
    for (let agl = 1800; agl > 180; agl -= 12) {
      seq.push(base({
        aglFt: agl, altFt: agl + 13, vsFpm: -450, gsKt: 90,
        flapsDeg: 20, nearRunwayFinal: true, gsDeviation: 0.05,
        terrainAheadFt: () => 0,
      }))
    }
    const a = collect(taws, seq)
    expect(a).toEqual(['FIVE HUNDRED'])
  })
})
