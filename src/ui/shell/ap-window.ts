/**
 * Autopilot window: a flight-guidance panel for any airplane — mode
 * annunciations, the AP / HDG / NAV / APR / ALT / VS / FLC (and A/T where
 * fitted) buttons, selector steppers for heading, altitude, vertical
 * speed and speed, and an ILS picker that tunes NAV1. All logic lives in
 * `sim/ap-panel.ts`; this is only the face.
 */
import type { Knob } from '../../sim/ap-panel'

export type ApAction = 'ap' | 'hdg' | 'nav' | 'apr' | 'alt' | 'vs' | 'flc' | 'at' | 'land'

export interface ApReadout {
  master: boolean
  lateral: string
  lateralArmed: string
  vertical: string
  verticalArmed: string
  /** Buttons lit: the user-selected modes (lateral / vertical / A/T). */
  lit: Partial<Record<ApAction, boolean>>
  hasAutothrottle: boolean
  atText: string
  /** Autoland fitted, and its phase annunciation (LAND ARM / LAND / ROLLOUT), or ''. */
  hasAutoland: boolean
  landText: string
  sel: { heading: number; altitude: number; vs: number; ias: number }
  /** Currently tuned NAV1 frequency, MHz. */
  nav1: number
  /** Why the last press was refused / what it did (shown for a few seconds). */
  message?: string
}

export interface IlsChoice { ident: string; runway: string; freqMhz: number }

export interface ApWindowDeps {
  read(): ApReadout
  press(a: ApAction): void
  turn(k: Knob, steps: number): void
  ils(): IlsChoice[]
  tune(freqMhz: number): void
}

const CSS = `
.oh-ap .oh-ann{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:12px}
.oh-ap .oh-ann div{background:rgba(0,0,0,.4);border:1px solid var(--oh-line);border-radius:3px;padding:6px 4px;text-align:center;font:600 13px ui-monospace,monospace;letter-spacing:.06em;color:var(--oh-dim)}
.oh-ap .oh-ann small{display:block;font:10px var(--oh-font);letter-spacing:.14em;color:var(--oh-faint);margin-bottom:2px}
.oh-ap .oh-ann .on{color:#7dff95;border-color:rgba(125,255,149,.5)}
.oh-ap .oh-ann .arm{color:#e9f4ff}
.oh-ap .oh-btns{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.oh-ap .oh-btns button{padding:10px 0 !important;letter-spacing:.1em;font-weight:700 !important}
.oh-ap .oh-btns button.lit{background:var(--oh-accent) !important;border-color:var(--oh-accent) !important;color:#04121f !important}
.oh-ap .oh-btns button.ap{grid-column:span 2}
.oh-ap .oh-btns button.land{grid-column:span 4;letter-spacing:.14em}
.oh-ap .oh-btns button.land.lit{background:#3fe06a !important;border-color:#3fe06a !important}
.oh-ap .oh-btns button.ap.lit{background:#3fe06a !important;border-color:#3fe06a !important}
.oh-ap .oh-btns button[hidden]{display:none}
.oh-ap .oh-sel{display:grid;grid-template-columns:70px 1fr;gap:4px 10px;align-items:center;margin-top:12px}
.oh-ap .oh-sel > span{color:var(--oh-dim);font-size:11px;letter-spacing:.14em;text-transform:uppercase}
.oh-ap .oh-step{display:flex;align-items:center;gap:6px}
.oh-ap .oh-step b{flex:1;text-align:center;font:700 18px ui-monospace,monospace;color:var(--oh-text);background:rgba(0,0,0,.35);border:1px solid var(--oh-line);border-radius:3px;padding:4px 0}
.oh-ap .oh-step button{width:34px;padding:5px 0 !important;font-weight:700 !important}
.oh-ap .oh-msg{min-height:18px;margin-top:10px;color:#ffd98a;font-size:12px}
.oh-ap select{width:100%;margin-top:6px}
`

/** Build the window body; returns an updater to call each frame. */
export function buildApWindow(body: HTMLElement, d: ApWindowDeps): () => void {
  if (!document.getElementById('oh-ap-css')) {
    const st = document.createElement('style'); st.id = 'oh-ap-css'; st.textContent = CSS; document.head.appendChild(st)
  }
  body.classList.add('oh-ap')
  const ann = document.createElement('div')
  ann.className = 'oh-ann'
  const cell = (label: string): { el: HTMLElement; v: HTMLElement } => {
    const el = document.createElement('div')
    const small = document.createElement('small'); small.textContent = label
    const v = document.createElement('span')
    el.append(small, v)
    ann.appendChild(el)
    return { el, v }
  }
  const aAp = cell('AP'), aLat = cell('LATERAL'), aVer = cell('VERTICAL')
  const btns = document.createElement('div')
  btns.className = 'oh-btns'
  const buttons = new Map<ApAction, HTMLButtonElement>()
  const mk = (a: ApAction, label: string, cls = ''): void => {
    const b = document.createElement('button')
    b.textContent = label
    if (cls) b.className = cls
    b.onclick = () => d.press(a)
    btns.appendChild(b)
    buttons.set(a, b)
  }
  mk('ap', 'AUTOPILOT', 'ap'); mk('at', 'A/T'); mk('hdg', 'HDG'); mk('nav', 'NAV'); mk('apr', 'APR'); mk('alt', 'ALT'); mk('vs', 'VS'); mk('flc', 'FLC'); mk('land', 'AUTOLAND', 'land')
  const sel = document.createElement('div')
  sel.className = 'oh-sel'
  const values = new Map<Knob, HTMLElement>()
  const row = (knob: Knob, label: string, small: number, big: number): void => {
    const l = document.createElement('span'); l.textContent = label
    const w = document.createElement('div'); w.className = 'oh-step'
    const mkb = (t: string, steps: number): HTMLButtonElement => {
      const b = document.createElement('button'); b.textContent = t; b.onclick = (e) => d.turn(knob, (e as MouseEvent).shiftKey ? steps * 10 : steps); return b
    }
    const v = document.createElement('b')
    w.append(mkb('−', -small), v, mkb('+', small))
    w.addEventListener('wheel', (e) => { e.preventDefault(); d.turn(knob, (e.deltaY < 0 ? 1 : -1) * small * (e.shiftKey ? 10 : 1)) }, { passive: false })
    sel.append(l, w)
    values.set(knob, v)
    void big
  }
  row('heading', 'Heading', 1, 10); row('altitude', 'Altitude', 1, 10); row('vs', 'V/S', 1, 5); row('ias', 'Speed', 1, 10)
  const hint = document.createElement('div')
  hint.style.cssText = 'margin-top:6px;color:var(--oh-faint);font-size:11px'
  hint.textContent = 'Shift-click = ×10 · mouse wheel over a value to turn it'
  const ilsLabel = document.createElement('div'); ilsLabel.className = 'oh-label'; ilsLabel.textContent = 'ILS approach (tunes NAV1)'
  const ils = document.createElement('select')
  ils.setAttribute('aria-label', 'ILS approach')
  ils.onchange = () => { const f = Number(ils.value); if (Number.isFinite(f) && f > 0) d.tune(f) }
  const msg = document.createElement('div'); msg.className = 'oh-msg'; msg.setAttribute('role', 'status')
  body.append(ann, btns, sel, hint, ilsLabel, ils, msg)

  let lastIlsKey = ''
  let lastRefresh = 0
  return () => {
    const r = d.read()
    aAp.v.textContent = r.master ? 'ON' : 'OFF'; aAp.el.className = r.master ? 'on' : ''
    aLat.v.textContent = r.lateralArmed ? `${r.lateral} · ${r.lateralArmed}` : r.lateral
    aLat.el.className = r.master ? 'on' : ''
    aVer.v.textContent = r.verticalArmed ? `${r.vertical} · ${r.verticalArmed}` : r.vertical
    aVer.el.className = r.master ? 'on' : ''
    for (const [a, b] of buttons) {
      b.classList.toggle('lit', !!r.lit[a])
      if (a === 'at') { b.hidden = !r.hasAutothrottle; if (r.hasAutothrottle) b.title = r.atText }
      if (a === 'land') {
        b.hidden = !r.hasAutoland
        const label = r.landText ? `AUTOLAND · ${r.landText}` : 'AUTOLAND'
        if (b.textContent !== label) b.textContent = label
        b.title = 'Arms the localizer, glideslope and rollout: tune an ILS, press once, and the airplane lands itself.'
      }
    }
    const set = (k: Knob, text: string): void => { const v = values.get(k); if (v && v.textContent !== text) v.textContent = text }
    set('heading', `${String(r.sel.heading).padStart(3, '0')}°`)
    set('altitude', `${r.sel.altitude} ft`)
    set('vs', `${r.sel.vs >= 0 ? '+' : ''}${r.sel.vs} fpm`)
    set('ias', `${r.sel.ias} kt`)
    msg.textContent = r.message ?? ''
    const now = performance.now()
    if (now - lastRefresh > 1500) {
      lastRefresh = now
      const list = d.ils()
      const key = list.map((i) => `${i.ident}${i.runway}${i.freqMhz}`).join('|') + `@${r.nav1}`
      if (key !== lastIlsKey) {
        lastIlsKey = key
        ils.textContent = ''
        const none = document.createElement('option'); none.value = ''; none.textContent = list.length ? 'Choose a runway…' : 'No ILS within 30 nm'
        ils.appendChild(none)
        for (const i of list) {
          const o = document.createElement('option')
          o.value = String(i.freqMhz)
          o.textContent = `${i.ident} runway ${i.runway} — ${i.freqMhz.toFixed(2)}`
          if (Math.abs(i.freqMhz - r.nav1) < 0.005) o.selected = true
          ils.appendChild(o)
        }
      }
    }
  }
}
