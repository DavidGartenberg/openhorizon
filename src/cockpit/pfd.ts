/**
 * G1000 Primary Flight Display (Phase 3 §8.2 / Task 2b): canvas-2D draw
 * function, pure `(ctx, width, height, data) => void`, no three.js/DOM
 * globals reached into beyond the `ctx` it's given. Designed to be usable
 * at ≥2048px wide — all layout is computed from `width`/`height`, nothing
 * is a hardcoded pixel position.
 *
 * This module only draws instruments; it does not simulate anything. Nav
 * (VOR/GPS/CDI) truth doesn't exist until Phase 4, so the CDI is rendered
 * honestly inert (centered, flagged) rather than faking live nav data, per
 * the master prompt's rule against faking instruments.
 *
 * V-speeds are sourced from `src/sim/aircraft/c172s.ts`'s `vSpeeds` (POH-
 * sourced) — never re-guessed here. Arc colors (white/green/yellow/red-line)
 * are standard ASI convention, not an invented "G1000 spec".
 *
 * Layout, softkey labels, and any other value with no in-repo source are
 * flagged as assumptions in comments below and in the task report.
 */
import { C172S } from '../sim/aircraft/c172s'
import type { RadioStack, SoftkeyRegion } from './types'

// ============================================================================
// Pure math (unit-tested in tests/cockpit/pfd.test.ts) — no ctx/canvas here.
// ============================================================================

/**
 * Position, in pixels, of a tape value on a vertical scrolling tape centered
 * on `centerValue` at `centerY`, scaled by `pxPerUnit` pixels per unit.
 * Convention (matches real ASI/altimeter tapes): larger values are higher
 * up the tape (smaller y), so a value above center yields y < centerY.
 */
export function tapeValueToY(centerValue: number, value: number, pxPerUnit: number, centerY: number): number {
  return centerY - (value - centerValue) * pxPerUnit
}

/** V-speed arc boundaries (kt) derived from the C172S POH `vSpeeds` table. */
export interface VSpeedArcs {
  whiteLowKt: number // Vs0: bottom of white (flaps-operating) arc
  whiteHighKt: number // Vfe (full flaps): top of white arc
  greenLowKt: number // Vs1: bottom of green (normal operating) arc
  greenHighKt: number // Vno: top of green arc
  yellowLowKt: number // Vno
  yellowHighKt: number // Vne: top of yellow (caution) arc
  redLineKt: number // Vne: never-exceed red line
}

/** Pull the ASI arc boundaries out of the POH vSpeeds table (no invented numbers). */
export function vSpeedArcs(vSpeeds: typeof C172S.vSpeeds): VSpeedArcs {
  return {
    whiteLowKt: vSpeeds.vs0,
    whiteHighKt: vSpeeds.vfe30, // full-flaps Vfe = widest (most conservative) top of white arc
    greenLowKt: vSpeeds.vs1,
    greenHighKt: vSpeeds.vno,
    yellowLowKt: vSpeeds.vno,
    yellowHighKt: vSpeeds.vne,
    redLineKt: vSpeeds.vne,
  }
}

/** Mutable closure-state for the airspeed trend vector, across draw calls. */
export interface PfdTrendState {
  lastIasKt: number | null
}

export function makePfdTrendState(): PfdTrendState {
  return { lastIasKt: null }
}

/**
 * Update trend state with a new IAS sample and return the current trend
 * rate in kt/s (positive = accelerating). First call (no prior sample) or a
 * non-positive dt returns 0 rather than a divide-by-zero/garbage spike.
 */
export function updateIasTrend(state: PfdTrendState, iasKt: number, dtS: number): number {
  const prev = state.lastIasKt
  state.lastIasKt = iasKt
  if (prev === null || dtS <= 0) return 0
  return (iasKt - prev) / dtS
}

/** Normalize a heading delta (target - from) to (-180, 180]. */
export function headingDeltaDeg(fromDeg: number, toDeg: number): number {
  let d = ((toDeg - fromDeg) % 360 + 360) % 360
  if (d > 180) d -= 360
  return d
}

// Stock softkey label set along the bottom bezel. Real G1000 PFD bezels
// carry ~12 keys; the exact production label set/order isn't in this repo,
// so this is a reasonable representative set flagged as an assumption
// (functionally inert regions this task — later cockpit-interaction task
// raycasts against them).
export const PFD_SOFTKEY_LABELS: readonly string[] = [
  'PFD',
  'INSET',
  'DCLTR',
  'BRG1',
  'HSI FMT',
  'VOR1',
  'ADF/DME',
  'XPDR',
  'IDENT',
  'TMR/REF',
  'NRST',
  'ALERTS',
]

/** Softkey bezel row height as a fraction of canvas height — shared by
 *  `pfdSoftkeyRegions` (click geometry) and `drawPfd` (body layout) so the
 *  two can never drift out of sync. */
export const SOFTKEY_ROW_HEIGHT_FRAC = 0.045

/**
 * Click-target rectangles for the softkey bezel row, in canvas pixel space.
 * Pure geometry: evenly divides the bottom strip of the canvas into one box
 * per label. Exported so a later 3D-cockpit-interaction task can raycast
 * against the same regions used to draw them, rather than re-deriving the
 * layout.
 */
export function pfdSoftkeyRegions(width: number, height: number): SoftkeyRegion[] {
  const rowH = height * SOFTKEY_ROW_HEIGHT_FRAC
  const y = height - rowH
  const n = PFD_SOFTKEY_LABELS.length
  const w = width / n
  return PFD_SOFTKEY_LABELS.map((label, i) => ({ label, x: i * w, y, w, h: rowH }))
}

// ============================================================================
// Input shape
// ============================================================================

export interface PfdInput {
  // Airspeed
  iasKt: number
  /** kt/s, from `updateIasTrend` — positive = accelerating. */
  iasTrendKtPerS: number

  // Attitude
  pitchDeg: number
  rollDeg: number
  /** Slip/skid proxy — `FlightData.betaDeg` (positive = right slip/skid). */
  slipSkidDeg: number

  // Altitude / vertical speed
  altitudeFt: number
  verticalSpeedFpm: number
  baroInHg: number

  // Heading / HSI
  headingDeg: number
  headingBugDeg: number
  windDirDeg: number
  windSpeedKt: number

  // Speed cross-checks
  ktas: number
  groundSpeedKt: number
  oatC: number

  // Radios
  nav1: RadioStack
  com1: RadioStack
  squawk: string // 4-digit string, e.g. "1200"

  // Annunciations
  annunciations: readonly string[]
}

// ============================================================================
// Drawing
// ============================================================================

const COLORS = {
  sky: '#2a6fb8',
  ground: '#6b4a2a',
  horizonLine: '#ffffff',
  tapeBg: '#0a0a0a',
  tapeText: '#ffffff',
  white: '#ffffff',
  green: '#00c000',
  yellow: '#e0c000',
  red: '#d02020',
  bezel: '#1c1c1c',
  bezelText: '#c8c8c8',
  cyan: '#20c0e0',
  magenta: '#d020c0',
  annunciatorBg: '#000000',
  annunciatorWarn: '#ff3030',
}

/** Airspeed tape: scrolling tape centered on IAS with POH V-speed arcs + trend vector. */
function drawAirspeedTape(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, data: PfdInput): void {
  const centerY = y + h / 2
  const pxPerKt = h / 60 // 60kt span visible on the tape, flagged layout assumption
  const arcs = vSpeedArcs(C172S.vSpeeds)

  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()

  ctx.fillStyle = COLORS.tapeBg
  ctx.fillRect(x, y, w, h)

  const arcX = x + w * 0.62
  const arcW = w * 0.18

  const drawArc = (lowKt: number, highKt: number, color: string) => {
    const yTop = tapeValueToY(data.iasKt, highKt, pxPerKt, centerY)
    const yBot = tapeValueToY(data.iasKt, lowKt, pxPerKt, centerY)
    ctx.fillStyle = color
    ctx.fillRect(arcX, Math.max(yTop, y), arcW, Math.min(yBot, y + h) - Math.max(yTop, y))
  }
  drawArc(arcs.whiteLowKt, arcs.whiteHighKt, COLORS.white)
  drawArc(arcs.greenLowKt, arcs.greenHighKt, COLORS.green)
  drawArc(arcs.yellowLowKt, arcs.yellowHighKt, COLORS.yellow)

  const redY = tapeValueToY(data.iasKt, arcs.redLineKt, pxPerKt, centerY)
  ctx.strokeStyle = COLORS.red
  ctx.lineWidth = Math.max(2, h * 0.006)
  ctx.beginPath()
  ctx.moveTo(arcX, redY)
  ctx.lineTo(arcX + arcW, redY)
  ctx.stroke()

  // Tick marks + labels every 10kt within the visible span.
  ctx.fillStyle = COLORS.tapeText
  ctx.font = `${Math.round(h * 0.045)}px monospace`
  ctx.textBaseline = 'middle'
  const lo = Math.ceil((data.iasKt - 30) / 10) * 10
  for (let v = lo; v <= data.iasKt + 30; v += 10) {
    if (v < 0) continue
    const ty = tapeValueToY(data.iasKt, v, pxPerKt, centerY)
    ctx.strokeStyle = COLORS.tapeText
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x + w * 0.35, ty)
    ctx.lineTo(x + w * 0.5, ty)
    ctx.stroke()
    ctx.fillText(String(v), x + w * 0.02, ty)
  }

  // Trend vector: short line from center marker showing where IAS is
  // heading based on `iasTrendKtPerS`, projected forward a fixed 6s window.
  const trendKt = data.iasTrendKtPerS * 6
  if (Math.abs(trendKt) > 0.5) {
    const trendY = tapeValueToY(data.iasKt, data.iasKt + trendKt, pxPerKt, centerY)
    ctx.strokeStyle = COLORS.magenta
    ctx.lineWidth = Math.max(2, h * 0.01)
    ctx.beginPath()
    ctx.moveTo(x + w * 0.5, centerY)
    ctx.lineTo(x + w * 0.5, trendY)
    ctx.stroke()
  }

  ctx.restore()

  // Current-value box at center line.
  ctx.fillStyle = COLORS.bezel
  ctx.fillRect(x, centerY - h * 0.04, w, h * 0.08)
  ctx.fillStyle = COLORS.tapeText
  ctx.font = `bold ${Math.round(h * 0.06)}px monospace`
  ctx.textAlign = 'center'
  ctx.fillText(data.iasKt.toFixed(0), x + w / 2, centerY)
  ctx.textAlign = 'left'
}

/** Altitude tape + barometric setting readout. */
function drawAltitudeTape(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, data: PfdInput): void {
  const centerY = y + h / 2
  const pxPerFt = h / 600 // 600ft visible span, flagged layout assumption

  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.fillStyle = COLORS.tapeBg
  ctx.fillRect(x, y, w, h)

  ctx.fillStyle = COLORS.tapeText
  ctx.font = `${Math.round(h * 0.045)}px monospace`
  ctx.textBaseline = 'middle'
  const lo = Math.ceil((data.altitudeFt - 300) / 100) * 100
  for (let v = lo; v <= data.altitudeFt + 300; v += 100) {
    const ty = tapeValueToY(data.altitudeFt, v, pxPerFt, centerY)
    ctx.strokeStyle = COLORS.tapeText
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x + w * 0.02, ty)
    ctx.lineTo(x + w * 0.18, ty)
    ctx.stroke()
    ctx.fillText(String(Math.round(v)), x + w * 0.22, ty)
  }
  ctx.restore()

  ctx.fillStyle = COLORS.bezel
  ctx.fillRect(x, centerY - h * 0.04, w, h * 0.08)
  ctx.fillStyle = COLORS.tapeText
  ctx.font = `bold ${Math.round(h * 0.06)}px monospace`
  ctx.textAlign = 'center'
  ctx.fillText(data.altitudeFt.toFixed(0), x + w / 2, centerY)

  // Baro setting readout, below the tape.
  ctx.font = `${Math.round(h * 0.05)}px monospace`
  ctx.fillStyle = COLORS.tapeText
  ctx.fillText(`${data.baroInHg.toFixed(2)} IN`, x + w / 2, y + h + h * 0.06)
  ctx.textAlign = 'left'
}

/** Vertical speed indicator: simple vertical scale centered on zero. */
function drawVsi(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, data: PfdInput): void {
  const centerY = y + h / 2
  const pxPerFpm = h / 2 / 2000 // +-2000fpm full scale, flagged layout assumption

  ctx.fillStyle = COLORS.tapeBg
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = COLORS.tapeText
  ctx.lineWidth = 1
  for (const v of [-2000, -1000, 0, 1000, 2000]) {
    const ty = tapeValueToY(0, v, pxPerFpm, centerY)
    ctx.beginPath()
    ctx.moveTo(x, ty)
    ctx.lineTo(x + w * 0.35, ty)
    ctx.stroke()
  }

  const vsClamped = Math.max(-2000, Math.min(2000, data.verticalSpeedFpm))
  const needleY = tapeValueToY(0, vsClamped, pxPerFpm, centerY)
  ctx.fillStyle = COLORS.magenta
  ctx.beginPath()
  ctx.moveTo(x, centerY)
  ctx.lineTo(x + w * 0.6, needleY)
  ctx.lineTo(x, needleY)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = COLORS.tapeText
  ctx.font = `${Math.round(h * 0.04)}px monospace`
  ctx.fillText(data.verticalSpeedFpm.toFixed(0), x + w * 0.05, y + h + h * 0.06)
}

/** Attitude indicator: blue-over-brown horizon, pitch ladder, roll pointer, slip/skid. */
function drawAttitude(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, data: PfdInput): void {
  const cx = x + w / 2
  const cy = y + h / 2

  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()

  ctx.translate(cx, cy)
  ctx.rotate((-data.rollDeg * Math.PI) / 180)

  const pxPerDeg = h / 40 // 40deg pitch span visible, flagged layout assumption
  const pitchOffset = data.pitchDeg * pxPerDeg
  const bigSize = Math.max(w, h) * 2

  ctx.fillStyle = COLORS.sky
  ctx.fillRect(-bigSize, -bigSize + pitchOffset, bigSize * 2, bigSize)
  ctx.fillStyle = COLORS.ground
  ctx.fillRect(-bigSize, pitchOffset, bigSize * 2, bigSize)

  ctx.strokeStyle = COLORS.horizonLine
  ctx.lineWidth = Math.max(2, h * 0.008)
  ctx.beginPath()
  ctx.moveTo(-bigSize, pitchOffset)
  ctx.lineTo(bigSize, pitchOffset)
  ctx.stroke()

  // Pitch ladder every 10deg.
  ctx.font = `${Math.round(h * 0.035)}px monospace`
  ctx.fillStyle = COLORS.tapeText
  ctx.textAlign = 'center'
  for (let p = -30; p <= 30; p += 10) {
    if (p === 0) continue
    const ly = pitchOffset - p * pxPerDeg
    const lineW = w * (Math.abs(p) === 30 ? 0.18 : 0.12)
    ctx.strokeStyle = COLORS.tapeText
    ctx.beginPath()
    ctx.moveTo(-lineW, ly)
    ctx.lineTo(lineW, ly)
    ctx.stroke()
    ctx.fillText(String(Math.abs(p)), -lineW - w * 0.06, ly)
  }
  ctx.restore()

  // Fixed (non-rolling/non-pitching) bank pointer + roll scale at top of the box.
  ctx.save()
  ctx.translate(cx, y + h * 0.12)
  ctx.strokeStyle = COLORS.tapeText
  ctx.lineWidth = 2
  for (const bankDeg of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const a = ((bankDeg - 0) * Math.PI) / 180
    const r1 = h * 0.32
    const r2 = bankDeg === 0 ? h * 0.24 : h * 0.28
    ctx.beginPath()
    ctx.moveTo(r1 * Math.sin(a), -r1 * Math.cos(a))
    ctx.lineTo(r2 * Math.sin(a), -r2 * Math.cos(a))
    ctx.stroke()
  }
  // Roll pointer (triangle) rotates with current roll.
  ctx.save()
  ctx.rotate((data.rollDeg * Math.PI) / 180)
  ctx.fillStyle = COLORS.tapeText
  const r = h * 0.32
  ctx.beginPath()
  ctx.moveTo(0, -r)
  ctx.lineTo(-h * 0.02, -r + h * 0.03)
  ctx.lineTo(h * 0.02, -r + h * 0.03)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
  ctx.restore()

  // Slip/skid indicator: a small ball offset horizontally, riding just below
  // the roll pointer. `slipSkidDeg` is a proxy (FlightData.betaDeg) — no
  // dedicated slip-ball input exists on FlightData.
  ctx.save()
  ctx.translate(cx, y + h * 0.12 + h * 0.05)
  const slipPx = Math.max(-1, Math.min(1, data.slipSkidDeg / 10)) * w * 0.06
  ctx.strokeStyle = COLORS.tapeText
  ctx.strokeRect(-w * 0.07, -h * 0.012, w * 0.14, h * 0.024)
  ctx.fillStyle = COLORS.white
  ctx.beginPath()
  ctx.arc(slipPx, 0, h * 0.012, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // Fixed aircraft symbol (wings + dot) at screen center.
  ctx.strokeStyle = COLORS.yellow
  ctx.lineWidth = Math.max(3, h * 0.012)
  ctx.beginPath()
  ctx.moveTo(cx - w * 0.12, cy)
  ctx.lineTo(cx - w * 0.03, cy)
  ctx.moveTo(cx + w * 0.03, cy)
  ctx.lineTo(cx + w * 0.12, cy)
  ctx.stroke()
  ctx.fillStyle = COLORS.yellow
  ctx.beginPath()
  ctx.arc(cx, cy, h * 0.01, 0, Math.PI * 2)
  ctx.fill()
}

/** HSI: compass rose, heading bug, and an honestly-inert CDI (no Phase-4 nav yet). */
function drawHsi(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, data: PfdInput): void {
  const cx = x + w / 2
  const cy = y + h / 2
  const r = Math.min(w, h) * 0.42

  ctx.fillStyle = COLORS.tapeBg
  ctx.fillRect(x, y, w, h)

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((-data.headingDeg * Math.PI) / 180)

  ctx.strokeStyle = COLORS.tapeText
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.stroke()

  ctx.font = `${Math.round(r * 0.18)}px monospace`
  ctx.fillStyle = COLORS.tapeText
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let hdg = 0; hdg < 360; hdg += 30) {
    const a = (hdg * Math.PI) / 180
    const label = hdg === 0 ? 'N' : hdg === 90 ? 'E' : hdg === 180 ? 'S' : hdg === 270 ? 'W' : String(hdg / 10)
    ctx.save()
    ctx.translate(r * Math.sin(a), -r * Math.cos(a))
    ctx.rotate(a)
    ctx.fillText(label, 0, 0)
    ctx.restore()
  }

  // Heading bug.
  const bugA = (data.headingBugDeg * Math.PI) / 180
  ctx.fillStyle = COLORS.cyan
  ctx.save()
  ctx.rotate(bugA)
  ctx.beginPath()
  ctx.moveTo(0, -r)
  ctx.lineTo(-r * 0.05, -r * 0.9)
  ctx.lineTo(r * 0.05, -r * 0.9)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  // CDI: honestly-inert instrument face. No live VOR/GPS nav exists until
  // Phase 4, so this renders a centered needle with a flagged/inactive
  // annunciation rather than fabricating a live deviation signal.
  ctx.strokeStyle = COLORS.magenta
  ctx.lineWidth = Math.max(2, r * 0.03)
  ctx.beginPath()
  ctx.moveTo(0, -r * 0.7)
  ctx.lineTo(0, r * 0.7)
  ctx.stroke()
  // Deviation dots (always centered/inert this phase).
  for (const d of [-0.6, -0.3, 0.3, 0.6]) {
    ctx.beginPath()
    ctx.arc(d * r * 0.5, 0, r * 0.02, 0, Math.PI * 2)
    ctx.stroke()
  }

  ctx.restore()

  // Fixed lubber line + heading readout.
  ctx.strokeStyle = COLORS.yellow
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cx, cy - r - r * 0.15)
  ctx.lineTo(cx - r * 0.06, cy - r)
  ctx.lineTo(cx + r * 0.06, cy - r)
  ctx.closePath()
  ctx.stroke()

  ctx.fillStyle = COLORS.bezel
  ctx.fillRect(cx - w * 0.08, cy - r - r * 0.35, w * 0.16, r * 0.2)
  ctx.fillStyle = COLORS.tapeText
  ctx.font = `bold ${Math.round(r * 0.18)}px monospace`
  ctx.textAlign = 'center'
  ctx.fillText(Math.round(data.headingDeg).toString().padStart(3, '0') + '°', cx, cy - r - r * 0.25)

  // "NO NAV" flag — honest placeholder in place of a real CDI source flag,
  // since no VOR/GPS source selection exists yet (Phase 4).
  ctx.fillStyle = COLORS.annunciatorWarn
  ctx.font = `${Math.round(r * 0.14)}px monospace`
  ctx.fillText('NO NAV', cx, cy + r * 0.35)

  // Wind vector box (direction + speed), corner of the HSI.
  ctx.textAlign = 'left'
  ctx.fillStyle = COLORS.tapeText
  ctx.font = `${Math.round(r * 0.14)}px monospace`
  ctx.fillText(`WIND ${Math.round(data.windDirDeg).toString().padStart(3, '0')}°/${Math.round(data.windSpeedKt)}`, x + w * 0.02, y + h * 0.06)
}

/** NAV/COM frequency boxes with flip-flop (active over standby) display. */
function drawRadioStack(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, radio: RadioStack): void {
  ctx.fillStyle = COLORS.bezel
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = COLORS.bezelText
  ctx.strokeRect(x, y, w, h)

  ctx.fillStyle = COLORS.tapeText
  ctx.font = `${Math.round(h * 0.22)}px monospace`
  ctx.textAlign = 'left'
  ctx.fillText(label, x + w * 0.04, y + h * 0.22)

  ctx.fillStyle = COLORS.green
  ctx.font = `bold ${Math.round(h * 0.3)}px monospace`
  ctx.fillText(radio.activeMhz.toFixed(3), x + w * 0.04, y + h * 0.55)

  ctx.fillStyle = COLORS.tapeText
  ctx.font = `${Math.round(h * 0.24)}px monospace`
  ctx.fillText(radio.standbyMhz.toFixed(3), x + w * 0.04, y + h * 0.88)
}

/** Transponder squawk box. */
function drawTransponder(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, squawk: string): void {
  ctx.fillStyle = COLORS.bezel
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = COLORS.bezelText
  ctx.strokeRect(x, y, w, h)
  ctx.fillStyle = COLORS.tapeText
  ctx.font = `${Math.round(h * 0.28)}px monospace`
  ctx.textAlign = 'left'
  ctx.fillText('XPDR', x + w * 0.05, y + h * 0.3)
  ctx.font = `bold ${Math.round(h * 0.4)}px monospace`
  ctx.fillText(squawk.padStart(4, '0'), x + w * 0.05, y + h * 0.75)
}

/** OAT + TAS/GS readout box. */
function drawOatTas(ctx: CanvasRenderingContext2D, x: number, y: number, _w: number, h: number, data: PfdInput): void {
  ctx.fillStyle = COLORS.tapeText
  ctx.font = `${Math.round(h * 0.22)}px monospace`
  ctx.textAlign = 'left'
  ctx.fillText(`OAT ${data.oatC.toFixed(0)}°C`, x, y + h * 0.3)
  ctx.fillText(`TAS ${data.ktas.toFixed(0)}KT`, x, y + h * 0.62)
  ctx.fillText(`GS  ${data.groundSpeedKt.toFixed(0)}KT`, x, y + h * 0.94)
}

/** Annunciator window: lists active annunciations/warnings as plain text. */
function drawAnnunciator(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, annunciations: readonly string[]): void {
  ctx.fillStyle = COLORS.annunciatorBg
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = COLORS.bezelText
  ctx.strokeRect(x, y, w, h)

  ctx.font = `${Math.round(h * 0.08)}px monospace`
  ctx.textAlign = 'left'
  if (annunciations.length === 0) {
    ctx.fillStyle = '#606060'
    ctx.fillText('NO ANNUNCIATIONS', x + w * 0.05, y + h * 0.12)
    return
  }
  annunciations.forEach((msg, i) => {
    ctx.fillStyle = COLORS.annunciatorWarn
    ctx.fillText(msg, x + w * 0.05, y + h * (0.12 + i * 0.11))
  })
}

/** Softkey bezel row along the bottom of the display. */
function drawSoftkeys(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  for (const region of pfdSoftkeyRegions(width, height)) {
    ctx.fillStyle = COLORS.bezel
    ctx.fillRect(region.x, region.y, region.w, region.h)
    ctx.strokeStyle = '#000000'
    ctx.strokeRect(region.x, region.y, region.w, region.h)
    ctx.fillStyle = COLORS.bezelText
    ctx.font = `${Math.round(region.h * 0.32)}px monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(region.label, region.x + region.w / 2, region.y + region.h / 2)
  }
}

/**
 * Draw the full G1000 PFD into `ctx` at `width`x`height`. Pure function of
 * `data` in, pixels out — call once per display refresh (20-30fps target
 * per the phase plan, not every physics step).
 */
export function drawPfd(ctx: CanvasRenderingContext2D, width: number, height: number, data: PfdInput): void {
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, width, height)

  const softkeyRowH = height * SOFTKEY_ROW_HEIGHT_FRAC
  const topRowH = height * 0.06
  const bodyY = topRowH
  const bodyH = height - topRowH - softkeyRowH

  // Top row: NAV/COM frequency boxes (left), transponder (right).
  const freqBoxW = width * 0.14
  drawRadioStack(ctx, 0, 0, freqBoxW, topRowH, 'COM1', data.com1)
  drawRadioStack(ctx, freqBoxW, 0, freqBoxW, topRowH, 'NAV1', data.nav1)
  drawTransponder(ctx, width - width * 0.12, 0, width * 0.12, topRowH, data.squawk)

  // Main body: airspeed tape | attitude+HSI | altitude tape | VSI | annunciator
  const asiW = width * 0.12
  const altW = width * 0.1
  const vsiW = width * 0.04
  const annW = width * 0.14
  const attX = asiW
  const attW = width - asiW - altW - vsiW - annW

  drawAirspeedTape(ctx, 0, bodyY, asiW, bodyH * 0.62, data)
  drawOatTas(ctx, 0, bodyY + bodyH * 0.64, asiW, bodyH * 0.34, data)

  drawAttitude(ctx, attX, bodyY, attW, bodyH * 0.55, data)
  drawHsi(ctx, attX, bodyY + bodyH * 0.57, attW, bodyH * 0.4, data)

  drawAltitudeTape(ctx, attX + attW, bodyY, altW, bodyH * 0.62, data)
  drawVsi(ctx, attX + attW + altW, bodyY, vsiW, bodyH * 0.62, data)

  drawAnnunciator(ctx, width - annW, bodyY, annW, bodyH * 0.5, data.annunciations)

  drawSoftkeys(ctx, width, height)
}
