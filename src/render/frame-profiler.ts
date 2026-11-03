/**
 * Frame profiler (plan step 16): splits each frame's main-thread time into
 * sections by marks — `start()` at the top of the frame, `mark(name)` after
 * each stage charges the time since the previous mark to that stage. Each
 * section is an exponentially smoothed millisecond figure. Exposed as
 * `__ohProfile()` and the PERF overlay. GPU time is not visible from the
 * main thread (see the rAF interval / frame-rate controller for that).
 */
export class FrameProfiler {
  private last = 0
  private readonly ms = new Map<string, number>()

  start(now = performance.now()): void {
    this.last = now
  }

  mark(name: string, now = performance.now()): void {
    const dt = now - this.last
    this.last = now
    const prev = this.ms.get(name)
    this.ms.set(name, prev === undefined ? dt : prev + 0.05 * (dt - prev))
  }

  /** Sections by smoothed cost, highest first. */
  report(): Array<{ section: string; ms: number }> {
    return [...this.ms.entries()].map(([section, ms]) => ({ section, ms })).sort((a, b) => b.ms - a.ms)
  }

  totalMs(): number {
    let t = 0
    for (const v of this.ms.values()) t += v
    return t
  }
}
