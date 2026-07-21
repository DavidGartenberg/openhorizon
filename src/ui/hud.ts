/**
 * Debug HUD: flight data + performance. Every number is read from the
 * simulation state — nothing is synthesized for display (§1). Exposes
 * `window.__oh` for automated browser verification.
 */
import type { FlightData } from '../sim/aircraft'

export interface HudStats {
  simDate: Date
  simRate: number
  flight: FlightData
  throttlePct: number
  trimPct: number
  cameraMode: string
  tilesReady: number
  /** Live-weather one-liner (nearest station + wind/vis/clouds), if loaded. */
  wx?: string
  /** Active TCAS/TAWS annunciation, if any. */
  safety?: string
  spawnDesc: string
  lat: number
  lon: number
}

declare global {
  interface Window {
    __oh?: {
      fps: number
      frameMs: number
      ticks: number
      ias: number
      alt: number
      vs: number
      rpm: number
      aoa: number
      stall: number
      onGround: boolean
    }
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
  }

  update(stats: HudStats, ticks: number): void {
    this.frames += 1
    const now = performance.now()
    const windowMs = now - this.windowStart
    if (windowMs < 250) return
    this.fps = (this.frames * 1000) / windowMs
    this.frameMs = windowMs / this.frames
    this.frames = 0
    this.windowStart = now

    const f = stats.flight
    window.__oh = {
      fps: this.fps,
      frameMs: this.frameMs,
      ticks,
      ias: f.kias,
      alt: f.altitudeFt,
      vs: f.verticalSpeedFpm,
      rpm: f.rpm,
      aoa: f.alphaDeg,
      stall: f.stallFraction,
      onGround: f.onGround,
    }

    const rate = stats.simRate === 0 ? 'PAUSED' : `${stats.simRate}x`
    const stallWarn = f.stallFraction > 0.35 ? '  ⚠ STALL' : ''
    this.el.textContent =
      `OpenHorizon — Phase 2 · C172S · ${stats.spawnDesc}\n` +
      `IAS ${f.kias.toFixed(0).padStart(3)} kt   ALT ${f.altitudeFt.toFixed(0).padStart(5)} ft   ` +
      `AGL ${f.aglFt.toFixed(0).padStart(5)} ft   ` +
      `VS ${f.verticalSpeedFpm >= 0 ? '+' : ''}${f.verticalSpeedFpm.toFixed(0)} fpm\n` +
      `HDG ${f.headingDeg.toFixed(0).padStart(3)}°   RPM ${f.rpm.toFixed(0)}   ` +
      `FF ${f.fuelFlowGph.toFixed(1)} gph${stallWarn}\n` +
      `THR ${(stats.throttlePct * 100).toFixed(0)}%   FLAPS ${f.flapsDeg.toFixed(0)}°   ` +
      `TRIM ${stats.trimPct >= 0 ? '+' : ''}${(stats.trimPct * 100).toFixed(0)}%   ` +
      `AoA ${f.alphaDeg.toFixed(1)}°   ${f.loadFactorG.toFixed(1)}g` +
      `${f.onGround ? '   [GND]' : ''}\n` +
      `${stats.lat.toFixed(4)}, ${stats.lon.toFixed(4)} · tiles ${stats.tilesReady}` +
      `${stats.wx ? ` · wx ${stats.wx}` : ''}${stats.safety ? `\n${stats.safety}` : ''}\n` +
      `${this.fps.toFixed(0)} fps · sim ${formatUTC(stats.simDate)} [${rate}] · cam ${stats.cameraMode}\n` +
      `↑↓←→ fly · A/D rudder · W/S throttle · F/G flaps · ,/. trim · B brakes\n` +
      `/ airport search · C camera · R reset · Space pause · 1/2/3 rate · [ ] time · M mute · O/P save/load`
  }
}

function formatUTC(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`
}
