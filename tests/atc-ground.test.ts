import { describe, expect, it } from 'vitest'

describe('real taxi routes (night-shift N7)', () => {
  it('routeIdents picks corridor idents in order, deduped, max 3', async () => {
    const { routeIdents } = await import('../src/sim/atc/ground')
    const segs = [
      { ref: 'A', x: 100, z: 0 },
      { ref: 'A', x: 300, z: 10 }, // dupe ident later along — dropped
      { ref: 'B', x: 500, z: -20 },
      { ref: 'C', x: 800, z: 400 }, // off-corridor
      { ref: 'D', x: 900, z: 15 },
      { ref: 'E', x: 950, z: 5 }, // 4th in-corridor — trimmed by max-3
    ]
    const r = routeIdents(segs, { x: 0, z: 0 }, { x: 1000, z: 0 })
    expect(r).toEqual(['A', 'B', 'D'])
  })
  it('phrases the clearance with real idents, falls back honestly', async () => {
    const { GroundController } = await import('../src/sim/atc/ground')
    const g = new GroundController({ facility: 'SFO Ground', freqMhz: 121.8, activeRunway: '28R' })
    const withRoute = g.request('Skyhawk 123AB', 'taxiOut', 0, ['A', 'F'])
    expect(withRoute[0]!.text).toContain('taxi via A, F, hold short runway 28R')
    const g2 = new GroundController({ facility: 'SFO Ground', freqMhz: 121.8, activeRunway: '28R' })
    const bare = g2.request('Skyhawk 123AB', 'taxiOut')
    expect(bare[0]!.text).toContain('via the parallel')
  })
})
