/**
 * Flight info panel: flight data + performance in the shell's style (a
 * compact glass panel, labelled tiles). Every number is read from the
 * simulation state — nothing is synthesized for display (§1). Exposes
 * `window.__oh` for automated browser verification. The keyboard list
 * lives in the shell's Help window.
 */
import type { FlightData } from '../sim/aircraft'

export interface HudStats {
  /** Fleet (11g): active aircraft label, gear state text, jet FF kg/h. */
  aircraftLabel?: string
  gear?: string
  ffKgH?: number
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
  /** Copilot callout line (Slice 4) — own slot, never the safety line. */
  copilot?: string
  /** Live-traffic status (Slice 6): count, or an honest STALE/NO FEED. */
  tfc?: string
  /** Stability assist mode label ('SAS' / 'ASSIST FULL'); absent = off. */
  assist?: string
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

/** Tile ids in display order: [id, label]. */
const TILES: ReadonlyArray<readonly [string, string]> = [
  ['ias', 'IAS'], ['alt', 'ALT'], ['vs', 'V/S'], ['hdg', 'HDG'],
  ['agl', 'AGL'], ['pwr', 'POWER'], ['ff', 'FUEL FLOW'], ['thr', 'THROTTLE'],
  ['flaps', 'FLAPS'], ['gear', 'GEAR'], ['trim', 'TRIM'], ['aoa', 'AOA · G'],
]

export class Hud {
  private readonly el: HTMLElement
  private frames = 0
  private windowStart = performance.now()
  private fps = 0
  private frameMs = 0
  private readonly cells = new Map<string, HTMLElement>()
  private readonly title: HTMLElement
  private readonly clock: HTMLElement
  private readonly alert: HTMLElement
  private readonly copilot: HTMLElement
  private readonly foot: HTMLElement

  constructor() {
    const el = document.getElementById('hud')
    if (!el) throw new Error('missing #hud element')
    this.el = el
    el.classList.add('oh-ui')
    el.textContent = ''
    const head = document.createElement('div')
    head.className = 'oh-fi-head'
    this.title = document.createElement('b')
    this.clock = document.createElement('span')
    head.append(this.title, this.clock)
    this.alert = document.createElement('div')
    this.alert.className = 'oh-fi-alert'
    this.alert.hidden = true
    const grid = document.createElement('div')
    grid.className = 'oh-fi-grid'
    for (const [id, label] of TILES) {
      const cell = document.createElement('div')
      cell.className = 'oh-fi-cell'
      const l = document.createElement('span')
      l.textContent = label
      const v = document.createElement('b')
      cell.append(l, v)
      grid.appendChild(cell)
      this.cells.set(id, v)
    }
    this.copilot = document.createElement('div')
    this.copilot.className = 'oh-fi-co'
    this.copilot.hidden = true
    this.foot = document.createElement('div')
    this.foot.className = 'oh-fi-foot'
    el.append(head, this.alert, grid, this.copilot, this.foot)
  }

  get visible(): boolean { return !this.el.hidden }
  set visible(v: boolean) { this.el.hidden = !v }

  private set(id: string, value: string, unit = ''): void {
    const c = this.cells.get(id)
    if (!c) return
    if (c.firstChild?.nodeValue === value && (c.lastChild as HTMLElement | null)?.textContent === unit) return
    c.textContent = value
    if (unit) { const u = document.createElement('small'); u.textContent = unit; c.appendChild(u) }
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
    if (this.el.hidden) return

    const rate = stats.simRate === 0 ? 'PAUSED' : `${stats.simRate}×`
    this.title.textContent = `${stats.aircraftLabel ?? 'C172S'} · ${stats.spawnDesc}`
    this.clock.textContent = `${formatUTC(stats.simDate)} · ${rate}`
    const jet = f.n1Pct > 0
    this.set('ias', f.kias.toFixed(0), 'kt')
    this.set('alt', f.altitudeFt.toFixed(0), 'ft')
    this.set('vs', `${f.verticalSpeedFpm >= 0 ? '+' : ''}${f.verticalSpeedFpm.toFixed(0)}`, 'fpm')
    this.set('hdg', `${String(Math.round(((f.headingDeg % 360) + 360) % 360)).padStart(3, '0')}°`)
    this.set('agl', f.onGround ? 'GND' : f.aglFt.toFixed(0), f.onGround ? '' : 'ft')
    this.set('pwr', jet ? f.n1Pct.toFixed(1) : f.rpm.toFixed(0), jet ? '% N1' : 'rpm')
    this.set('ff', jet ? (stats.ffKgH ?? 0).toFixed(0) : f.fuelFlowGph.toFixed(1), jet ? 'kg/h' : 'gph')
    this.set('thr', (stats.throttlePct * 100).toFixed(0), '%')
    this.set('flaps', f.flapsDeg.toFixed(0), '°')
    this.set('gear', stats.gear ?? 'FIXED')
    this.set('trim', `${stats.trimPct >= 0 ? '+' : ''}${(stats.trimPct * 100).toFixed(0)}`, '%')
    this.set('aoa', `${f.alphaDeg.toFixed(1)}° · ${f.loadFactorG.toFixed(1)}`, 'g')
    const stall = f.stallFraction > 0.35
    const alertText = stats.safety ?? (stall ? 'STALL' : '')
    this.alert.hidden = !alertText
    this.alert.textContent = alertText
    this.alert.classList.toggle('red', stall || /PULL UP|TERRAIN|CRASH|STARV|QUIT/i.test(alertText))
    this.copilot.hidden = !stats.copilot
    this.copilot.textContent = stats.copilot ? `First officer: ${stats.copilot}` : ''
    this.foot.textContent =
      `${stats.lat.toFixed(4)}, ${stats.lon.toFixed(4)}${stats.wx ? ` · ${stats.wx}` : ''}${stats.tfc ? ` · ${stats.tfc}` : ''}` +
      ` · ${this.fps.toFixed(0)} fps · ${stats.cameraMode} view${stats.assist ? ` · ${stats.assist}` : ''}`
  }
}

function formatUTC(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`
}
