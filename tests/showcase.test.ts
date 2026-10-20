import { describe, expect, it } from 'vitest'
import { SHOT_SECONDS, showcaseShot } from '../src/render/showcase'

describe('showcase camera', () => {
  it('is deterministic and stays in a sane framing envelope for a long time', () => {
    for (let t = 0; t < 600; t += 0.37) {
      const a = showcaseShot(t), b = showcaseShot(t)
      expect(a).toEqual(b)
      expect(a.elevation).toBeGreaterThan(0.02)
      expect(a.elevation).toBeLessThan(0.75)
      expect(a.distanceScale).toBeGreaterThan(0.5)
      expect(a.distanceScale).toBeLessThan(1.4)
      expect(Number.isFinite(a.azimuth)).toBe(true)
    }
  })

  it('never jumps: the pose moves only a little between nearby instants, including across shot changes', () => {
    const wrap = (d: number): number => Math.abs(((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
    let prev = showcaseShot(0)
    for (let t = 0.05; t < SHOT_SECONDS * 8; t += 0.05) {
      const s = showcaseShot(t)
      expect(wrap(s.azimuth - prev.azimuth), `azimuth at ${t.toFixed(2)}s`).toBeLessThan(0.08)
      expect(Math.abs(s.elevation - prev.elevation), `elevation at ${t.toFixed(2)}s`).toBeLessThan(0.05)
      expect(Math.abs(s.distanceScale - prev.distanceScale), `distance at ${t.toFixed(2)}s`).toBeLessThan(0.05)
      prev = s
    }
  })

  it('actually changes viewpoint from shot to shot', () => {
    const a = showcaseShot(2), b = showcaseShot(SHOT_SECONDS + 2), c = showcaseShot(2 * SHOT_SECONDS + 2)
    expect(Math.abs(a.elevation - b.elevation) + Math.abs(a.distanceScale - b.distanceScale)).toBeGreaterThan(0.2)
    expect(Math.abs(b.elevation - c.elevation) + Math.abs(b.distanceScale - c.distanceScale)).toBeGreaterThan(0.2)
  })

  it('treats negative time as the start', () => {
    expect(showcaseShot(-5)).toEqual(showcaseShot(0))
  })
})
