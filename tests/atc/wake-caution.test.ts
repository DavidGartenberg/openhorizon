import { describe, expect, it } from 'vitest'
import { wakeCaution, wtcFor, type RunwayUse } from '../../src/sim/atc/wake-caution'
import { TowerController } from '../../src/sim/atc/tower'

describe('wake turbulence cautions', () => {
  it('assigns ICAO wake categories by mass and span', () => {
    expect(wtcFor(1_111, 11)).toBe('L')
    expect(wtcFor(79_000, 35.8)).toBe('M')
    expect(wtcFor(351_000, 64.8)).toBe('H')
    expect(wtcFor(575_000, 79.8)).toBe('J')
  })

  it('cautions a lighter aircraft behind recent heavier traffic, not after 3 minutes', () => {
    const uses: RunwayUse[] = [{ wtc: 'H', kind: 'arrival', atSimS: 100, typeName: 'Boeing 777' }]
    expect(wakeCaution('L', uses, 160)).toBe('caution wake turbulence, landing Boeing 777')
    expect(wakeCaution('L', uses, 300)).toBeNull()
    expect(wakeCaution('H', uses, 160)).toBeNull() // same category
    expect(wakeCaution('M', [{ wtc: 'J', kind: 'departure', atSimS: 0 }], 30)).toBe('caution wake turbulence, departing heavy jet')
  })

  it('the tower appends it to the landing clearance', () => {
    const twr = new TowerController({
      facility: 'Test Tower', freqMhz: 118.6, activeRunway: '28R',
      wakeCautionFor: (cs) => (cs === 'N1' ? 'caution wake turbulence, landing Boeing 777' : null),
    })
    const out = twr.request('N1', 'inboundLanding', { distanceM: 9000, aglFt: 1200, onGround: false }, 0)
    expect(out.map((t) => t.text).join(' ')).toContain('cleared to land, caution wake turbulence, landing Boeing 777')
    const other = twr.request('N2', 'inboundLanding', { distanceM: 9000, aglFt: 1200, onGround: false }, 0)
    expect(other.map((t) => t.text).join(' ')).not.toContain('wake')
  })
})
