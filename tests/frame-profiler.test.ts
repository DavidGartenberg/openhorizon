import { describe, expect, it } from 'vitest'
import { FrameProfiler } from '../src/render/frame-profiler'

describe('frame profiler', () => {
  it('charges the time between marks to each section and ranks them', () => {
    const p = new FrameProfiler()
    for (let f = 0; f < 200; f++) {
      const t0 = f * 20
      p.start(t0)
      p.mark('physics', t0 + 2)
      p.mark('scene', t0 + 3)
      p.mark('render', t0 + 9)
    }
    const r = p.report()
    expect(r.map((x) => x.section)).toEqual(['render', 'physics', 'scene'])
    expect(r[0]!.ms).toBeCloseTo(6, 6)
    expect(p.totalMs()).toBeCloseTo(9, 6)
  })
})
