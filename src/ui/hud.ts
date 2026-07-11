/**
 * Debug HUD: FPS, frame time, sim clock, sim rate, camera state, sun angle.
 * Also exposes `window.__oh` so automated browser verification can read the
 * same numbers the user sees.
 */

export interface HudStats {
  simDate: Date
  simRate: number
  cameraAltM: number
  cameraSpeedMs: number
  sunElevationDeg: number
}

declare global {
  interface Window {
    __oh?: { fps: number; frameMs: number; ticks: number }
  }
}

export class Hud {
  private readonly el: HTMLElement
  private frames = 0
  private windowStart = performance.now()
  private fps = 0
  private frameMs = 0

  constructor() {
    const el = document.getElementById('hud')
    if (!el) throw new Error('missing #hud element')
    this.el = el
    window.__oh = { fps: 0, frameMs: 0, ticks: 0 }
  }

  update(stats: HudStats, ticks: number): void {
    this.frames += 1
    const now = performance.now()
    const windowMs = now - this.windowStart
    if (windowMs >= 500) {
      this.fps = (this.frames * 1000) / windowMs
      this.frameMs = windowMs / this.frames
      this.frames = 0
      this.windowStart = now
      window.__oh = { fps: this.fps, frameMs: this.frameMs, ticks }

      const rate = stats.simRate === 0 ? 'PAUSED' : `${stats.simRate}x`
      this.el.textContent =
        `OpenHorizon — Phase 0\n` +
        `${this.fps.toFixed(0)} fps  (${this.frameMs.toFixed(1)} ms)\n` +
        `sim ${formatUTC(stats.simDate)}  [${rate}]\n` +
        `sun ${stats.sunElevationDeg >= 0 ? '+' : ''}${stats.sunElevationDeg.toFixed(1)}°\n` +
        `cam ${stats.cameraAltM.toFixed(0)} m  spd ${stats.cameraSpeedMs.toFixed(0)} m/s\n` +
        `drag look · WASD/RF move · wheel spd · Space pause · 1/2/3 rate · [ ] time`
    }
  }
}

function formatUTC(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`
}
