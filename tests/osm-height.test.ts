import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ES module without types (server code)
import { osmHeightM } from '../server/handlers.mjs'

describe('building height from OSM tags', () => {
  it('reads height in metres (with units or a decimal comma) and falls back to levels × 3.6 m', () => {
    expect(osmHeightM({ height: '18' })).toBe(18); expect(osmHeightM({ height: '12.5 m' })).toBe(12.5); expect(osmHeightM({ height: '9,5' })).toBe(9.5)
    expect(osmHeightM({ 'building:levels': '3' })).toBe(10.8); expect(osmHeightM({ height: '20', 'building:levels': '2' })).toBe(20)
  })
  it('is null for nothing, junk or absurd values', () => {
    expect(osmHeightM({})).toBeNull(); expect(osmHeightM(undefined)).toBeNull(); expect(osmHeightM({ height: 'tall' })).toBeNull()
    expect(osmHeightM({ height: '2' })).toBeNull(); expect(osmHeightM({ height: '9000' })).toBeNull(); expect(osmHeightM({ 'building:levels': '500' })).toBeNull()
  })
})

import { normalizedLayout } from '../src/world/osm-layout'
describe('terminal heights through the client layout', () => {
  const sq = (o: number): [number, number][] => [[o, o], [o, o + 0.001], [o + 0.001, o + 0.001], [o + 0.001, o]]
  it('stay with their own polygon when a malformed one is dropped, and are clamped', () => {
    const l = normalizedLayout({ tm: [sq(1), [[1, 1]], sq(3), sq(5)], th: [20, 15, null, 900] })
    expect(l.tm).toHaveLength(3)
    expect(l.tmh.get(l.tm[0]!)).toBe(20)          // the malformed second polygon's 15 is not given to the third
    expect(l.tmh.get(l.tm[1]!)).toBeUndefined()   // untagged: the caller uses its estimate
    expect(l.tmh.get(l.tm[2]!)).toBe(80)          // absurd heights are capped
  })
  it('is fine without any heights (an airport cached before they were kept)', () => {
    const l = normalizedLayout({ tm: [sq(1)] })
    expect(l.tm).toHaveLength(1); expect(l.tmh.get(l.tm[0]!)).toBeUndefined()
  })
})
