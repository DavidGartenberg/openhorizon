/** Cloud shadows: sun-projected footprints of the cloud masses on the ground. */
import { describe, expect, it } from 'vitest'
import { rasterCloudShadows } from '../src/render/cloud-shadows'

const N = 128, HALF = 14_000, TEXEL = (2 * HALF) / N
const one = (x: number, y: number, z: number, r: number) => ({ version: 0, forEachCloud: (fn: (...a: number[]) => void) => fn(x, y, z, r, r * 0.6, r) })
const at = (out: Float32Array, x: number, z: number): number => out[Math.floor((z + HALF) / TEXEL) * N + Math.floor((x + HALF) / TEXEL)]!

describe('cloud shadows', () => {
  it('drops the shadow where the sun projects the cloud: straight down at noon, far off for a low sun', () => {
    const out = new Float32Array(N * N)
    rasterCloudShadows(out, N, HALF, 0, 0, 0, { x: 0, y: 1, z: 0 }, one(0, 1500, 0, 800))
    expect(at(out, 0, 0)).toBeGreaterThan(0.6)
    // Sun 20° up in the west (render frame x = east): the shadow lands east.
    const el = (20 * Math.PI) / 180
    const sun = { x: -Math.cos(el), y: Math.sin(el), z: 0 }
    rasterCloudShadows(out, N, HALF, 0, 0, 0, sun, one(0, 1500, 0, 800))
    const h = 1500 - 0.25 * 480
    const expectX = (Math.cos(el) / Math.sin(el)) * h
    expect(at(out, 0, 0)).toBe(0)
    expect(at(out, expectX, 0)).toBeGreaterThan(0.6)
  })

  it('is darkest at the core, soft at the edge, and lets skylight through', () => {
    const out = new Float32Array(N * N)
    rasterCloudShadows(out, N, HALF, 0, 0, 0, { x: 0, y: 1, z: 0 }, one(0, 1500, 0, 1200))
    expect(at(out, 0, 0)).toBeLessThan(0.8) // never black
    expect(at(out, 800, 0)).toBeLessThan(at(out, 0, 0))
    expect(at(out, 1100, 0)).toBe(0)
  })

  it('casts nothing with the sun down, and overlapping masses multiply their transmission', () => {
    const out = new Float32Array(N * N)
    expect(rasterCloudShadows(out, N, HALF, 0, 0, 0, { x: 0, y: -0.2, z: 0.98 }, one(0, 1500, 0, 800))).toBe(0)
    expect(Math.max(...out)).toBe(0)
    const two = { version: 0, forEachCloud: (fn: (...a: number[]) => void) => { fn(0, 1500, 0, 800, 480, 800); fn(0, 2500, 0, 800, 480, 800) } }
    rasterCloudShadows(out, N, HALF, 0, 0, 0, { x: 0, y: 1, z: 0 }, two)
    const single = 0.72
    expect(at(out, 0, 0)).toBeCloseTo(1 - (1 - single) ** 2, 1)
  })
})
