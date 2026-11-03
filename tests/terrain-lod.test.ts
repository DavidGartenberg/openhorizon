/**
 * Terrain mesh level of detail (world/terrain-lod.ts): coarser index lists
 * over the worker's one vertex grid. They must be drop-in replacements for
 * the full list (same vertex layout, same winding, the whole tile covered
 * once, skirts hanging from exactly the coarse edge), the gap between
 * neighbours on different levels must stay inside the skirts, and the
 * per-tile choice must refine at once and coarsen only with margin.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { LOD_STRIDES, chooseStride, distanceToBox, lodColumns, lodEdgeDeviation, lodIndices } from '../src/world/terrain-lod'
import { TileManager, WorldFrame } from '../src/world/tiles'
import { gridResponse } from './fixtures/terrain-tile'

/** The worker's original hand-built index list (before terrain-lod). */
function legacyIndices(G: number): number[] {
  const quads: number[] = []
  const edge = (i: number, j: number) => j * G + i
  for (let j = 0; j < G - 1; j++) for (let i = 0; i < G - 1; i++) {
    const a = edge(i, j), b = edge(i + 1, j), d = edge(i, j + 1), e = edge(i + 1, j + 1)
    quads.push(a, d, b, b, d, e)
  }
  let sv = G * G
  const addSkirtEdge = (cells: number[]) => {
    let prevTop = cells[0]!, prevBot = sv++
    for (let k = 1; k < cells.length; k++) {
      const top = cells[k]!, bot = sv++
      quads.push(prevTop, prevBot, top, top, prevBot, bot)
      prevTop = top; prevBot = bot
    }
  }
  addSkirtEdge(Array.from({ length: G }, (_, i) => edge(i, 0)))
  addSkirtEdge(Array.from({ length: G }, (_, i) => edge(G - 1 - i, G - 1)))
  addSkirtEdge(Array.from({ length: G }, (_, j) => edge(0, G - 1 - j)))
  addSkirtEdge(Array.from({ length: G }, (_, j) => edge(G - 1, j)))
  return quads
}

const GRIDS = [3, 17, 48, 64, 96] // the rings use 96, 96, 64, 48

describe('terrain LOD index lists', () => {
  it('stride 1 is exactly the list the worker always shipped', () => {
    for (const G of [2, ...GRIDS]) expect(Array.from(lodIndices(G, 1))).toEqual(legacyIndices(G))
  })

  it('kept rows/columns start at 0, end on the edge, and stay within 1.5 strides', () => {
    for (const G of GRIDS) for (const s of LOD_STRIDES) {
      const C = lodColumns(G, s)
      expect(C[0]).toBe(0)
      expect(C[C.length - 1]).toBe(G - 1)
      for (let k = 1; k < C.length; k++) {
        expect(C[k]! - C[k - 1]!).toBeGreaterThan(0)
        expect(C[k]! - C[k - 1]!).toBeLessThanOrEqual(Math.max(1, Math.floor(1.5 * s)))
      }
    }
  })

  it('every level covers the tile once, with the full mesh\'s winding and no slivers', () => {
    for (const G of GRIDS) for (const s of LOD_STRIDES) {
      const idx = lodIndices(G, s)
      const grid = (lodColumns(G, s).length - 1) ** 2 * 6
      let area = 0
      for (let t = 0; t < grid; t += 3) {
        const [a, b, c] = [idx[t]!, idx[t + 1]!, idx[t + 2]!]
        for (const v of [a, b, c]) expect(v).toBeLessThan(G * G)
        // Grid vertex (i, j) sits at x = i east, z = j south; y up.
        const ax = a % G, az = Math.floor(a / G), bx = b % G, bz = Math.floor(b / G), cx = c % G, cz = Math.floor(c / G)
        const crossY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az) // y of (b − a) × (c − a)
        expect(crossY).toBeGreaterThan(0) // the full mesh's triangles all face up
        area += crossY / 2
      }
      expect(area).toBe((G - 1) ** 2)
      for (let t = grid; t < idx.length; t++) expect(idx[t]).toBeLessThan(G * G + 4 * G)
    }
  })

  it('skirts hang from exactly the coarse edge vertices', () => {
    for (const G of GRIDS) for (const s of LOD_STRIDES) {
      const idx = lodIndices(G, s), C = new Set(lodColumns(G, s))
      const grid = (C.size - 1) ** 2 * 6
      const tops = new Set<number>()
      for (let t = grid; t < idx.length; t++) {
        const v = idx[t]!
        if (v >= G * G) continue
        tops.add(v)
        const i = v % G, j = Math.floor(v / G)
        expect(i === 0 || j === 0 || i === G - 1 || j === G - 1).toBe(true)
        // Along its edge the vertex must be a kept row/column.
        expect(j === 0 || j === G - 1 ? C.has(i) : C.has(j)).toBe(true)
      }
      expect(tops.size).toBe(4 * (C.size - 1)) // every kept edge vertex, corners shared
    }
  })

  it('coarse levels cut the triangle count by the square of the stride', () => {
    const full = lodIndices(96, 1).length
    expect(full / lodIndices(96, 2).length).toBeGreaterThan(3.5)
    expect(full / lodIndices(96, 4).length).toBeGreaterThan(12)
    expect(full / lodIndices(96, 8).length).toBeGreaterThan(35)
  })
})

describe('terrain LOD cracks', () => {
  it('measures the edge deviation exactly: flat and planar ground has none', () => {
    expect(lodEdgeDeviation(() => 5, 17)).toBe(0)
    expect(lodEdgeDeviation((i, j) => 3 * i - 2 * j, 17)).toBeCloseTo(0, 9)
    // A 12 m bump on a vertex every coarse level skips.
    expect(lodEdgeDeviation((i, j) => (i === 3 && j === 0 ? 12 : 0), 17)).toBeCloseTo(12, 9)
    // Inside the tile it is not an edge deviation.
    expect(lodEdgeDeviation((i, j) => (i === 3 && j === 5 ? 12 : 0), 17)).toBe(0)
  })

  it('two levels of a shared edge never part by more than twice the deviation (the skirt allowance)', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let trial = 0; trial < 20; trial++) {
      const G = [48, 64, 96][trial % 3]!
      const h = Array.from({ length: G * G }, () => rnd() * 300)
      const y = (i: number, j: number) => h[j * G + i]!
      const dev = lodEdgeDeviation(y, G)
      // The north edge as drawn at stride s: linear between kept vertices.
      const drawn = (s: number, q: number) => {
        const C = lodColumns(G, s)
        let p = 0
        while (C[p + 1]! < q) p++
        const q0 = C[p]!, q1 = C[p + 1]!
        return y(q0, 0) + ((y(q1, 0) - y(q0, 0)) * (q - q0)) / (q1 - q0)
      }
      for (const sa of LOD_STRIDES) for (const sb of LOD_STRIDES) for (let q = 0; q < G; q++) {
        expect(Math.abs(drawn(sa, q) - drawn(sb, q))).toBeLessThanOrEqual(2 * dev + 1e-9)
      }
    }
  })
})

describe('terrain LOD choice', () => {
  const PX = 540 / (2 * Math.tan((60 * Math.PI) / 360)) // 540 px tall, 60° fov

  it('keeps full detail close by and coarsens with distance, never finer further out', () => {
    expect(chooseStride(40, 0, PX, 8, 1)).toBe(1)
    expect(chooseStride(40, 500, PX, 8, 1)).toBe(1)
    let prev = 1
    for (let d = 100; d < 50_000; d *= 1.1) {
      const s = chooseStride(40, d, PX, 8, prev)
      expect(s).toBeGreaterThanOrEqual(prev)
      prev = s
    }
    expect(prev).toBe(8)
  })

  it('refines at once but coarsens only with margin, so it never flickers on a threshold', () => {
    // 40 m cells at 8 px: stride 2 is allowed beyond 40 × PX × 2 / 8 m.
    const edge = (40 * PX * 2) / 8
    expect(chooseStride(40, edge * 1.05, PX, 8, 1)).toBe(1) // inside the margin: stay
    expect(chooseStride(40, edge * 1.3, PX, 8, 1)).toBe(2)
    expect(chooseStride(40, edge * 1.05, PX, 8, 2)).toBe(2) // stays coarse in the band
    expect(chooseStride(40, edge * 0.95, PX, 8, 2)).toBe(1) // too coarse: refine now
    let s = 1, flips = 0
    for (let i = 0; i < 1000; i++) {
      const next = chooseStride(40, edge * (1.1 + 0.08 * Math.sin(i)), PX, 8, s)
      if (next !== s) flips++
      s = next
    }
    expect(flips).toBeLessThanOrEqual(1)
  })

  it('measures distance to the tile, not its centre', () => {
    expect(distanceToBox(0, 100, 0, 0, 0, 0, 500, 50, 500)).toBe(50) // above it
    expect(distanceToBox(600, 0, 0, 0, 0, 0, 500, 50, 500)).toBe(100)
    expect(distanceToBox(10, 10, 10, 0, 0, 0, 500, 50, 500)).toBe(0) // inside
  })
})

class WorkerStub { onmessage: unknown; postMessage = vi.fn(); terminate = vi.fn() }
const ring = (z: number) => ({ z, radiusM: 10000, grid: 2, skirt: 10, depthBiasM: 0 })
beforeEach(() => vi.stubGlobal('Worker', WorkerStub))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('terrain LOD in the tile manager', () => {
  function setup() {
    const scene = new THREE.Scene(), frame = new WorldFrame({ lat: 37.5092, lon: -122.4959 })
    const m = new TileManager(scene, frame, () => [])
    m.setImagery(false)
    const internal = m as any
    internal.want(ring(13), 1309, 3174)
    const t = internal.tiles.get('13/1309/3174')
    internal.onTileBuilt(gridResponse(t, 96, 100))
    return { m, t, geo: t.mesh.geometry as THREE.BufferGeometry }
  }
  const PX = 540 / (2 * Math.tan((60 * Math.PI) / 360))

  it('draws a far tile coarse and the tile under the camera in full', () => {
    const { m, t, geo } = setup()
    const full = lodIndices(96, 1).length
    const drawn = () => Math.min(geo.drawRange.count, geo.getIndex()!.count)
    expect(drawn()).toBe(full) // no view yet: full mesh
    const at = (x: number, y: number, z: number) => m.updateLod(new THREE.Vector3(t.mesh.position.x + x, y, t.mesh.position.z + z), PX)
    at(0, 400, 0)
    expect(t.stride).toBe(1)
    expect(drawn()).toBe(full)
    at(30_000, 400, 0)
    expect(t.stride).toBe(8)
    expect(drawn()).toBe(lodIndices(96, 8).length)
    // The drawn list is the coarse level itself, uploaded as a range.
    const idx = geo.getIndex()!
    expect(Array.from((idx.array as Uint32Array).subarray(0, geo.drawRange.count))).toEqual(Array.from(lodIndices(96, 8)))
    expect(idx.updateRanges.at(-1)?.count ?? geo.drawRange.count).toBe(geo.drawRange.count)
    at(0, 400, 0)
    expect(t.stride).toBe(1)
    expect(drawn()).toBe(full)
  })

  it('a finer render target or a higher target keeps more detail; off restores the full mesh', () => {
    const { m, t, geo } = setup()
    const cam = new THREE.Vector3(t.mesh.position.x + 12_000, 400, t.mesh.position.z)
    m.updateLod(cam, PX)
    const sNormal = t.stride
    m.updateLod(cam, PX * 4) // 4× the pixels per radian
    expect(t.stride).toBeLessThan(sNormal)
    m.setLodTarget(32)
    m.updateLod(cam, PX)
    expect(t.stride).toBeGreaterThanOrEqual(sNormal)
    m.setLod(false)
    expect(geo.drawRange.count).toBe(lodIndices(96, 1).length)
    m.updateLod(cam, PX)
    expect(geo.drawRange.count).toBe(lodIndices(96, 1).length)
    m.setLod(true)
    expect(geo.drawRange.count).toBeLessThan(lodIndices(96, 1).length)
  })
})
