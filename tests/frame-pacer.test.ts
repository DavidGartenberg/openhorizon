import { describe, expect, it } from 'vitest'
import { FramePacer, UNCAPPED_MAX_FPS, isFrameMode, type PacerDeps } from '../src/render/frame-pacer'

/** A deterministic scheduler: nothing runs until the test pumps it. */
function fakeDeps() {
  const rafs = new Map<number, (t: number) => void>()
  const posts: Array<() => void> = []
  const delays: Array<{ at: number; cb: () => void }> = []
  let id = 0
  const s: {
    t: number; hidden: boolean; cancelled: number[]; deps: PacerDeps
    refresh(): void; pump(): void; readonly pendingRaf: number; readonly pendingPosts: number
  } = {
    t: 0,
    hidden: false,
    cancelled: [],
    deps: {
      raf: (cb) => { rafs.set(++id, cb); return id },
      cancelRaf: (i) => { s.cancelled.push(i); rafs.delete(i) },
      post: (cb) => { posts.push(cb) },
      delay: (ms, cb) => { delays.push({ at: s.t + ms, cb }) },
      now: () => s.t,
      hidden: () => s.hidden,
    } as PacerDeps,
    /** One display refresh: run every pending rAF callback. */
    refresh(): void { const cbs = [...rafs.values()]; rafs.clear(); for (const cb of cbs) cb(s.t) },
    /** Run all currently queued messages and any due timers once. */
    pump(): void {
      const due = delays.filter((d) => d.at <= s.t); for (const d of due) delays.splice(delays.indexOf(d), 1)
      for (const d of due) d.cb()
      const run = posts.splice(0); for (const cb of run) cb()
    },
    get pendingRaf(): number { return rafs.size },
    get pendingPosts(): number { return posts.length },
  }
  return s
}

describe('vsync mode', () => {
  it('renders once per display refresh and reschedules itself', () => {
    const f = fakeDeps(); const frames: number[] = []
    const p = new FramePacer(f.deps, 'vsync', (t) => frames.push(t))
    p.start()
    for (let i = 1; i <= 5; i++) { f.t = i * 16.7; f.refresh() }
    expect(frames).toHaveLength(5)
    expect(f.pendingRaf).toBe(1) // always one armed
  })
  it('never uses the uncapped message loop', () => {
    const f = fakeDeps(); const p = new FramePacer(f.deps, 'vsync', () => {})
    p.start(); f.refresh(); f.pump()
    expect(f.pendingPosts).toBe(0)
  })
})

describe('uncapped mode', () => {
  it('start() only schedules; it never renders re-entrantly', () => {
    const f = fakeDeps(); let frames = 0
    const p = new FramePacer(f.deps, 'uncapped', () => { frames++ })
    p.start(); expect(frames).toBe(0); expect(f.pendingPosts).toBe(1)
  })
  it('renders far more often than a 60 Hz display would, but never above the ceiling', () => {
    const f = fakeDeps(); let frames = 0
    const p = new FramePacer(f.deps, 'uncapped', () => { frames++ })
    p.start()
    // Simulate one second in 0.25 ms ticks of scheduler time.
    for (let tick = 0; tick < 4000; tick++) { f.t = tick * 0.25; f.pump() }
    expect(frames).toBeGreaterThan(300) // far above 60
    expect(frames).toBeLessThanOrEqual(UNCAPPED_MAX_FPS + 1) // and capped
  })
  it('passes the real clock to the frame callback, not a rAF stamp', () => {
    const f = fakeDeps(); const stamps: number[] = []
    const p = new FramePacer(f.deps, 'uncapped', (t) => stamps.push(t))
    f.t = 1000; p.start(); f.pump()
    expect(stamps[0]).toBe(1000)
  })
  it('does not render twice inside the minimum interval', () => {
    const f = fakeDeps(); let frames = 0
    const p = new FramePacer(f.deps, 'uncapped', () => { frames++ })
    p.start(); f.t = 0; f.pump(); f.t = 0.5; f.pump(); f.pump()
    expect(frames).toBe(1)
  })
  it('parks while the tab is hidden and resumes on visibilityChanged', () => {
    const f = fakeDeps(); let frames = 0
    const p = new FramePacer(f.deps, 'uncapped', () => { frames++ })
    p.start(); f.t = 10; f.pump()
    expect(frames).toBe(1)
    f.hidden = true
    for (let i = 0; i < 10; i++) { f.t += 10; f.pump() }
    expect(frames).toBe(1) // the in-flight step saw the hidden tab and parked: no more frames
    expect(f.pendingPosts).toBe(0) // nothing spinning in the background
    f.hidden = false; p.visibilityChanged(); f.t += 10; f.pump()
    expect(frames).toBe(2)
  })
  it('starting while already hidden renders nothing until visible', () => {
    const f = fakeDeps(); let frames = 0; f.hidden = true
    const p = new FramePacer(f.deps, 'uncapped', () => { frames++ })
    p.start(); f.pump(); expect(frames).toBe(0)
    f.hidden = false; p.visibilityChanged(); f.t = 5; f.pump(); expect(frames).toBe(1)
  })
})

describe('mode switching and lifecycle', () => {
  it('switching from vsync to uncapped cancels the pending rAF so nothing double-renders', () => {
    const f = fakeDeps(); let frames = 0
    const p = new FramePacer(f.deps, 'vsync', () => { frames++ })
    p.start(); expect(f.pendingRaf).toBe(1)
    p.setMode('uncapped')
    expect(f.pendingRaf).toBe(0); expect(f.cancelled).toHaveLength(1)
    f.refresh(); expect(frames).toBe(0)
    f.t = 3; f.pump(); expect(frames).toBe(1)
  })
  it('switching from uncapped to vsync silences the stale message loop', () => {
    const f = fakeDeps(); let frames = 0
    const p = new FramePacer(f.deps, 'uncapped', () => { frames++ })
    p.start(); f.t = 1; f.pump(); expect(frames).toBe(1)
    p.setMode('vsync')
    f.t = 10; f.pump(); f.pump() // old message-loop callbacks must do nothing
    expect(frames).toBe(1)
    f.refresh(); expect(frames).toBe(2)
  })
  it('setMode to the same mode is a no-op', () => {
    const f = fakeDeps(); const p = new FramePacer(f.deps, 'vsync', () => {})
    p.start(); p.setMode('vsync'); expect(f.cancelled).toHaveLength(0); expect(f.pendingRaf).toBe(1)
  })
  it('a throwing frame does not stop the loop', () => {
    const f = fakeDeps(); let calls = 0
    const p = new FramePacer(f.deps, 'vsync', () => { calls++; throw new Error('bad frame') })
    p.start()
    expect(() => f.refresh()).toThrow('bad frame')
    expect(f.pendingRaf).toBe(1) // re-armed despite the throw
    expect(() => f.refresh()).toThrow(); expect(calls).toBe(2)
  })
  it('stop halts both loops; start after stop works', () => {
    const f = fakeDeps(); let frames = 0
    const p = new FramePacer(f.deps, 'uncapped', () => { frames++ })
    p.start(); f.t = 1; f.pump(); p.stop(); f.t = 5; f.pump(); expect(frames).toBe(1)
    p.start(); f.t = 9; f.pump(); expect(frames).toBe(2)
  })
  it('isFrameMode accepts only the two modes', () => {
    expect(isFrameMode('vsync')).toBe(true); expect(isFrameMode('uncapped')).toBe(true)
    expect(isFrameMode('60')).toBe(false); expect(isFrameMode(null)).toBe(false); expect(isFrameMode(undefined)).toBe(false)
  })
})
