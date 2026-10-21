/**
 * Canvas painters for the 737NG flight deck (cockpit-737.ts). Layouts follow
 * the published 737NG flight-deck arrangement (FCOM panel diagrams): the
 * forward overhead's system columns, the main instrument panel around the
 * six display units, the glareshield EFIS/MCP/annunciator faces and the
 * aisle stand. Painted switchgear is COSMETIC unless a live painter says
 * otherwise — recorded in PROGRESS.md. No logos or trademarks are drawn.
 */

import type { DuLayoutName } from './cockpit-profile'

/** Panel face / seam colours — set per airplane (manufacturer palette)
 *  before the deck paints; every painter reads the current values. */
export let PANEL_GRAY = '#565b60'
export let PANEL_EDGE = '#3f4347'
export function setPanelPalette(panel: string, edge: string): void {
  PANEL_GRAY = panel
  PANEL_EDGE = edge
}

/** Which family's legends the panels carry. */
export type PanelStyle = 'boeing' | 'airbus' | 'generic'
export const ENGRAVE = '#eceae0'
const LIGHT_OFF = '#2a2d30'

export type Ctx = CanvasRenderingContext2D

/** Widest an engraving may run (px); labels shrink to fit their cell. */
let fitWidth = Infinity
export function withFit<T>(maxW: number, fn: () => T): T {
  const prev = fitWidth
  fitWidth = maxW
  try { return fn() } finally { fitWidth = prev }
}

export function engrave(c: Ctx, text: string, x: number, y: number, size: number, align: CanvasTextAlign = 'center', color = ENGRAVE): void {
  c.fillStyle = color
  c.font = `600 ${size}px "Helvetica Neue", Arial, sans-serif`
  if (Number.isFinite(fitWidth)) {
    const w = c.measureText(text).width
    if (w > fitWidth) c.font = `600 ${Math.max(6, size * (fitWidth / w))}px "Helvetica Neue", Arial, sans-serif`
  }
  c.textAlign = align
  c.textBaseline = 'middle'
  c.fillText(text, x, y)
}

export function screw(c: Ctx, x: number, y: number, r = 5): void {
  c.fillStyle = '#2e3134'
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill()
  c.strokeStyle = 'rgba(210,210,210,0.45)'; c.lineWidth = 1.2
  c.beginPath(); c.moveTo(x - r * 0.6, y - r * 0.2); c.lineTo(x + r * 0.6, y + r * 0.2); c.stroke()
}

/** A screwed sub-panel plate with an optional engraved title bar. */
export function plate(c: Ctx, x: number, y: number, w: number, h: number, title?: string, size = 15): void {
  c.fillStyle = PANEL_GRAY
  c.fillRect(x, y, w, h)
  c.strokeStyle = PANEL_EDGE; c.lineWidth = 3
  c.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3)
  const g = c.createLinearGradient(x, y, x, y + h)
  g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.08)')
  c.fillStyle = g; c.fillRect(x, y, w, h)
  for (const [sx, sy] of [[x + 9, y + 9], [x + w - 9, y + 9], [x + 9, y + h - 9], [x + w - 9, y + h - 9]] as const) screw(c, sx, sy, 4)
  if (title) {
    engrave(c, title, x + w / 2, y + size * 0.9 + 4, size)
    c.strokeStyle = ENGRAVE; c.lineWidth = 1.5
    const tw = c.measureText(title).width
    for (const s of [-1, 1]) {
      c.beginPath()
      c.moveTo(x + w / 2 + s * (tw / 2 + 8), y + size * 0.9 + 4)
      c.lineTo(s < 0 ? x + 18 : x + w - 18, y + size * 0.9 + 4)
      c.stroke()
    }
  }
}

/** Toggle switch seen nearly head-on: bezel nut + bat handle (up/down). */
export function toggle(c: Ctx, x: number, y: number, label: string, up = true, s = 1, labelBelow = true): void {
  c.fillStyle = '#1b1d1f'
  c.beginPath(); c.arc(x, y, 9 * s, 0, Math.PI * 2); c.fill()
  c.fillStyle = '#9fa4a8'
  c.beginPath(); c.arc(x, y, 6 * s, 0, Math.PI * 2); c.fill()
  const dy = up ? -1 : 1
  c.fillStyle = '#d8dadb'
  c.beginPath(); c.roundRect(x - 4 * s, y + (up ? -20 : 2) * s, 8 * s, 18 * s, 3 * s); c.fill()
  c.fillStyle = '#f2f2f0'
  c.beginPath(); c.arc(x, y + dy * 19 * s, 5 * s, 0, Math.PI * 2); c.fill()
  if (label) engrave(c, label, x, labelBelow ? y + 34 * s : y - 34 * s, 11 * s)
}

/** Red-guarded toggle (closed guard). */
export function guarded(c: Ctx, x: number, y: number, label: string, s = 1, color = '#b3261e'): void {
  toggle(c, x, y, '', false, s)
  c.fillStyle = color
  c.globalAlpha = 0.92
  c.beginPath(); c.roundRect(x - 13 * s, y - 16 * s, 26 * s, 36 * s, 4 * s); c.fill()
  c.globalAlpha = 1
  c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1.5
  c.strokeRect(x - 13 * s, y - 16 * s, 26 * s, 36 * s)
  if (label) engrave(c, label, x, y + 34 * s, 11 * s)
}

/** Rotary selector knob with pointer and optional position labels. */
export function knob(c: Ctx, x: number, y: number, r: number, angle = -Math.PI / 2, labels?: Array<[string, number]>, title?: string): void {
  if (labels) for (const [t, a] of labels) {
    engrave(c, t, x + Math.cos(a) * (r + 16), y + Math.sin(a) * (r + 12), Math.max(9, r * 0.45))
    c.strokeStyle = ENGRAVE; c.lineWidth = 1.5
    c.beginPath(); c.moveTo(x + Math.cos(a) * (r + 2), y + Math.sin(a) * (r + 2)); c.lineTo(x + Math.cos(a) * (r + 6), y + Math.sin(a) * (r + 6)); c.stroke()
  }
  const g = c.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r)
  g.addColorStop(0, '#4b4f53'); g.addColorStop(1, '#151618')
  c.fillStyle = g
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill()
  c.strokeStyle = '#ececea'; c.lineWidth = Math.max(2, r * 0.18)
  c.beginPath(); c.moveTo(x + Math.cos(angle) * r * 0.2, y + Math.sin(angle) * r * 0.2); c.lineTo(x + Math.cos(angle) * r * 0.92, y + Math.sin(angle) * r * 0.92); c.stroke()
  if (title) engrave(c, title, x, y + r + (labels ? 30 : 16), Math.max(10, r * 0.5))
}

/** Annunciator / pushbutton light: dark when off, legend lit in its color. */
export function lamp(c: Ctx, x: number, y: number, w: number, h: number, lines: string[], color: string, lit = false): void {
  c.fillStyle = '#121416'
  c.beginPath(); c.roundRect(x - 2, y - 2, w + 4, h + 4, 3); c.fill()
  c.fillStyle = lit ? color : LIGHT_OFF
  c.beginPath(); c.roundRect(x, y, w, h, 2); c.fill()
  if (lit) { c.shadowColor = color; c.shadowBlur = 12 }
  const size = Math.min(h / (lines.length + 0.6), w / Math.max(...lines.map(l => l.length)) * 1.55, 15)
  lines.forEach((l, i) => engrave(c, l, x + w / 2, y + h / 2 + (i - (lines.length - 1) / 2) * size * 1.05, size, 'center', lit ? '#101010' : shade(color)))
  c.shadowBlur = 0
}

function shade(color: string): string {
  // Unlit legend: the color's dim ghost through the dark lens.
  const n = parseInt(color.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return `rgb(${Math.round(r * 0.32 + 20)},${Math.round(g * 0.32 + 20)},${Math.round(b * 0.32 + 20)})`
}

export const AMBER = '#ffb020'
export const BLUE = '#36a8ff'
export const GREEN = '#3fe06a'
export const RED = '#ff3326'
export const WHITE_LIGHT = '#f4f2e6'

/** Round analog gauge face. */
export function gauge(c: Ctx, x: number, y: number, r: number, title: string, ticks = 10, needle = 0.3): void {
  c.fillStyle = '#0f1012'
  c.beginPath(); c.arc(x, y, r + 5, 0, Math.PI * 2); c.fill()
  c.fillStyle = '#18191b'
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill()
  c.strokeStyle = '#e8e8e2'; c.lineWidth = 2
  for (let i = 0; i <= ticks; i++) {
    const a = Math.PI * 0.75 + (i / ticks) * Math.PI * 1.5
    c.beginPath(); c.moveTo(x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78); c.lineTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92); c.stroke()
  }
  const a = Math.PI * 0.75 + needle * Math.PI * 1.5
  c.strokeStyle = '#f4f4ee'; c.lineWidth = 3
  c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8); c.stroke()
  engrave(c, title, x, y + r * 0.45, Math.max(9, r * 0.22))
}

/** Digital readout window (LCD). */
export function readout(c: Ctx, x: number, y: number, w: number, h: number, text: string, color = '#ffd27a'): void {
  c.fillStyle = '#060707'
  c.beginPath(); c.roundRect(x, y, w, h, 3); c.fill()
  c.strokeStyle = '#2b2e31'; c.lineWidth = 2; c.strokeRect(x, y, w, h)
  c.fillStyle = color
  c.font = `600 ${Math.round(h * 0.68)}px "Courier New", monospace`
  c.textAlign = 'center'; c.textBaseline = 'middle'
  c.fillText(text, x + w / 2, y + h / 2 + 1)
}

// ---------------------------------------------------------------------------
// Forward overhead panel
// ---------------------------------------------------------------------------

type Item =
  | { t: 'tog'; l: string; up?: boolean }
  | { t: 'grd'; l: string }
  | { t: 'knob'; l: string; pos?: string[] }
  | { t: 'lamp'; l: string[]; c: string }
  | { t: 'gauge'; l: string }
  | { t: 'dig'; v: string }
  | { t: 'gap' }

interface Section { title: string; rows: Item[][] }

const TOG = (l: string, up = true): Item => ({ t: 'tog', l, up })
const GRD = (l: string): Item => ({ t: 'grd', l })
const KNOB = (l: string, pos?: string[]): Item => ({ t: 'knob', l, ...(pos ? { pos } : {}) })
const LAMP = (c: string, ...l: string[]): Item => ({ t: 'lamp', l, c })
const GAUGE = (l: string): Item => ({ t: 'gauge', l })
const DIG = (v: string): Item => ({ t: 'dig', v })
const GAP: Item = { t: 'gap' }

/** Forward overhead, five system columns over the exterior-lights /
 *  engine-start row, which sits along the FORWARD edge (by the windshield
 *  center post). Canvas top = aft edge, as the pilot reads it looking up. */
const OVERHEAD_COLUMNS: Section[][] = [
  [
    { title: 'FLIGHT CONTROL', rows: [[GRD('A'), GRD('B'), GRD('ALTN FLAPS')], [LAMP(AMBER, 'LOW', 'QUANTITY'), LAMP(AMBER, 'LOW', 'PRESSURE'), LAMP(AMBER, 'FEEL', 'DIFF PRESS')], [GRD('SPOILER A'), GRD('SPOILER B'), TOG('YAW DAMPER')], [LAMP(AMBER, 'YAW', 'DAMPER'), LAMP(AMBER, 'STBY RUD', 'ON'), LAMP(AMBER, 'AUTO SLAT', 'FAIL')]] },
    { title: 'NAV / DISPLAYS', rows: [[KNOB('VHF NAV'), KNOB('IRS'), KNOB('FMC')], [KNOB('SOURCE'), KNOB('CONTROL PANEL'), GAP]] },
    { title: 'FUEL', rows: [[GAUGE('FUEL TEMP'), LAMP(BLUE, 'VALVE', 'CLOSED'), LAMP(BLUE, 'VALVE', 'CLOSED')], [LAMP(AMBER, 'FILTER', 'BYPASS'), KNOB('CROSSFEED'), LAMP(AMBER, 'FILTER', 'BYPASS')], [TOG('CTR L'), TOG('CTR R'), LAMP(AMBER, 'LOW', 'PRESSURE')], [TOG('L AFT'), TOG('L FWD'), TOG('R FWD'), TOG('R AFT')]] },
  ],
  [
    { title: 'ELECTRICAL', rows: [[DIG('28'), DIG('115'), DIG('400')], [KNOB('DC', ['STBY', 'BAT', 'TR1', 'TR2']), KNOB('AC', ['STBY', 'GRD', 'GEN1', 'APU', 'GEN2'])], [LAMP(AMBER, 'BAT', 'DISCHARGE'), LAMP(AMBER, 'TR UNIT'), LAMP(AMBER, 'ELEC')], [GRD('BAT'), GRD('STANDBY PWR'), LAMP(AMBER, 'STANDBY', 'PWR OFF')]] },
    { title: 'GENERATORS', rows: [[LAMP(AMBER, 'DRIVE'), LAMP(AMBER, 'DRIVE'), GAP], [GRD('DISCONNECT 1'), GRD('DISCONNECT 2'), TOG('BUS TRANS')], [LAMP(BLUE, 'GRD POWER', 'AVAILABLE'), TOG('GRD PWR'), GAP], [LAMP(BLUE, 'GEN OFF', 'BUS'), LAMP(BLUE, 'APU GEN', 'OFF BUS'), LAMP(BLUE, 'GEN OFF', 'BUS')], [TOG('GEN 1'), TOG('APU GEN'), TOG('APU GEN'), TOG('GEN 2')]] },
    { title: 'APU', rows: [[GAUGE('APU EGT'), LAMP(BLUE, 'MAINT'), LAMP(AMBER, 'LOW OIL', 'PRESSURE')], [LAMP(AMBER, 'FAULT'), LAMP(AMBER, 'OVER', 'SPEED'), GAP]] },
  ],
  [
    { title: 'CABIN / WINDOW HEAT', rows: [[TOG('EQUIP SUPPLY'), TOG('EQUIP EXHAUST'), GRD('EMER EXIT LTS')], [TOG('NO SMOKING'), TOG('FASTEN BELTS'), LAMP(BLUE, 'NOT', 'ARMED')], [LAMP(GREEN, 'ON'), LAMP(GREEN, 'ON'), LAMP(GREEN, 'ON'), LAMP(GREEN, 'ON')], [TOG('L SIDE'), TOG('L FWD'), TOG('R FWD'), TOG('R SIDE')], [LAMP(AMBER, 'OVERHEAT'), LAMP(AMBER, 'OVERHEAT'), LAMP(AMBER, 'OVERHEAT'), LAMP(AMBER, 'OVERHEAT')]] },
    { title: 'PROBE HEAT', rows: [[TOG('A'), TOG('B'), GAP], [LAMP(AMBER, 'CAPT', 'PITOT'), LAMP(AMBER, 'L ELEV', 'PITOT'), LAMP(AMBER, 'L ALPHA', 'VANE'), LAMP(AMBER, 'TEMP', 'PROBE')], [LAMP(AMBER, 'F/O', 'PITOT'), LAMP(AMBER, 'R ELEV', 'PITOT'), LAMP(AMBER, 'R ALPHA', 'VANE'), LAMP(AMBER, 'AUX', 'PITOT')]] },
    { title: 'WIPERS', rows: [[KNOB('L', ['PARK', 'INT', 'LOW', 'HIGH']), KNOB('R', ['PARK', 'INT', 'LOW', 'HIGH'])]] },
  ],
  [
    { title: 'ANTI-ICE', rows: [[LAMP(BLUE, 'L VALVE', 'OPEN'), LAMP(BLUE, 'R VALVE', 'OPEN'), LAMP(AMBER, 'COWL', 'ANTI-ICE'), LAMP(AMBER, 'COWL', 'ANTI-ICE')], [TOG('WING', false), TOG('ENG 1', false), TOG('ENG 2', false)]] },
    { title: 'HYDRAULIC PUMPS', rows: [[LAMP(AMBER, 'OVERHEAT'), LAMP(AMBER, 'OVERHEAT'), GAP, GAP], [LAMP(AMBER, 'LOW', 'PRESSURE'), LAMP(AMBER, 'LOW', 'PRESSURE'), LAMP(AMBER, 'LOW', 'PRESSURE'), LAMP(AMBER, 'LOW', 'PRESSURE')], [TOG('ENG 1'), TOG('ELEC 2'), TOG('ELEC 1'), TOG('ENG 2')]] },
    { title: 'DOORS', rows: [[LAMP(AMBER, 'FWD', 'ENTRY'), LAMP(AMBER, 'FWD', 'SERVICE'), LAMP(AMBER, 'LEFT FWD', 'OVERWING')], [LAMP(AMBER, 'AFT', 'ENTRY'), LAMP(AMBER, 'AFT', 'SERVICE'), LAMP(AMBER, 'EQUIP')]] },
    { title: 'CABIN ALTITUDE', rows: [[GAUGE('CABIN ALT'), GAUGE('CABIN CLIMB')]] },
  ],
  [
    { title: 'AIR CONDITIONING', rows: [[GAUGE('DUCT TEMP'), KNOB('TEMP SEL')], [KNOB('CONT CAB'), KNOB('FWD CAB'), KNOB('AFT CAB')], [LAMP(AMBER, 'ZONE', 'TEMP'), LAMP(AMBER, 'ZONE', 'TEMP'), LAMP(AMBER, 'ZONE', 'TEMP')], [TOG('TRIM AIR'), TOG('L RECIRC FAN'), TOG('R RECIRC FAN')]] },
    { title: 'BLEED', rows: [[GAUGE('DUCT PRESS'), LAMP(AMBER, 'DUAL', 'BLEED'), LAMP(BLUE, 'RAM DOOR', 'FULL OPEN')], [LAMP(AMBER, 'PACK'), LAMP(AMBER, 'WING-BODY', 'OVERHEAT'), LAMP(AMBER, 'PACK')], [TOG('L PACK'), KNOB('ISOLATION', ['CLOSE', 'AUTO', 'OPEN']), TOG('R PACK')], [TOG('1'), TOG('APU'), TOG('2')]] },
    { title: 'PRESSURIZATION', rows: [[DIG('35000'), DIG('00450')], [LAMP(AMBER, 'AUTO', 'FAIL'), LAMP(AMBER, 'OFF', 'SCHED DES'), LAMP(GREEN, 'ALTN'), LAMP(GREEN, 'MANUAL')], [KNOB('MODE', ['AUTO', 'ALTN', 'MAN']), TOG('VALVE'), GAUGE('OUTFLOW')]] },
  ],
]

/** Exterior-light / start row. LIVE: the landing-light switches follow
 *  the sim's landing lights; position/anti-collision/logo read ON because
 *  the sim runs those whenever the airplane is powered (no separate
 *  switch is modeled — the painted taxi/turnoff/wing/wheel-well read OFF). */
export interface OverheadState { landing: boolean; powered: boolean }
export const LIGHTS_ROW_LANDING = 4 // the first four items are the landing lights
function lightsRow(o: OverheadState): Item[] {
  return [
    TOG('L RETR', o.landing), TOG('R RETR', o.landing), TOG('L FIXED', o.landing), TOG('R FIXED', o.landing), GAP,
    TOG('L TURNOFF', false), TOG('R TURNOFF', false), TOG('TAXI', false), GAP,
    KNOB('APU', ['OFF', 'ON', 'START']), GAP,
    KNOB('ENGINE 1', ['GRD', 'OFF', 'CONT', 'FLT']), TOG('IGN', true), KNOB('ENGINE 2', ['GRD', 'OFF', 'CONT', 'FLT']), GAP,
    TOG('LOGO', o.powered), TOG('POSITION', o.powered), TOG('ANTI COLLISION', o.powered), TOG('WING', false), TOG('WHEEL WELL', false),
  ]
}
/** Canvas-space box of one item in the lights / engine-start row. */
export function lightsRowItemBox(W: number, H: number, index: number): { x0: number; x1: number; y0: number; y1: number } {
  const lightsH = H * 0.13, n = lightsRow({ landing: false, powered: true }).length, cw = (W - 30) / n
  return { x0: 15 + index * cw, x1: 15 + (index + 1) * cw, y0: H - lightsH + 4, y1: H - 10 }
}
/** Lights-row indices of the ENGINE 1 / ENGINE 2 start selectors. */
export const ENGINE_START_ITEMS = [11, 13] as const

/** Canvas-space box of the landing-light switch group (for the 3D hit). */
export function landingSwitchBox(W: number, H: number): { x0: number; x1: number; y0: number; y1: number } {
  const lightsH = H * 0.13, n = lightsRow({ landing: false, powered: true }).length, cw = (W - 30) / n
  return { x0: 15, x1: 15 + LIGHTS_ROW_LANDING * cw, y0: H - lightsH + 4, y1: H - 10 }
}

function drawItem(c: Ctx, it: Item, x: number, y: number, w: number, h: number): void {
  withFit(w * 0.92, () => drawItemFit(c, it, x, y, w, h))
}

function drawItemFit(c: Ctx, it: Item, x: number, y: number, w: number, h: number): void {
  const cx = x + w / 2, cy = y + h / 2
  const s = Math.min(w, h) / 70
  switch (it.t) {
    case 'tog': toggle(c, cx, cy - 6 * s, it.l, it.up ?? true, s); break
    case 'grd': guarded(c, cx, cy - 6 * s, it.l, s); break
    case 'knob': {
      const pos = it.pos
      const labels = pos?.map((p, i) => [p, -Math.PI * 0.8 + (i / Math.max(1, pos.length - 1)) * Math.PI * 0.6] as [string, number])
      knob(c, cx, cy + (labels ? 6 : -4) * s, 15 * s, labels ? labels[Math.min(1, labels.length - 1)]![1] : -Math.PI / 2, labels, it.l)
      break
    }
    case 'lamp': lamp(c, cx - 30 * s, cy - 15 * s, 60 * s, 30 * s, it.l, it.c, false); break
    case 'gauge': gauge(c, cx, cy, 26 * s, it.l, 8, 0.25); break
    case 'dig': readout(c, cx - 30 * s, cy - 12 * s, 60 * s, 24 * s, it.v); break
    case 'gap': break
  }
}

function drawSection(c: Ctx, sec: Section, x: number, y: number, w: number, h: number): void {
  plate(c, x, y, w, h, sec.title, 16)
  const top = y + 34, rh = (h - 44) / sec.rows.length
  sec.rows.forEach((row, ri) => {
    const cw = (w - 20) / row.length
    row.forEach((it, ci) => drawItem(c, it, x + 10 + ci * cw, top + ri * rh, cw, rh))
  })
}

/** Paint the forward overhead on a W×H canvas (top = aft edge). */
export function paintOverhead(c: Ctx, W: number, H: number, state: OverheadState = { landing: false, powered: true }): void {
  c.fillStyle = '#2f3236'
  c.fillRect(0, 0, W, H)
  const lightsH = H * 0.13
  const colW = W / OVERHEAD_COLUMNS.length
  OVERHEAD_COLUMNS.forEach((col, ci) => {
    const weights = col.map(s => s.rows.length + 0.6)
    const total = weights.reduce((a, b) => a + b, 0)
    let y = 6
    col.forEach((sec, si) => {
      const h = ((H - lightsH - 12) * weights[si]!) / total
      drawSection(c, sec, ci * colW + 4, y, colW - 8, h - 6)
      y += h
    })
  })
  // Forward edge: exterior lights, APU and engine start.
  plate(c, 4, H - lightsH, W - 8, lightsH - 6)
  const row = lightsRow(state)
  const n = row.length, cw = (W - 30) / n
  row.forEach((it, i) => drawItem(c, it, 15 + i * cw, H - lightsH + 4, cw, lightsH - 14))
}

// ---------------------------------------------------------------------------
// Main instrument panel
// ---------------------------------------------------------------------------

/** A/P, A/T, FMC P/RST light strip height (below the glareshield hood). */
export const PRST_UP = 0.795

/** The disconnect-light strip on its own canvas (LIVE overlay): the A/P and
 *  A/T lamps flash red after a disconnect until reset. Legends per family. */
export function paintPrst(c: Ctx, W: number, H: number, ap: boolean, at: boolean, style: PanelStyle = 'boeing'): void {
  c.fillStyle = PANEL_GRAY
  c.fillRect(0, 0, W, H)
  const items: Array<[string[], string, boolean]> = style === 'boeing'
    ? [[['A/P', 'P/RST'], RED, ap], [['A/T', 'P/RST'], RED, at], [['FMC', 'P/RST'], AMBER, false]]
    : style === 'airbus'
      ? [[['AUTO', 'LAND'], RED, ap], [['A/THR', 'DISC'], AMBER, at], [['TERR', 'ON ND'], GREEN, false]]
      : [[['AP', 'DISC'], RED, ap], [['AT', 'DISC'], AMBER, at], [['TAWS', 'INHB'], AMBER, false]]
  items.forEach(([t, col, lit], i) => lamp(c, (i + 0.1) * (W / 3), H * 0.08, (W / 3) * 0.8, H * 0.84, t, col, lit))
}

/** Main-panel outline in panel metres: lateral (−left) / up, shared by the
 *  painter and the 3D builder; the `six` display positions are the 737NG's. */
export const MIP = {
  left: -0.84, right: 0.84, bottom: 0.3, top: 0.83,
  /** DU bezel size and active (glass) size, metres. */
  du: 0.215, glass: 0.172,
  duUp: 0.66,
  captPfd: -0.645, captNd: -0.42, upperDu: 0, lowerDu: 0, lowerDuUp: 0.425,
  foNd: 0.42, foPfd: 0.645,
  /** Knee cut-outs: the side panels stop above the pilots' knees. */
  sideBottom: 0.47,
  centerHalf: 0.315,
  isfd: { lat: -0.235, up: 0.705, size: 0.088 },
  gear: { lat: 0.215, up: 0.66 },
} as const

export type DuKind = 'pfd' | 'nd' | 'eicas' | 'lower'
export interface DuSlot { kind: DuKind; lat: number; up: number; w: number; h: number }
export interface DeckLayout {
  name: DuLayoutName
  dus: DuSlot[]
  isfd: { lat: number; up: number; size: number }
  gear: { lat: number; up: number; scale: number }
  /** MFDs carry the engine display beside the map (no dedicated EICAS DU). */
  ndEngines: boolean
}

/** Display arrangements (published flight decks): six 8-inch DUs (737NG,
 *  757/767/777/747, A320–A380, CRJ, MD-11); four large landscape DUs
 *  (737 MAX, Gulfstream PlaneView, Falcon EASy, Pro Line turboprops);
 *  five (787, A220, E-Jets, Q400, ATR -600, Citation X); three (Citation CJ /
 *  Latitude, Phenom, HondaJet). Glass = bezel less 2.15 cm a side. */
export function deckLayout(name: DuLayoutName): DeckLayout {
  const m = MIP
  const sq = (kind: DuKind, lat: number, up: number = m.duUp): DuSlot => ({ kind, lat, up, w: m.du, h: m.du })
  const wide = (kind: DuKind, lat: number, w: number, up: number = m.duUp): DuSlot => ({ kind, lat, up, w, h: w * 0.75 })
  switch (name) {
    case 'fourWide':
      return { name, ndEngines: true, dus: [wide('pfd', -0.6, 0.27), wide('nd', -0.3, 0.27), wide('nd', 0.3, 0.27), wide('pfd', 0.6, 0.27)], isfd: { lat: -0.08, up: 0.705, size: 0.088 }, gear: { lat: 0.085, up: 0.66, scale: 1 } }
    case 'fiveWide':
      return { name, ndEngines: false, dus: [wide('pfd', -0.6, 0.22), wide('nd', -0.33, 0.22), wide('eicas', 0, 0.22), wide('nd', 0.33, 0.22), wide('pfd', 0.6, 0.22)], isfd: { lat: -0.165, up: 0.705, size: 0.085 }, gear: { lat: 0.165, up: 0.66, scale: 0.72 } }
    case 'threeWide':
      return { name, ndEngines: true, dus: [wide('pfd', -0.55, 0.26), wide('nd', 0, 0.32, 0.65), wide('pfd', 0.55, 0.26)], isfd: { lat: -0.295, up: 0.705, size: 0.088 }, gear: { lat: 0.295, up: 0.66, scale: 1 } }
    default:
      return { name: 'six', ndEngines: false, dus: [sq('pfd', m.captPfd), sq('nd', m.captNd), sq('eicas', m.upperDu), sq('lower', m.lowerDu, m.lowerDuUp), sq('nd', m.foNd), sq('pfd', m.foPfd)], isfd: { ...m.isfd }, gear: { ...m.gear, scale: 1 } }
  }
}

/** Glass (active area) of a slot. */
export function duGlass(s: DuSlot): { w: number; h: number } {
  return { w: s.w - 0.043, h: s.h - 0.043 }
}

/** Paint the MIP face for a layout and family. */
export function paintMip(c: Ctx, W: number, H: number, layout: DeckLayout = deckLayout('six'), style: PanelStyle = 'boeing', turboprop = false): void {
  const m = MIP
  const sx = W / (m.right - m.left), sy = H / (m.top - m.bottom)
  const px = (lat: number): number => (lat - m.left) * sx
  const py = (up: number): number => (m.top - up) * sy
  c.clearRect(0, 0, W, H)
  // Panel silhouette: full-width upper band, side panels down to the knee
  // line, center panel down to the pedestal.
  c.fillStyle = PANEL_GRAY
  c.beginPath()
  c.moveTo(px(m.left), py(m.top))
  c.lineTo(px(m.right), py(m.top))
  c.lineTo(px(m.right), py(m.sideBottom))
  c.lineTo(px(m.centerHalf + 0.02), py(m.sideBottom))
  c.lineTo(px(m.centerHalf - 0.03), py(m.bottom))
  c.lineTo(px(-m.centerHalf + 0.03), py(m.bottom))
  c.lineTo(px(-m.centerHalf - 0.02), py(m.sideBottom))
  c.lineTo(px(m.left), py(m.sideBottom))
  c.closePath()
  c.fill()
  const g = c.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, 'rgba(255,255,255,0.06)'); g.addColorStop(1, 'rgba(0,0,0,0.1)')
  c.globalCompositeOperation = 'source-atop'
  c.fillStyle = g; c.fillRect(0, 0, W, H)
  c.globalCompositeOperation = 'source-over'
  // Panel seams: captain / center / F/O sections.
  c.strokeStyle = PANEL_EDGE; c.lineWidth = 4
  for (const lat of [-m.centerHalf, m.centerHalf]) { c.beginPath(); c.moveTo(px(lat), py(m.top)); c.lineTo(px(lat), py(m.sideBottom)); c.stroke() }
  for (let lat = m.left + 0.04; lat < m.right; lat += 0.21) { screw(c, px(lat), py(m.top - 0.012), 6) }

  // Display bezels with glass (the live screens render just proud of them).
  for (const slot of layout.dus) {
    const w = slot.w * sx, h = slot.h * sy, x = px(slot.lat) - w / 2, y = py(slot.up) - h / 2
    c.fillStyle = '#1d1f21'
    c.beginPath(); c.roundRect(x, y, w, h, 14); c.fill()
    c.strokeStyle = '#0c0d0e'; c.lineWidth = 3; c.stroke()
    const gl = duGlass(slot)
    c.fillStyle = '#040506'
    c.fillRect(px(slot.lat) - (gl.w * sx) / 2, py(slot.up) - (gl.h * sy) / 2, gl.w * sx, gl.h * sy)
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) screw(c, px(slot.lat) + dx * (w / 2 - 12), py(slot.up) + dy * (h / 2 - 12), 5)
    knob(c, px(slot.lat) + w / 2 - 22, py(slot.up) + h / 2 - 22, 9)
    c.fillStyle = '#0a0b0c'; c.beginPath(); c.arc(px(slot.lat) - w / 2 + 20, py(slot.up) + h / 2 - 20, 5, 0, Math.PI * 2); c.fill()
  }

  // Captain / F/O panels: clock, display selectors, glideslope inhibit.
  const clock = (lat: number, up: number): void => {
    const r = 0.034 * sx
    c.fillStyle = '#121315'; c.beginPath(); c.arc(px(lat), py(up), r + 6, 0, Math.PI * 2); c.fill()
    c.fillStyle = '#1b1c1e'; c.beginPath(); c.arc(px(lat), py(up), r, 0, Math.PI * 2); c.fill()
    readout(c, px(lat) - r * 0.6, py(up) - r * 0.45, r * 1.2, r * 0.36, '12:00', '#ffcf6a')
    readout(c, px(lat) - r * 0.45, py(up) + r * 0.12, r * 0.9, r * 0.3, '00:00', '#ffcf6a')
    engrave(c, 'CHR', px(lat) - r * 0.7, py(up) - r - 14, 12); engrave(c, 'ET', px(lat) + r * 0.7, py(up) - r - 14, 12)
  }
  clock(-0.775, 0.765)
  clock(0.775, 0.765)
  const pfdLats = layout.dus.filter(d => d.kind === 'pfd').map(d => d.lat)
  for (const side of [-1, 1]) {
    const lat0 = pfdLats.find(l => Math.sign(l) === side) ?? side * 0.645
    // Disconnect lights (painted; the LIVE strip overlays them).
    paintPrstAt(c, px(lat0), py(PRST_UP), 0.18 * sx, 0.024 * sy, style)
    const [selA, selB] = style === 'airbus' ? [['PFD/ND XFR', ['PFD', 'NORM', 'ND']], ['ECAM/ND XFR', ['CAPT', 'NORM', 'F/O']]] as const
      : style === 'boeing' ? [['MAIN PANEL DUs', ['OUTBD PFD', 'NORM', 'ENG PRI']], ['LOWER DU', ['ENG PRI', 'NORM', 'ND']]] as const
        : [['DISPLAY', ['PFD', 'NORM', 'MFD']], ['REVERSION', ['NORM', 'MFD', 'EICAS']]] as const
    engrave(c, selA[0], px(side * 0.69), py(0.53), 12)
    knob(c, px(side * 0.69), py(0.505), 0.013 * sx, -Math.PI / 2, [[selA[1][0], -Math.PI * 0.95], [selA[1][1], -Math.PI / 2], [selA[1][2], -Math.PI * 0.05]])
    engrave(c, selB[0], px(side * 0.57), py(0.53), 12)
    knob(c, px(side * 0.57), py(0.505), 0.013 * sx, -Math.PI / 2, [[selB[1][0], -Math.PI * 0.95], [selB[1][1], -Math.PI / 2], [selB[1][2], -Math.PI * 0.05]])
    const gsLamp = style === 'airbus' ? ['G/S', 'MODE'] : ['BELOW', 'G/S']
    lamp(c, px(side * 0.785) - 0.03 * sx, py(0.705) - 0.018 * sy, 0.06 * sx, 0.036 * sy, gsLamp, AMBER)
    engrave(c, style === 'airbus' ? 'LOUD SPKR' : 'P-INHIBIT', px(side * 0.785), py(0.672), 10)
  }
  knob(c, px(-0.785), py(0.505), 0.012 * sx, -Math.PI / 2, [['ALT', -Math.PI * 0.8], ['NORM', -Math.PI * 0.2]], style === 'airbus' ? 'A/SKID & N/W STRG' : 'NOSE WHEEL STEERING')

  // Center panel: standby display bezel (live face drawn by the 3D
  // builder), then the family's center-stack controls under it.
  const f = layout.isfd
  c.fillStyle = '#18191b'
  c.beginPath(); c.roundRect(px(f.lat) - (f.size / 2 + 0.01) * sx, py(f.up) - (f.size / 2 + 0.01) * sy, (f.size + 0.02) * sx, (f.size + 0.02) * sy, 10); c.fill()
  knob(c, px(f.lat) + (f.size / 2 - 0.003) * sx, py(f.up) + (f.size / 2 + 0.003) * sy, 9)
  const cl = f.lat, cu = f.up
  if (style === 'boeing') {
    engrave(c, turboprop ? 'TQ SET' : 'N1 SET', px(cl - 0.03), py(cu - 0.13), 11)
    knob(c, px(cl - 0.03), py(cu - 0.155), 0.012 * sx, -Math.PI / 2, [['2', -Math.PI * 0.9], ['1', -Math.PI * 0.65], ['BOTH', -Math.PI * 0.35], ['AUTO', -Math.PI * 0.1]])
    engrave(c, 'SPD REF', px(cl + 0.03), py(cu - 0.13), 11)
    knob(c, px(cl + 0.03), py(cu - 0.155), 0.012 * sx, -Math.PI / 2, [['V1', -Math.PI * 0.9], ['VR', -Math.PI * 0.7], ['WT', -Math.PI * 0.5], ['VREF', -Math.PI * 0.3], ['SET', -Math.PI * 0.1]])
    toggle(c, px(cl), py(cu - 0.235), 'FUEL FLOW', true, 0.9)
    for (const [t, i] of [['ENG', 0], ['SYS', 1]] as const) lamp(c, px(cl - 0.035 + i * 0.07) - 0.025 * sx, py(cu - 0.315) - 0.012 * sy, 0.05 * sx, 0.024 * sy, [t], WHITE_LIGHT)
    engrave(c, 'MFD', px(cl), py(cu - 0.29), 11)
  } else if (style === 'airbus') {
    for (const [t, i] of [['LO', 0], ['MED', 1], ['MAX', 2]] as const) lamp(c, px(cl - 0.05 + i * 0.05) - 0.021 * sx, py(cu - 0.15) - 0.014 * sy, 0.042 * sx, 0.028 * sy, [t, 'DECEL'], GREEN)
    engrave(c, 'AUTO/BRK', px(cl), py(cu - 0.12), 11)
    toggle(c, px(cl - 0.03), py(cu - 0.235), 'A/SKID', true, 0.9)
    lamp(c, px(cl + 0.04) - 0.025 * sx, py(cu - 0.235) - 0.014 * sy, 0.05 * sx, 0.028 * sy, ['BRK', 'FAN'], WHITE_LIGHT)
    gauge(c, px(cl), py(cu - 0.32), 0.025 * sx, 'BRAKES PSI', 6, 0.1)
  } else {
    engrave(c, 'AUTO BRAKE', px(cl), py(cu - 0.13), 11)
    knob(c, px(cl), py(cu - 0.155), 0.012 * sx, -Math.PI / 2, [['OFF', -Math.PI * 0.9], ['LO', -Math.PI * 0.6], ['MED', -Math.PI * 0.4], ['HI', -Math.PI * 0.1]])
    toggle(c, px(cl - 0.03), py(cu - 0.235), 'ANTISKID', true, 0.9)
    toggle(c, px(cl + 0.03), py(cu - 0.235), 'EMER BRK', false, 0.9)
    lamp(c, px(cl) - 0.035 * sx, py(cu - 0.315) - 0.012 * sy, 0.07 * sx, 0.024 * sy, ['DISPLAY', 'REVERSION'], WHITE_LIGHT)
  }
  const gr = layout.gear
  lamp(c, px(gr.lat) - 0.035 * sx, py(gr.up - 0.13) - 0.012 * sy, 0.07 * sx, 0.024 * sy, ['ANTISKID', 'INOP'], AMBER)
  engrave(c, style === 'airbus' ? 'LDG GEAR' : 'LANDING GEAR', px(gr.lat), py(0.81), 12)

  // F/O panel extras: brake pressure gauge, trim / speedbrake lights.
  gauge(c, px(0.785), py(0.53), 0.03 * sx, 'BRAKE PRESS', 6, 0.82)
  if (style === 'boeing') {
    lamp(c, px(0.70) - 0.04 * sx, py(0.535) - 0.012 * sy, 0.08 * sx, 0.024 * sy, ['STAB OUT', 'OF TRIM'], AMBER)
    lamp(c, px(-0.12) - 0.04 * sx, py(0.79) - 0.011 * sy, 0.08 * sx, 0.022 * sy, ['SPEED BRAKE', 'ARMED'], GREEN)
    lamp(c, px(-0.03) - 0.04 * sx, py(0.79) - 0.011 * sy, 0.08 * sx, 0.022 * sy, ['SPEED BRAKE', 'DO NOT ARM'], AMBER)
    lamp(c, px(0.06) - 0.04 * sx, py(0.79) - 0.011 * sy, 0.08 * sx, 0.022 * sy, ['STAB OUT', 'OF TRIM'], AMBER)
  } else if (style === 'airbus') {
    lamp(c, px(0.70) - 0.04 * sx, py(0.535) - 0.012 * sy, 0.08 * sx, 0.024 * sy, ['TERR', 'ON ND'], GREEN)
  } else {
    lamp(c, px(0.70) - 0.04 * sx, py(0.535) - 0.012 * sy, 0.08 * sx, 0.024 * sy, ['TRIM', 'FAIL'], AMBER)
  }
}

/** Painted disconnect-light strip (the live overlay sits over it). */
function paintPrstAt(c: Ctx, cx: number, cy: number, w: number, h: number, style: PanelStyle): void {
  c.save()
  c.translate(cx - w / 2, cy - h / 2)
  paintPrst(c, w, h, false, false, style)
  c.restore()
}

// ---------------------------------------------------------------------------
// Glareshield faces
// ---------------------------------------------------------------------------

/** EFIS control panel (captain or F/O). Cosmetic. */
export function paintEfis(c: Ctx, W: number, H: number, style: PanelStyle = 'boeing'): void {
  if (style === 'airbus') { paintEfisAirbus(c, W, H); return }
  if (style === 'generic') { paintDisplayControl(c, W, H); return }
  plate(c, 0, 0, W, H)
  const k = H / 300
  knob(c, W * 0.17, H * 0.36, 30 * k, -Math.PI / 2, [['RADIO', -Math.PI * 0.85], ['BARO', -Math.PI * 0.15]], 'MINS')
  knob(c, W * 0.83, H * 0.36, 30 * k, -Math.PI / 2, [['IN', -Math.PI * 0.85], ['HPA', -Math.PI * 0.15]], 'BARO')
  readout(c, W * 0.06, H * 0.05, W * 0.2, H * 0.1, 'RST', '#d8d8d0')
  readout(c, W * 0.74, H * 0.05, W * 0.2, H * 0.1, 'STD', '#d8d8d0')
  knob(c, W * 0.38, H * 0.36, 26 * k, -Math.PI * 0.6, [['APP', -Math.PI * 0.95], ['VOR', -Math.PI * 0.7], ['MAP', -Math.PI * 0.45], ['PLN', -Math.PI * 0.2]], 'MODE')
  knob(c, W * 0.62, H * 0.36, 26 * k, -Math.PI * 0.7, [['5', -Math.PI * 0.95], ['10', -Math.PI * 0.8], ['20', -Math.PI * 0.65], ['40', -Math.PI * 0.5], ['80', -Math.PI * 0.35], ['160', -Math.PI * 0.2], ['320', -Math.PI * 0.05]], 'RANGE')
  const btns = ['WXR', 'STA', 'WPT', 'ARPT', 'DATA', 'POS', 'TERR']
  btns.forEach((b, i) => {
    const x = W * (0.08 + i * 0.13), y = H * 0.8
    c.fillStyle = '#26292c'; c.beginPath(); c.roundRect(x - 22 * k, y - 15 * k, 44 * k, 30 * k, 4); c.fill()
    engrave(c, b, x, y, 13 * k)
  })
  toggle(c, W * 0.15, H * 0.62, 'VOR1 ADF1', true, 0.7 * k * 1.3)
  toggle(c, W * 0.85, H * 0.62, 'VOR2 ADF2', true, 0.7 * k * 1.3)
  for (const [t, x] of [['FPV', 0.4], ['MTRS', 0.6]] as const) {
    c.fillStyle = '#26292c'; c.beginPath(); c.roundRect(W * x - 22 * k, H * 0.6 - 13 * k, 44 * k, 26 * k, 4); c.fill()
    engrave(c, t, W * x, H * 0.6, 12 * k)
  }
}

/** Glareshield annunciator cluster: FIRE WARN, MASTER CAUTION and the
 *  six-pack system annunciator. LIVE: fire / caution lamps. */
export function paintAnnunciators(c: Ctx, W: number, H: number, side: 'L' | 'R', fire: boolean, caution: boolean, style: PanelStyle = 'boeing'): void {
  if (style !== 'boeing') {
    // Airbus / most other types: MASTER WARNING (red) + MASTER CAUTION
    // (amber) pushbutton lights, plus the family's extra annunciators.
    plate(c, 0, 0, W, H)
    lamp(c, W * 0.06, H * 0.1, W * 0.4, H * 0.34, ['MASTER', 'WARN'], RED, fire)
    lamp(c, W * 0.54, H * 0.1, W * 0.4, H * 0.34, ['MASTER', 'CAUT'], AMBER, caution)
    const extra = style === 'airbus' ? [['AUTO LAND', RED], ['SIDE STICK', GREEN], ['PRIORITY', RED]] : [['AP DISC', RED], ['TAWS', AMBER], ['GPWS', AMBER]]
    extra.forEach(([t, col], i) => lamp(c, W * 0.06 + i * W * 0.3, H * 0.6, W * 0.27, H * 0.28, [t!], col!))
    return
  }
  plate(c, 0, 0, W, H)
  const k = H / 300
  const bw = W * 0.4, bh = H * 0.3
  lamp(c, W * 0.06, H * 0.08, bw, bh, ['FIRE', 'WARN'], RED, fire)
  lamp(c, W * 0.54, H * 0.08, bw, bh, ['MASTER', 'CAUTION'], AMBER, caution)
  const six = side === 'L'
    ? [['FLT CONT', 'IRS'], ['FUEL', 'ELEC'], ['APU', 'OVHT/DET']]
    : [['ANTI-ICE', 'HYD'], ['DOORS', 'ENG'], ['OVERHEAD', 'AIR COND']]
  six.forEach(([a, b], i) => {
    const x = W * 0.06 + i * W * 0.3
    lamp(c, x, H * 0.5, W * 0.27, H * 0.18, [a!], AMBER)
    lamp(c, x, H * 0.72, W * 0.27, H * 0.18, [b!], AMBER)
  })
  void k
}

/** Boeing 737NG mode control panel. LIVE: SPD / HDG / ALT / V/S windows
 *  and mode-button lights from the real autopilot state. */
export interface Mcp737State {
  iasKt: number
  hdgDeg: number
  altFt: number
  vsFpm: number
  vsActive: boolean
  courseDeg: number
  cmdA: boolean
  lateral: string
  lateralArmed: boolean
  vertical: string
  verticalArmed: boolean
  speedMode: boolean
  n1Mode: boolean
  fdOn: boolean
  atArm: boolean
}

/** One clickable control on a guidance panel, as fractions of the panel
 *  canvas (centre x, centre y from the top, width, height). */
export interface McpControl { id: string; fx: number; fy: number; fw: number; fh: number }

/** The guidance panel's buttons and selector knobs for a family, matching
 *  where the painters draw them. Buttons carry `apBtn:<action>`; each knob
 *  has a left (−) and right (+) half, `apKnob:<knob>:<±1>`. Painted
 *  positions are in each painter's own units, converted here for the
 *  canvas size (k = H / 300). */
export function mcpControls(style: PanelStyle, W: number, H: number, autothrottle: boolean): McpControl[] {
  const k = H / 300
  const out: McpControl[] = []
  const btn = (action: string, cx: number, cy: number, w: number, h: number): void => { out.push({ id: `apBtn:${action}`, fx: cx / W, fy: cy / H, fw: w / W, fh: h / H }) }
  // A knob: left third turns down, right third turns up, and (where the
  // family's knobs are push-to-select, as on the FCU) the centre selects.
  const knobAt = (name: string, cx: number, cy: number, r: number, push?: string): void => {
    out.push({ id: `apKnob:${name}:-1`, fx: (cx - (2 * r) / 3) / W, fy: cy / H, fw: ((2 * r) / 3) / W, fh: (2 * r) / H })
    out.push({ id: `apKnob:${name}:1`, fx: (cx + (2 * r) / 3) / W, fy: cy / H, fw: ((2 * r) / 3) / W, fh: (2 * r) / H })
    if (push) out.push({ id: `apBtn:${push}`, fx: cx / W, fy: cy / H, fw: ((2 * r) / 3) / W, fh: (2 * r) / H })
  }
  if (style === 'boeing') {
    const by = H * 0.62 + 23 * k, bw = 70 * k, bh = 46 * k
    btn('ap', W * 0.925, by, 58 * k, bh)
    if (autothrottle) { btn('at', W * 0.15, H * 0.62, 40 * k, 60 * k); btn('speedBtn', W * 0.255, by, bw, bh) }
    btn('flc', W * 0.395 + 75 * k, by, bw, bh)
    btn('hdg', W * 0.575, by, bw, bh)
    btn('nav', W * 0.575 + 75 * k, by, bw, bh)
    btn('apr', W * 0.655 + 75 * k, by, bw, bh)
    btn('alt', W * 0.735, by, bw, bh)
    btn('vs', W * 0.82, by, bw, bh)
    knobAt('ias', W * 0.3275, H * 0.82, 26 * k); knobAt('heading', W * 0.52, H * 0.82, 26 * k); knobAt('altitude', W * 0.775, H * 0.82, 26 * k)
    knobAt('vs', W * 0.8825, H * 0.74, 14 * k)
  } else if (style === 'airbus') {
    const by = H * 0.56 + 26 * k, bw = 76 * k, bh = 52 * k
    btn('nav', W * 0.235, by, bw, bh); btn('ap', W * 0.565, by, bw, bh)
    if (autothrottle) btn('at', W * 0.655, by, bw, bh)
    btn('apr', W * 0.84, by, bw, bh)
    knobAt('ias', W * 0.12, H * 0.72, 30 * k, 'flc'); knobAt('heading', W * 0.35, H * 0.72, 30 * k, 'hdg'); knobAt('altitude', W * 0.485, H * 0.72, 30 * k, 'alt'); knobAt('vs', W * 0.93, H * 0.72, 30 * k, 'vs')
  } else {
    const by = H * 0.36 + 25 * k, bw = 72 * k, bh = 50 * k
    btn('hdg', W * 0.2, by, bw, bh); btn('nav', W * 0.2 + 78 * k, by, bw, bh); btn('apr', W * 0.2 + 156 * k, by, bw, bh)
    btn('flc', W * 0.53 + 78 * k, by, bw, bh); btn('vs', W * 0.53 + 156 * k, by, bw, bh); btn('alt', W * 0.53 + 234 * k, by, bw, bh)
    btn('ap', W * 0.68, by, bw, bh)
    if (autothrottle) btn('at', W * 0.74, by, bw, bh)
    knobAt('ias', W * 0.12, H * 0.5, 30 * k); knobAt('heading', W * 0.45, H * 0.5, 30 * k); knobAt('altitude', W * 0.86, H * 0.5, 30 * k)
  }
  return out
}

export function paintMcp737(c: Ctx, W: number, H: number, s: Mcp737State, style: PanelStyle = 'boeing', autothrottle = true): void {
  if (style === 'airbus') { paintFcuAirbus(c, W, H, s); return }
  if (style === 'generic') { paintGuidancePanel(c, W, H, s, autothrottle); return }
  c.fillStyle = '#5b6065'
  c.fillRect(0, 0, W, H)
  c.strokeStyle = '#33373a'; c.lineWidth = 4; c.strokeRect(2, 2, W - 4, H - 4)
  const k = H / 300
  const win = (x: number, w: number, label: string, value: string): void => {
    engrave(c, label, x + w / 2, H * 0.13, 17 * k)
    readout(c, x, H * 0.22, w, H * 0.24, value, '#f3efe2')
  }
  const btn = (x: number, label: string[], lit: boolean, w = 70 * k): void => {
    const y = H * 0.62, h = 46 * k
    c.fillStyle = '#d9d9d3'
    c.beginPath(); c.roundRect(x - w / 2, y, w, h, 4); c.fill()
    // the lit bar across the top of a Boeing MCP mode button
    c.fillStyle = lit ? '#9cff9c' : '#3a3f3c'
    if (lit) { c.shadowColor = '#9cff9c'; c.shadowBlur = 10 }
    c.fillRect(x - w / 2 + 6, y + 5, w - 12, 8 * k)
    c.shadowBlur = 0
    label.forEach((l, i) => engrave(c, l, x, y + 26 * k + i * 14 * k, 13 * k, 'center', '#1c1d1e'))
  }
  const knobAt = (x: number, y = H * 0.82): void => knob(c, x, y, 26 * k)
  const toggleAt = (x: number, label: string, on: boolean, light: string): void => {
    engrave(c, label, x, H * 0.13, 15 * k)
    toggle(c, x, H * 0.62, '', on, 1.15 * k)
    c.fillStyle = on ? '#9cff9c' : '#2c2f2d'
    c.beginPath(); c.arc(x, H * 0.33, 9 * k, 0, Math.PI * 2); c.fill()
    engrave(c, light, x, H * 0.43, 11 * k)
  }
  const f3 = (n: number): string => String(Math.round(((n % 360) + 360) % 360) || 360).padStart(3, '0')
  // Captain COURSE
  win(W * 0.01, W * 0.06, 'COURSE', f3(s.courseDeg)); knobAt(W * 0.04)
  toggleAt(W * 0.1, 'F/D', s.fdOn, 'MA')
  toggleAt(W * 0.15, 'A/T ARM', s.atArm, 'ARM')
  btn(W * 0.205, ['N1'], s.n1Mode)
  btn(W * 0.255, ['SPEED'], s.speedMode)
  win(W * 0.29, W * 0.075, 'IAS/MACH', String(Math.round(s.iasKt)).padStart(3, ' '))
  knobAt(W * 0.3275)
  btn(W * 0.395, ['VNAV'], false)
  btn(W * 0.395 + 75 * k, ['LVL', 'CHG'], s.vertical === 'IAS' || s.vertical === 'FLC')
  win(W * 0.49, W * 0.06, 'HEADING', f3(s.hdgDeg))
  knobAt(W * 0.52)
  btn(W * 0.575, ['HDG', 'SEL'], s.lateral === 'HDG')
  btn(W * 0.575 + 75 * k, ['LNAV'], s.lateral === 'GPS' || s.lateral === 'LNAV')
  btn(W * 0.655, ['VOR', 'LOC'], s.lateral === 'NAV' || (s.lateral === 'APR' && s.lateralArmed))
  btn(W * 0.655 + 75 * k, ['APP'], s.lateral === 'APR' || s.vertical === 'GS')
  win(W * 0.74, W * 0.07, 'ALTITUDE', String(Math.round(s.altFt)).padStart(5, ' '))
  knobAt(W * 0.775)
  btn(W * 0.735, ['ALT', 'HLD'], s.vertical === 'ALT')
  btn(W * 0.82, ['V/S'], s.vertical === 'VS')
  win(W * 0.85, W * 0.065, 'VERT SPEED', s.vsActive ? `${s.vsFpm >= 0 ? '+' : '-'}${String(Math.abs(Math.round(s.vsFpm / 50) * 50)).padStart(4, ' ')}` : '')
  // V/S thumbwheel
  c.fillStyle = '#1b1c1e'; c.fillRect(W * 0.87, H * 0.55, W * 0.025, H * 0.38)
  for (let i = 0; i < 8; i++) { c.fillStyle = '#4a4d50'; c.fillRect(W * 0.87, H * 0.57 + i * H * 0.045, W * 0.025, 3) }
  btn(W * 0.925, ['CMD', 'A'], s.cmdA, 58 * k)
  btn(W * 0.925 + 62 * k, ['CMD', 'B'], false, 58 * k)
  // DISENGAGE bar
  c.fillStyle = '#c9c9c3'; c.fillRect(W * 0.915, H * 0.2, W * 0.07, H * 0.12)
  engrave(c, 'DISENGAGE', W * 0.95, H * 0.26, 12 * k, 'center', '#1c1d1e')
  toggleAt(W * 0.995 - 1, '', s.fdOn, '')
}

// ---------------------------------------------------------------------------
// Aisle stand (aft electronic panel), CDU face
// ---------------------------------------------------------------------------

export interface AisleState {
  nav1: { activeMhz: number; standbyMhz: number }
  nav2: { activeMhz: number; standbyMhz: number }
  com1: { activeMhz: number; standbyMhz: number }
  com2: { activeMhz: number; standbyMhz: number }
  squawk: string
  rudderTrim: number
  fireTest: boolean
}

/** Paint the aisle stand top, aft of the CDUs (canvas top = forward).
 *  LIVE: radio frequencies, squawk, rudder-trim needle, fire-test lights. */
export function paintAisle(c: Ctx, W: number, H: number, s: AisleState): void {
  c.fillStyle = '#2b2e31'
  c.fillRect(0, 0, W, H)
  const half = W / 2
  const radio = (x: number, y: number, w: number, h: number, title: string, a: number, sb: number, dec: number): void => {
    plate(c, x, y, w, h, title, 14)
    readout(c, x + w * 0.06, y + h * 0.3, w * 0.36, h * 0.36, a.toFixed(dec))
    readout(c, x + w * 0.58, y + h * 0.3, w * 0.36, h * 0.36, sb.toFixed(dec))
    engrave(c, 'ACTIVE', x + w * 0.24, y + h * 0.78, 11); engrave(c, 'STANDBY', x + w * 0.76, y + h * 0.78, 11)
    c.fillStyle = '#d9d9d3'; c.fillRect(x + w * 0.45, y + h * 0.4, w * 0.1, h * 0.16)
    knob(c, x + w * 0.9, y + h * 0.82, 12)
  }
  const rowH = H / 7
  radio(4, 4, half - 8, rowH - 8, 'VHF NAV 1', s.nav1.activeMhz, s.nav1.standbyMhz, 2)
  radio(half + 4, 4, half - 8, rowH - 8, 'VHF NAV 2', s.nav2.activeMhz, s.nav2.standbyMhz, 2)
  radio(4, rowH + 4, half - 8, rowH - 8, 'VHF COMM 1', s.com1.activeMhz, s.com1.standbyMhz, 3)
  radio(half + 4, rowH + 4, half - 8, rowH - 8, 'VHF COMM 2', s.com2.activeMhz, s.com2.standbyMhz, 3)
  // ADF + transponder
  plate(c, 4, rowH * 2 + 4, half - 8, rowH - 8, 'ADF', 14)
  readout(c, 20, rowH * 2 + rowH * 0.32, half * 0.4, rowH * 0.34, ' 350.0')
  readout(c, half * 0.52, rowH * 2 + rowH * 0.32, half * 0.4, rowH * 0.34, ' 415.0')
  plate(c, half + 4, rowH * 2 + 4, half - 8, rowH - 8, 'ATC', 14)
  readout(c, half + half * 0.3, rowH * 2 + rowH * 0.3, half * 0.4, rowH * 0.36, s.squawk)
  knob(c, half + half * 0.13, rowH * 2.62, 14, -Math.PI / 2, undefined, 'TA/RA')
  knob(c, half + half * 0.87, rowH * 2.62, 14)
  // Fire protection: the engine/APU fire switch handles are 3D; the plate
  // carries the detector test switch, discharge lights and labels.
  plate(c, 4, rowH * 3 + 4, W - 8, rowH * 1.35 - 8, 'FIRE PROTECTION', 15)
  const fy = rowH * 3 + rowH * 0.5
  for (const [t, x] of [['ENG 1', 0.2], ['APU', 0.5], ['ENG 2', 0.8]] as const) {
    lamp(c, W * x - 46, fy - 10, 92, 30, [t, 'FIRE'], RED, s.fireTest)
    lamp(c, W * x - 46, fy + 38, 92, 26, ['DISCH'], AMBER, false)
  }
  lamp(c, W * 0.06, fy + 4, 70, 26, ['FAULT'], AMBER, s.fireTest)
  lamp(c, W * 0.86, fy + 4, 70, 26, ['WHEEL', 'WELL'], RED, s.fireTest)
  toggle(c, W * 0.35, fy + 64, 'TEST', !s.fireTest, 0.9)
  engrave(c, 'BELL CUTOUT', W * 0.65, fy + 70, 11)
  // Cargo fire + weather radar row
  plate(c, 4, rowH * 4.35 + 4, half - 8, rowH * 0.9 - 8, 'CARGO FIRE', 13)
  lamp(c, 24, rowH * 4.65, 70, 26, ['FWD'], RED); lamp(c, 104, rowH * 4.65, 70, 26, ['AFT'], RED)
  lamp(c, 184, rowH * 4.65, 70, 26, ['DISCH'], AMBER)
  plate(c, half + 4, rowH * 4.35 + 4, half - 8, rowH * 0.9 - 8, 'WEATHER RADAR', 13)
  for (let i = 0; i < 4; i++) knob(c, half + 40 + i * (half - 60) / 3.3, rowH * 4.85, 13)
  // Trim panel: rudder trim (LIVE) + aileron trim + stab trim override.
  plate(c, 4, rowH * 5.25 + 4, W - 8, rowH * 1.75 - 8, 'RUDDER TRIM / AILERON TRIM', 14)
  const rx = W * 0.3, ry = rowH * 6.15
  c.strokeStyle = ENGRAVE; c.lineWidth = 2
  c.beginPath(); c.arc(rx, ry + 30, 70, Math.PI * 1.2, Math.PI * 1.8); c.stroke()
  for (let i = -4; i <= 4; i++) {
    const a = Math.PI * 1.5 + i * Math.PI * 0.075
    c.beginPath(); c.moveTo(rx + Math.cos(a) * 64, ry + 30 + Math.sin(a) * 64); c.lineTo(rx + Math.cos(a) * 74, ry + 30 + Math.sin(a) * 74); c.stroke()
  }
  const ra = Math.PI * 1.5 + Math.max(-1, Math.min(1, s.rudderTrim)) * Math.PI * 0.3
  c.strokeStyle = '#fff'; c.lineWidth = 3
  c.beginPath(); c.moveTo(rx, ry + 30); c.lineTo(rx + Math.cos(ra) * 66, ry + 30 + Math.sin(ra) * 66); c.stroke()
  engrave(c, 'NOSE LEFT', rx - 80, ry + 34, 10); engrave(c, 'NOSE RIGHT', rx + 80, ry + 34, 10)
  knob(c, rx, ry + 52, 18, -Math.PI / 2, undefined, 'RUDDER')
  knob(c, W * 0.62, ry + 30, 16, -Math.PI / 2, undefined, 'AILERON')
  guarded(c, W * 0.85, ry + 20, 'STAB TRIM OVERRIDE', 0.9)
}

/** CDU screen: the PROGRESS page with live position data. */
export function paintCdu(c: Ctx, W: number, H: number, lines: Array<[string, string, string?]>): void {
  c.fillStyle = '#020403'
  c.fillRect(0, 0, W, H)
  const lh = H / 14
  c.font = `${Math.round(lh * 0.82)}px "Courier New", monospace`
  c.textBaseline = 'middle'
  lines.forEach(([left, right, color], i) => {
    const big = i % 2 === 0
    c.font = `${big ? '' : ''}${Math.round(lh * (big ? 0.9 : 0.62))}px "Courier New", monospace`
    c.fillStyle = color ?? (big ? '#f2f2f2' : '#e6e6e6')
    c.textAlign = 'left'; c.fillText(left, W * 0.03, lh * (i + 0.8))
    c.textAlign = 'right'; c.fillText(right, W * 0.97, lh * (i + 0.8))
  })
}

/** CDU keyboard bezel below the screen. */
export function paintCduKeys(c: Ctx, W: number, H: number): void {
  c.fillStyle = '#4b5055'
  c.fillRect(0, 0, W, H)
  const rows = [['INIT REF', 'RTE', 'CLB', 'CRZ', 'DES'], ['MENU', 'LEGS', 'DEP ARR', 'HOLD', 'PROG'], ['N1 LIMIT', 'FIX', 'PREV PAGE', 'NEXT PAGE', 'EXEC']]
  const kw = W / 5.4, kh = H * 0.1
  rows.forEach((r, ri) => r.forEach((t, i) => {
    const x = W * 0.04 + i * kw * 1.04, y = H * 0.03 + ri * kh * 1.25
    c.fillStyle = '#1e2124'; c.beginPath(); c.roundRect(x, y, kw * 0.94, kh, 4); c.fill()
    engrave(c, t, x + kw * 0.47, y + kh / 2, Math.min(13, kw * 0.14))
  }))
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const nums = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '+/-']
  const top = H * 0.45, sz = H * 0.075
  nums.forEach((n, i) => {
    const x = W * 0.05 + (i % 3) * sz * 1.25, y = top + Math.floor(i / 3) * sz * 1.25
    c.fillStyle = '#1e2124'; c.beginPath(); c.arc(x + sz / 2, y + sz / 2, sz / 2, 0, Math.PI * 2); c.fill()
    engrave(c, n, x + sz / 2, y + sz / 2, sz * 0.5)
  })
  ;[...letters, 'SP', 'DEL', '/', 'CLR'].forEach((l, i) => {
    const x = W * 0.42 + (i % 5) * sz * 1.12, y = top + Math.floor(i / 5) * sz * 1.05
    c.fillStyle = '#1e2124'; c.fillRect(x, y, sz, sz * 0.88)
    engrave(c, l, x + sz / 2, y + sz * 0.45, sz * (l.length > 1 ? 0.3 : 0.5))
  })
}

// ---------------------------------------------------------------------------
// Airbus FCU and EFIS control panel; business-jet / regional guidance panel
// ---------------------------------------------------------------------------

/** Airbus flight control unit: SPD/MACH, HDG/TRK, ALT, V/S windows with
 *  the knobs under them, LOC / AP1 / AP2 / A/THR / EXPED / APPR. LIVE. */
function paintFcuAirbus(c: Ctx, W: number, H: number, s: Mcp737State): void {
  c.fillStyle = PANEL_GRAY
  c.fillRect(0, 0, W, H)
  c.strokeStyle = PANEL_EDGE; c.lineWidth = 4; c.strokeRect(2, 2, W - 4, H - 4)
  const k = H / 300
  const AMBER_LCD = '#ffa236'
  const win = (x: number, w: number, label: string, value: string, dot = false): void => {
    engrave(c, label, x + w / 2, H * 0.12, 16 * k)
    readout(c, x, H * 0.2, w, H * 0.26, value, AMBER_LCD)
    if (dot) { c.fillStyle = AMBER_LCD; c.beginPath(); c.arc(x + w - 10 * k, H * 0.25, 4 * k, 0, Math.PI * 2); c.fill() }
    knob(c, x + w / 2, H * 0.72, 30 * k)
  }
  const btn = (x: number, label: string, lit: boolean, w = 76 * k): void => {
    const y = H * 0.56, h = 52 * k
    c.fillStyle = '#2a2f35'
    c.beginPath(); c.roundRect(x - w / 2, y, w, h, 5); c.fill()
    engrave(c, label, x, y + 32 * k, 15 * k)
    c.fillStyle = lit ? '#7dff7d' : '#3a403c'
    if (lit) { c.shadowColor = '#7dff7d'; c.shadowBlur = 10 }
    c.fillRect(x - w * 0.35, y + 7 * k, w * 0.7, 6 * k)
    c.shadowBlur = 0
  }
  const f3 = (n: number): string => String(Math.round(((n % 360) + 360) % 360) || 360).padStart(3, '0')
  win(W * 0.06, W * 0.12, 'SPD   MACH', String(Math.round(s.iasKt)).padStart(3, ' '), !s.speedMode)
  btn(W * 0.235, 'LOC', s.lateral === 'APR' || s.lateral === 'NAV')
  win(W * 0.29, W * 0.12, 'HDG   TRK', f3(s.hdgDeg), s.lateral !== 'HDG')
  btn(W * 0.565, 'AP1', s.cmdA)
  btn(W * 0.565 + 82 * k, 'AP2', false)
  btn(W * 0.655, 'A/THR', s.atArm)
  win(W * 0.43, W * 0.11, 'ALT', String(Math.round(s.altFt)).padStart(5, ' '), s.vertical !== 'ALT')
  btn(W * 0.75, 'EXPED', false)
  btn(W * 0.84, 'APPR', s.lateral === 'APR' || s.vertical === 'GS')
  win(W * 0.875, W * 0.11, 'V/S   FPA', s.vsActive ? `${s.vsFpm >= 0 ? '+' : '-'}${String(Math.abs(Math.round(s.vsFpm / 100))).padStart(2, '0')}oo` : '-----')
}

/** Airbus EFIS control panel: QNH/STD, FD and LS, the ND filters, and the
 *  ND mode / range selectors. Cosmetic. */
function paintEfisAirbus(c: Ctx, W: number, H: number): void {
  plate(c, 0, 0, W, H)
  const k = H / 300
  readout(c, W * 0.06, H * 0.08, W * 0.3, H * 0.14, '1013', '#ffa236')
  knob(c, W * 0.21, H * 0.45, 30 * k, -Math.PI / 2, [['inHg', -Math.PI * 0.85], ['hPa', -Math.PI * 0.15]], 'QNH')
  for (const [t, x] of [['FD', 0.45], ['LS', 0.6]] as const) {
    c.fillStyle = '#2a2f35'; c.beginPath(); c.roundRect(W * x - 26 * k, H * 0.12, 52 * k, 34 * k, 4); c.fill()
    engrave(c, t, W * x, H * 0.12 + 17 * k, 14 * k)
  }
  knob(c, W * 0.52, H * 0.55, 26 * k, -Math.PI * 0.55, [['ILS', -Math.PI * 0.95], ['VOR', -Math.PI * 0.75], ['NAV', -Math.PI * 0.55], ['ARC', -Math.PI * 0.35], ['PLAN', -Math.PI * 0.15]], 'MODE')
  knob(c, W * 0.8, H * 0.55, 26 * k, -Math.PI * 0.6, [['10', -Math.PI * 0.95], ['20', -Math.PI * 0.75], ['40', -Math.PI * 0.55], ['80', -Math.PI * 0.35], ['160', -Math.PI * 0.15]], 'RANGE')
  ;['CSTR', 'WPT', 'VOR.D', 'NDB', 'ARPT'].forEach((b, i) => {
    const x = W * (0.12 + i * 0.18), y = H * 0.86
    c.fillStyle = '#2a2f35'; c.beginPath(); c.roundRect(x - 26 * k, y - 15 * k, 52 * k, 30 * k, 4); c.fill()
    engrave(c, b, x, y, 12 * k)
  })
}

/** Business-jet / regional flight-guidance panel (Collins / Honeywell /
 *  Garmin family): CRS, HDG, ALT, SPD knobs; HDG NAV APR B/C, VNAV FLC VS
 *  ALT; AP, YD and, where fitted, A/T. Targets show on the PFD. LIVE. */
function paintGuidancePanel(c: Ctx, W: number, H: number, s: Mcp737State, autothrottle: boolean): void {
  c.fillStyle = PANEL_GRAY
  c.fillRect(0, 0, W, H)
  c.strokeStyle = PANEL_EDGE; c.lineWidth = 4; c.strokeRect(2, 2, W - 4, H - 4)
  const k = H / 300
  const btn = (x: number, label: string, lit: boolean, w = 72 * k): void => {
    const y = H * 0.36, h = 50 * k
    c.fillStyle = '#25292e'
    c.beginPath(); c.roundRect(x - w / 2, y, w, h, 5); c.fill()
    engrave(c, label, x, y + 30 * k, 15 * k)
    c.fillStyle = lit ? '#7dff7d' : '#3a403c'
    if (lit) { c.shadowColor = '#7dff7d'; c.shadowBlur = 10 }
    c.fillRect(x - w * 0.12, y + 6 * k, w * 0.24, 6 * k)
    c.shadowBlur = 0
  }
  const kn = (x: number, label: string): void => { knob(c, x, H * 0.5, 30 * k); engrave(c, label, x, H * 0.16, 16 * k) }
  kn(W * 0.05, 'CRS 1')
  kn(W * 0.12, 'SPD')
  btn(W * 0.2, 'HDG', s.lateral === 'HDG')
  btn(W * 0.2 + 78 * k, 'NAV', s.lateral === 'NAV' || s.lateral === 'GPS')
  btn(W * 0.2 + 156 * k, 'APR', s.lateral === 'APR')
  btn(W * 0.2 + 234 * k, 'B/C', s.lateral === 'BC')
  kn(W * 0.45, 'HDG')
  btn(W * 0.53, 'VNAV', false)
  btn(W * 0.53 + 78 * k, 'FLC', s.vertical === 'FLC' || s.vertical === 'IAS')
  btn(W * 0.53 + 156 * k, 'VS', s.vertical === 'VS')
  btn(W * 0.53 + 234 * k, 'ALT', s.vertical === 'ALT')
  btn(W * 0.68, 'AP', s.cmdA)
  if (autothrottle) btn(W * 0.74, 'A/T', s.atArm)
  btn(W * 0.8, 'YD', s.cmdA)
  kn(W * 0.86, 'ALT')
  // pitch wheel
  c.fillStyle = '#1b1c1e'; c.fillRect(W * 0.91, H * 0.25, W * 0.022, H * 0.5)
  for (let i = 0; i < 9; i++) { c.fillStyle = '#4a4d50'; c.fillRect(W * 0.91, H * 0.27 + i * H * 0.052, W * 0.022, 3) }
  engrave(c, 'DN / UP', W * 0.921, H * 0.84, 12 * k)
  kn(W * 0.965, 'CRS 2')
}

/** Display control panel (business jets / regionals): PFD/MFD formats,
 *  range, baro, minimums. Cosmetic. */
function paintDisplayControl(c: Ctx, W: number, H: number): void {
  plate(c, 0, 0, W, H)
  const k = H / 300
  knob(c, W * 0.16, H * 0.42, 28 * k, -Math.PI / 2, [['RA', -Math.PI * 0.85], ['BARO', -Math.PI * 0.15]], 'MINIMUMS')
  knob(c, W * 0.84, H * 0.42, 28 * k, -Math.PI / 2, [['IN', -Math.PI * 0.85], ['HPA', -Math.PI * 0.15]], 'BARO')
  knob(c, W * 0.5, H * 0.42, 26 * k, -Math.PI * 0.6, [['5', -Math.PI * 0.9], ['25', -Math.PI * 0.6], ['100', -Math.PI * 0.3], ['300', -Math.PI * 0.1]], 'RANGE')
  ;['FRMT', 'TERR', 'WX', 'TFC', 'NAV SRC'].forEach((b, i) => {
    const x = W * (0.12 + i * 0.19), y = H * 0.86
    c.fillStyle = '#25292e'; c.beginPath(); c.roundRect(x - 28 * k, y - 15 * k, 56 * k, 30 * k, 4); c.fill()
    engrave(c, b, x, y, 12 * k)
  })
}
