/**
 * Dynamic resolution: scales the renderer's pixel ratio to hold a frame-time
 * target. Pixel cost is the dominant GPU load (terrain, clouds, ocean and
 * every material shade once per pixel), so a 0.8× scale removes ~36% of it
 * with little visible loss, and the controller only gives up resolution
 * when it must.
 *
 * Input is the frame-to-frame (rAF) interval, which includes GPU time. Each
 * sample is the median of the last five intervals, so one hitch (a shader
 * compiling, a GC pause) moves nothing while a slow machine registers at
 * once. Over budget (smoothed interval > 1.15 × target, after a hold time)
 * the scale drops in proportion to the overrun (bounded 0.7–0.92 per step).
 * When frames are on budget for three hold times, it probes back up 8%. A
 * probe that pushes frames over budget within three hold times blocks
 * further probes for 20 s, so it does not oscillate. Gaps over 5 s (a
 * background tab coming back, a debugger pause) are stalls, not frames.
 *
 * Below the resolution floor: when frames stay over budget at the minimum
 * scale for three hold times, `lite` turns on (the caller drops the terrain
 * to its lite shader tier and coarser mesh detail). Vsync caps the rAF
 * interval, so spare GPU time cannot be seen; turning it off is a probe,
 * like a resolution step up: after ten hold times on budget at full scale.
 * A probe that has to be undone within fifteen hold times blocks the next
 * one for two minutes, doubling each time (up to 16 min).
 */
export class AdaptiveResolution {
  scale = 1
  enabled = true
  /** Over budget even at the floor: run the lite rendering tier. */
  lite = false
  private ema: number | null = null
  private lastChangeMs = -Infinity
  private goodSinceMs: number | null = null
  private blockUpUntilMs = -Infinity
  private lastUpAtMs = -Infinity
  private readonly recent: number[] = []
  private floorSinceMs: number | null = null
  private headroomSinceMs: number | null = null
  private restoredAtMs = -Infinity
  private restoreBlockedUntilMs = -Infinity
  private restoreBlockMs = 120_000

  constructor(public targetMs = 1000 / 60, public minScale = 0.5, public maxScale = 1, private readonly holdMs = 1000) {}

  /** Smoothed frame interval (ms), or null before the first sample. */
  get smoothedMs(): number | null { return this.ema }

  /** Feed one rAF interval (ms). Returns the new scale when it changes
   *  (`lite` may change on any call; compare it after sampling). */
  sample(frameMs: number, nowMs: number): number | null {
    if (!this.enabled || !(frameMs > 0) || frameMs > 5000) return null
    this.recent.push(frameMs)
    if (this.recent.length > 5) this.recent.shift()
    const sorted = [...this.recent].sort((a, b) => a - b)
    const ms = sorted[Math.floor(sorted.length / 2)]!
    this.ema = this.ema === null ? ms : this.ema + 0.08 * (ms - this.ema)
    const t = this.targetMs
    this.ladder(this.ema, nowMs)
    if (nowMs - this.lastChangeMs < this.holdMs) return null
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

  /** The lite tier: on below the floor, off with headroom at full scale. */
  private ladder(ema: number, nowMs: number): void {
    const t = this.targetMs
    if (!this.lite) {
      const stuck = this.scale <= this.minScale && ema > t * 1.15
      if (!stuck) { this.floorSinceMs = null; return }
      this.floorSinceMs ??= nowMs
      if (nowMs - this.floorSinceMs < this.holdMs * 3) return
      this.lite = true
      this.floorSinceMs = null
      this.headroomSinceMs = null
      // A restore that could not hold: wait longer before the next one.
      if (nowMs - this.restoredAtMs < this.holdMs * 15) {
        this.restoreBlockedUntilMs = nowMs + this.restoreBlockMs
        this.restoreBlockMs = Math.min(this.restoreBlockMs * 2, 960_000)
      }
      return
    }
    const roomy = this.scale >= this.maxScale && ema <= t * 1.04
    if (!roomy) { this.headroomSinceMs = null; return }
    this.headroomSinceMs ??= nowMs
    if (nowMs - this.headroomSinceMs < this.holdMs * 10 || nowMs < this.restoreBlockedUntilMs) return
    this.lite = false
    this.headroomSinceMs = null
    this.restoredAtMs = nowMs
    // The heavier tier costs more: measure it afresh.
    this.ema = null
    this.recent.length = 0
  }

  /** Back to full resolution (e.g. when the user turns the feature off). */
  reset(): void {
    this.scale = 1
    this.lite = false
    this.ema = null
    this.recent.length = 0
    this.goodSinceMs = null
    this.blockUpUntilMs = -Infinity
    this.lastChangeMs = -Infinity
    this.floorSinceMs = null
    this.headroomSinceMs = null
    this.restoredAtMs = -Infinity
    this.restoreBlockedUntilMs = -Infinity
    this.restoreBlockMs = 120_000
  }

  private set(s: number, nowMs: number): number | null {
    const next = Math.round(Math.min(this.maxScale, Math.max(this.minScale, s)) * 100) / 100
    if (next === this.scale) return null
    this.scale = next
    this.lastChangeMs = nowMs
    this.goodSinceMs = null
    this.ema = null
    this.recent.length = 0
    return next
  }
}
