import { describe, it, expect } from 'vitest'
import { TERRAIN_VERT, TERRAIN_FRAG } from '../src/world/terrain-shader'

/** Names declared by `varying` statements (handles comma lists). */
function varyings(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/varying\s+\w+\s+([^;]+);/g)) {
    for (const n of m[1]!.split(',')) out.push(n.trim())
  }
  return out
}

describe('terrain shader source contract', () => {
  it('every fragment varying is written by the vertex shader', () => {
    const vert = new Set(varyings(TERRAIN_VERT))
    const missing = varyings(TERRAIN_FRAG).filter(v => !vert.has(v))
    expect(missing).toEqual([])
  })

  it('takes screen derivatives before the coverage discard', () => {
    expect(TERRAIN_FRAG.indexOf('dFdx(ground)')).toBeGreaterThan(-1)
    expect(TERRAIN_FRAG.indexOf('dFdx(ground)')).toBeLessThan(TERRAIN_FRAG.indexOf('discard;'))
  })

  it('keeps the shared aerial-perspective + cloud-fog tail intact', () => {
    expect(TERRAIN_FRAG).toContain('skyRadiance(uSky,hazeDir)')
    expect(TERRAIN_FRAG).toContain('#include <tonemapping_fragment>')
    expect(TERRAIN_FRAG).toContain('#include <colorspace_fragment>')
  })
})
