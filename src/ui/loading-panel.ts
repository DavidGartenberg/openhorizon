import { mountFlightPanel } from './flight-panel-dock'
import {
  readLoadingDraft, toDisplayMass, validateLoading,
  type LoadingSelection, type LoadingValidation, type MassUnit,
} from '../sim/loading'
import type { AircraftParams } from '../sim/aircraft/params'

export interface LoadingPanelActions {
  current(): LoadingSelection
  onGround(): boolean
  apply(selection: LoadingSelection, unit: MassUnit): LoadingValidation & { applied: boolean }
  disableInput(): void
  enableInput(): void
}

export class LoadingPanel {
  private readonly panel: HTMLDetailsElement
  private readonly unit: HTMLSelectElement
  private readonly payload: HTMLInputElement
  private readonly left: HTMLInputElement
  private readonly right: HTMLInputElement
  private readonly total: HTMLOutputElement
  private readonly empty: HTMLOutputElement
  private readonly gross: HTMLOutputElement
  private readonly mtow: HTMLOutputElement
  private readonly status: HTMLOutputElement
  private draftUnit: MassUnit
  private canonicalDraft: LoadingSelection = { payloadKg: 0, leftKg: 0, rightKg: 0 }
  private readonly dirty = new Set<keyof LoadingSelection>()

  constructor(private readonly params: AircraftParams, private readonly actions: LoadingPanelActions, initialUnit: MassUnit = 'kg') {
    this.draftUnit = initialUnit
    const style = document.createElement('style')
    style.textContent = `
      #loading-panel{position:fixed;top:58px;right:18px;z-index:31;width:min(290px,calc(100vw - 36px));font:12px/1.45 system-ui,sans-serif;color:#e6edf0;background:rgba(14,22,29,.94);border:1px solid #ffffff26;border-radius:12px;box-shadow:0 8px 28px #0004}
      #loading-panel summary{padding:11px 15px;cursor:pointer;font-weight:650;letter-spacing:.02em}
      #loading-panel .loading-controls{padding:2px 15px 14px;border-top:1px solid #ffffff12}
      #loading-panel label,#loading-panel .readout{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:9px}
      #loading-panel input,#loading-panel select{box-sizing:border-box;width:116px;border:1px solid #ffffff26;border-radius:5px;padding:5px 7px;background:#24333e;color:#f0f4f5;font:inherit}
      #loading-panel button{width:100%;margin-top:12px;background:#31556a;border:1px solid #ffffff30;border-radius:6px;color:#fff;padding:7px;font:inherit;cursor:pointer}
      #loading-panel output{font-variant-numeric:tabular-nums} #loading-panel .hint{color:#aebbc2;margin:10px 0 0}
      #loading-panel .status{display:block;min-height:2.8em;margin-top:9px;color:#b7d7c3} #loading-panel .status.warn{color:#ffcc79} #loading-panel .status.error{color:#ff9a91}
      @media(max-height:700px){#loading-panel .loading-controls{max-height:max(120px,calc(100vh - 370px));overflow:auto}}
      @media(max-height:400px){#loading-panel{top:8px}}
      @media(max-width:700px){#loading-panel{top:52px;right:8px;width:min(290px,calc(100vw - 16px))}}
    `
    document.head.appendChild(style)
    this.panel = document.createElement('details')
    this.panel.id = 'loading-panel'
    this.panel.innerHTML = `<summary>Fuel &amp; payload</summary><div class="loading-controls">
      <label>Units<select aria-label="Loading units"><option value="kg">kg</option><option value="lb">lb</option></select></label>
      <label>Pilot / passengers / bags<input aria-label="Payload" inputmode="decimal"></label>
      <label>Left tank<input aria-label="Left tank fuel" inputmode="decimal"></label>
      <label>Right tank<input aria-label="Right tank fuel" inputmode="decimal"></label>
      <div class="readout"><span>Total fuel</span><output aria-label="Total fuel"></output></div>
      <div class="readout"><span>Empty weight</span><output aria-label="Empty weight"></output></div>
      <div class="readout"><span>Gross weight</span><output aria-label="Gross weight"></output></div>
      <div class="readout"><span>MTOW</span><output aria-label="MTOW"></output></div>
      <p class="hint">Loading changes apply only while on the ground and stationary.</p>
      <button type="button">Apply loading</button><output class="status" aria-live="polite"></output>
    </div>`
    this.unit = this.panel.querySelector('select')!
    this.payload = this.panel.querySelector('[aria-label="Payload"]')!
    this.left = this.panel.querySelector('[aria-label="Left tank fuel"]')!
    this.right = this.panel.querySelector('[aria-label="Right tank fuel"]')!
    this.total = this.panel.querySelector('[aria-label="Total fuel"]')!
    this.empty = this.panel.querySelector('[aria-label="Empty weight"]')!
    this.gross = this.panel.querySelector('[aria-label="Gross weight"]')!
    this.mtow = this.panel.querySelector('[aria-label="MTOW"]')!
    this.status = this.panel.querySelector('.status')!
    this.unit.value = initialUnit
    this.panel.addEventListener('toggle', () => {
      if (this.panel.open) this.syncFromAircraft()
      else actions.enableInput()
    })
    this.panel.addEventListener('keydown', e => e.stopPropagation())
    this.panel.addEventListener('focusin', () => actions.disableInput())
    this.panel.addEventListener('focusout', () => queueMicrotask(() => {
      if (!this.panel.contains(document.activeElement)) actions.enableInput()
    }))
    this.unit.onchange = () => {
      const selection = this.readDraft(this.draftUnit)
      if (selection) this.canonicalDraft = selection
      this.draftUnit = this.unit.value as MassUnit
      this.dirty.clear()
      this.writeDraft(this.canonicalDraft)
      this.refresh()
    }
    const fields = [['payloadKg', this.payload], ['leftKg', this.left], ['rightKg', this.right]] as const
    for (const [key, field] of fields) field.oninput = () => { this.dirty.add(key); this.refresh() }
    this.panel.querySelector('button')!.onclick = () => {
      const selection = this.readDraft(this.draftUnit)
      if (!selection) { this.show('Enter finite numbers for payload and both tanks.', 'error'); return }
      const result = actions.apply(selection, this.draftUnit)
      this.show(result.message, result.applied ? (result.overweight ? 'warn' : '') : 'error')
      if (result.applied) this.syncFromAircraft()
    }
    mountFlightPanel(this.panel)
    this.syncFromAircraft()
  }

  private format(kg: number): string { return `${toDisplayMass(kg, this.draftUnit).toFixed(1)} ${this.draftUnit}` }
  private writeDraft(s: LoadingSelection): void {
    this.payload.value = toDisplayMass(s.payloadKg, this.draftUnit).toFixed(1)
    this.left.value = toDisplayMass(s.leftKg, this.draftUnit).toFixed(1)
    this.right.value = toDisplayMass(s.rightKg, this.draftUnit).toFixed(1)
  }
  private readDraft(unit: MassUnit): LoadingSelection | null {
    return readLoadingDraft(this.canonicalDraft, {
      payloadKg: this.payload.value,
      leftKg: this.left.value,
      rightKg: this.right.value,
    }, this.dirty, unit)
  }
  private syncFromAircraft(): void {
    this.canonicalDraft = this.actions.current()
    this.dirty.clear()
    this.writeDraft(this.canonicalDraft)
    this.refresh()
  }
  private refresh(): void {
    this.empty.value = this.format(this.params.emptyMassKg)
    this.mtow.value = this.format(this.params.mtowKg)
    const s = this.readDraft(this.draftUnit)
    if (!s) { this.total.value = '—'; this.gross.value = '—'; this.show('Enter finite numbers for payload and both tanks.', 'error'); return }
    this.total.value = this.format(s.leftKg + s.rightKg)
    const result = validateLoading(s, this.params)
    this.gross.value = this.format(result.grossKg)
    this.show(result.message, !result.valid ? 'error' : result.overweight ? 'warn' : '')
  }
  private show(message: string, kind: '' | 'warn' | 'error'): void {
    this.status.value = message
    this.status.className = `status${kind ? ` ${kind}` : ''}`
  }
}
