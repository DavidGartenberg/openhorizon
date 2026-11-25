/**
 * External-view instrument overlay: the on-screen flight instruments of a
 * modern consumer flight sim, drawn on one transparent canvas over the
 * 3D view — compass rose with heading / course bugs and a heading readout
 * across the top; airspeed tape, engine dials, fuel and angle-of-attack
 * bars at bottom left; altitude and vertical-speed tapes with flaps and
 * trim indicators at bottom right. Every value comes from the sim's own
 * state (nothing is synthesized); instruments the airplane does not have
 * (course pointer with no nav tuned, flaps on a glider) are not drawn.
 * Original drawing code and layout — no third-party artwork or fonts.
 */

export interface OverlayEngine {
  /** Lever position, 0–100 %. */
  lever: number
  /** Gauge value, % (N1 for jets, power % for propellers). */
  value: number
  /** Gauge redline, % (the jet limit or the propeller redline). */
  redline: number
}

export interface OverlayState {
  headingDeg: number
  headingBugDeg: number
  /** Selected course (nav tuned); undefined hides the course pointer. */
  courseDeg?: number
  iasKt: number
  /** Selected speed, kt; undefined shows --- . */
  selSpeedKt?: number
  tasKt: number
  groundSpeedKt: number
  altitudeFt: number
  /** Selected altitude, ft; undefined shows ---- . */
  selAltFt?: number
  baroInHg: number
  verticalSpeedFpm: number
  engines: OverlayEngine[]
  /** Total fuel, 0–100 % of capacity; undefined for fuel-less airplanes. */
  fuelPct?: number
  /** Angle of attack, degrees, and the stall-onset angle (for the bands). */
  aoaDeg: number
  aoaStallDeg: number
  /** Flap position 0–1 and the setting in degrees; undefined = no flaps. */
  flapsFrac?: number
  flapsDeg?: number
  /** Pitch trim, −1…+1 (nose-up positive); undefined = hidden. */
  trim?: number
  /** Airspeed arcs (kt): normal operating range and caution range. */
  greenLowKt: number
  greenHighKt: number
  yellowHighKt: number
  /** Active alert / first-officer callout, shown as a banner. */
  alert?: string
  alertRed?: boolean
  callout?: string
}

// ---------------------------------------------------------------------------
// Pure layout helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Vertical position (rows from the tape centre, + = below) of `v` when the
 *  tape is centred on `centre` and rows are `step` apart. */
export function tapeOffset(v: number, centre: number, step: number): number {
  return (centre - v) / step
}

/** Compass-rose labels: 30° apart, N/E/S/W and the tens (3, 6, 12, …). */
export function compassLabel(deg: number): string {
  const d = ((Math.round(deg / 30) * 30) % 360 + 360) % 360
  return d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : String(d / 10)
}

/** Sweep angle of an engine dial for a value (0 at the dial's start, 1 at
 *  its end), clamped; the dial spans 0…`max`. */
export function dialFraction(value: number, max = 110): number {
  return Math.max(0, Math.min(1, value / max))
}

/** AOA bar bands as fractions of the bar height (bottom → top): green,
 *  yellow, amber, red. The marker position is `aoaFraction`. */
export const AOA_BANDS = [
  { to: 0.45, color: '#2fc05a' },
  { to: 0.7, color: '#f0d63a' },
  { to: 0.88, color: '#f3992b' },
  { to: 1, color: '#e5483b' },
] as const

/** Marker height on the AOA bar: −4° … stall angle mapped to 0…1 (the red
 *  band starts a little before stall). Pure, clamped. */
export function aoaFraction(aoaDeg: number, stallDeg: number): number {
  const lo = -4, hi = Math.max(stallDeg + 2, 8)
  return Math.max(0, Math.min(1, (aoaDeg - lo) / (hi - lo)))
}

/** Vertical-speed tape position, −1 … +1 (non-linear: ±1000 fpm takes half
 *  the throw, like the airliner VSI). Pure. */
export function vsTapeFraction(fpm: number): number {
  const v = Math.max(-6000, Math.min(6000, fpm))
  const a = Math.abs(v)
  const f = a <= 1000 ? (a / 1000) * 0.5 : a <= 2000 ? 0.5 + ((a - 1000) / 1000) * 0.25 : 0.75 + ((a - 2000) / 4000) * 0.25
  return Math.sign(v) * f
}

/** Layout scale for a viewport: the design is 1280×720. */
export function overlayScale(w: number, h: number): number {
  return Math.max(0.55, Math.min(1.5, Math.min(w / 1280, h / 720)))
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const WHITE = '#f4f6f8'
const CYAN = '#33d6ff'
const MAGENTA = '#ff5ad8'
const GREEN = '#35d062'
const AMBER = '#f3b13a'
const RED = '#ee4a3d'
const PANEL = 'rgba(8,12,18,0.42)'
const FONT = '"Arial Narrow","Helvetica Neue Condensed","Roboto Condensed",system-ui,sans-serif'

type Ctx = CanvasRenderingContext2D

function label(c: Ctx, t: string, x: number, y: number, size: number, color = WHITE, align: CanvasTextAlign = 'left', weight = 600): void {
  c.font = `${weight} ${size}px ${FONT}`
  c.textAlign = align
  c.textBaseline = 'middle'
  c.lineWidth = Math.max(2, size * 0.18)
  c.strokeStyle = 'rgba(0,0,0,0.65)'
  c.strokeText(t, x, y)
  c.fillStyle = color
  c.fillText(t, x, y)
}

function box(c: Ctx, x: number, y: number, w: number, h: number, stroke = 'rgba(255,255,255,0.85)'): void {
  c.fillStyle = 'rgba(5,8,12,0.78)'
  c.fillRect(x, y, w, h)
  c.strokeStyle = stroke
  c.lineWidth = 1.5
  c.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5)
}

function drawCompass(c: Ctx, s: number, st: OverlayState): void {
  const r = 62 * s, cx = 28 * s + r, cy = 52 * s + r
  c.save()
  c.fillStyle = PANEL
  c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill()
  c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1.6
  c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke()
  // rotating card
  c.translate(cx, cy)
  c.rotate((-st.headingDeg * Math.PI) / 180)
  for (let d = 0; d < 360; d += 5) {
    const major = d % 30 === 0, mid = d % 10 === 0
    const a = (d * Math.PI) / 180
    const len = (major ? 11 : mid ? 7 : 4) * s
    c.strokeStyle = WHITE; c.lineWidth = major ? 2 : 1.2
    c.beginPath(); c.moveTo(Math.sin(a) * r, -Math.cos(a) * r); c.lineTo(Math.sin(a) * (r - len), -Math.cos(a) * (r - len)); c.stroke()
    if (major) {
      c.save()
      c.translate(Math.sin(a) * (r - 22 * s), -Math.cos(a) * (r - 22 * s))
      c.rotate(a)
      label(c, compassLabel(d), 0, 0, (d % 90 === 0 ? 17 : 13) * s, d % 90 === 0 ? WHITE : '#dfe6ee', 'center', 700)
      c.restore()
    }
  }
  // heading bug (cyan) on the ring
  const hb = (st.headingBugDeg * Math.PI) / 180
  c.save(); c.rotate(hb)
  c.fillStyle = CYAN
  c.beginPath(); c.moveTo(-6 * s, -r - 1); c.lineTo(6 * s, -r - 1); c.lineTo(6 * s, -r + 7 * s); c.lineTo(0, -r + 3 * s); c.lineTo(-6 * s, -r + 7 * s); c.closePath(); c.fill()
  c.restore()
  // course pointer (magenta) — only when a nav source is tuned
  if (st.courseDeg !== undefined) {
    c.save(); c.rotate((st.courseDeg * Math.PI) / 180)
    c.strokeStyle = MAGENTA; c.lineWidth = 2.6
    c.beginPath(); c.moveTo(0, r - 14 * s); c.lineTo(0, -r + 16 * s); c.stroke()
    c.fillStyle = MAGENTA
    c.beginPath(); c.moveTo(0, -r + 10 * s); c.lineTo(-6 * s, -r + 24 * s); c.lineTo(6 * s, -r + 24 * s); c.closePath(); c.fill()
    c.restore()
  }
  c.restore()
  // fixed aircraft symbol + lubber line
  c.strokeStyle = WHITE; c.lineWidth = 2
  c.beginPath(); c.moveTo(cx, cy - 12 * s); c.lineTo(cx, cy + 10 * s); c.moveTo(cx - 10 * s, cy); c.lineTo(cx + 10 * s, cy); c.moveTo(cx - 4 * s, cy + 9 * s); c.lineTo(cx + 4 * s, cy + 9 * s); c.stroke()
  c.fillStyle = WHITE
  c.beginPath(); c.moveTo(cx, cy - r - 2); c.lineTo(cx - 5 * s, cy - r - 11 * s); c.lineTo(cx + 5 * s, cy - r - 11 * s); c.closePath(); c.fill()
  // bug readouts above the rose
  const hdgTxt = String(Math.round(((st.headingBugDeg % 360) + 360) % 360) || 360).padStart(3, '0')
  label(c, 'HDG', cx - r + 0, 30 * s, 11 * s, WHITE, 'left'); label(c, `${hdgTxt}°`, cx - r + 28 * s, 30 * s, 12 * s, CYAN, 'left', 700)
  if (st.courseDeg !== undefined) {
    label(c, 'CRS', cx + 6 * s, 30 * s, 11 * s, WHITE, 'left')
    label(c, `${String(Math.round(((st.courseDeg % 360) + 360) % 360) || 360).padStart(3, '0')}°`, cx + 32 * s, 30 * s, 12 * s, MAGENTA, 'left', 700)
  }
}

function drawHeadingTop(c: Ctx, s: number, w: number, st: OverlayState): void {
  const cx = w / 2
  const hdg = String(Math.round(((st.headingDeg % 360) + 360) % 360) || 360).padStart(3, '0')
  c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 1.6
  c.beginPath(); c.moveTo(cx - 62 * s, 54 * s); c.lineTo(cx + 62 * s, 54 * s); c.stroke()
  c.fillStyle = WHITE
  c.beginPath(); c.moveTo(cx, 62 * s); c.lineTo(cx - 7 * s, 52 * s); c.lineTo(cx + 7 * s, 52 * s); c.closePath(); c.fill()
  label(c, `${hdg}°`, cx, 34 * s, 17 * s, WHITE, 'center', 700)
}

function drawTape(c: Ctx, s: number, x: number, y: number, w: number, h: number, centre: number, step: number, rows: number, fmt: (v: number) => string, side: 'left' | 'right', minorStep: number): void {
  c.fillStyle = PANEL
  c.fillRect(x, y, w, h)
  c.save()
  c.beginPath(); c.rect(x, y, w, h); c.clip()
  const rowH = h / rows
  const mid = y + h / 2
  const lo = centre - (rows / 2 + 1) * step, hi = centre + (rows / 2 + 1) * step
  for (let v = Math.ceil(lo / minorStep) * minorStep; v <= hi; v += minorStep) {
    const yy = mid + tapeOffset(v, centre, step) * rowH
    const major = Math.abs(v / step - Math.round(v / step)) < 1e-6
    c.strokeStyle = WHITE; c.lineWidth = major ? 1.6 : 1
    const tx = side === 'left' ? x + w : x
    c.beginPath(); c.moveTo(tx, yy); c.lineTo(tx + (side === 'left' ? -1 : 1) * (major ? 9 : 5) * s, yy); c.stroke()
    if (major) label(c, fmt(v), side === 'left' ? x + w - 13 * s : x + 13 * s, yy, 14 * s, WHITE, side === 'left' ? 'right' : 'left', 600)
  }
  c.restore()
}

function drawAirspeed(c: Ctx, s: number, H: number, st: OverlayState): void {
  const x = 30 * s, w = 66 * s, h = 150 * s, y = H - 205 * s
  label(c, 'AIRSPEED', x, y - 38 * s, 11 * s, WHITE, 'left', 700)
  box(c, x, y - 28 * s, w, 20 * s, 'rgba(255,255,255,0.4)')
  label(c, st.selSpeedKt === undefined ? '--- KTS' : `${Math.round(st.selSpeedKt)} KTS`, x + w / 2, y - 18 * s, 12 * s, st.selSpeedKt === undefined ? '#6c8794' : CYAN, 'center', 700)
  drawTape(c, s, x, y, w, h, st.iasKt, 10, 6, (v) => (v < 0 ? '' : String(Math.round(v))), 'left', 5)
  // speed arcs along the right edge of the tape (green normal, amber caution)
  const rowH = h / 6, mid = y + h / 2
  const band = (lo: number, hi: number, col: string): void => {
    const y0 = Math.max(y, mid + tapeOffset(hi, st.iasKt, 10) * rowH), y1 = Math.min(y + h, mid + tapeOffset(lo, st.iasKt, 10) * rowH)
    if (y1 > y0) { c.fillStyle = col; c.fillRect(x + w + 1, y0, 5 * s, y1 - y0) }
  }
  band(st.greenLowKt, st.greenHighKt, GREEN)
  band(st.greenHighKt, st.yellowHighKt, AMBER)
  // current speed box
  box(c, x + 6 * s, mid - 12 * s, w - 4 * s, 24 * s)
  label(c, String(Math.max(0, Math.round(st.iasKt))), x + w - 8 * s, mid, 17 * s, WHITE, 'right', 700)
  label(c, `TAS ${Math.round(st.tasKt)}KT`, x, y + h + 14 * s, 11 * s, WHITE, 'left', 600)
  label(c, `GS ${Math.round(st.groundSpeedKt)}`, x + w, y + h + 14 * s, 11 * s, '#b9c6d2', 'right', 600)
}

function drawEngine(c: Ctx, s: number, x: number, y: number, n: number, e: OverlayEngine): void {
  const r = 34 * s, cx = x + r, cy = y + r + 8 * s
  label(c, `ENGINE #${n}`, x, y - 4 * s, 11 * s, WHITE, 'left', 700)
  c.fillStyle = PANEL
  c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill()
  const a0 = Math.PI * 0.75, span = Math.PI * 1.5
  const ang = (v: number): number => a0 + dialFraction(v) * span
  c.lineWidth = 5 * s
  c.strokeStyle = GREEN
  c.beginPath(); c.arc(cx, cy, r - 5 * s, a0, ang(e.redline)); c.stroke()
  c.strokeStyle = RED
  c.beginPath(); c.arc(cx, cy, r - 5 * s, ang(e.redline), a0 + span); c.stroke()
  // needle
  c.strokeStyle = WHITE; c.lineWidth = 2.6
  const na = ang(e.value)
  c.beginPath(); c.moveTo(cx + Math.cos(na) * 6 * s, cy + Math.sin(na) * 6 * s); c.lineTo(cx + Math.cos(na) * (r - 10 * s), cy + Math.sin(na) * (r - 10 * s)); c.stroke()
  label(c, '0', cx - r + 6 * s, cy + r - 6 * s, 10 * s, WHITE, 'center')
  label(c, '110', cx + r - 6 * s, cy + r - 6 * s, 10 * s, WHITE, 'center')
  label(c, 'LVR', cx - 6 * s, cy + 12 * s, 9 * s, '#b9c6d2', 'right', 600)
  label(c, `${Math.round(e.lever)}%`, cx - 4 * s, cy + 12 * s, 11 * s, WHITE, 'left', 700)
  label(c, `${Math.round(e.value)}%`, cx, cy + r + 12 * s, 13 * s, WHITE, 'center', 700)
}

function drawBar(c: Ctx, s: number, x: number, y: number, w: number, h: number, title: string, fraction: number, bands: ReadonlyArray<{ to: number; color: string }>, valueText: string): void {
  label(c, title, x, y - 12 * s, 11 * s, WHITE, 'left', 700)
  c.fillStyle = PANEL
  c.fillRect(x, y, w, h)
  let from = 0
  for (const b of bands) {
    c.fillStyle = b.color
    c.globalAlpha = 0.85
    c.fillRect(x + 3 * s, y + h * (1 - b.to) + 1, w - 6 * s, Math.max(1, h * (b.to - from) - 2))
    from = b.to
  }
  c.globalAlpha = 1
  const my = y + h * (1 - Math.max(0, Math.min(1, fraction)))
  c.fillStyle = WHITE
  c.beginPath(); c.moveTo(x - 6 * s, my); c.lineTo(x + 4 * s, my - 5 * s); c.lineTo(x + 4 * s, my + 5 * s); c.closePath(); c.fill()
  c.strokeStyle = WHITE; c.lineWidth = 1.5; c.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5)
  label(c, valueText, x + w / 2, y + h + 12 * s, 12 * s, WHITE, 'center', 700)
}

function drawAltitude(c: Ctx, s: number, W: number, H: number, st: OverlayState): void {
  const w = 74 * s, h = 150 * s, x = W - 98 * s - 40 * s - w + 40 * s, y = H - 205 * s
  label(c, 'ALTITUDE', x + w, y - 38 * s, 11 * s, WHITE, 'right', 700)
  box(c, x, y - 28 * s, w, 20 * s, 'rgba(255,255,255,0.4)')
  label(c, st.selAltFt === undefined ? '----' : String(Math.round(st.selAltFt)), x + w / 2, y - 18 * s, 12 * s, st.selAltFt === undefined ? '#6c8794' : CYAN, 'center', 700)
  drawTape(c, s, x, y, w, h, st.altitudeFt, 100, 6, (v) => String(Math.round(v)), 'right', 20)
  const mid = y + h / 2
  box(c, x - 4 * s, mid - 12 * s, w - 2 * s, 24 * s)
  label(c, String(Math.round(st.altitudeFt)), x + w - 8 * s, mid, 17 * s, WHITE, 'right', 700)
  label(c, `${st.baroInHg.toFixed(2)} IN`, x + w, y + h + 14 * s, 11 * s, WHITE, 'right', 600)
  // vertical speed tape
  const vx = x + w + 14 * s, vw = 34 * s
  label(c, 'VS', vx + vw, y - 38 * s, 11 * s, WHITE, 'right', 700)
  c.fillStyle = PANEL; c.fillRect(vx, y, vw, h)
  for (const t of [-6, -4, -2, -1, 0, 1, 2, 4, 6]) {
    const yy = y + h / 2 - vsTapeFraction(t * 1000) * (h / 2)
    c.strokeStyle = WHITE; c.lineWidth = t === 0 ? 2 : 1.2
    c.beginPath(); c.moveTo(vx, yy); c.lineTo(vx + (t === 0 ? 14 : 8) * s, yy); c.stroke()
    if (t !== 0 && Math.abs(t) !== 1) label(c, String(Math.abs(t)), vx + 18 * s, yy, 10 * s, WHITE, 'left', 600)
  }
  const py = y + h / 2 - vsTapeFraction(st.verticalSpeedFpm) * (h / 2)
  c.fillStyle = WHITE
  c.beginPath(); c.moveTo(vx + vw + 2, py); c.lineTo(vx + vw - 12 * s, py - 6 * s); c.lineTo(vx + vw - 12 * s, py + 6 * s); c.closePath(); c.fill()
  box(c, vx - 2 * s, y + h + 2 * s, vw + 6 * s, 20 * s, 'rgba(255,255,255,0.4)')
  label(c, String(Math.round(st.verticalSpeedFpm / 10) * 10), vx + vw / 2 + 1 * s, y + h + 12 * s, 12 * s, WHITE, 'center', 700)
  // flaps and trim columns, left of the altitude tape
  let fx = x - 66 * s
  if (st.flapsFrac !== undefined) {
    label(c, 'FLAPS', fx, y - 12 * s, 11 * s, WHITE, 'left', 700)
    c.fillStyle = PANEL; c.fillRect(fx, y, 26 * s, h)
    for (let i = 0; i <= 4; i++) { const yy = y + 8 * s + (i / 4) * (h - 16 * s); c.strokeStyle = WHITE; c.lineWidth = 1.3; c.beginPath(); c.moveTo(fx, yy); c.lineTo(fx + 8 * s, yy); c.stroke() }
    const my = y + 8 * s + st.flapsFrac * (h - 16 * s)
    c.fillStyle = WHITE; c.beginPath(); c.moveTo(fx + 26 * s, my); c.lineTo(fx + 14 * s, my - 5 * s); c.lineTo(fx + 14 * s, my + 5 * s); c.closePath(); c.fill()
    label(c, `${Math.round(st.flapsDeg ?? 0)}°`, fx + 13 * s, y + h + 12 * s, 12 * s, WHITE, 'center', 700)
    fx -= 56 * s
  }
  if (st.trim !== undefined) {
    label(c, 'TRIM', fx, y - 12 * s, 11 * s, WHITE, 'left', 700)
    c.fillStyle = PANEL; c.fillRect(fx, y, 26 * s, h)
    label(c, 'DN', fx + 13 * s, y + 10 * s, 9 * s, '#b9c6d2', 'center', 600)
    label(c, 'UP', fx + 13 * s, y + h - 10 * s, 9 * s, '#b9c6d2', 'center', 600)
    c.fillStyle = GREEN; c.fillRect(fx + 4 * s, y + h * 0.42, 18 * s, h * 0.16)
    const my = y + h / 2 - st.trim * (h / 2 - 14 * s) * -1
    c.fillStyle = WHITE; c.beginPath(); c.moveTo(fx + 26 * s, my); c.lineTo(fx + 14 * s, my - 5 * s); c.lineTo(fx + 14 * s, my + 5 * s); c.closePath(); c.fill()
    label(c, `${Math.round(st.trim * 100)}%`, fx + 13 * s, y + h + 12 * s, 12 * s, WHITE, 'center', 700)
  }
}

function drawBanner(c: Ctx, s: number, w: number, st: OverlayState): void {
  let y = 86 * s
  if (st.alert) {
    c.font = `700 ${17 * s}px ${FONT}`
    const tw = c.measureText(st.alert).width + 36 * s
    c.fillStyle = st.alertRed ? 'rgba(200,30,22,0.9)' : 'rgba(224,150,20,0.92)'
    c.fillRect(w / 2 - tw / 2, y, tw, 28 * s)
    label(c, st.alert, w / 2, y + 14 * s, 17 * s, st.alertRed ? '#fff' : '#130b00', 'center', 700)
    y += 34 * s
  }
  if (st.callout) {
    const t = `First officer: ${st.callout}`
    c.font = `600 ${14 * s}px ${FONT}`
    const tw = c.measureText(t).width + 28 * s
    c.fillStyle = 'rgba(8,12,18,0.62)'
    c.fillRect(w / 2 - tw / 2, y, tw, 24 * s)
    label(c, t, w / 2, y + 12 * s, 14 * s, '#c8ecff', 'center', 600)
  }
}

/** Draw every instrument for a W×H viewport. Pure of DOM except the context. */
export function drawOverlay(c: Ctx, W: number, H: number, st: OverlayState): void {
  c.clearRect(0, 0, W, H)
  const s = overlayScale(W, H)
  drawCompass(c, s, st)
  drawHeadingTop(c, s, W, st)
  drawBanner(c, s, W, st)
  drawAirspeed(c, s, H, st)
  let ex = 112 * s
  st.engines.slice(0, 4).forEach((e, i) => { drawEngine(c, s, ex, H - 196 * s, i + 1, e); ex += 80 * s })
  let bx = ex + 4 * s
  if (st.fuelPct !== undefined) {
    drawBar(c, s, bx, H - 172 * s, 22 * s, 126 * s, 'FUEL', st.fuelPct / 100, [{ to: 0.12, color: RED }, { to: 0.25, color: AMBER }, { to: 1, color: GREEN }], `${Math.round(st.fuelPct)}%`)
    bx += 52 * s
  }
  drawBar(c, s, bx, H - 172 * s, 22 * s, 126 * s, 'AOA', aoaFraction(st.aoaDeg, st.aoaStallDeg), AOA_BANDS, `${Math.round(st.aoaDeg)}°`)
  drawAltitude(c, s, W, H, st)
}

/** The overlay element: a fixed, pointer-transparent canvas that redraws at
 *  ~20 Hz while visible. */
export class InstrumentOverlay {
  readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private last = 0
  private shown = true
  private w = 0
  private h = 0

  constructor() {
    const canvas = document.createElement('canvas')
    canvas.id = 'oh-instruments'
    canvas.setAttribute('aria-hidden', 'true')
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:35'
    document.body.appendChild(canvas)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable for the instrument overlay')
    this.canvas = canvas
    this.ctx = ctx
  }

  get visible(): boolean { return this.shown }
  set visible(v: boolean) {
    this.shown = v
    this.canvas.style.display = v ? '' : 'none'
  }

  update(state: OverlayState, now = performance.now()): void {
    if (!this.shown || now - this.last < 50) return
    this.last = now
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const W = window.innerWidth, H = window.innerHeight
    if (W !== this.w || H !== this.h) {
      this.w = W; this.h = H
      this.canvas.width = Math.round(W * dpr)
      this.canvas.height = Math.round(H * dpr)
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawOverlay(this.ctx, W, H, state)
  }
}
