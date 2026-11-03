/**
 * Terrain level of detail. A tile ships one vertex grid (G×G, row j = 0 at
 * the north edge, plus a skirt copy of the four edges: terrain-worker.ts);
 * its coarser levels are index lists over the same vertices that skip rows
 * and columns (stride 2, 4, 8). The level is chosen per tile from the
 * projected size of a grid cell at the tile's nearest point, so the ground
 * near the camera keeps every vertex while distant ground stops drawing
 * triangles a pixel or two across. Those were most of the terrain's cost:
 * every triangle pays full setup, and every pixel it touches shades a whole
 * 2×2 quad, so a sub-pixel mesh shades several times per pixel.
 *
 * Neighbours on different levels meet with T-junctions; the skirts hide
 * them. The worker deepens each tile's skirt by twice the largest edge
 * deviation over the coarse levels (lodEdgeDeviation), which bounds the gap
 * between any two levels' versions of a shared edge.
 */

export const LOD_STRIDES = [1, 2, 4, 8] as const
export type LodStride = (typeof LOD_STRIDES)[number]

/**
 * Vertex rows/columns (0..G−1) kept at stride s: every s-th one, always
 * ending on the far edge G−1. When G−1 is not a multiple of s, a last strip
 * of s/2 cells or fewer merges into the one before it.
 */
export function lodColumns(G: number, s: number): number[] {
  const out: number[] = []
  for (let i = 0; i < G - 1; i += s) out.push(i)
  if (out.length > 1 && G - 1 - out[out.length - 1]! <= s / 2) out.pop()
  out.push(G - 1)
  return out
}

const cache = new Map<number, Uint32Array>()

/**
 * The triangle list (grid, then the four skirt edges) at stride s, in the
 * worker's vertex layout and winding. Stride 1 is the full mesh, and is
 * exactly the list the worker ships. Cached per (G, s): treat as read-only.
 */
export function lodIndices(G: number, s: number): Uint32Array {
  const key = G * 64 + s
  const hit = cache.get(key)
  if (hit) return hit
  const C = lodColumns(G, s)
  const n = C.length
  const out = new Uint32Array((n - 1) * (n - 1) * 6 + 4 * (n - 1) * 6)
  let k = 0
  for (let jj = 0; jj + 1 < n; jj++) {
    const j0 = C[jj]!, j1 = C[jj + 1]!
    for (let ii = 0; ii + 1 < n; ii++) {
      const i0 = C[ii]!, i1 = C[ii + 1]!
      const a = j0 * G + i0, b = j0 * G + i1, d = j1 * G + i0, e = j1 * G + i1
      out[k++] = a; out[k++] = d; out[k++] = b
      out[k++] = b; out[k++] = d; out[k++] = e
    }
  }
  // Skirt edges, in the worker's order: each walks a sequence k = 0..G−1 of
  // edge vertices; skirt vertex (base + k) hangs under sequence vertex k.
  const base = G * G
  const edges: Array<{ top: (q: number) => number; skirt: number; reversed: boolean }> = [
    { top: (q) => q, skirt: base, reversed: false }, // north row, west → east
    { top: (q) => (G - 1) * G + (G - 1 - q), skirt: base + G, reversed: true }, // south row, east → west
    { top: (q) => (G - 1 - q) * G, skirt: base + 2 * G, reversed: true }, // west column, south → north
    { top: (q) => q * G + (G - 1), skirt: base + 3 * G, reversed: false }, // east column, north → south
  ]
  for (const edge of edges) {
    // The kept sequence positions are the kept grid rows/columns, so the
    // skirt hangs from exactly the vertices the coarse grid edge uses.
    const K = edge.reversed ? C.map((c) => G - 1 - c).reverse() : C
    for (let q = 0; q + 1 < K.length; q++) {
      const q0 = K[q]!, q1 = K[q + 1]!
      const prevTop = edge.top(q0), prevBot = edge.skirt + q0
      const top = edge.top(q1), bot = edge.skirt + q1
      out[k++] = prevTop; out[k++] = prevBot; out[k++] = top
      out[k++] = top; out[k++] = prevBot; out[k++] = bot
    }
  }
  cache.set(key, out)
  return out
}

/**
 * Largest vertical gap (m) between a tile edge at any coarse stride and the
 * full-resolution edge. Both are piecewise linear with breakpoints at the
 * full-resolution vertices, so checking those vertices is exact. `y(i, j)`
 * is the rendered height of grid vertex (column i, row j).
 */
export function lodEdgeDeviation(y: (i: number, j: number) => number, G: number): number {
  let worst = 0
  for (const s of LOD_STRIDES) {
    if (s === 1) continue
    const C = lodColumns(G, s)
    const along = (h: (q: number) => number): void => {
      for (let p = 0; p + 1 < C.length; p++) {
        const q0 = C[p]!, q1 = C[p + 1]!
        const h0 = h(q0), h1 = h(q1)
        for (let q = q0 + 1; q < q1; q++) {
          const lin = h0 + ((h1 - h0) * (q - q0)) / (q1 - q0)
          worst = Math.max(worst, Math.abs(h(q) - lin))
        }
      }
    }
    along((q) => y(q, 0))
    along((q) => y(q, G - 1))
    along((q) => y(0, q))
    along((q) => y(G - 1, q))
  }
  return worst
}

/**
 * The tile's level: the coarsest stride whose cells project to at most
 * `targetPx` pixels at the tile's nearest point. Coarsening needs 20%
 * margin; refining happens at once, so a level never pops back and forth
 * on a threshold and close ground is never left coarse.
 *
 * cellM: grid cell size (m); distM: camera to the tile's nearest point
 * (m); pxPerRad: render-target pixels per radian of view.
 */
export function chooseStride(cellM: number, distM: number, pxPerRad: number, targetPx: number, current: number): LodStride {
  const cellPx = (cellM / Math.max(distM, 1)) * pxPerRad
  let fine: LodStride = 1, coarse: LodStride = 1
  for (const s of LOD_STRIDES) {
    if (s * cellPx <= targetPx) fine = s
    if (s * cellPx <= targetPx * 0.8) coarse = s
  }
  if (current > fine) return fine
  if (current < coarse) return coarse
  return current as LodStride
}

/** Distance (m) from a point to an axis-aligned box given by centre and half extents. */
export function distanceToBox(px: number, py: number, pz: number, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): number {
  const dx = Math.max(Math.abs(px - cx) - hx, 0)
  const dy = Math.max(Math.abs(py - cy) - hy, 0)
  const dz = Math.max(Math.abs(pz - cz) - hz, 0)
  return Math.hypot(dx, dy, dz)
}
