import { describe, expect, it } from 'vitest'
import { declutterLabels, labelAlpha } from '../src/render/traffic-layer'

describe('traffic label helpers', () => {
  it('fade with distance, never below 35 %', () => {
    expect(labelAlpha(500)).toBe(1)
    expect(labelAlpha(4000)).toBe(1)
    expect(labelAlpha(12000)).toBeGreaterThan(0.5)
    expect(labelAlpha(12000)).toBeLessThan(1)
    expect(labelAlpha(20000)).toBeCloseTo(0.35, 6)
    expect(labelAlpha(60000)).toBe(0.35)
  })
  it('keeps the nearest label of an overlapping group and everything that is clear', () => {
    const items = [
      { id: 'far', sx: 400, sy: 300, dist: 9000 },
      { id: 'near', sx: 410, sy: 305, dist: 800 },
      { id: 'mid', sx: 420, sy: 310, dist: 3000 },
      { id: 'clear', sx: 900, sy: 300, dist: 15000 },
    ]
    expect(declutterLabels(items, 132, 22).map((i) => i.id)).toEqual(['near', 'clear'])
  })
  it('does not mutate its input and handles empty lists', () => {
    const items = [{ sx: 1, sy: 1, dist: 5 }, { sx: 2, sy: 2, dist: 1 }]
    declutterLabels(items, 10, 10)
    expect(items[0]!.dist).toBe(5)
    expect(declutterLabels([], 10, 10)).toEqual([])
  })
})
