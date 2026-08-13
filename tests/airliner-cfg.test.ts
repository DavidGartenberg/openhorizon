import { describe, expect, it } from 'vitest'
import { ROSTER } from '../src/sim/aircraft/roster'
import { airlinerCfgFor } from '../src/render/airliner-mesh'

/** N2 geometry invariants: every airliner/bizjet in the roster must
 *  produce a physically sane visual config — and the family traits
 *  (humps, T-tails, winglet styles) must land on the right designators. */

const JETS = ROSTER.filter((r) => r.opts.cd0Class === 'airliner' || r.opts.cd0Class === 'bizjet')

describe('airliner visual configs (fleet-wide)', () => {
  it('every jet type yields a sane config', () => {
    expect(JETS.length).toBeGreaterThan(20)
    for (const r of JETS) {
      const s = r.spec
      const cfg = airlinerCfgFor({
        designator: s.designator,
        lengthM: s.lengthM,
        spanM: s.spanM,
        powerplant: { kind: s.powerplant.kind, count: 'count' in s.powerplant ? s.powerplant.count : undefined },
      })
      expect(cfg.lengthM, s.designator).toBeGreaterThan(10)
      expect(cfg.spanM, s.designator).toBeGreaterThan(8)
      expect(cfg.fuseRadiusM, s.designator).toBeGreaterThan(1.2)
      expect(cfg.fuseRadiusM, s.designator).toBeLessThan(cfg.spanM / 4)
      // nose gear ahead of CG, mains just behind (transport geometry)
      expect(cfg.gear[0]!.x, s.designator).toBeGreaterThan(0)
      expect(cfg.gear[1]!.x, s.designator).toBeLessThan(0)
      expect([2, 3, 4]).toContain(cfg.engines.count)
    }
  })

  it('family traits land on the right designators', () => {
    const cfg = (d: string): ReturnType<typeof airlinerCfgFor> => {
      const r = JETS.find((j) => j.spec.designator === d)
      expect(r, d).toBeTruthy()
      const s = r!.spec
      return airlinerCfgFor({
        designator: s.designator,
        lengthM: s.lengthM,
        spanM: s.spanM,
        powerplant: { kind: s.powerplant.kind, count: 'count' in s.powerplant ? s.powerplant.count : undefined },
      })
    }
    expect(cfg('B744').hump).toBe('747')
    expect(cfg('A388').hump).toBe('a380')
    expect(cfg('A320').hump).toBe('none')
    expect(cfg('MD88').tTail).toBe(true)
    expect(cfg('MD88').engines.mounted).toBe('tail')
    expect(cfg('CRJ9').engines.mounted).toBe('tail')
    expect(cfg('A320').engines.mounted).toBe('wing')
    expect(cfg('A20N').winglet).toBe('sharklet')
    expect(cfg('B788').winglet).toBe('raked')
    expect(cfg('B752').winglet).toBe('none')
    expect(cfg('A388').engines.count).toBe(4)
    expect(cfg('B744').engines.count).toBe(4)
  })
})
