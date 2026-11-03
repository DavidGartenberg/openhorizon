/**
 * Dynamic resolution: scales the renderer's pixel ratio to hold a frame-time
 * target. Pixel cost is the dominant GPU load (terrain, clouds, ocean and
 * every material shade once per pixel), so a 0.8× scale removes ~36% of it
 * with little visible loss, and the controller only gives up resolution
 * when it must.
 *
 * Input is the frame-to-frame (rAF) interval, which includes GPU time. Over
 * budget (smoothed interval > 1.15 × target, after a hold time) the scale
 * drops in proportion to the overrun (bounded 0.7–0.92 per step). When frames
 * are on budget for three hold times, it probes back up 8%. A probe that
 * pushes frames over budget within three hold times blocks further probes
 * for 20 s, so it does not oscillate. Stalls over a second (background tabs,
 * long pauses) are ignored; a genuinely slow machine (4–8 fps) still adapts.
 */
export class AdaptiveResolution {
  scale = 1
  enabled = true
  private ema: number | null = null
  private lastChangeMs = -Infinity
  private goodSinceMs: number | null = null
  private blockUpUntilMs = -Infinity
  private lastUpAtMs = -Infinity

  constructor(public targetMs = 1000 / 60, public minScale = 0.5, public maxScale = 1, private readonly holdMs = 1000) {}

  /** Smoothed frame interval (ms), or null before the first sample. */
  get smoothedMs(): number | null { return this.ema }

  /** Feed one rAF interval (ms). Returns the new scale when it changes. */
  sample(frameMs: number, nowMs: number): number | null {
    if (!this.enabled || !(frameMs > 0) || frameMs > 1000) return null
    this.ema = this.ema === null ? frameMs : this.ema + 0.08 * (frameMs - this.ema)
    if (nowMs - this.lastChangeMs < this.holdMs) return null
    const t = this.targetMs
    if (this.ema > t * 1.15 && this.scale > this.minScale) {
      if (nowMs - this.lastUpAtMs < this.holdMs * 3) this.blockUpUntilMs = nowMs + 20_000
      const k = Math.max(0.7, Math.min(0.92, t / this.ema))
      return this.set(this.scale * k, nowMs)
    }
    if (this.ema <= t * 1.04) {
      this.goodSinceMs ??= nowMs
      if (this.scale < this.maxScale && nowMs - this.goodSinceMs >= this.holdMs * 3 && nowMs >= this.blockUpUntilMs) {
        this.lastUpAtMs = nowMs
        return this.set(this.scale * 1.08, nowMs)
      }
    } else {
      this.goodSinceMs = null
    }
    return null
  }

  /** Back to full resolution (e.g. when the user turns the feature off). */
  reset(): void {
    this.scale = 1
    this.ema = null
    this.goodSinceMs = null
    this.blockUpUntilMs = -Infinity
    this.lastChangeMs = -Infinity
  }

  private set(s: number, nowMs: number): number | null {
    const next = Math.round(Math.min(this.maxScale, Math.max(this.minScale, s)) * 100) / 100
    if (next === this.scale) return null
    this.scale = next
    this.lastChangeMs = nowMs
    this.goodSinceMs = null
    this.ema = null
    return next
  }
}
