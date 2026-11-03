/**
 * Coverage culling: coarse ring tiles leave out of the draw the triangles that
 * lie wholly under ready finer tiles. The shader discarded every pixel there,
 * but the triangles were still transformed and rasterized, once per ring.
 * The culling must be exact: only triangles every point of which the coverage
 * test would discard, and all of them back when the fine tile goes away.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { TileManager, WorldFrame } from '../src/world/tiles'
import { lodIndices } from '../src/world/terrain-lod'
import { gridResponse } from './fixtures/terrain-tile'

class WorkerStub { onmessage: unknown; postMessage = vi.fn(); terminate = vi.fn() }
const ring = (z: number) => ({ z, radiusM: 10000, grid: 2, skirt: 10, depthBiasM: 0 })

beforeEach(() => vi.stubGlobal('Worker', WorkerStub))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('terrain coverage culling', () => {
  it('drops exactly the triangles under a ready fine tile, and restores them when it is evicted', () => {
    const scene = new THREE.Scene(), frame = new WorldFrame({ lat: 37.5092, lon: -122.4959 })
    const m = new TileManager(scene, frame, () => [])
    m.setImagery(false)
    const internal = m as any
    const want = (z: number, x: number, y: number) => { internal.want(ring(z), x, y); return internal.tiles.get(`${z}/${x}/${y}`) }
    // z11 tile (4×4 coverage cells) on a 17×17 grid; one z13 child inside it.
    const coarse = want(11, 327, 793)
    internal.onTileBuilt(gridResponse(coarse, 17, 100))
    const geo = coarse.mesh.geometry as THREE.BufferGeometry
    const all = geo.getIndex()!.count
    expect(Math.min(geo.drawRange.count, all)).toBe(all) // nothing covered yet
    const fine = want(13, 327 * 4 + 1, 793 * 4 + 2)
    internal.onTileBuilt(gridResponse(fine, 3, 10))
    const kept = geo.drawRange.count
    expect(kept).toBeLessThan(all)
    expect(kept).toBeGreaterThan(all * 0.8) // one cell of sixteen, at most

    // Exactness: every dropped triangle is covered at every point.
    const uv = geo.getAttribute('uv').array as Float32Array
    const src = lodIndices(17, 1)
    const drawn = new Set<string>()
    const idx = geo.getIndex()!.array as Uint32Array
    for (let t = 0; t < kept; t += 3) drawn.add(`${idx[t]},${idx[t + 1]},${idx[t + 2]}`)
    let dropped = 0
    for (let t = 0; t < src.length; t += 3) {
      const tri = [src[t]!, src[t + 1]!, src[t + 2]!]
      if (drawn.has(tri.join(','))) continue
      dropped++
      for (const [wa, wb] of [[1 / 3, 1 / 3], [0.98, 0.01], [0.01, 0.98], [0.01, 0.01], [0.5, 0.49]]) {
        const wc = 1 - wa! - wb!
        const u = wa! * uv[tri[0]! * 2]! + wb! * uv[tri[1]! * 2]! + wc * uv[tri[2]! * 2]!
        const v = wa! * uv[tri[0]! * 2 + 1]! + wb! * uv[tri[1]! * 2 + 1]! + wc * uv[tri[2]! * 2 + 1]!
        expect(coarse.coverage.covered(u, 1 - v)).toBe(true)
      }
    }
    expect(dropped * 3).toBe(all - kept)

    // Evict the fine tile: the coarse ground is whole again.
    coarse.lastWanted = 2; fine.lastWanted = 0; internal.stamp = 2
    for (let i = 0; i < 340; i++) internal.tiles.set(`dummy${i}`, { ...coarse, key: `dummy${i}`, mesh: undefined, lastWanted: 2 })
    internal.evict(0, 0)
    expect(internal.tiles.has(fine.key)).toBe(false)
    expect(geo.drawRange.count).toBe(all)
  })

  it('a coverage refresh leaves fine (z13) tiles alone: nothing can cover them', () => {
    const scene = new THREE.Scene(), frame = new WorldFrame({ lat: 37.5092, lon: -122.4959 })
    const m = new TileManager(scene, frame, () => [])
    m.setImagery(false)
    const internal = m as any
    internal.want(ring(13), 1309, 3174)
    const t = internal.tiles.get('13/1309/3174')
    internal.onTileBuilt(gridResponse(t, 5, 0))
    const index = t.mesh.geometry.getIndex()
    const version = index.version
    internal.refreshCoverage()
    expect(index.version).toBe(version)
    expect(t.mesh.geometry.drawRange.count).toBeGreaterThanOrEqual(index.count)
  })
})
