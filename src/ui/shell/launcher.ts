/**
 * Free-flight start screen: pick an aircraft, a departure airport and
 * runway (or a final approach), time of day and weather, then FLY — the
 * "world map" step of a modern consumer flight sim, without the globe.
 * Changing aircraft needs a reload (the airframe is built at boot), so the
 * choice rides across it in session storage and is applied on arrival.
 */
import { icon } from './icons'

export type LaunchTime = 'keep' | 'day' | 'sunset' | 'night'
export type LaunchWeather = 'live' | 'clear' | 'scattered' | 'overcast'

export interface LaunchChoice {
  aircraft: string
  airport: string
  runway?: string
  final: boolean
  time: LaunchTime
  weather: LaunchWeather
}

export interface LauncherAircraft { key: string; label: string; group: string }
export interface LauncherAirport { ident: string; name: string; size: number; runways: string[] }

export interface LauncherDeps {
  aircraft: LauncherAircraft[]
  currentAircraft: string
  defaultAirport: string
  search(query: string): LauncherAirport[]
  airport(ident: string): LauncherAirport | undefined
  fly(choice: LaunchChoice): void
  /** Opened / closed (pause the sim, release the keyboard). */
  onVisible(open: boolean): void
}

export const PENDING_LAUNCH_KEY = 'oh-pending-launch'

/** The search-box command that spawns a choice (same path as `/`). Pure. */
export function launchCommand(c: LaunchChoice): string {
  return [c.airport, c.runway, c.final ? 'FINAL' : ''].filter(Boolean).join(' ')
}

/** Validate a launch carried across a reload. Pure. */
export function parsePendingLaunch(raw: string | null): LaunchChoice | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<LaunchChoice>
    const ok = typeof v.aircraft === 'string' && typeof v.airport === 'string' && /^[A-Z0-9]{2,6}$/.test(v.airport) &&
      (v.runway === undefined || (typeof v.runway === 'string' && /^[0-9]{1,2}[LCR]?$/.test(v.runway))) &&
      typeof v.final === 'boolean' && ['keep', 'day', 'sunset', 'night'].includes(v.time as string) &&
      ['live', 'clear', 'scattered', 'overcast'].includes(v.weather as string)
    return ok ? (v as LaunchChoice) : null
  } catch { return null }
}

const CSS = `
#oh-launcher{position:fixed;inset:0;z-index:80;display:flex;flex-direction:column;color:var(--oh-text);
  background:radial-gradient(120% 90% at 70% 10%, rgba(20,36,58,.55), rgba(5,8,13,.92));backdrop-filter:blur(7px) brightness(.75);-webkit-backdrop-filter:blur(7px) brightness(.75)}
#oh-launcher[hidden]{display:none}
#oh-launcher .oh-l-top{display:flex;align-items:flex-end;gap:18px;padding:28px 40px 18px;border-bottom:1px solid var(--oh-line)}
#oh-launcher .oh-l-top h1{margin:0;font-size:30px;font-weight:300;letter-spacing:.22em}
#oh-launcher .oh-l-top span{color:var(--oh-dim);letter-spacing:.18em;font-size:12px;text-transform:uppercase;padding-bottom:6px}
#oh-launcher .oh-l-cols{flex:1;display:grid;grid-template-columns:minmax(300px,1fr) minmax(320px,1.15fr);gap:22px;padding:22px 40px;min-height:0}
#oh-launcher .oh-l-card{display:flex;flex-direction:column;min-height:0;background:var(--oh-glass);border:1px solid var(--oh-line);border-radius:4px}
#oh-launcher .oh-l-card > h2{margin:0;padding:12px 16px;font-size:12px;font-weight:600;letter-spacing:.16em;color:var(--oh-dim);border-bottom:1px solid var(--oh-line);display:flex;gap:10px;align-items:center}
#oh-launcher .oh-l-card > h2 svg{color:var(--oh-accent)}
#oh-launcher .oh-l-pad{padding:12px 16px;overflow:auto}
#oh-launcher input{width:100%;background:rgba(255,255,255,.06);border:1px solid var(--oh-line-strong);border-radius:3px;color:var(--oh-text);padding:10px 12px;font-size:14px;outline:none}
#oh-launcher input:focus{border-color:var(--oh-accent)}
#oh-launcher .oh-l-list{overflow:auto;flex:1;padding:4px 8px 12px}
#oh-launcher .oh-l-group{font-size:10px;letter-spacing:.18em;color:var(--oh-faint);text-transform:uppercase;padding:12px 10px 4px}
#oh-launcher .oh-l-chips{display:flex;flex-wrap:wrap;gap:6px}
#oh-launcher .oh-l-airport{margin-top:12px;padding:12px;border:1px solid var(--oh-line);border-radius:3px;background:rgba(255,255,255,.03)}
#oh-launcher .oh-l-airport b{font-size:20px;letter-spacing:.06em}
#oh-launcher .oh-l-airport div{color:var(--oh-dim);margin-top:2px}
#oh-launcher .oh-l-bottom{display:flex;align-items:center;gap:16px;padding:16px 40px 26px;border-top:1px solid var(--oh-line)}
#oh-launcher .oh-l-summary{flex:1;color:var(--oh-dim);letter-spacing:.04em}
#oh-launcher .oh-l-summary b{color:var(--oh-text)}
#oh-launcher .oh-l-fly{min-width:200px;padding:14px 28px;border:none;border-radius:3px;background:var(--oh-accent);color:#03121f;font-size:16px;font-weight:800;letter-spacing:.22em;cursor:pointer}
#oh-launcher .oh-l-fly:hover{filter:brightness(1.1)}
#oh-launcher .oh-l-fly:disabled{opacity:.4;cursor:default}
#oh-launcher .oh-l-resume{padding:13px 20px;border:1px solid var(--oh-line-strong);border-radius:3px;background:transparent;color:var(--oh-text);letter-spacing:.14em;cursor:pointer}
@media (max-width:820px){#oh-launcher .oh-l-cols{grid-template-columns:1fr;overflow:auto;padding:16px}#oh-launcher .oh-l-top,#oh-launcher .oh-l-bottom{padding-left:16px;padding-right:16px}}
`

export class Launcher {
  readonly el: HTMLElement
  private choice: LaunchChoice
  private readonly list: HTMLElement
  private readonly results: HTMLElement
  private readonly airportCard: HTMLElement
  private readonly summary: HTMLElement
  private readonly fly: HTMLButtonElement
  private aircraftFilter = ''

  constructor(private readonly deps: LauncherDeps) {
    if (!document.getElementById('oh-launcher-css')) {
      const st = document.createElement('style'); st.id = 'oh-launcher-css'; st.textContent = CSS; document.head.appendChild(st)
    }
    this.choice = { aircraft: deps.currentAircraft, airport: deps.defaultAirport, final: false, time: 'keep', weather: 'live' }
    const el = document.createElement('div')
    el.id = 'oh-launcher'
    el.className = 'oh-ui'
    el.hidden = true
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-label', 'Free flight')
    el.innerHTML = `
      <div class="oh-l-top"><h1>FREE FLIGHT</h1><span>OpenHorizon</span></div>
      <div class="oh-l-cols">
        <section class="oh-l-card"><h2>${icon('plane', 18)}AIRCRAFT</h2>
          <div class="oh-l-pad" style="padding-bottom:0"><input data-k="acft" placeholder="Search aircraft…" aria-label="Search aircraft"></div>
          <div class="oh-l-list" data-k="list"></div></section>
        <section class="oh-l-card"><h2>${icon('navlog', 18)}DEPARTURE</h2>
          <div class="oh-l-pad">
            <input data-k="dep" placeholder="Airport ICAO, city or name…" aria-label="Departure airport">
            <div data-k="results"></div>
            <div class="oh-l-airport" data-k="airport"></div>
            <div class="oh-label">Start position</div><div class="oh-l-chips" data-k="start"></div>
            <div class="oh-label">Time of day</div><div class="oh-l-chips" data-k="time"></div>
            <div class="oh-label">Weather</div><div class="oh-l-chips" data-k="wx"></div>
          </div></section>
      </div>
      <div class="oh-l-bottom"><div class="oh-l-summary" data-k="summary"></div>
        <button class="oh-l-resume" data-k="resume">RESUME FLIGHT</button>
        <button class="oh-l-fly" data-k="fly">FLY</button></div>`
    document.body.appendChild(el)
    this.el = el
    const q = <T extends HTMLElement>(k: string): T => el.querySelector(`[data-k="${k}"]`) as T
    this.list = q('list'); this.results = q('results'); this.airportCard = q('airport'); this.summary = q('summary')
    this.fly = q<HTMLButtonElement>('fly')
    const acft = q<HTMLInputElement>('acft'), dep = q<HTMLInputElement>('dep')
    acft.addEventListener('input', () => { this.aircraftFilter = acft.value.trim().toLowerCase(); this.renderAircraft() })
    dep.addEventListener('input', () => this.renderResults(dep.value))
    dep.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const first = this.deps.search(dep.value)[0]; if (first) this.pickAirport(first.ident); dep.value = ''; this.renderResults('') }
    })
    for (const inp of [acft, dep]) inp.addEventListener('keydown', (e) => e.stopPropagation())
    this.fly.onclick = () => { this.deps.fly({ ...this.choice }); this.close() }
    q<HTMLButtonElement>('resume').onclick = () => this.close()
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close() })
    this.renderChips(q('start'), [['RUNWAY', false], ['FINAL APPROACH', true]] as const, () => this.choice.final, (v) => { this.choice.final = v })
    this.renderChips(q('time'), [['CURRENT', 'keep'], ['DAY', 'day'], ['SUNSET', 'sunset'], ['NIGHT', 'night']] as const, () => this.choice.time, (v) => { this.choice.time = v })
    this.renderChips(q('wx'), [['LIVE', 'live'], ['CLEAR', 'clear'], ['SCATTERED', 'scattered'], ['OVERCAST', 'overcast']] as const, () => this.choice.weather, (v) => { this.choice.weather = v })
    this.renderAircraft()
    this.pickAirport(deps.defaultAirport)
  }

  get isOpen(): boolean { return !this.el.hidden }

  open(): void {
    if (this.isOpen) return
    this.el.hidden = false
    this.renderAircraft()
    this.pickAirport(this.choice.airport)
    this.deps.onVisible(true)
  }

  close(): void {
    if (!this.isOpen) return
    this.el.hidden = true
    this.deps.onVisible(false)
  }

  private renderChips<T>(host: HTMLElement, options: ReadonlyArray<readonly [string, T]>, get: () => T, set: (v: T) => void): void {
    const draw = (): void => {
      host.textContent = ''
      for (const [label, value] of options) {
        const b = document.createElement('button')
        b.className = `oh-chip${get() === value ? ' sel' : ''}`
        b.textContent = label
        b.onclick = () => { set(value); draw(); this.renderSummary() }
        host.appendChild(b)
      }
    }
    draw()
  }

  private renderAircraft(): void {
    this.list.textContent = ''
    let group = ''
    for (const a of this.deps.aircraft) {
      if (this.aircraftFilter && !`${a.label} ${a.key} ${a.group}`.toLowerCase().includes(this.aircraftFilter)) continue
      if (a.group !== group) {
        group = a.group
        const g = document.createElement('div'); g.className = 'oh-l-group'; g.textContent = group; this.list.appendChild(g)
      }
      const row = document.createElement('button')
      row.className = `oh-row${a.key === this.choice.aircraft ? ' sel' : ''}`
      row.textContent = a.label
      row.onclick = () => { this.choice.aircraft = a.key; this.renderAircraft(); this.renderSummary() }
      this.list.appendChild(row)
    }
    this.renderSummary()
  }

  private renderResults(query: string): void {
    this.results.textContent = ''
    for (const a of this.deps.search(query).slice(0, 6)) {
      const row = document.createElement('button')
      row.className = 'oh-row'
      const id = document.createElement('b'); id.textContent = a.ident; id.style.minWidth = '56px'
      const nm = document.createElement('span'); nm.textContent = a.name; nm.style.color = 'var(--oh-dim)'
      row.append(id, nm)
      row.onclick = () => { this.pickAirport(a.ident); this.renderResults('') }
      this.results.appendChild(row)
    }
  }

  private pickAirport(ident: string): void {
    const ap = this.deps.airport(ident)
    this.choice.airport = ap?.ident ?? ident
    if (this.choice.runway && !ap?.runways.includes(this.choice.runway)) delete this.choice.runway
    this.airportCard.textContent = ''
    const b = document.createElement('b'); b.textContent = this.choice.airport
    const n = document.createElement('div'); n.textContent = ap?.name ?? 'Airport data loading…'
    this.airportCard.append(b, n)
    if (ap && ap.runways.length) {
      const lab = document.createElement('div'); lab.className = 'oh-label'; lab.textContent = 'Runway'
      const chips = document.createElement('div'); chips.className = 'oh-l-chips'
      const draw = (): void => {
        chips.textContent = ''
        for (const r of ['AUTO', ...ap.runways]) {
          const c = document.createElement('button')
          const val = r === 'AUTO' ? undefined : r
          c.className = `oh-chip${this.choice.runway === val ? ' sel' : ''}`
          c.textContent = r
          c.onclick = () => { if (val) this.choice.runway = val; else delete this.choice.runway; draw(); this.renderSummary() }
          chips.appendChild(c)
        }
      }
      draw()
      this.airportCard.append(lab, chips)
    }
    this.renderSummary()
  }

  private renderSummary(): void {
    const a = this.deps.aircraft.find((x) => x.key === this.choice.aircraft)
    this.summary.textContent = ''
    const b = document.createElement('b'); b.textContent = a?.label ?? this.choice.aircraft
    this.summary.append(b, ` · ${this.choice.airport}${this.choice.runway ? ` runway ${this.choice.runway}` : ''} · ${this.choice.final ? 'final approach' : 'on the runway'}` +
      `${this.choice.aircraft !== this.deps.currentAircraft ? ' · loads the new aircraft' : ''}`)
    this.fly.disabled = !this.deps.airport(this.choice.airport)
  }
}
