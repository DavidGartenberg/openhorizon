import { tileGridUv } from '../../src/math/geo'
import { lodIndices } from '../../src/world/terrain-lod'

/**
 * A tile response in the worker's layout (terrain-worker.ts): a G×G grid
 * (row j = 0 north), then one skirt vertex under each edge vertex, edge by
 * edge (north W→E, south E→W, west S→N, east N→S), indexed by lodIndices.
 * `height(i, j)` gives the grid heights (default flat at 0).
 */
export function gridResponse(t: { key: string; requestId: number; sizeEastM: number; sizeNorthM: number }, G: number, h: number | ((i: number, j: number) => number) = 0, skirtM = 10) {
  const N = G * G + 4 * G
  const at = typeof h === 'number' ? () => h : h
  const positions = new Float32Array(N * 3), uvs = new Float32Array(N * 2), heights = new Float32Array(G * G)
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const k = j * G + i
    heights[k] = at(i, j)
    positions[k * 3] = (i / (G - 1) - 0.5) * t.sizeEastM
    positions[k * 3 + 1] = heights[k]!
    positions[k * 3 + 2] = (j / (G - 1) - 0.5) * t.sizeNorthM
    const [u, v] = tileGridUv(i, j, G)
    uvs[k * 2] = u; uvs[k * 2 + 1] = v
  }
  let sv = G * G
  const skirt = (src: number): void => {
    positions.copyWithin(sv * 3, src * 3, src * 3 + 3)
    positions[sv * 3 + 1] = positions[src * 3 + 1]! - skirtM
    uvs.copyWithin(sv * 2, src * 2, src * 2 + 2)
    sv++
  }
  for (let i = 0; i < G; i++) skirt(i)
  for (let i = 0; i < G; i++) skirt((G - 1) * G + (G - 1 - i))
  for (let j = 0; j < G; j++) skirt((G - 1 - j) * G)
  for (let j = 0; j < G; j++) skirt(j * G + G - 1)
  return {
    key: t.key, requestId: t.requestId, positions, normals: new Float32Array(N * 3), colors: new Float32Array(N * 3), uvs,
    urban: new Float32Array(N), indices: lodIndices(G, 1).slice(), heights, gridSize: G,
  }
}
