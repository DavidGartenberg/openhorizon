/**
 * Frame pacing: "vsync" (the browser's requestAnimationFrame, locked to the
 * display's refresh) or "uncapped" (a loop that renders as fast as the machine
 * allows, up to a ceiling).
 *
 * A web page cannot switch off the display's vsync — the browser presents at the
 * monitor's refresh rate. What the page controls is whether its render loop is
 * TIED to that rate. Uncapped decouples it, so the frame on screen at each
 * refresh was rendered as late (as fresh) as possible and the measured FPS is the
 * true render rate. The price is power and heat, so it has a ceiling and it
 * stands down while the tab is hidden (a hidden tab's timers are throttled, and
 * a message-driven loop would otherwise spin at full speed unseen).
 *
 * Pure given its injected scheduling functions — unit-tested with fakes.
 */

export type FrameMode = 'vsync' | 'uncapped'

/** The uncapped loop never renders faster than this (frames per second). */
export const UNCAPPED_MAX_FPS = 360

export interface PacerDeps {
  /** requestAnimationFrame */
  raf(cb: (t: number) => void): number
  cancelRaf(id: number): void
  /** A macrotask that is not subject to timer clamping (MessageChannel). */
  post(cb: () => void): void
  /** setTimeout, for waiting out the part of a frame interval above 1 ms. */
  delay(ms: number, cb: () => void): void
  /** performance.now() */
  now(): number
  /** document.hidden */
  hidden(): boolean
}

export function isFrameMode(v: unknown): v is FrameMode {
  return v === 'vsync' || v === 'uncapped'
}

export class FramePacer {
  private generation = 0
  private rafId: number | undefined
  private lastRender = -Infinity
  private running = false
  private parked = false
  private readonly minIntervalMs = 1000 / UNCAPPED_MAX_FPS

  constructor(
    private readonly deps: PacerDeps,
    private mode: FrameMode,
    private readonly onFrame: (now: number) => void,
  ) {}

  get currentMode(): FrameMode { return this.mode }

  start(): void {
    if (this.running) return
    this.running = true
    this.schedule()
  }

  setMode(mode: FrameMode): void {
    if (mode === this.mode) return
    this.mode = mode
    if (!this.running) return
    this.cancelPending()
    this.schedule()
  }

  /** Call from the page's visibilitychange handler: the uncapped loop parks
   *  while hidden and resumes here. (rAF pauses and resumes on its own.) */
  visibilityChanged(): void {
    if (this.running && this.mode === 'uncapped' && this.parked && !this.deps.hidden()) {
      this.parked = false
      this.schedule()
    }
  }

  stop(): void {
    this.running = false
    this.cancelPending()
  }

  private cancelPending(): void {
    ++this.generation
    if (this.rafId !== undefined) this.deps.cancelRaf(this.rafId)
    this.rafId = undefined
    this.parked = false
  }

  private schedule(): void {
    const token = this.generation
    if (this.mode === 'vsync') {
      this.rafId = this.deps.raf((t) => {
        if (token !== this.generation) return
        this.rafId = undefined
        try { this.onFrame(t) } finally { if (token === this.generation && this.running) this.schedule() }
      })
      return
    }
    // Never render inside start()/setMode(): always go through the message queue.
    this.deps.post(() => this.uncappedStep(token))
  }

  private uncappedStep(token: number): void {
    if (token !== this.generation || !this.running) return
    if (this.deps.hidden()) { this.parked = true; return }
    const now = this.deps.now()
    const wait = this.minIntervalMs - (now - this.lastRender)
    if (wait > 1) { this.deps.delay(wait - 1, () => this.uncappedStep(token)); return }
    if (wait > 0) { this.deps.post(() => this.uncappedStep(token)); return }
    this.lastRender = now
    try { this.onFrame(now) } finally {
      if (token === this.generation && this.running) this.deps.post(() => this.uncappedStep(token))
    }
  }
}

/** The real browser's scheduling primitives. */
export function browserPacerDeps(): PacerDeps {
  const channel = new MessageChannel()
  const queue: Array<() => void> = []
  channel.port1.onmessage = () => { const cb = queue.shift(); cb?.() }
  return {
    raf: (cb) => requestAnimationFrame(cb),
    cancelRaf: (id) => cancelAnimationFrame(id),
    post: (cb) => { queue.push(cb); channel.port2.postMessage(0) },
    delay: (ms, cb) => { setTimeout(cb, ms) },
    now: () => performance.now(),
    hidden: () => document.hidden,
  }
}
