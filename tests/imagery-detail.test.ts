import { describe, expect, it } from 'vitest'
import { imageryChildren } from '../src/world/imagery-detail'

describe('high-resolution imagery footprint', () => {
  it('covers exactly the parent tile with north-first z16 children', () => {
    const children = imageryChildren(13, 1308, 3165, 16)
    expect(children).toHaveLength(64)
    expect(children[0]).toEqual({ z: 16, x: 10464, y: 25320, px: 0, py: 0 })
    expect(children[7]).toEqual({ z: 16, x: 10471, y: 25320, px: 1792, py: 0 })
    expect(children[63]).toEqual({ z: 16, x: 10471, y: 25327, px: 1792, py: 1792 })
    expect(new Set(children.map(c => `${c.x}/${c.y}`)).size).toBe(64)
  })
  it('bounds refinements and rejects invalid zoom arithmetic', () => {
    expect(() => imageryChildren(13, 0, 0, 12)).toThrow()
    expect(() => imageryChildren(13, 0, 0, 20)).toThrow()
    expect(() => imageryChildren(13, 0, 0, 14.5)).toThrow()
  })
})
