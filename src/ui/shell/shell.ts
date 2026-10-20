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
import { buildApWindow, type ApWindowDeps } from './ap-window'
import { CHECKLISTS, checklistProgress, evaluateChecklist, suggestChecklist, type ChecklistState } from '../../sim/checklists'

export type CameraMode = 'chase' | 'orbit' | 'free' | 'cockpit' | 'showcase'

/** The camera window's tabs and the views each one offers. */
export const CAMERA_TABS: ReadonlyArray<{ id: string; title: string; views: ReadonlyArray<{ mode: CameraMode; label: string; note: string }> }> = [
  { id: 'cockpit', title: 'Cockpit', views: [{ mode: 'cockpit', label: 'Pilot view', note: 'Inside the flight deck' }] },
  { id: 'external', title: 'External', views: [
    { mode: 'chase', label: 'Chase', note: 'Behind the airplane' },
    { mode: 'orbit', label: 'Orbit', note: 'Drag to rotate · wheel to zoom' },
  ] },
  { id: 'showcase', title: 'Showcase', views: [{ mode: 'showcase', label: 'Cinematic', note: 'Automatic camera shots' }] },
  { id: 'drone', title: 'Drone', views: [{ mode: 'free', label: 'Free drone', note: 'WASD · R/F up-down · Shift fast' }] },
]

/** Which tab a camera mode lives under. Pure. */
export function cameraTabFor(mode: CameraMode): string {
  return CAMERA_TABS.find((t) => t.views.some((v) => v.mode === mode))?.id ?? 'external'
}
export type AssistMode = 'off' | 'sas' | 'full'

export interface ShellDeps {
  launcher: Launcher
  flightInfo: { visible: boolean }
  ap: ApWindowDeps
  /** Add the active departure/destination to the nav log; returns an error or null. */
  directTo(ident: string): string | null
  clearPlan(): void
  instruments: { visible: boolean; on: boolean; set(v: boolean): void }
  camera: { get(): CameraMode; set(m: CameraMode): void; fov: { get(): number; set(deg: number): void; min: number; max: number } }
  /** Real aircraft state for the checklists. */
  checklist: { state(): ChecklistState }
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

    // Camera: tabs (cockpit / external / showcase / drone), a list of views
    // with the current one in blue, and a field-of-view slider.
    const cam = win('camera', 'Camera', 'camera', 340, vw / 2 - 170, 70)
    cam.body.classList.add('flush')
    const tabBar = document.createElement('div'); tabBar.className = 'oh-tabs'; tabBar.setAttribute('role', 'tablist')
    const viewList = document.createElement('div')
    const tabButtons = new Map<string, HTMLButtonElement>()
    for (const t of CAMERA_TABS) {
      const b = document.createElement('button'); b.className = 'oh-tab'; b.textContent = t.title; b.setAttribute('role', 'tab')
      b.onclick = () => { this.camTab = t.id; this.camKey = ''; this.refresh() }
      tabBar.appendChild(b); tabButtons.set(t.id, b)
    }
    const camHead = document.createElement('div'); camHead.className = 'oh-sec'; camHead.textContent = 'Views'
    const optHead = document.createElement('div'); optHead.className = 'oh-sec'; optHead.textContent = 'Options'
    const fovRow = document.createElement('div'); fovRow.className = 'oh-slider'
    const fovLabel = document.createElement('label'); fovLabel.textContent = 'Field of view'; fovLabel.htmlFor = 'oh-fov'
    const fovOut = document.createElement('output'); fovOut.htmlFor = 'oh-fov'
    const fov = document.createElement('input'); fov.type = 'range'; fov.id = 'oh-fov'
    fov.min = String(d.camera.fov.min); fov.max = String(d.camera.fov.max); fov.step = '1'
    fov.addEventListener('input', () => { d.camera.fov.set(Number(fov.value)); fovOut.textContent = `${Math.round(Number(fov.value))}°` })
    fov.addEventListener('keydown', (e) => e.stopPropagation())
    fovRow.append(fovLabel, fovOut, fov)
    cam.body.append(tabBar, camHead, viewList, optHead, fovRow)
    this.camParts = { tabButtons, viewList, fov, fovOut }

    // Checklist: auto-checked against the real airplane where possible.
    const chk = win('checklist', 'Checklist', 'checklist', 380, 16, 70)
    chk.body.classList.add('flush')
    const ckTabs = document.createElement('div'); ckTabs.className = 'oh-tabs'; ckTabs.setAttribute('role', 'tablist')
    const ckShort: Record<string, string> = { 'before-start': 'Start', 'engine-start': 'Engine', 'before-takeoff': 'Takeoff', 'before-landing': 'Landing', 'after-landing': 'After' }
    const ckTabButtons = new Map<string, HTMLButtonElement>()
    for (const l of CHECKLISTS) {
      const b = document.createElement('button'); b.className = 'oh-tab'; b.textContent = ckShort[l.id] ?? l.title; b.title = l.title; b.setAttribute('role', 'tab')
      b.onclick = () => { this.ckPick = l.id; this.ckUserPicked = true; this.ckKey = ''; this.refresh() }
      ckTabs.appendChild(b); ckTabButtons.set(l.id, b)
    }
    const ckTitle = document.createElement('div'); ckTitle.className = 'oh-sec'
    const ckList = document.createElement('div')
    const ckBar = document.createElement('div'); ckBar.className = 'oh-ckbar'
    const ckProg = document.createElement('div'); ckProg.className = 'oh-prog'; const ckFill = document.createElement('i'); ckProg.appendChild(ckFill)
    const ckCount = document.createElement('span')
    const ckReset = document.createElement('button'); ckReset.textContent = 'RESET'; ckReset.title = 'Clear the items you ticked by hand'
    ckReset.onclick = () => { this.ckTicked.delete(this.ckPick); this.ckKey = ''; this.refresh() }
    ckBar.append(ckProg, ckCount, ckReset)
    chk.body.append(ckTabs, ckTitle, ckList, ckBar)
    this.ckParts = { tabButtons: ckTabButtons, title: ckTitle, list: ckList, fill: ckFill, count: ckCount }

    // Nav log: the flight plan, with a direct-to entry.
    const nav = win('navlog', 'Nav log', 'navlog', 320, vw - 350, 70)
    const entry = document.createElement('div'); entry.style.cssText = 'display:flex;gap:6px;margin-bottom:10px'
    const dto = document.createElement('input'); dto.placeholder = 'Direct to airport (ICAO)…'; dto.setAttribute('aria-label', 'Direct to airport'); dto.style.flex = '1'
    dto.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go.click() })
    const go = document.createElement('button'); go.textContent = 'GO'
    const clr = document.createElement('button'); clr.textContent = 'CLEAR'
    const err = document.createElement('div'); err.style.cssText = 'color:#ffd98a;font-size:12px;min-height:16px;margin-bottom:6px'
    go.onclick = () => { const e = d.directTo(dto.value.trim().toUpperCase()); err.textContent = e ?? ''; if (!e) dto.value = '' }
    clr.onclick = () => { d.clearPlan(); err.textContent = '' }
    entry.append(dto, go, clr)
    nav.body.append(entry, err)
    const list = document.createElement('div'); nav.body.appendChild(list)
    this.navBody = list

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

    // Autopilot.
    const apw = win('ap', 'Autopilot', 'autopilot', 340, vw / 2 - 170, 70)
    this.updateAp = buildApWindow(apw.body, d.ap)

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
      { id: 'checklist', label: 'Checklist', icon: 'checklist', onClick: toggle('checklist'), active: open('checklist') },
      { id: 'atc', label: 'ATC', icon: 'atc', onClick: toggle('atc'), active: open('atc') },
      { id: 'instruments', label: 'Instruments', icon: 'gauge', onClick: () => d.instruments.set(!d.instruments.on), active: () => d.instruments.on },
      { id: 'info', label: 'Flight info', icon: 'info', onClick: () => { d.flightInfo.visible = !d.flightInfo.visible; this.saveInfo() }, active: () => d.flightInfo.visible },
      { id: 'navlog', label: 'Nav log', icon: 'navlog', onClick: toggle('navlog'), active: open('navlog') },
      { id: 'conditions', label: 'Weather & view', icon: 'weather', onClick: toggle('conditions'), active: open('conditions') },
      { id: 'fuel', label: 'Fuel & payload', icon: 'fuel', onClick: toggle('fuel'), active: open('fuel') },
      { id: 'controls', label: 'Controls', icon: 'controls', onClick: toggle('controls'), active: open('controls'), separatorBefore: true },
      { id: 'ap', label: 'Autopilot', icon: 'autopilot', onClick: toggle('ap'), active: () => !!d.ap.read().master || open('ap')() },
      { id: 'assist', label: 'Assistance', icon: 'assist', onClick: toggle('assist'), active: open('assist') },
      { id: 'help', label: 'Keys', icon: 'keys', onClick: toggle('help'), active: open('help') },
    ])
    // The tile panel is optional now (the instrument overlay is the default).
    let infoOn = false
    try { infoOn = localStorage.getItem('oh-flight-info') === 'on' } catch { /* storage unavailable */ }
    d.flightInfo.visible = infoOn
  }

  private updateAp: (() => void) | null = null
  private camTab = 'external'
  private camKey = ''
  private lastCamMode: CameraMode | null = null
  private camParts: { tabButtons: Map<string, HTMLButtonElement>; viewList: HTMLElement; fov: HTMLInputElement; fovOut: HTMLElement } | null = null
  private ckPick = 'before-start'
  private ckUserPicked = false
  private ckKey = ''
  private readonly ckTicked = new Map<string, Set<string>>()
  private ckParts: { tabButtons: Map<string, HTMLButtonElement>; title: HTMLElement; list: HTMLElement; fill: HTMLElement; count: HTMLElement } | null = null
  private assistButtons: Array<[AssistMode, HTMLButtonElement]> = []

  private saveInfo(): void {
    try { localStorage.setItem('oh-flight-info', this.d.flightInfo.visible ? 'on' : 'off') } catch { /* storage unavailable */ }
  }

  /** Open a window by id (e.g. the ATC window when its menu is called up). */
  open(id: string): void { this.windows.get(id)?.open() }

  private refreshCamera(): void {
    const p = this.camParts
    if (!p) return
    const mode = this.d.camera.get()
    if (mode !== this.lastCamMode) { this.lastCamMode = mode; this.camTab = cameraTabFor(mode); this.camKey = '' }
    const key = `${this.camTab}|${mode}`
    if (key !== this.camKey) {
      this.camKey = key
      for (const [id, b] of p.tabButtons) { b.classList.toggle('sel', id === this.camTab); b.setAttribute('aria-selected', String(id === this.camTab)) }
      p.viewList.textContent = ''
      for (const v of CAMERA_TABS.find((t) => t.id === this.camTab)?.views ?? []) {
        const b = document.createElement('button'); b.className = `oh-opt${v.mode === mode ? ' sel' : ''}`
        const t = document.createElement('span'); t.textContent = v.label
        const n = document.createElement('small'); n.textContent = v.note
        b.append(t, n)
        b.onclick = () => { this.d.camera.set(v.mode); this.refresh() }
        p.viewList.appendChild(b)
      }
    }
    const fovNow = String(Math.round(this.d.camera.fov.get()))
    if (document.activeElement !== p.fov && p.fov.value !== fovNow) { p.fov.value = fovNow; p.fovOut.textContent = `${fovNow}°` }
    if (!p.fovOut.textContent) p.fovOut.textContent = `${fovNow}°`
  }

  private refreshChecklist(): void {
    const p = this.ckParts
    if (!p) return
    const s = this.d.checklist.state()
    if (!this.ckUserPicked) this.ckPick = suggestChecklist(s)
    const list = CHECKLISTS.find((l) => l.id === this.ckPick) ?? CHECKLISTS[0]!
    const ticked = this.ckTicked.get(list.id) ?? new Set<string>()
    const items = evaluateChecklist(list, s, ticked)
    const key = `${list.id}|${items.map((i) => (i.status === 'done' ? '1' : '0')).join('')}`
    if (key === this.ckKey) return
    this.ckKey = key
    for (const [id, b] of p.tabButtons) { b.classList.toggle('sel', id === list.id); b.setAttribute('aria-selected', String(id === list.id)) }
    p.title.textContent = list.title
    p.list.textContent = ''
    for (const it of items) {
      const r = document.createElement('button'); r.className = `oh-ck${it.status === 'done' ? ' done' : ''}${it.auto ? '' : ' manual'}`
      const tick = document.createElement('span'); tick.className = 'oh-tick'; tick.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
      const ch = document.createElement('span'); ch.textContent = it.challenge
      const resp = document.createElement('span'); resp.className = 'oh-resp'; resp.textContent = it.response
      r.append(tick, ch)
      if (it.auto) { const a = document.createElement('span'); a.className = 'oh-auto'; a.textContent = 'AUTO'; a.title = 'Checked against the real airplane'; r.appendChild(a) }
      r.appendChild(resp)
      if (!it.auto) {
        r.onclick = () => {
          const set = this.ckTicked.get(list.id) ?? new Set<string>()
          if (set.has(it.id)) set.delete(it.id); else set.add(it.id)
          this.ckTicked.set(list.id, set); this.ckKey = ''; this.refresh()
        }
      } else r.setAttribute('aria-disabled', 'true')
      p.list.appendChild(r)
    }
    const pr = checklistProgress(items)
    p.fill.style.width = `${pr.total ? (pr.done / pr.total) * 100 : 0}%`
    p.count.textContent = `${pr.done} / ${pr.total}${pr.complete ? ' ✓' : ''}`
  }

  /** Per frame (cheap): toolbar visibility/lit state, selected chips and
   *  the nav log when it changes. */
  refresh(): void {
    this.toolbar.refresh()
    if (this.windows.get('camera')?.isOpen) this.refreshCamera()
    if (this.windows.get('checklist')?.isOpen) this.refreshChecklist()
    const as = this.d.assist.get()
    for (const [m, b] of this.assistButtons) b.classList.toggle('sel', m === as)
    if (this.windows.get('ap')?.isOpen) this.updateAp?.()
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
