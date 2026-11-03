/**
 * Frame clock (sim/frame-clock.ts): rAF drives a visible page however slow;
 * the metronome steps only a hidden tab. On a machine slower than 400 ms a
 * frame the metronome used to step visible pages between rAF callbacks,
 * doubling the main thread's load and handing the dynamic-resolution
 * controller zero or negative frame times.
 */
import { describe, expect, it } from 'vitest'
import { metronomeStepS, rafIntervalMs } from '../src/sim/frame-clock'
import { AdaptiveResolution } from '../src/render/adaptive-resolution'

describe('frame clock', () => {
  it('never steps a visible page from the metronome, however slow its frames', () => {
    // 1.3 s since the last rAF callback began (a slow software-GL frame).
    expect(metronomeStepS(10_000, 8_700, 8_700, true)).toBeNull()
    expect(metronomeStepS(10_000, 0, 0, true)).toBeNull()
  })

  it('steps a hidden tab near real time, capped at a second', () => {
    expect(metronomeStepS(10_000, 9_800, 9_500, false)).toBeNull() // rAF ran 200 ms ago
    expect(metronomeStepS(10_000, 9_000, 9_500, false)).toBeCloseTo(0.5, 9)
    expect(metronomeStepS(10_000, 0, 0, false)).toBe(1) // after an OS sleep: resume, don't fast-forward
    expect(metronomeStepS(10_000, 9_000, 9_900, false)).toBeNull() // too soon after the last step
  })

  it('a rAF interval is never negative', () => {
    expect(rafIntervalMs(1_000, 1_020)).toBe(0)
    expect(rafIntervalMs(1_300, 1_000)).toBe(300)
  })

  it('a slow visible page now feeds the controller real frame times, and it adapts', () => {
    // 0.8 fps software GL: every rAF interval is a whole frame, nothing else steps.
    const ar = new AdaptiveResolution()
    let t = 0, last = 0
    for (let i = 0; i < 40; i++) {
      t += 400 + 1600 * ar.scale * ar.scale * (ar.lite ? 0.6 : 1)
      ar.sample(rafIntervalMs(t, last), t)
      last = t
    }
    expect(ar.scale).toBe(0.5)
    expect(ar.lite).toBe(true)
  })
})
