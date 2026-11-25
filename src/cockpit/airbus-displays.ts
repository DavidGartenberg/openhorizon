import { vsiFraction, type BoeingEicasInput, type BoeingPfdInput } from './boeing-displays'

type Ctx = CanvasRenderingContext2D
const WHITE = '#e4eced', GREEN = '#47f781', CYAN = '#55eaff', AMBER = '#ffb541', YELLOW = '#ffe44a', MAGENTA = '#ff6dec'
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const angle = (v: number) => ((v % 360 + 360) % 360)
const delta = (a: number, b: number) => angle(a - b + 180) - 180
function text(c: Ctx, value: string, x: number, y: number, size = 18, color = WHITE): void {
  c.fillStyle = color; c.font = `600 ${size}px monospace`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(value, x, y)
}
function line(c: Ctx, x: number, y: number, ex: number, ey: number, color = WHITE, width = 1.5): void {
  c.strokeStyle = color; c.lineWidth = width; c.beginPath(); c.moveTo(x, y); c.lineTo(ex, ey); c.stroke()
}
function begin(c: Ctx, size: number): void {
  c.save(); c.scale(size / 512, size / 512); c.fillStyle = '#080e11'; c.fillRect(0, 0, 512, 512)
}
function clip(c: Ctx, x: number, y: number, w: number, h: number): void {
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip()
}

const MODE: Readonly<Record<string, string>> = {
  'MCP SPD': 'SPEED', 'HDG SEL': 'HDG', 'VOR/LOC': 'LOC', 'ALT HOLD': 'ALT', 'ALT ACQ': 'ALT*', LNAV: 'NAV', N1: 'THR', CMD: 'AP1',
}
const airbusMode = (s: string) => MODE[s] ?? s

/** Airbus presentation of the sim's existing flight data. No Airbus-only
 * automation or protections are inferred from the appearance of the deck. */
export function drawAirbusPfd(c: Ctx, size: number, d: BoeingPfdInput, navSource: 'gps' | 'vor' | 'loc' = 'loc'): void {
  begin(c, size)
  const cols = [54, 156, 258, 360, 462]
  for (let i = 1; i < cols.length; i++) line(c, cols[i]! - 51, 9, cols[i]! - 51, 67)
  const rollMode = d.fma.roll === 'VOR/LOC' ? (navSource === 'gps' ? 'NAV' : navSource === 'vor' ? 'VOR' : 'LOC') : d.fma.roll
  ;[d.fma.at, d.fma.pitch, rollMode, d.fma.land ?? '', d.fma.ap].forEach((s, i) => {
    if (s) text(c, airbusMode(s), cols[i]!, 28, 17, i === 4 ? WHITE : GREEN)
  })
  if (d.fma.pitchArmed) text(c, airbusMode(d.fma.pitchArmed), 156, 52, 16, CYAN)
  if (d.fma.rollArmed) text(c, d.fma.rollArmed === 'VOR/LOC' ? navSource === 'gps' ? 'NAV' : navSource === 'vor' ? 'VOR' : 'LOC' : airbusMode(d.fma.rollArmed), 258, 52, 16, CYAN)

  const cx = 246, cy = 244
  clip(c, 122, 112, 248, 264)
  c.translate(cx, cy); c.rotate(-d.rollDeg * Math.PI / 180)
  const pitch = clamp(d.pitchDeg, -90, 90) * 5
  c.fillStyle = '#1494c6'; c.fillRect(-768, -768 + pitch, 1536, 768)
  c.fillStyle = '#8c4f33'; c.fillRect(-768, pitch, 1536, 768)
  line(c, -768, pitch, 768, pitch)
  for (let deg = -30; deg <= 30; deg += 5) {
    if (!deg) continue
    const y = pitch - deg * 5, major = deg % 10 === 0, w = major ? 41 : 20
    line(c, -w, y, w, y)
    if (major) { text(c, String(Math.abs(deg)), -w - 16, y, 13); text(c, String(Math.abs(deg)), w + 16, y, 13) }
  }
  c.restore()
  for (const deg of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const a = (deg - 90) * Math.PI / 180, r = deg % 30 === 0 ? 148 : 142
    line(c, cx + Math.cos(a) * 132, cy + Math.sin(a) * 132, cx + Math.cos(a) * r, cy + Math.sin(a) * r)
  }
  const roll = clamp(d.rollDeg, -60, 60) * Math.PI / 180
  c.save(); c.translate(cx, cy); c.rotate(-roll)
  c.fillStyle = YELLOW; c.beginPath(); c.moveTo(0, -130); c.lineTo(7, -119); c.lineTo(-7, -119); c.closePath(); c.fill()
  c.fillRect(clamp(d.slipDeg * 2, -16, 16) - 6, -117, 12, 3); c.restore()
  if (d.fd && d.fma.ap) {
    const x = cx + clamp((d.fd.bankDeg - d.rollDeg) * 3, -73, 73), y = cy - clamp((d.fd.pitchDeg - d.pitchDeg) * 5, -76, 76)
    line(c, x, cy - 67, x, cy + 67, GREEN, 3); line(c, cx - 67, y, cx + 67, y, GREEN, 3)
  }
  line(c, cx - 91, cy, cx - 38, cy, YELLOW, 3); line(c, cx - 38, cy, cx - 38, cy + 15, YELLOW, 3)
  line(c, cx + 91, cy, cx + 38, cy, YELLOW, 3); line(c, cx + 38, cy, cx + 38, cy + 15, YELLOW, 3)
  c.fillStyle = YELLOW; c.fillRect(cx - 3, cy - 3, 6, 6)

  const tape = (x: number, w: number, value: number, step: number, spread: number, sel: number, min: number, labelsEvery: number): void => {
    clip(c, x, 104, w, 280)
    c.fillStyle = '#273239'; c.fillRect(x, 104, w, 280)
    const y = (v: number) => cy - (v - value) * spread
    const n = Math.ceil(142 / (step * spread))
    for (let i = -n; i <= n; i++) {
      const v = Math.floor(value / step) * step + i * step
      if (v < min) continue
      line(c, x + w - 10, y(v), x + w, y(v))
      if (v % labelsEvery === 0) text(c, String(v), x + (w - 12) / 2, y(v), 16)
    }
    const bug = clamp(y(sel), 108, 380)
    line(c, x + w - 12, bug, x + w, bug, CYAN, 3)
    if (x < cx) {
      for (const [limit, lo, hi] of [[d.vmoKt, 104, y(d.vmoKt)], [d.stallKt, y(d.stallKt), 384]] as const) {
        if (Number.isFinite(limit) && hi > lo) { c.fillStyle = '#f74638'; c.fillRect(x + w - 5, lo, 5, hi - lo) }
      }
      line(c, x + w - 16, cy, x + w - 16, cy - clamp(d.trendKt10s * spread, -105, 105), GREEN, 2)
    }
    c.restore()
    c.fillStyle = '#0b1013'; c.fillRect(x + 1, cy - 16, w - 3, 32)
    c.strokeStyle = YELLOW; c.lineWidth = 1.5; c.strokeRect(x + 1, cy - 16, w - 3, 32)
    text(c, String(Math.round(value)), x + w / 2, cy, 22, GREEN)
    text(c, String(Math.round(sel)), x + w / 2, 88, 17, CYAN)
  }
  tape(26, 76, d.iasKt, 10, 3.15, d.selSpeedKt, 30, 20)
  tape(390, 85, d.altFt, 100, .32, d.selAltFt, -1000, 500)
  line(c, 486, 126, 486, 362)
  const vs = vsiFraction(d.vsFpm)
  line(c, 507, cy, 487, cy - vs * 116, GREEN, 2.5)
  if (Math.abs(d.vsFpm) >= 200) text(c, String(Math.round(Math.abs(d.vsFpm) / 100)), 497, cy - vs * 116 - 13, 13, GREEN)

  if (d.loc !== undefined || d.gs !== undefined) {
    for (const i of [-2, -1, 0, 1, 2]) {
      c.strokeStyle = WHITE; c.lineWidth = 1; c.beginPath(); c.arc(cx + i * 26, 394, 3, 0, Math.PI * 2); c.stroke()
      c.beginPath(); c.arc(379, cy + i * 26, 3, 0, Math.PI * 2); c.stroke()
    }
    if (d.loc !== undefined) text(c, '◇', cx + clamp(d.loc, -2.5, 2.5) * 26, 394, 20, MAGENTA)
    if (d.gs !== undefined) text(c, '◇', 379, cy + clamp(d.gs, -2.5, 2.5) * 26, 20, MAGENTA)
  }
  if (!d.onGround && d.radioAltFt !== null && d.radioAltFt < 2500) text(c, String(Math.round(d.radioAltFt)), cx, 354, 22, d.radioAltFt < 400 ? AMBER : GREEN)
  clip(c, 114, 422, 270, 42)
  const h = Math.floor(d.hdgDeg / 10) * 10
  for (let i = -5; i <= 5; i++) {
    const v = h + i * 10, x = cx + delta(v, d.hdgDeg) * 4
    line(c, x, 427, x, 437); text(c, String(Math.round(angle(v) / 10)).padStart(2, '0'), x, 450, 15)
  }
  const selected = cx + clamp(delta(d.selHdgDeg, d.hdgDeg), -33, 33) * 4
  line(c, selected, 423, selected, 437, CYAN, 3); c.restore()
  text(c, String(Math.round(angle(d.hdgDeg)) % 360).padStart(3, '0'), cx, 481, 22, GREEN)
  if (d.mach >= .4) text(c, d.mach.toFixed(3), 63, 482, 17, GREEN)
  text(c, `${Math.round(d.baroInHg * 33.8639)} hPa`, 429, 482, 16, CYAN)
  c.restore()
}

/** Engine/warning display driven by the existing engine model. */
export function drawAirbusEwd(c: Ctx, size: number, d: BoeingEicasInput): void {
  begin(c, size)
  const count = Math.max(1, Math.min(4, d.n1Pct.length)), radius = Math.min(71, 177 / count)
  text(c, 'N1 %', 256, 40, 18, CYAN)
  text(c, 'EGT °C', 256, 188, 18, CYAN)
  text(c, 'FF KG/H', 256, 330, 18, CYAN)
  const dial = (x: number, y: number, v: number, max: number, digits: string, commanded?: number) => {
    const a = (n: number) => Math.PI + clamp(n / max, 0, 1) * Math.PI
    c.strokeStyle = WHITE; c.lineWidth = 2; c.beginPath(); c.arc(x, y, radius, Math.PI, Math.PI * 2); c.stroke()
    if (commanded !== undefined) line(c, x + Math.cos(a(commanded)) * (radius - 5), y + Math.sin(a(commanded)) * (radius - 5), x + Math.cos(a(commanded)) * (radius + 6), y + Math.sin(a(commanded)) * (radius + 6), CYAN, 2)
    line(c, x, y, x + Math.cos(a(v)) * (radius - 5), y + Math.sin(a(v)) * (radius - 5), GREEN, 2)
    text(c, digits, x, y + 19, 21, GREEN)
  }
  for (let i = 0; i < count; i++) {
    const x = (i + .5) * 512 / count, n1 = d.n1Pct[i] ?? 0, egt = d.egtC[i] ?? 0
    dial(x, 135, n1, d.n1RedlinePct, n1.toFixed(1), d.n1CommandPct)
    dial(x, 285, egt, 1000, String(Math.round(egt)))
    text(c, String(Math.round(d.ffKgH[i] ?? 0)), x, 359, 19, GREEN)
  }
  if (d.reverse) text(c, 'REV', 256, 399, 22, AMBER)
  line(c, 18, 423, 494, 423)
  text(c, 'FOB KG', 147, 462, 19, CYAN)
  text(c, String(Math.round(d.fuelKg[0] + d.fuelKg[1])), 328, 462, 23, GREEN)
  c.restore()
}

export function drawAirbusSystems(c: Ctx, size: number, d: {
  fuelKg: readonly [number, number]; gearPosition: number; flapDegrees: number; speedbrake: number; tatC: number
}): void {
  begin(c, size)
  text(c, 'FUEL', 256, 48, 24); line(c, 225, 67, 287, 67)
  for (const [i, x] of [140, 372].entries()) {
    c.strokeStyle = WHITE; c.lineWidth = 2; c.strokeRect(x - 90, 97, 180, 104)
    text(c, i === 0 ? 'LEFT' : 'RIGHT', x, 120, 19)
    text(c, String(Math.round(d.fuelKg[i]!)), x, 168, 27, GREEN)
  }
  text(c, 'KG', 256, 221, 17, CYAN)
  line(c, 18, 251, 494, 251)
  text(c, 'GEAR', 142, 293, 18); text(c, 'FLAPS', 142, 341, 18); text(c, 'SPEED BRK', 142, 389, 18)
  text(c, d.gearPosition > .99 ? 'DOWN' : d.gearPosition < .01 ? 'UP' : 'TRANSIT', 364, 293, 22, d.gearPosition > .99 || d.gearPosition < .01 ? GREEN : AMBER)
  text(c, `${Math.round(d.flapDegrees)}°`, 364, 341, 22, GREEN)
  text(c, `${Math.round(clamp(d.speedbrake, 0, 1) * 100)}%`, 364, 389, 22, GREEN)
  line(c, 18, 424, 494, 424); text(c, `TAT ${Math.round(d.tatC)} °C`, 117, 462, 18)
  c.restore()
}
