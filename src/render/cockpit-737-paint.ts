/**
 * Canvas painters for the 737NG flight deck (cockpit-737.ts). Layouts follow
 * the published 737NG flight-deck arrangement (FCOM panel diagrams): the
 * forward overhead's system columns, the main instrument panel around the
 * six display units, the glareshield EFIS/MCP/annunciator faces and the
 * aisle stand. Painted switchgear is COSMETIC unless a live painter says
 * otherwise — recorded in PROGRESS.md. No logos or trademarks are drawn.
 */

export const PANEL_GRAY = '#565b60'
export const PANEL_EDGE = '#3f4347'
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

/** Main-panel layout in panel metres: lateral (−left) / up, shared by the
 *  painter and the 3D builder so DU glass and live screens coincide. */
/** A/P, A/T, FMC P/RST light strip height (below the glareshield hood). */
export const PRST_UP = 0.795

/** The P/RST strip on its own canvas (LIVE overlay): A/P and A/T lamps
 *  flash red after a disconnect until reset. */
export function paintPrst(c: Ctx, W: number, H: number, ap: boolean, at: boolean): void {
  c.fillStyle = PANEL_GRAY
  c.fillRect(0, 0, W, H)
  const items: Array<[string[], string, boolean]> = [[['A/P', 'P/RST'], RED, ap], [['A/T', 'P/RST'], RED, at], [['FMC', 'P/RST'], AMBER, false]]
  items.forEach(([t, col, lit], i) => lamp(c, (i + 0.1) * (W / 3), H * 0.08, (W / 3) * 0.8, H * 0.84, t, col, lit))
}

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

/** Paint the MIP face. `px(lat)`/`py(up)` map panel metres to canvas px. */
export function paintMip(c: Ctx, W: number, H: number): void {
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

  // Six DU bezels with glass, softkey-less (the CDS DUs carry only a
  // brightness knob and a light sensor).
  const du = (lat: number, up: number): void => {
    const w = m.du * sx, h = m.du * sy, x = px(lat) - w / 2, y = py(up) - h / 2
    c.fillStyle = '#1d1f21'
    c.beginPath(); c.roundRect(x, y, w, h, 14); c.fill()
    c.strokeStyle = '#0c0d0e'; c.lineWidth = 3; c.stroke()
    const gw = m.glass * sx, gh = m.glass * sy
    c.fillStyle = '#040506'
    c.fillRect(px(lat) - gw / 2, py(up) - gh / 2, gw, gh)
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) screw(c, px(lat) + dx * (w / 2 - 12), py(up) + dy * (h / 2 - 12), 5)
    knob(c, px(lat) + w / 2 - 22, py(up) + h / 2 - 22, 9)
    c.fillStyle = '#0a0b0c'; c.beginPath(); c.arc(px(lat) - w / 2 + 20, py(up) + h / 2 - 20, 5, 0, Math.PI * 2); c.fill()
  }
  for (const lat of [m.captPfd, m.captNd, m.foNd, m.foPfd]) du(lat, m.duUp)
  du(m.upperDu, m.duUp)
  du(m.lowerDu, m.lowerDuUp)

  // Captain panel: clock, A/P-A/T-FMC annunciators, display selectors.
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
  for (const side of [-1, 1]) {
    const lat0 = side * 0.645
    const items = [['A/P', 'P/RST'], ['A/T', 'P/RST'], ['FMC', 'P/RST']]
    items.forEach((t, i) => lamp(c, px(lat0 - 0.06 + i * 0.06) - 0.024 * sx, py(PRST_UP) - 0.011 * sy, 0.048 * sx, 0.022 * sy, t, i < 2 ? RED : AMBER))
    engrave(c, 'MAIN PANEL DUs', px(side * 0.69), py(0.53), 12)
    knob(c, px(side * 0.69), py(0.505), 0.013 * sx, -Math.PI / 2, [['OUTBD PFD', -Math.PI * 0.95], ['NORM', -Math.PI / 2], ['ENG PRI', -Math.PI * 0.05]])
    engrave(c, 'LOWER DU', px(side * 0.57), py(0.53), 12)
    knob(c, px(side * 0.57), py(0.505), 0.013 * sx, -Math.PI / 2, [['ENG PRI', -Math.PI * 0.95], ['NORM', -Math.PI / 2], ['ND', -Math.PI * 0.05]])
    lamp(c, px(side * 0.785) - 0.03 * sx, py(0.705) - 0.018 * sy, 0.06 * sx, 0.036 * sy, ['BELOW', 'G/S'], AMBER)
    engrave(c, 'P-INHIBIT', px(side * 0.785), py(0.672), 10)
  }
  knob(c, px(-0.785), py(0.505), 0.012 * sx, -Math.PI / 2, [['ALT', -Math.PI * 0.8], ['NORM', -Math.PI * 0.2]], 'NOSE WHEEL STEERING')

  // Center panel: ISFD bezel (live face drawn by the 3D builder), N1 SET,
  // SPD REF, FUEL FLOW, MFD buttons, LE flaps lights.
  const f = m.isfd
  c.fillStyle = '#18191b'
  c.beginPath(); c.roundRect(px(f.lat) - (f.size / 2 + 0.01) * sx, py(f.up) - (f.size / 2 + 0.01) * sy, (f.size + 0.02) * sx, (f.size + 0.02) * sy, 10); c.fill()
  knob(c, px(f.lat) + (f.size / 2 - 0.003) * sx, py(f.up) + (f.size / 2 + 0.003) * sy, 9)
  engrave(c, 'N1 SET', px(-0.265), py(0.575), 11)
  knob(c, px(-0.265), py(0.55), 0.012 * sx, -Math.PI / 2, [['2', -Math.PI * 0.9], ['1', -Math.PI * 0.65], ['BOTH', -Math.PI * 0.35], ['AUTO', -Math.PI * 0.1]])
  engrave(c, 'SPD REF', px(-0.205), py(0.575), 11)
  knob(c, px(-0.205), py(0.55), 0.012 * sx, -Math.PI / 2, [['V1', -Math.PI * 0.9], ['VR', -Math.PI * 0.7], ['WT', -Math.PI * 0.5], ['VREF', -Math.PI * 0.3], ['SET', -Math.PI * 0.1]])
  toggle(c, px(-0.235), py(0.47), 'FUEL FLOW', true, 0.9)
  for (const [t, i] of [['ENG', 0], ['SYS', 1]] as const) lamp(c, px(-0.27 + i * 0.07) - 0.025 * sx, py(0.39) - 0.012 * sy, 0.05 * sx, 0.024 * sy, [t], WHITE_LIGHT)
  engrave(c, 'MFD', px(-0.235), py(0.415), 11)
  lamp(c, px(0.215) - 0.035 * sx, py(0.53) - 0.012 * sy, 0.07 * sx, 0.024 * sy, ['ANTISKID', 'INOP'], AMBER)
  engrave(c, 'AUTO BRAKE', px(0.215), py(0.505), 11)
  lamp(c, px(0.27) - 0.024 * sx, py(0.478) - 0.012 * sy, 0.048 * sx, 0.024 * sy, ['AUTO BRAKE', 'DISARM'], AMBER)
  engrave(c, 'LANDING GEAR', px(0.215), py(0.81), 12)

  // F/O panel extras: brake pressure gauge, STAB OUT OF TRIM, SPEEDBRAKE.
  gauge(c, px(0.785), py(0.53), 0.03 * sx, 'BRAKE PRESS', 6, 0.82)
  lamp(c, px(0.70) - 0.04 * sx, py(0.565) - 0.012 * sy, 0.08 * sx, 0.024 * sy, ['STAB OUT', 'OF TRIM'], AMBER)
  lamp(c, px(-0.12) - 0.04 * sx, py(0.79) - 0.011 * sy, 0.08 * sx, 0.022 * sy, ['SPEED BRAKE', 'ARMED'], GREEN)
  lamp(c, px(-0.03) - 0.04 * sx, py(0.79) - 0.011 * sy, 0.08 * sx, 0.022 * sy, ['SPEED BRAKE', 'DO NOT ARM'], AMBER)
  lamp(c, px(0.06) - 0.04 * sx, py(0.79) - 0.011 * sy, 0.08 * sx, 0.022 * sy, ['STAB OUT', 'OF TRIM'], AMBER)
}

// ---------------------------------------------------------------------------
// Glareshield faces
// ---------------------------------------------------------------------------

/** EFIS control panel (captain or F/O). Cosmetic. */
export function paintEfis(c: Ctx, W: number, H: number): void {
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
export function paintAnnunciators(c: Ctx, W: number, H: number, side: 'L' | 'R', fire: boolean, caution: boolean): void {
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

export function paintMcp737(c: Ctx, W: number, H: number, s: Mcp737State): void {
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
