import { describe, expect, it } from 'vitest'
import { parkedKindFor, parkedAircraftFor, parkedSpec, nearestParked, spotHash, GATE_OCCUPANCY } from '../src/world/parked-aircraft'
import { chooseTrafficModel } from '../src/render/xplane-proxy'

const ramp = (i: number, cats: string[], kind = 'gate') => ({ x: i * 61.3, z: i * 17.9 + 5, hdg: 90 + i, kind, cats, name: `G${i}` })

describe('what parks where', () => {
  it('takes the largest class a ramp start lists, and nothing for a start with none we draw', () => {
    expect(parkedKindFor(['heavy', 'jets', 'turboprops'])).toBe('jet')
    expect(parkedKindFor(['heavy'])).toBe('heavy')
    expect(parkedKindFor(['turboprops', 'props'])).toBe('turboprop')
    expect(parkedKindFor(['props'])).toBe('prop')
    expect(parkedKindFor(['fighters'])).toBeNull(); expect(parkedKindFor([])).toBeNull()
  })
  it('is deterministic, about the stated share, and honours heading and uniqueness', () => {
    const ramps = Array.from({ length: 400 }, (_, i) => ramp(i, ['jets']))
    const a = parkedAircraftFor(ramps), b = parkedAircraftFor(ramps)
    expect(a).toEqual(b)
    expect(a.length / ramps.length).toBeGreaterThan(GATE_OCCUPANCY - 0.1); expect(a.length / ramps.length).toBeLessThan(GATE_OCCUPANCY + 0.1)
    expect(new Set(a.map((s) => s.id)).size).toBe(a.length)
    expect(a.every((s) => s.hdg >= 0 && s.hdg < 360)).toBe(true)
  })
  it('keeps jets off tie-downs, drops junk, and wraps headings', () => {
    expect(parkedAircraftFor(Array.from({ length: 50 }, (_, i) => ramp(i, ['jets'], 'tie-down')))).toEqual([])
    expect(parkedAircraftFor([{ x: NaN, z: 0, hdg: 0, kind: 'gate', cats: ['jets'] }])).toEqual([])
    const wrapped = parkedAircraftFor(Array.from({ length: 60 }, (_, i) => ({ x: i * 40, z: 3, hdg: -90, kind: 'gate', cats: ['jets'] })))
    expect(wrapped.length).toBeGreaterThan(0); expect(wrapped.every((s) => s.hdg === 270)).toBe(true)
  })
  it('the hash is stable and spreads', () => {
    expect(spotHash(10, 20)).toBe(spotHash(10, 20))
    const v = Array.from({ length: 200 }, (_, i) => spotHash(i * 13, i * 7))
    expect(Math.min(...v)).toBeGreaterThanOrEqual(0); expect(Math.max(...v)).toBeLessThan(1)
  })
})

describe('how they are drawn', () => {
  it('every kind resolves to an installed model at a sane scale (heavies use the 737, stretched, not the 600 k-triangle A330)', () => {
    for (const k of ['heavy', 'jet', 'turboprop', 'prop'] as const) {
      const c = chooseTrafficModel(parkedSpec(k), '', { allowHeavy: false })
      expect(c, k).not.toBeNull(); expect(c!.scale, k).toBeGreaterThan(0.5); expect(c!.scale, k).toBeLessThan(2.5)
    }
    expect(chooseTrafficModel(parkedSpec('heavy'), '', { allowHeavy: false })!.key).toBe('B738')
    expect(chooseTrafficModel(parkedSpec('jet'), '', { allowHeavy: false })!.key).toBe('B738')
    expect(chooseTrafficModel(parkedSpec('turboprop'), '', { allowHeavy: false })!.key).toBe('BE9L')
  })
  it('picks the nearest few within range and skips occupied stands', () => {
    const spots = Array.from({ length: 20 }, (_, i) => ({ x: i * 50, z: 0 }))
    expect(nearestParked(spots, { x: 0, z: 0 }, 300, 3).map((s) => s.x)).toEqual([0, 50, 100])
    expect(nearestParked(spots, { x: 0, z: 0 }, 300, 3, (s) => s.x === 50).map((s) => s.x)).toEqual([0, 100, 150])
    expect(nearestParked(spots, { x: 5000, z: 0 }, 300, 3)).toEqual([])
  })
})
