/**
 * The in-flight shell: an auto-hiding top toolbar whose buttons open
 * floating windows (ATC, camera, nav log, weather & view, fuel & payload,
 * controls, assistance, keys), the flight-info panel toggle, notification
 * cards and the free-flight start screen. Existing panels are re-hosted
 * inside windows rather than rewritten — their logic, ids and hooks stay.
 */
import { installShellTheme } from './theme'
import { ShellWindow } from './window'
import { Toolbar } from './toolbar'
import { Notifier } from './notify'
import type { Launcher } from './launcher'

export type CameraMode = 'chase' | 'orbit' | 'free' | 'cockpit'
export type AssistMode = 'off' | 'sas' | 'full'

export interface ShellDeps {
  launcher: Launcher
  flightInfo: { visible: boolean }
  camera: { get(): CameraMode; set(m: CameraMode): void }
  assist: { get(): AssistMode; set(m: AssistMode): void }
  pause: { paused(): boolean; toggle(): void }
  navLog(): Array<{ ident: string; active: boolean; distNm?: number }>
  /** Existing panel roots to re-host (missing ones are skipped). */
  panels: { conditions?: HTMLElement | null; fuel?: HTMLElement | null; controls?: HTMLElement | null }
  /** ATC elements, in order: transcript, menu, free-text box, voice bar. */
  atc: HTMLElement[]
  keys: ReadonlyArray<readonly [string, string]>
}

/** Strip the fixed-position inline layout a legacy panel carried so it
 *  flows inside its window. */
function rehost(el: HTMLElement, into: HTMLElement): void {
  for (const p of ['position', 'top', 'left', 'right', 'bottom', 'width', 'maxWidth', 'maxHeight', 'zIndex', 'background', 'border', 'borderRadius', 'boxShadow'] as const) el.style[p] = ''
  if (el instanceof HTMLDetailsElement) el.open = true
  into.appendChild(el)
}

export class Shell {
  readonly toolbar: Toolbar
  readonly notifier: Notifier
  readonly windows = new Map<string, ShellWindow>()
  private navBody: HTMLElement | null = null
  private navKey = ''

  constructor(private readonly d: ShellDeps) {
    installShellTheme()
    this.notifier = new Notifier()
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
    const win = (id: string, title: string, iconName: string, width: number, x: number, y: number): ShellWindow => {
      const w = new ShellWindow(id, title, iconName, { width, x, y })
      this.windows.set(id, w)
      return w
    }

    // ATC: transcript, numbered options, free-text transmit, push-to-talk.
    const atc = win('atc', 'ATC', 'atc', 440, 16, 70)
    for (const el of d.atc) {
      el.style.cssText = el.style.cssText.replace(/position:\s*fixed;?|left:[^;]*;?|right:[^;]*;?|bottom:[^;]*;?|top:[^;]*;?|z-index:[^;]*;?|max-width:[^;]*;?|width:[^;]*;?|background:[^;]*;?/g, '')
      el.style.margin = '0 0 10px'
      atc.body.appendChild(el)
    }

    // Camera views.
    const cam = win('camera', 'Camera', 'camera', 300, vw / 2 - 150, 70)
    const camRow = document.createElement('div'); camRow.className = 'oh-l-chips'; camRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px'
    const camButtons: Array<[CameraMode, HTMLButtonElement]> = []
    for (const [m, label] of [['cockpit', 'Cockpit'], ['chase', 'Chase'], ['orbit', 'External'], ['free', 'Drone']] as const) {
      const b = document.createElement('button'); b.className = 'oh-chip'; b.textContent = label
      b.onclick = () => { d.camera.set(m); this.refresh() }
      camRow.appendChild(b); camButtons.push([m, b])
    }
    cam.body.appendChild(camRow)
    this.camButtons = camButtons

    // Nav log: the flight plan.
    const nav = win('navlog', 'Nav log', 'navlog', 300, vw - 330, 70)
    this.navBody = nav.body

    // Re-hosted panels.
    const host = (id: string, title: string, iconName: string, el: HTMLElement | null | undefined, width: number, x: number, y: number): void => {
      if (!el) return
      const w = win(id, title, iconName, width, x, y)
      rehost(el, w.body)
    }
    host('conditions', 'Weather & view', 'weather', d.panels.conditions, 320, vw - 350, 70)
    host('fuel', 'Fuel & payload', 'fuel', d.panels.fuel, 340, vw - 370, 120)
    host('controls', 'Controls', 'controls', d.panels.controls, 460, vw - 490, 90)
    document.getElementById('flight-panel-dock')?.remove()

    // Assistance.
    const assist = win('assist', 'Assistance', 'assist', 320, vw / 2 - 160, 70)
    const aRow = document.createElement('div'); aRow.style.cssText = 'display:flex;flex-direction:column;gap:6px'
    const assistButtons: Array<[AssistMode, HTMLButtonElement]> = []
    for (const [m, label, help] of [['off', 'Off', 'Raw aircraft — no stability help'], ['sas', 'Stability (SAS)', 'Yaw damper and gentle wing leveler'], ['full', 'Full', 'Adds pitch hold']] as const) {
      const b = document.createElement('button'); b.className = 'oh-row'
      const t = document.createElement('b'); t.textContent = label
      const s = document.createElement('span'); s.textContent = help; s.style.color = 'var(--oh-dim)'; s.style.marginLeft = 'auto'; s.style.fontSize = '12px'
      b.append(t, s)
      b.onclick = () => { d.assist.set(m); this.refresh() }
      aRow.appendChild(b); assistButtons.push([m, b])
    }
    assist.body.appendChild(aRow)
    this.assistButtons = assistButtons

    // Keyboard reference.
    const help = win('help', 'Keys', 'keys', 420, vw / 2 - 210, 70)
    const tbl = document.createElement('div'); tbl.style.cssText = 'display:grid;grid-template-columns:auto 1fr;gap:4px 16px;font-size:13px'
    for (const [k, what] of d.keys) {
      const a = document.createElement('kbd'); a.textContent = k
      a.style.cssText = 'font:12px ui-monospace,monospace;color:var(--oh-text);background:rgba(255,255,255,.08);border:1px solid var(--oh-line-strong);border-radius:3px;padding:2px 6px;justify-self:start'
      const b = document.createElement('span'); b.textContent = what; b.style.color = 'var(--oh-dim)'
      tbl.append(a, b)
    }
    help.body.appendChild(tbl)

    const toggle = (id: string) => () => this.windows.get(id)?.toggle()
    const open = (id: string) => () => !!this.windows.get(id)?.isOpen
    this.toolbar = new Toolbar([
      { id: 'menu', label: 'Free flight', icon: 'menu', onClick: () => d.launcher.open(), active: () => d.launcher.isOpen },
      { id: 'pause', label: 'Pause', icon: 'pause', onClick: () => d.pause.toggle(), active: () => d.pause.paused() },
      { id: 'camera', label: 'Camera', icon: 'camera', onClick: toggle('camera'), active: open('camera'), separatorBefore: true },
      { id: 'atc', label: 'ATC', icon: 'atc', onClick: toggle('atc'), active: open('atc') },
      { id: 'info', label: 'Flight info', icon: 'info', onClick: () => { d.flightInfo.visible = !d.flightInfo.visible; this.saveInfo() }, active: () => d.flightInfo.visible },
      { id: 'navlog', label: 'Nav log', icon: 'navlog', onClick: toggle('navlog'), active: open('navlog') },
      { id: 'conditions', label: 'Weather & view', icon: 'weather', onClick: toggle('conditions'), active: open('conditions') },
      { id: 'fuel', label: 'Fuel & payload', icon: 'fuel', onClick: toggle('fuel'), active: open('fuel') },
      { id: 'controls', label: 'Controls', icon: 'controls', onClick: toggle('controls'), active: open('controls'), separatorBefore: true },
      { id: 'assist', label: 'Assistance', icon: 'assist', onClick: toggle('assist'), active: open('assist') },
      { id: 'help', label: 'Keys', icon: 'keys', onClick: toggle('help'), active: open('help') },
    ])
    try { if (localStorage.getItem('oh-flight-info') === 'off') d.flightInfo.visible = false } catch { /* storage unavailable */ }
  }

  private camButtons: Array<[CameraMode, HTMLButtonElement]> = []
  private assistButtons: Array<[AssistMode, HTMLButtonElement]> = []

  private saveInfo(): void {
    try { localStorage.setItem('oh-flight-info', this.d.flightInfo.visible ? 'on' : 'off') } catch { /* storage unavailable */ }
  }

  /** Open a window by id (e.g. the ATC window when its menu is called up). */
  open(id: string): void { this.windows.get(id)?.open() }

  /** Per frame (cheap): toolbar visibility/lit state, selected chips and
   *  the nav log when it changes. */
  refresh(): void {
    this.toolbar.refresh()
    const cam = this.d.camera.get()
    for (const [m, b] of this.camButtons) b.classList.toggle('sel', m === cam)
    const as = this.d.assist.get()
    for (const [m, b] of this.assistButtons) b.classList.toggle('sel', m === as)
    if (this.navBody && this.windows.get('navlog')?.isOpen) {
      const legs = this.d.navLog()
      const key = legs.map((l) => `${l.ident}${l.active ? '*' : ''}${l.distNm?.toFixed(0) ?? ''}`).join('|')
      if (key !== this.navKey) {
        this.navKey = key
        this.navBody.textContent = ''
        if (!legs.length) {
          const p = document.createElement('div'); p.style.color = 'var(--oh-dim)'
          p.textContent = 'No flight plan loaded. Enter one in the FMS / GPS, or fly direct.'
          this.navBody.appendChild(p)
        }
        legs.forEach((l, i) => {
          const r = document.createElement('div'); r.className = `oh-row${l.active ? ' sel' : ''}`
          const n = document.createElement('span'); n.className = 'oh-num'; n.textContent = String(i + 1)
          const id = document.createElement('b'); id.textContent = l.ident
          const dist = document.createElement('span'); dist.style.marginLeft = 'auto'; dist.style.color = 'var(--oh-dim)'
          dist.textContent = l.distNm !== undefined ? `${l.distNm.toFixed(1)} NM` : ''
          r.append(n, id, dist)
          this.navBody!.appendChild(r)
        })
      }
    }
  }
}
