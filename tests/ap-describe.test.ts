import { describe, expect, it } from 'vitest'
import { describeAutopilot, type ApDescribeInput } from '../src/sim/ap-describe'

const base: ApDescribeInput = {
  master: true, onGround: false,
  lateral: 'ROL', lateralArmed: false, vertical: 'PIT', verticalActual: 'PIT',
  sel: { headingDeg: 270, altitudeFt: 8000, vsFpm: 0, iasKt: 210 }, altHoldFt: 0,
  current: { altitudeFt: 3480, headingDeg: 87, iasKt: 119, vsFpm: 0 },
  autothrottle: null, autoland: null, navSource: null,
}
const d = (o: Partial<ApDescribeInput>) => describeAutopilot({ ...base, ...o })

describe('autopilot off', () => {
  it('on the ground: says when it can be used', () => {
    const r = d({ master: false, onGround: true })
    expect(r.headline).toMatch(/off/i); expect(r.next).toMatch(/take ?off/i)
  })
  it('in the air: you are flying by hand and told how to engage', () => {
    const r = d({ master: false })
    expect(r.headline).toMatch(/off/i); expect(r.headline).toMatch(/hand/i)
    expect(r.next).toMatch(/HDG|ALT|CLIMB|AUTOPILOT/)
  })
})

describe('what it is doing, in words', () => {
  it('wings level / holding pitch right after engaging, and what to press next', () => {
    const r = d({})
    expect(r.headline).toMatch(/wings level/i); expect(r.headline).toMatch(/pitch/i)
    expect(r.next).toMatch(/HDG/); expect(r.next).toMatch(/ALT|CLIMB|DESCEND/)
  })
  it('heading: turning to a heading vs holding it', () => {
    expect(d({ lateral: 'HDG', current: { ...base.current, headingDeg: 87 } }).headline).toMatch(/turning to heading 270/i)
    expect(d({ lateral: 'HDG', current: { ...base.current, headingDeg: 269 } }).headline).toMatch(/holding heading 270/i)
  })
  it('altitude hold, climb and descent with the target and rate', () => {
    expect(d({ vertical: 'ALT', verticalActual: 'ALT', altHoldFt: 5000 }).headline).toMatch(/holding 5,000 ft/i)
    const climb = d({ vertical: 'VS', verticalActual: 'ALTS', sel: { ...base.sel, vsFpm: 1500 } }).headline
    expect(climb).toMatch(/climbing to 8,000 ft/i); expect(climb).toMatch(/1,500 ft\/min/); expect(climb).toMatch(/level off/i)
    const desc = d({ vertical: 'VS', verticalActual: 'ALTS', sel: { ...base.sel, vsFpm: -700, altitudeFt: 2000 } }).headline
    expect(desc).toMatch(/descending to 2,000 ft/i); expect(desc).toMatch(/700 ft\/min/)
  })
  it('a vertical speed that leads away from the selected altitude does not claim a capture', () => {
    const r = d({ vertical: 'VS', verticalActual: 'VS', sel: { ...base.sel, vsFpm: -700, altitudeFt: 8000 } }).headline
    expect(r).toMatch(/descending at 700 ft\/min/i); expect(r).not.toMatch(/level off/i)
  })
  it('flight level change names the speed it holds', () => {
    const r = d({ vertical: 'FLC', verticalActual: 'ALTS' }).headline
    expect(r).toMatch(/climbing to 8,000 ft/i); expect(r).toMatch(/210 kt/)
  })
  it('navigation and approach', () => {
    expect(d({ lateral: 'NAV', navSource: 'flight plan' }).headline).toMatch(/flight plan/i)
    expect(d({ lateral: 'NAV', navSource: 'VOR' }).headline).toMatch(/VOR/)
    expect(d({ lateral: 'APR', lateralArmed: true }).headline).toMatch(/intercept/i)
    expect(d({ lateral: 'APR', vertical: 'GS', verticalActual: 'GS' }).headline).toMatch(/localizer/i)
    expect(d({ lateral: 'APR', vertical: 'GS', verticalActual: 'GS' }).headline).toMatch(/glideslope/i)
  })
  it('autothrottle and autoland are mentioned only when they are really on', () => {
    expect(d({ autothrottle: { engaged: true, mode: 'MCP SPD' } }).headline).toMatch(/autothrottle holding 210 kt/i)
    expect(d({ autothrottle: { engaged: false, mode: 'ARM' } }).headline).not.toMatch(/autothrottle/i)
    expect(d({}).headline).not.toMatch(/autothrottle|autoland/i)
    const al = d({ lateral: 'APR', vertical: 'GS', verticalActual: 'GS', autoland: { phase: 'ARMED' } })
    expect(al.headline).toMatch(/autoland/i)
    expect(al.next ?? '').toMatch(/land|flare|stop/i)
  })
  it('autoland phases get their own wording', () => {
    const phase = (p: string) => d({ lateral: 'APR', vertical: 'GS', verticalActual: 'GS', autoland: { phase: p } }).headline
    expect(phase('ROLLOUT')).toMatch(/roll/i)
    expect(phase('DONE')).toMatch(/stopped|complete|done/i)
  })
})

describe('never invents state', () => {
  it('uses only what it is given: the same input always gives the same words', () => {
    const a = d({ lateral: 'HDG', vertical: 'ALT', verticalActual: 'ALT', altHoldFt: 4000 })
    expect(d({ lateral: 'HDG', vertical: 'ALT', verticalActual: 'ALT', altHoldFt: 4000 })).toEqual(a)
  })
})
