/**
 * Imagery UV orientation (Phase 13b). The terrain worker's grid rows run
 * north (j=0) → south (j=G−1); textures load with three's default flipY,
 * so v=1 must be the image's top edge = north. Height rows are sampled
 * uniformly in tile-pixel (mercator-y) space and web-map imagery tiles
 * are mercator too, so a linear grid→UV map aligns imagery with the
 * heightfield pixel-for-pixel by construction.
 */
import { describe, expect, it } from 'vitest'
import { tileGridUv } from '../src/math/geo'

describe('tileGridUv', () => {
  const G = 96
  it('NW corner (i=0, j=0) → u=0, v=1 (image top = north)', () => {
    expect(tileGridUv(0, 0, G)).toEqual([0, 1])
  })
  it('NE corner (i=G−1, j=0) → u=1, v=1', () => {
    expect(tileGridUv(G - 1, 0, G)).toEqual([1, 1])
  })
  it('SW corner (i=0, j=G−1) → u=0, v=0', () => {
    expect(tileGridUv(0, G - 1, G)).toEqual([0, 0])
  })
  it('grid center → (0.5, 0.5)', () => {
    const [u, v] = tileGridUv((G - 1) / 2, (G - 1) / 2, G)
    expect(u).toBeCloseTo(0.5, 12)
    expect(v).toBeCloseTo(0.5, 12)
  })
})
