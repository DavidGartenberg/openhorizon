/**
 * Autopilot window: a flight-guidance panel for any airplane — mode
 * annunciations, the AP / HDG / NAV / APR / ALT / VS / FLC (and A/T where
 * fitted) buttons, selector steppers for heading, altitude, vertical
 * speed and speed, and an ILS picker that tunes NAV1. All logic lives in
 * `sim/ap-panel.ts`; this is only the face.
 */
import type { Knob } from '../../sim/ap-panel'
import { AUTOBRAKE_SETTINGS, type AutobrakeSetting } from '../../sim/autobrake'

export type ApAction = 'ap' | 'hdg' | 'nav' | 'apr' | 'alt' | 'vs' | 'flc' | 'at' | 'land'

export interface ApReadout {
  master: boolean
  lateral: string
  lateralArmed: string
  vertical: string
  verticalArmed: string
  /** Buttons lit: the user-selected modes (lateral / vertical / A/T). */
  lit: Partial<Record<ApAction, boolean>>
  /** Plain-English status from the real state (sim/ap-describe.ts). */
  summary?: { headline: string; next?: string }
  /** The one-touch altitude button's current label ("CLIMB TO 8,000" …). */
  goLabel?: string
  /** Why a mode button would be refused right now (only the unavailable ones). */
  reasons?: { nav?: string; apr?: string; land?: string }
  /** Autobrake panel (airliner decks only; absent = not fitted). */
  autobrake?: { setting: string; phase: string; disarmLight: boolean; reason: string; demand: number }
  hasAutothrottle: boolean
  atText: string
  /** True when this airplane has no real autothrottle and the A/T is a speed-hold assist. */
  atAssist?: boolean
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
  /** Move the autobrake selector. */
  autobrake?(setting: AutobrakeSetting): void
  /** Type an exact value into a selector ("8000", "FL350", "270"). */
  set?(k: Knob, text: string): void
  /** CLIMB / DESCEND / HOLD: go to the selected altitude. */
  go?(): void
  /** Set the heading, altitude and speed selectors to the present values. */
  sync?(): void
  ils(): IlsChoice[]
  tune(freqMhz: number): void
}

const MODE_HELP: Partial<Record<ApAction, string>> = {
  ap: 'Engage or disengage the autopilot. Pressing any mode button while airborne engages it for you.',
  hdg: 'Hold the selected heading (it turns to it, then holds it).',
  nav: 'Follow the flight plan, or the tuned VOR.',
  apr: 'Fly the ILS localizer and glideslope you have chosen below.',
  alt: 'Hold the present altitude.',
  vs: 'Climb or descend at the vertical speed shown, levelling off at the selected altitude.',
  flc: 'Climb or descend at the selected speed, levelling off at the selected altitude.',
  land: 'Arms the localizer, glideslope and rollout: choose an ILS, press once, and the airplane lands itself.',
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
.oh-ap .oh-sum{margin-bottom:12px;padding:9px 11px;border:1px solid var(--oh-line);border-radius:3px;background:rgba(0,0,0,.28)}
.oh-ap .oh-sum .h{font-size:13px;line-height:1.35;color:var(--oh-text)}
.oh-ap .oh-sum .n{margin-top:5px;font-size:11px;line-height:1.35;color:var(--oh-dim)}
.oh-ap .oh-go{display:grid;grid-template-columns:2fr 1fr;gap:6px;margin-top:10px}
.oh-ap .oh-go button{padding:9px 4px !important;font-weight:700 !important;letter-spacing:.06em;font-size:12px}
.oh-ap .oh-go button.primary{background:var(--oh-accent) !important;border-color:var(--oh-accent) !important;color:#04121f !important}
.oh-ap .oh-btns button.dim{opacity:.45}
.oh-ap .oh-step b{cursor:text}
.oh-ap .oh-step input{flex:1;min-width:0;text-align:center;font:700 18px ui-monospace,monospace;color:var(--oh-text);background:rgba(0,0,0,.55);border:1px solid var(--oh-accent);border-radius:3px;padding:3px 0;outline:none}
.oh-ap .oh-ab{margin-top:14px;padding-top:10px;border-top:1px solid var(--oh-line)}
.oh-ap .oh-ab[hidden]{display:none}
.oh-ap .oh-ab-row{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin-top:6px}
.oh-ap .oh-ab-row button{padding:7px 0 !important;font-weight:700 !important;letter-spacing:.06em;font-size:12px}
.oh-ap .oh-ab-row button.lit{background:var(--oh-accent) !important;border-color:var(--oh-accent) !important;color:#04121f !important}
.oh-ap .oh-ab-status{margin-top:6px;font:600 11px ui-monospace,monospace;letter-spacing:.08em;color:var(--oh-dim);min-height:15px}
.oh-ap .oh-ab-status.armed{color:#e9f4ff}.oh-ap .oh-ab-status.active{color:#7dff95}.oh-ap .oh-ab-status.warn{color:#ffb35c}
`

/** Build the window body; returns an updater to call each frame. */
export function buildApWindow(body: HTMLElement, d: ApWindowDeps): () => void {
  if (!document.getElementById('oh-ap-css')) {
    const st = document.createElement('style'); st.id = 'oh-ap-css'; st.textContent = CSS; document.head.appendChild(st)
  }
  body.classList.add('oh-ap')
  const sum = document.createElement('div'); sum.className = 'oh-sum'
  const sumHead = document.createElement('div'); sumHead.className = 'h'; sumHead.setAttribute('role', 'status')
  const sumNext = document.createElement('div'); sumNext.className = 'n'
  sum.append(sumHead, sumNext)
  body.appendChild(sum)
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
    v.tabIndex = 0; v.title = 'Click to type a value'
    const edit = (): void => {
      if (!d.set) return
      const input = document.createElement('input')
      input.type = 'text'; input.inputMode = 'numeric'; input.setAttribute('aria-label', `${label} value`)
      input.value = (v.textContent ?? '').replace(/[^0-9+\-]/g, '')
      // Put the value cell back explicitly: relying on the blur event alone leaves the
      // typing box (and a frozen number) behind whenever the page is not focused.
      const finish = (): void => { if (input.isConnected) input.replaceWith(v) }
      // Keys typed here must never fly the airplane.
      input.addEventListener('keydown', (e) => {
        e.stopPropagation()
        if (e.key === 'Enter') { d.set?.(knob, input.value); finish() }
        else if (e.key === 'Escape') finish()
      })
      input.addEventListener('blur', () => {
        // Clicking away applies what was typed, like Enter.
        if (input.isConnected && input.value.trim()) d.set?.(knob, input.value)
        finish()
      })
      v.replaceWith(input); input.focus(); input.select()
    }
    v.onclick = edit
    v.onkeydown = (e) => { if (e.key === 'Enter') edit() }
    w.append(mkb('−', -small), v, mkb('+', small))
    w.addEventListener('wheel', (e) => { e.preventDefault(); d.turn(knob, (e.deltaY < 0 ? 1 : -1) * small * (e.shiftKey ? 10 : 1)) }, { passive: false })
    sel.append(l, w)
    values.set(knob, v)
    void big
  }
  row('heading', 'Heading', 1, 10); row('altitude', 'Altitude', 1, 10); row('vs', 'V/S', 1, 5); row('ias', 'Speed', 1, 10)
  const go = document.createElement('div'); go.className = 'oh-go'
  const goBtn = document.createElement('button'); goBtn.className = 'primary'; goBtn.textContent = 'HOLD ALTITUDE'
  goBtn.title = 'Climb or descend to the selected altitude and level off (or hold the present altitude if none is dialled)'
  goBtn.onclick = () => d.go?.()
  const syncBtn = document.createElement('button'); syncBtn.textContent = 'SYNC'
  syncBtn.title = 'Set heading, altitude and speed to where the airplane is now'
  syncBtn.onclick = () => d.sync?.()
  go.append(goBtn, syncBtn)
  const hint = document.createElement('div')
  hint.style.cssText = 'margin-top:6px;color:var(--oh-faint);font-size:11px'
  hint.textContent = 'Shift-click = ×10 · mouse wheel over a value to turn it'
  const ilsLabel = document.createElement('div'); ilsLabel.className = 'oh-label'; ilsLabel.textContent = 'ILS approach (tunes NAV1)'
  const ils = document.createElement('select')
  ils.setAttribute('aria-label', 'ILS approach')
  ils.onchange = () => { const f = Number(ils.value); if (Number.isFinite(f) && f > 0) d.tune(f) }
  const msg = document.createElement('div'); msg.className = 'oh-msg'; msg.setAttribute('role', 'status')
  // Autobrake: the 737 selector (RTO · OFF · 1 · 2 · 3 · MAX) and what it is doing.
  const ab = document.createElement('div'); ab.className = 'oh-ab'; ab.hidden = true
  const abLabel = document.createElement('div'); abLabel.className = 'oh-label'; abLabel.textContent = 'Autobrake'
  const abRow = document.createElement('div'); abRow.className = 'oh-ab-row'
  const abButtons = new Map<AutobrakeSetting, HTMLButtonElement>()
  for (const setting of AUTOBRAKE_SETTINGS) {
    const b = document.createElement('button'); b.textContent = setting === 'off' ? 'OFF' : setting.toUpperCase()
    b.title = setting === 'rto' ? 'Rejected takeoff: full braking if you reject above 85 kt (select before takeoff)'
      : setting === 'off' ? 'Autobrake off'
      : `Landing autobrake ${setting.toUpperCase()}: holds a steady deceleration after touchdown (select before landing)`
    b.onclick = () => d.autobrake?.(setting)
    abRow.appendChild(b); abButtons.set(setting, b)
  }
  const abStatus = document.createElement('div'); abStatus.className = 'oh-ab-status'; abStatus.setAttribute('role', 'status')
  ab.append(abLabel, abRow, abStatus)
  body.append(ann, btns, sel, go, hint, ilsLabel, ils, msg, ab)

  let lastIlsKey = ''
  let lastRefresh = 0
  return () => {
    const r = d.read()
    if (r.summary) {
      if (sumHead.textContent !== r.summary.headline) sumHead.textContent = r.summary.headline
      const next = r.summary.next ?? ''
      if (sumNext.textContent !== next) sumNext.textContent = next
      sumNext.hidden = !next
    }
    sum.hidden = !r.summary
    go.hidden = !d.go
    if (r.goLabel && goBtn.textContent !== r.goLabel) goBtn.textContent = r.goLabel
    aAp.v.textContent = r.master ? 'ON' : 'OFF'; aAp.el.className = r.master ? 'on' : ''
    aLat.v.textContent = r.lateralArmed ? `${r.lateral} · ${r.lateralArmed}` : r.lateral
    aLat.el.className = r.master ? 'on' : ''
    aVer.v.textContent = r.verticalArmed ? `${r.vertical} · ${r.verticalArmed}` : r.vertical
    aVer.el.className = r.master ? 'on' : ''
    for (const [a, b] of buttons) {
      const why = a === 'nav' ? r.reasons?.nav : a === 'apr' ? r.reasons?.apr : a === 'land' ? r.reasons?.land : undefined
      b.classList.toggle('dim', !!why && !r.lit[a])
      if (a !== 'at') b.title = why ?? MODE_HELP[a] ?? ''
      b.classList.toggle('lit', !!r.lit[a])
      if (a === 'at') {
        b.hidden = !r.hasAutothrottle
        if (r.hasAutothrottle) {
          const label = r.lit.at && r.atText && r.atText !== 'OFF' ? `A/T · ${r.atText}` : 'A/T'
          if (b.textContent !== label) b.textContent = label
          b.title = r.atAssist
            ? `Autothrottle assist: holds the Speed value with the power lever. (${r.atText})`
            : `Autothrottle: ${r.atText}`
        }
      }
      if (a === 'land') {
        b.hidden = !r.hasAutoland
        const label = r.landText ? `AUTOLAND · ${r.landText}` : 'AUTOLAND'
        if (b.textContent !== label) b.textContent = label
        b.title = why ?? MODE_HELP.land ?? ''
      }
    }
    // Autobrake section
    ab.hidden = !r.autobrake
    if (r.autobrake) {
      for (const [setting, b] of abButtons) b.classList.toggle('lit', setting === r.autobrake.setting)
      const a = r.autobrake
      const text = a.phase === 'off' ? 'OFF'
        : a.phase === 'armed' ? (a.setting === 'rto' ? 'RTO ARMED — brakes hard if you reject above 85 kt' : `ARMED — applies after touchdown with the thrust levers at idle`)
        : a.phase === 'active' ? `BRAKING ${Math.round(a.demand * 100)}%`
        : a.disarmLight ? `AUTO BRAKE DISARM — ${a.reason}` : 'RELEASED'
      abStatus.textContent = text
      abStatus.className = `oh-ab-status ${a.phase === 'active' ? 'active' : a.phase === 'armed' ? 'armed' : a.disarmLight ? 'warn' : ''}`
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
