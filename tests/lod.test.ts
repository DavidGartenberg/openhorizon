import { describe, expect, it } from 'vitest'
import { LOD, lodVisible } from '../src/render/lod'

describe('distance LOD with hysteresis', () => {
  it('hides beyond the outer edge and shows again only inside the inner edge', () => {
    const b = LOD.facilities
    expect(lodVisible(true, 8000, b)).toBe(true) // inside the band: keep
    expect(lodVisible(true, 9000, b)).toBe(false)
    expect(lodVisible(false, 8000, b)).toBe(false) // inside the band: stay hidden
    expect(lodVisible(false, 7000, b)).toBe(true)
  })

  it('never flickers while hovering at the boundary', () => {
    let v = true, flips = 0
    for (let i = 0; i < 1000; i++) {
      const next = lodVisible(v, 8000 + Math.sin(i) * 400, LOD.facilities)
      if (next !== v) flips++
      v = next
    }
    expect(flips).toBe(0)
  })
})
