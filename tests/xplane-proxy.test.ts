import { describe, expect, it } from 'vitest'
import { ROSTER } from '../src/sim/aircraft/roster'
import { XP_MODELS } from '../src/render/xplane-manifest'
import { resolveLocalModel } from '../src/render/xplane-proxy'

const known = new Set(Object.keys(XP_MODELS))
const r = (k: string) => resolveLocalModel(k, known)

describe('which installed model draws each flyable aircraft', () => {
  it('the ten installed types are exact, at scale 1', () => {
    for (const [k, m] of [['172', 'C172'], ['737', 'B738'], ['A333', 'A333'], ['SR22', 'SR22'], ['BE58', 'BE58'], ['PA18', 'PA18'], ['AS21', 'AS21'], ['C750', 'C750'], ['BE9L', 'BE9L']] as const) {
      expect(r(k)).toEqual({ model: m, scale: 1, exact: true })
    }
  })
  it('other twin-engine airliners and jets borrow the closest model at their own size', () => {
    const a320 = r('A320')!
    expect(a320).toMatchObject({ model: 'B738', exact: false }); expect(a320.scale).toBeCloseTo(37.57 / 39.47, 2)
    expect(r('B39M')!.scale).toBeGreaterThan(1)
    expect(r('MD88')).toMatchObject({ model: 'MD82', exact: false })
    expect(r('A339')).toMatchObject({ model: 'A333', exact: false })
    expect(r('B772')).toMatchObject({ model: 'A333', exact: false })          // twin widebodies use the twin widebody
    expect(r('C56X')).toMatchObject({ model: 'C750', exact: false })
    expect(r('CRJ2')).toMatchObject({ model: 'B738' })
  })
  it('light aircraft use the matching Cessna / Cirrus / Piper / Baron / glider, scaled', () => {
    expect(r('C182')).toMatchObject({ model: 'C172' })
    expect(r('SR20')).toMatchObject({ model: 'SR22' })
    expect(r('PA34')).toMatchObject({ model: 'BE58' })
    expect(r('B350')).toMatchObject({ model: 'BE9L', exact: false })     // twin turboprops borrow the King Air
    for (const g of ['DG80', 'LS8', 'DISC']) expect(r(g)).toMatchObject({ model: 'AS21', exact: false })
  })
  it('three- and four-engine types keep their own airframe', () => {
    for (const k of ['B744', 'B748', 'A388', 'A343', 'B742', 'MD11', 'C130']) expect(r(k), k).toBeNull()
  })
  it('unknown designators are not guessed', () => {
    expect(r('ZZZZ')).toBeNull()
  })
  it('every roster aircraft either resolves to a known model with a sane scale, or is deliberately left alone', () => {
    let resolved = 0
    for (const { spec } of ROSTER) {
      const m = r(spec.designator)
      if (!m) continue
      resolved++
      expect(known.has(m.model), spec.designator).toBe(true)
      expect(m.scale, spec.designator).toBeGreaterThan(0.5); expect(m.scale, spec.designator).toBeLessThan(2.6)
    }
    expect(resolved).toBeGreaterThan(ROSTER.length * 0.8)
  })
})
