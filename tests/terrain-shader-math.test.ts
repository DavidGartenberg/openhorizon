/**
 * The terrain shader's relief normal comes from an analytic gradient of its
 * band-limited fBm (one pass instead of three finite-difference fBm calls),
 * and the rock/scree noise is skipped on near-flat ground below any snow
 * line. A JavaScript mirror of the GLSL (column-major mat2, fract/floor)
 * checks the math: the gradient matches finite differences, and the skip
 * relies on a bound (|fbm| < 0.4844) the noise really keeps.
 */
import { describe, expect, it } from 'vitest'
import { TERRAIN_FRAG } from '../src/world/terrain-shader'

const fract = (x: number): number => x - Math.floor(x)
function hash(px: number, py: number): number {
  let x = fract(px * 0.1031), y = fract(py * 0.1031), z = fract(px * 0.1031)
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33)
  x += d; y += d; z += d
  return fract((x + y) * z)
}
function noise(px: number, py: number): number {
  const ix = Math.floor(px), iy = Math.floor(py)
  let fx = px - ix, fy = py - iy
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1)
  const ab = a + (b - a) * fx, cd = c + (d - c) * fx
  return ab + (cd - ab) * fy
}
function noiseD(px: number, py: number): [number, number, number] {
  const ix = Math.floor(px), iy = Math.floor(py)
  const fx = px - ix, fy = py - iy
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
  const dux = 6 * fx * (1 - fx), duy = 6 * fy * (1 - fy)
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1)
  const k = a - b - c + d
  return [a + (b - a) * ux + (c - a) * uy + k * ux * uy, dux * (b - a + k * uy), duy * (c - a + k * ux)]
}
// GLSL mat2(0.8,-0.6,0.6,0.8): columns (0.8,-0.6) and (0.6,0.8).
const R = [0.8, -0.6, 0.6, 0.8]
const mul = (m: number[], x: number, y: number): [number, number] => [m[0]! * x + m[2]! * y, m[1]! * x + m[3]! * y]
const w = (fp: number, f: number): number => { const t = Math.min(Math.max((fp * f - 0.25) / 0.35, 0), 1); return 1 - t * t * (3 - 2 * t) }
function fbmBL(px: number, py: number, fp: number, f0: number, octaves = 5): number {
  let f = f0, a = 0.5, s = 0, qx = px, qy = py
  for (let i = 0; i < 5; i++) {
    const wi = w(fp, f)
    if (wi <= 0 || i >= octaves) break
    s += a * wi * (noise(qx * f, qy * f) - 0.5)
    ;[qx, qy] = mul(R, qx, qy); qx += 31.7; qy += 17.3
    f *= 2.03; a *= 0.5
  }
  return s
}
function fbmBLgrad(px: number, py: number, fp: number, f0: number, octaves = 5): [number, number] {
  let f = f0, a = 0.5, gx = 0, gy = 0, qx = px, qy = py
  let J = [1, 0, 0, 1]
  for (let i = 0; i < 5; i++) {
    const wi = w(fp, f)
    if (wi <= 0 || i >= octaves) break
    const n = noiseD(qx * f, qy * f)
    gx += a * wi * f * (J[0]! * n[1] + J[1]! * n[2]) // dot(J[0], grad)
    gy += a * wi * f * (J[2]! * n[1] + J[3]! * n[2]) // dot(J[1], grad)
    ;[qx, qy] = mul(R, qx, qy); qx += 31.7; qy += 17.3
    const c0 = mul(R, J[0]!, J[1]!), c1 = mul(R, J[2]!, J[3]!)
    J = [c0[0], c0[1], c1[0], c1[1]]
    f *= 2.03; a *= 0.5
  }
  return [gx, gy]
}

describe('terrain shader math (JS mirror of the GLSL)', () => {
  it('the analytic fBm gradient matches finite differences of the same fBm', () => {
    let worst = 0
    for (let k = 0; k < 400; k++) {
      const px = 1000 * Math.sin(k * 12.9898) + 37.1 * k, py = 1000 * Math.cos(k * 78.233) - 11.3 * k
      const fp = 0.02 + (k % 7) * 0.05
      const [gx, gy] = fbmBLgrad(px, py, fp, 1 / 26)
      const h = 1e-4
      const fx = (fbmBL(px + h, py, fp, 1 / 26) - fbmBL(px - h, py, fp, 1 / 26)) / (2 * h)
      const fy = (fbmBL(px, py + h, fp, 1 / 26) - fbmBL(px, py - h, fp, 1 / 26)) / (2 * h)
      const scale = Math.max(Math.hypot(fx, fy), 1e-3)
      worst = Math.max(worst, Math.hypot(gx - fx, gy - fy) / scale)
    }
    expect(worst).toBeLessThan(1e-3)
  })

  it('|fbmBL| stays under the 0.4844 bound the rock/snow skip relies on', () => {
    let max = 0
    for (let k = 0; k < 20_000; k++) max = Math.max(max, Math.abs(fbmBL(k * 3.7 - 9000, k * 1.9 + 400, 0.01, 1 / 70)))
    expect(max).toBeLessThan(0.4844)
    // At the skip's edge: slope 0.005 + 0.34·0.4844 < 0.17, so rock is exactly 0;
    // and the lowest snow line (2850 − 520·0.4844) − 120 − 260·0.4844 > 2350 m.
    expect(0.005 + 0.34 * 0.4844).toBeLessThan(0.17)
    expect(2850 - 520 * 0.4844 - 120 - 260 * 0.4844).toBeGreaterThan(2350)
  })

  it('the shader uses one gradient pass for the relief and skips rock noise only under that condition', () => {
    expect(TERRAIN_FRAG).toContain('fbmBLgrad(ground,footprint,1.0/26.0)')
    expect(TERRAIN_FRAG).not.toContain('float hx = fbmBL')
    expect(TERRAIN_FRAG).toMatch(/needRock = slope > 0\.005 \|\| vAltitude > 2350\.0/)
    // The lite tier is a separate program with the fBm code compiled out.
    expect(TERRAIN_FRAG).toMatch(/#ifndef TERRAIN_LITE\s+float fbmBL/)
  })
})
