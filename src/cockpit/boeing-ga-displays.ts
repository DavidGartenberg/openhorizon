/**
 * Boeing display skin for the piston / turboprop / glider panels: the PFD,
 * ND (MAP page) and engine strip use the 737 formats, fitted into the
 * G1000 canvases the panel already has — the panel, bezels, softkey row,
 * page logic and click routing are unchanged. Functions the Boeing formats
 * do not carry but the airplane needs stay on screen in the margins: radio
 * frequencies and transponder (the panel's tuning knobs act on them), the
 * caution/alert messages, OAT/TAS/groundspeed, V-speed arcs, airspace and
 * the best-glide ring. An instrument the type does not have (radio
 * altimeter) is not drawn.
 */
import { drawBoeingNd, drawBoeingPfd, type BoeingNdInput, type BoeingPfdInput } from './boeing-displays'

type Ctx = CanvasRenderingContext2D

const COL = { white: '#ffffff', green: '#3fe06a', cyan: '#22d8f0', amber: '#ffb020', red: '#ff2b2b', magenta: '#ff4fe0', dim: '#8a9199' }

function text(c: Ctx, s: string, x: number, y: number, size: number, color: string = COL.white, align: CanvasTextAlign = 'left'): void {
  c.fillStyle = color
  c.font = `600 ${size}px "Helvetica Neue", Arial, sans-serif`
  c.textAlign = align
  c.textBaseline = 'middle'
  c.fillText(s, x, y)
}

export interface GaPfdExtras {
  com1: { activeMhz: number; standbyMhz: number }
  nav1: { activeMhz: number; standbyMhz: number }
  squawk: string
  oatC: number
  ktas: number
  groundSpeedKt: number
  windDirDeg: number
  windKt: number
  /** Annunciations the airplane raised (AVIONICS BUS OFF, FUEL LOW, …). */
  alerts: readonly string[]
}

/** Alert → colour: loss-of-function and fuel starvation are warnings. */
export function alertColor(a: string): string {
  return /STARV|FAIL|OFF/.test(a) ? COL.red : COL.amber
}

/** Boeing PFD centred in a `w`×`h` canvas (the square format fills the
 *  height); margins carry the radios, transponder, alerts and air data. */
export function drawGaBoeingPfd(c: Ctx, w: number, h: number, pfd: BoeingPfdInput, x: GaPfdExtras): void {
  c.fillStyle = '#000'
  c.fillRect(0, 0, w, h)
  const S = Math.min(w, h)
  const left = (w - S) / 2
  c.save()
  c.translate(left, 0)
  c.beginPath(); c.rect(0, 0, S, S); c.clip()
  drawBoeingPfd(c, S, pfd)
  c.restore()
  const m = Math.max(0, left) - 10
  if (m < 60) return
  const f = Math.max(11, Math.min(17, m / 8))
  // Left margin: radios and transponder (the panel knobs tune these).
  let y = h * 0.06
  const radio = (label: string, r: { activeMhz: number; standbyMhz: number }, dec: number): void => {
    text(c, label, 8, y, f, COL.cyan)
    text(c, r.activeMhz.toFixed(dec), 8, y + f * 1.35, f * 1.15, COL.green)
    text(c, r.standbyMhz.toFixed(dec), 8, y + f * 2.7, f, COL.white)
    y += f * 4.6
  }
  radio('COM1', x.com1, 3)
  radio('NAV1', x.nav1, 2)
  text(c, 'XPDR', 8, y, f, COL.cyan)
  text(c, x.squawk, 8, y + f * 1.35, f * 1.15, COL.green)
  // Right margin: air data and alerts.
  const rx = w - m + 6
  text(c, 'OAT', rx, h * 0.06, f, COL.cyan)
  text(c, `${Math.round(x.oatC)}°C`, rx, h * 0.06 + f * 1.35, f * 1.15)
  text(c, 'TAS', rx, h * 0.06 + f * 3.4, f, COL.cyan)
  text(c, `${Math.round(x.ktas)}`, rx, h * 0.06 + f * 4.75, f * 1.15)
  text(c, 'GS', rx, h * 0.06 + f * 6.8, f, COL.cyan)
  text(c, `${Math.round(x.groundSpeedKt)}`, rx, h * 0.06 + f * 8.15, f * 1.15)
  if (x.windKt >= 1) {
    text(c, 'WIND', rx, h * 0.06 + f * 10.2, f, COL.cyan)
    text(c, `${String(Math.round(x.windDirDeg) % 360).padStart(3, '0')}°/${Math.round(x.windKt)}`, rx, h * 0.06 + f * 11.55, f)
  }
  x.alerts.forEach((a, i) => {
    const words = a.split(' ')
    const mid = Math.ceil(words.length / 2)
    const lines = a.length > 11 ? [words.slice(0, mid).join(' '), words.slice(mid).join(' ')] : [a]
    lines.forEach((ln, j) => text(c, ln, rx, h * 0.62 + (i * 2 + j) * f * 1.25, f * 0.95, alertColor(a)))
  })
}

export interface GaEngineInput {
  /** False for a glider: there is nothing to display. */
  hasEngine: boolean
  /** Turboprops show prop speed (NP) and torque; no CHT / mixture EGT. */
  kind?: 'piston' | 'turboprop'
  /** Engines on the airframe (the sim runs them matched). */
  engines?: number
  /** Torque, % (turboprop) — shaft power over prop speed. */
  torquePct?: number
  /** False: no electrical system (hand-propped) — no bus readouts. */
  hasElectrical?: boolean
  rpm: number
  redlineRpm: number
  egtC: number
  chtC: number
  chtMaxC: number
  oilTempC: number
  oilTempMaxC: number
  oilPressPsi: number
  oilPressMaxPsi: number
  oilPressMinGreenPsi: number
  fuelFlowGph: number
  fuelLGal: number
  fuelRGal: number
  tankCapGal: number
  volts: number
  ampsAlt: number
  ampsBat: number
}

/** 737-style engine strip for a piston/turboprop: an RPM dial with redline
 *  and digit box on top, EGT / CHT / oil as bar-less boxed readouts with
 *  caution colouring, fuel flow, fuel by tank, bus electrics. */
export function drawBoeingEngineColumn(c: Ctx, x: number, y: number, w: number, h: number, d: GaEngineInput): void {
  c.fillStyle = '#000'
  c.fillRect(x, y, w, h)
  c.strokeStyle = '#2b3036'; c.lineWidth = 2
  c.strokeRect(x + 1, y + 1, w - 2, h - 2)
  if (!d.hasEngine) { text(c, 'NO ENGINE', x + w / 2, y + h / 2, w * 0.14, COL.dim, 'center'); return }
  const u = w / 205
  const cx = x + w / 2
  // RPM dial.
  const r = 66 * u, cy = y + 100 * u
  const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2, span = a1 - a0
  const maxRpm = d.redlineRpm * 1.12
  const ang = (v: number): number => a0 + (Math.max(0, Math.min(maxRpm, v)) / maxRpm) * span
  const over = d.rpm >= d.redlineRpm
  c.fillStyle = '#3a3f45'
  c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, r, a0, ang(d.rpm)); c.closePath(); c.fill()
  c.strokeStyle = COL.white; c.lineWidth = 3 * u
  c.beginPath(); c.arc(cx, cy, r, a0, ang(d.redlineRpm)); c.stroke()
  c.strokeStyle = COL.red; c.lineWidth = 5 * u
  c.beginPath(); c.moveTo(cx + Math.cos(ang(d.redlineRpm)) * (r - 9 * u), cy + Math.sin(ang(d.redlineRpm)) * (r - 9 * u)); c.lineTo(cx + Math.cos(ang(d.redlineRpm)) * (r + 7 * u), cy + Math.sin(ang(d.redlineRpm)) * (r + 7 * u)); c.stroke()
  c.strokeStyle = COL.white; c.lineWidth = 4 * u
  c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(ang(d.rpm)) * r * 0.95, cy + Math.sin(ang(d.rpm)) * r * 0.95); c.stroke()
  const tp = d.kind === 'turboprop', n = Math.max(1, d.engines ?? 1)
  text(c, tp ? 'NP  RPM' : n > 1 ? 'RPM  1 · 2' : 'RPM', cx, y + 22 * u, 16 * u, COL.cyan, 'center')
  c.strokeStyle = COL.white; c.lineWidth = 2 * u
  if (n > 1) {
    // Twins: one box per engine (the sim runs them matched).
    for (const dx of [-44, 44]) {
      c.strokeRect(cx + dx * u - 40 * u, cy + 12 * u, 80 * u, 30 * u)
      text(c, String(Math.round(d.rpm)), cx + dx * u + 34 * u, cy + 27 * u, 20 * u, over ? COL.red : COL.white, 'right')
    }
  } else {
    c.strokeRect(cx - 40 * u, cy + 12 * u, 80 * u, 30 * u)
    text(c, String(Math.round(d.rpm)), cx + 34 * u, cy + 27 * u, 22 * u, over ? COL.red : COL.white, 'right')
  }

  // Boxed readouts: label left, value right, colour = caution state.
  let ry = y + 172 * u
  const row = (label: string, value: string, color: string): void => {
    text(c, label, x + 12 * u, ry, 14 * u, COL.cyan)
    c.strokeStyle = '#4a5058'; c.lineWidth = 1.5 * u
    c.strokeRect(x + 78 * u, ry - 13 * u, 114 * u, 26 * u)
    text(c, value, x + 186 * u, ry, 19 * u, color, 'right')
    ry += 33 * u
  }
  const hot = (v: number, max: number): string => (v / max > 0.9 ? COL.amber : COL.green)
  if (tp) row('TRQ %', (d.torquePct ?? 0).toFixed(0), (d.torquePct ?? 0) > 100 ? COL.red : COL.green)
  else {
    row('EGT °C', d.egtC.toFixed(0), COL.green)
    row('CHT °C', d.chtC.toFixed(0), hot(d.chtC, d.chtMaxC))
  }
  row('OIL °C', d.oilTempC.toFixed(0), hot(d.oilTempC, d.oilTempMaxC))
  row('OIL PSI', d.oilPressPsi.toFixed(0), d.oilPressPsi < d.oilPressMinGreenPsi ? COL.amber : COL.green)
  ry += 6 * u
  row('FF GPH', d.fuelFlowGph.toFixed(1), COL.green)
  ry += 6 * u
  // Fuel by tank: boxed gallons with a level bar beneath.
  for (const [label, gal] of [['FUEL L', d.fuelLGal], ['FUEL R', d.fuelRGal]] as const) {
    const frac = Math.max(0, Math.min(1, gal / Math.max(1e-6, d.tankCapGal)))
    text(c, label, x + 12 * u, ry, 14 * u, COL.cyan)
    c.strokeStyle = '#4a5058'; c.strokeRect(x + 78 * u, ry - 13 * u, 114 * u, 26 * u)
    text(c, gal.toFixed(1), x + 186 * u, ry, 19 * u, frac < 0.13 ? COL.amber : COL.white, 'right')
    c.fillStyle = frac < 0.13 ? COL.amber : COL.green
    c.fillRect(x + 78 * u, ry + 14 * u, 114 * u * frac, 4 * u)
    ry += 38 * u
  }
  ry += 4 * u
  if (d.hasElectrical === false) { text(c, 'NO ELECTRICAL SYSTEM', x + 12 * u, ry, 12 * u, COL.dim); return }
  text(c, `VOLTS ${d.volts.toFixed(1)}`, x + 12 * u, ry, 14 * u)
  text(c, `ALT ${d.ampsAlt.toFixed(0)}A  BAT ${d.ampsBat.toFixed(0)}A`, x + 12 * u, ry + 22 * u, 13 * u)
}

/** Boeing ND centred in a rectangle (the square format fills the shorter
 *  side); the rest of the page stays black. */
export function drawGaBoeingNd(c: Ctx, x: number, y: number, w: number, h: number, nd: BoeingNdInput): void {
  c.fillStyle = '#000'
  c.fillRect(x, y, w, h)
  const S = Math.min(w, h)
  c.save()
  c.beginPath(); c.rect(x, y, w, h); c.clip()
  c.translate(x + (w - S) / 2, y + (h - S) / 2)
  c.beginPath(); c.rect(0, 0, S, S); c.clip()
  drawBoeingNd(c, S, nd)
  c.restore()
}
