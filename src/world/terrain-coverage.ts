import { tileYToLat } from '../math/geo'

/** One texel per exact z13 child tile, never a rasterized world-space mask.
 * Latitude rows are nonuniform because the mesh uses linear latitude. */
export class TerrainCoverage {
  readonly size: number
  readonly cells: Uint8Array
  readonly rows = new Float32Array(65)
  readonly x: number
  readonly y: number
  constructor(readonly key: string) {
    const [z, x, y] = key.split('/').map(Number) as [number, number, number]
    this.size = 2 ** (13 - z)
    this.x = x * this.size
    this.y = y * this.size
    this.cells = new Uint8Array(this.size * this.size)
    const north = tileYToLat(y, z), south = tileYToLat(y + 1, z)
    for (let row = 0; row <= this.size; row++) {
      this.rows[row] = (north - tileYToLat(this.y + row, 13)) / (north - south)
    }
  }
  rebuild(readyKeys: readonly string[]): void {
    this.cells.fill(0)
    for (const key of readyKeys) {
      const [z, x, y] = key.split('/').map(Number) as [number, number, number]
      const span = 2 ** (13 - z)
      if (span >= this.size) continue
      const left = x * span - this.x, top = y * span - this.y
      if (left < 0 || top < 0 || left + span > this.size || top + span > this.size) continue
      for (let row = top; row < top + span; row++) {
        this.cells.fill(255, row * this.size + left, row * this.size + left + span)
      }
    }
  }
  /** Same half-open UV ownership and binary search as the fragment shader. */
  covered(u: number, northFraction: number): boolean {
    if (u < 0 || u >= 1 || northFraction < 0 || northFraction >= 1) return false
    let low = 0, high = this.size
    for (let i = 0; i < 6; i++) {
      if (high - low <= 1) break
      const middle = Math.floor((low + high) / 2)
      if (northFraction >= this.rows[middle]!) low = middle
      else high = middle
    }
    return this.cells[low * this.size + Math.floor(u * this.size)] !== 0
  }
}

export const TERRAIN_COVERAGE_GLSL = /* glsl */ `
  uniform sampler2D uCoverage;
  uniform float uCoverageSize;
  uniform float uCoverageRows[65];
  bool coveredByReadyTerrain(vec2 uv) {
    if (uCoverageSize <= 1.0) return false;
    float northFraction = 1.0 - uv.y;
    if (uv.x < 0.0 || uv.x >= 1.0 || northFraction < 0.0 || northFraction >= 1.0) return false;
    int low = 0;
    int high = int(uCoverageSize);
    for (int i = 0; i < 6; i++) {
      if (high - low <= 1) break;
      int middle = (low + high) / 2;
      if (northFraction >= uCoverageRows[middle]) low = middle;
      else high = middle;
    }
    return texture2D(uCoverage, vec2((floor(uv.x*uCoverageSize)+0.5)/uCoverageSize,
      (float(low)+0.5)/uCoverageSize)).r > 0.5;
  }
`

/** Matches the worker's (a,d,b), (b,d,e) triangle diagonal exactly. */
export function sampleTerrainTriangles(heights: Float32Array, size: number, u: number, v: number): number {
  const x = Math.min(Math.max(u, 0), 1) * (size - 1)
  const y = Math.min(Math.max(v, 0), 1) * (size - 1)
  const col = Math.min(Math.floor(x), size - 2), row = Math.min(Math.floor(y), size - 2)
  const tx = x - col, ty = y - row
  const a = heights[row * size + col]!, b = heights[row * size + col + 1]!
  const d = heights[(row + 1) * size + col]!, e = heights[(row + 1) * size + col + 1]!
  return tx + ty <= 1 ? a + tx * (b - a) + ty * (d - a)
    : e + (1 - tx) * (d - e) + (1 - ty) * (b - e)
}
