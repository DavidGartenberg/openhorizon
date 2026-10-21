/**
 * Boeing 737NG Common Display System formats, drawn on square canvases:
 * PFD (FMA, attitude, speed/altitude tapes, VSI, heading arc, ILS), ND in
 * expanded MAP mode, the upper-center engine display, and the ISFD.
 * Colour conventions follow Boeing: white = current/scale, magenta =
 * selected/command, green = engaged/active modes, cyan = armed / non-active
 * route, amber = caution, red = limit. Every value shown comes from the sim
 * (inputs below); anything not modeled is omitted, never invented.
 */

export interface BoeingPfdInput {
  iasKt: number
  /** Speed trend, kt per 10 s (Boeing trend vector convention). */
  trendKt10s: number
  mach: number
  selSpeedKt: number
  vmoKt: number
  /** Stall-warning speed for the current flap setting (bottom of the
   *  red/black barber pole), kt. */
  stallKt: number
  pitchDeg: number
  rollDeg: number
  slipDeg: number
  fd?: { pitchDeg: number; bankDeg: number }
  altFt: number
  selAltFt: number
  baroInHg: number
  vsFpm: number
  hdgDeg: number
  selHdgDeg: number
  trackDeg: number
  /** Radio altitude, ft — null on airplanes without a radio altimeter
   *  (an instrument that is not fitted is never drawn). */
  radioAltFt: number | null
  onGround: boolean
  /** Colour arcs along the speed tape (flap-operating / normal / caution),
   *  for types that publish them (every GA type; the jets use the
   *  barber poles only). */
  vArcs?: { whiteLow: number; whiteHigh: number; greenLow: number; greenHigh: number; yellowLow: number; yellowHigh: number }
  /** ILS raw data in dots (±2.5 = full scale), absent when not tuned/received. */
  loc?: number
  gs?: number
  fma: { at: string; roll: string; rollArmed: string; pitch: string; pitchArmed: string; ap: string; /** Autoland status line (LAND ARM / LAND), '' when none. */ land?: string }
}

const C = {
  sky: '#1677c9',
  ground: '#8a5a2b',
  tape: '#3b4148',
  white: '#ffffff',
  magenta: '#ff4fe0',
  green: '#3fe06a',
  cyan: '#22d8f0',
  amber: '#ffb020',
  red: '#ff2b2b',
  black: '#000000',
}

type Ctx = CanvasRenderingContext2D

function txt(c: Ctx, s: string, x: number, y: number, size: number, color = C.white, align: CanvasTextAlign = 'center', bold = true): void {
  c.fillStyle = color
  c.font = `${bold ? '600 ' : ''}${size}px "Helvetica Neue", Arial, sans-serif`
  c.textAlign = align
  c.textBaseline = 'middle'
  c.fillText(s, x, y)
}

/** Boeing VSI: non-linear scale, ±1000 fpm takes half the throw, ±6000 the
 *  rest. Returns the fraction of half-height (−1..1). Pure — tested. */
export function vsiFraction(vsFpm: number): number {
  const v = Math.max(-6000, Math.min(6000, vsFpm))
  const a = Math.abs(v)
  const f = a <= 1000 ? (a / 1000) * 0.5 : a <= 2000 ? 0.5 + ((a - 1000) / 1000) * 0.25 : 0.75 + ((a - 2000) / 4000) * 0.25
  return Math.sign(v) * f
}

/** Map autopilot/autothrottle state to 737NG FMA annunciations. Pure. */
export function boeingFma(s: { master: boolean; fdOn: boolean; lateral: string; lateralArmed: boolean; vertical: string; verticalArmed: boolean; speedMode: boolean; atMode?: string; onGround: boolean; autoland?: string }): BoeingPfdInput['fma'] {
  const rollMap: Record<string, string> = { HDG: 'HDG SEL', NAV: 'VOR/LOC', GPS: 'LNAV', LNAV: 'LNAV', APR: 'VOR/LOC', ROL: '' }
  const pitchMap: Record<string, string> = { ALT: 'ALT HOLD', ALTS: 'ALT ACQ', VS: 'V/S', GS: 'G/S', IAS: 'MCP SPD', FLC: 'MCP SPD', PIT: '' }
  const engaged = s.master || s.fdOn
  const roll = engaged && !s.lateralArmed ? rollMap[s.lateral] ?? s.lateral : ''
  const rollArmed = engaged && s.lateralArmed ? rollMap[s.lateral] ?? s.lateral : s.lateral === 'APR' && s.lateralArmed ? 'VOR/LOC' : ''
  const pitch = engaged && !s.verticalArmed ? pitchMap[s.vertical] ?? s.vertical : ''
  const pitchArmed = engaged && s.verticalArmed ? (s.vertical === 'GS' ? 'G/S' : pitchMap[s.vertical] ?? '') : ''
  // Autoland: ROLLOUT in the roll box once on the runway. The flare itself is
  // not annunciated on screen (the pitch box just keeps showing G/S).
  const phase = s.master ? s.autoland : undefined
  return {
    at: phase === 'FLARE' || phase === 'ROLLOUT' ? 'RETARD' : s.atMode && s.atMode !== 'OFF' ? s.atMode : s.speedMode ? 'MCP SPD' : '',
    roll: phase === 'ROLLOUT' ? 'ROLLOUT' : roll, rollArmed, pitch: phase === 'FLARE' ? 'G/S' : phase === 'ROLLOUT' ? '' : pitch, pitchArmed,
    ap: s.master ? 'CMD' : s.fdOn ? 'FD' : '',
    land: phase === 'ARMED' ? 'LAND ARM' : phase === 'LAND' || phase === 'FLARE' || phase === 'ROLLOUT' ? 'LAND' : '',
  }
}

export function drawBoeingPfd(c: Ctx, S: number, d: BoeingPfdInput): void {
  c.fillStyle = C.black
  c.fillRect(0, 0, S, S)
  const k = S / 768
  const cx = 384 * k, cy = 372 * k
  // ---------- FMA ----------
  const fmaY = 30 * k
  c.strokeStyle = C.white; c.lineWidth = 1.5 * k
  for (const x of [190, 340, 490]) { c.beginPath(); c.moveTo(x * k, 10 * k); c.lineTo(x * k, 66 * k); c.stroke() }
  const box = (s: string, x: number, armed = false): void => {
    if (!s) return
    txt(c, s, x * k, armed ? fmaY + 26 * k : fmaY, 22 * k, armed ? C.white : C.green)
    if (!armed) { c.strokeStyle = C.green; c.lineWidth = 2 * k; c.strokeRect(x * k - 66 * k, fmaY - 15 * k, 132 * k, 30 * k) }
  }
  box(d.fma.at === 'ARM' ? '' : d.fma.at, 120); if (d.fma.at === 'ARM') box('ARM', 120, true)
  box(d.fma.roll, 265); box(d.fma.rollArmed, 265, true)
  box(d.fma.pitch, 415); box(d.fma.pitchArmed, 415, true)
  if (d.fma.ap) txt(c, d.fma.ap, cx, 104 * k, 30 * k, C.green)
  if (d.fma.land) txt(c, d.fma.land, cx, 132 * k, 24 * k, d.fma.land === 'LAND ARM' ? C.white : C.green)

  // ---------- Attitude ----------
  const aw = 300 * k, ah = 330 * k
  const pxPerDeg = 8 * k
  c.save()
  c.beginPath(); c.roundRect(cx - aw / 2, cy - ah / 2, aw, ah, 26 * k); c.clip()
  c.translate(cx, cy)
  c.rotate((-d.rollDeg * Math.PI) / 180)
  const off = d.pitchDeg * pxPerDeg
  c.fillStyle = C.sky; c.fillRect(-S, -S + off, S * 2, S)
  c.fillStyle = C.ground; c.fillRect(-S, off, S * 2, S)
  c.strokeStyle = C.white; c.lineWidth = 2 * k
  c.beginPath(); c.moveTo(-S, off); c.lineTo(S, off); c.stroke()
  for (let p = -30; p <= 30; p += 2.5) {
    if (p === 0) continue
    const y = off - p * pxPerDeg
    if (Math.abs(y) > ah * 0.42) continue
    const major = p % 10 === 0, mid = p % 5 === 0
    const w = (major ? 70 : mid ? 38 : 18) * k
    c.beginPath(); c.moveTo(-w, y); c.lineTo(w, y); c.stroke()
    if (major) { txt(c, String(Math.abs(p)), -w - 22 * k, y, 18 * k); txt(c, String(Math.abs(p)), w + 22 * k, y, 18 * k) }
  }
  c.restore()
  // Bank scale (fixed) + roll pointer and slip indicator (rotate with roll).
  const br = 150 * k
  c.strokeStyle = C.white; c.lineWidth = 2.5 * k
  for (const a of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) {
    const r = ((a - 90) * Math.PI) / 180, len = (Math.abs(a) % 30 === 0 ? 18 : 10) * k
    c.beginPath(); c.moveTo(cx + Math.cos(r) * br, cy + Math.sin(r) * br); c.lineTo(cx + Math.cos(r) * (br + len), cy + Math.sin(r) * (br + len)); c.stroke()
  }
  c.fillStyle = C.white
  c.beginPath(); c.moveTo(cx, cy - br); c.lineTo(cx - 9 * k, cy - br - 16 * k); c.lineTo(cx + 9 * k, cy - br - 16 * k); c.closePath(); c.fill()
  c.save()
  c.translate(cx, cy); c.rotate((-d.rollDeg * Math.PI) / 180)
  const bankWarn = Math.abs(d.rollDeg) > 35
  c.fillStyle = bankWarn ? C.amber : C.white
  c.beginPath(); c.moveTo(0, -br + 2 * k); c.lineTo(-10 * k, -br + 18 * k); c.lineTo(10 * k, -br + 18 * k); c.closePath(); c.fill()
  const slip = Math.max(-1, Math.min(1, d.slipDeg / 8)) * 22 * k
  c.fillRect(-13 * k + slip, -br + 21 * k, 26 * k, 6 * k)
  c.restore()
  // Flight director bars.
  if (d.fd && d.fma.ap) {
    c.strokeStyle = C.magenta; c.lineWidth = 4 * k
    const fdy = cy - (d.fd.pitchDeg - d.pitchDeg) * pxPerDeg
    const fdx = cx + Math.max(-1, Math.min(1, (d.fd.bankDeg - d.rollDeg) / 25)) * 90 * k
    c.beginPath(); c.moveTo(cx - 90 * k, fdy); c.lineTo(cx + 90 * k, fdy); c.stroke()
    c.beginPath(); c.moveTo(fdx, cy - 90 * k); c.lineTo(fdx, cy + 90 * k); c.stroke()
  }
  // Airplane symbol: Boeing L-shaped wing bars + center square.
  c.fillStyle = C.black; c.strokeStyle = C.white; c.lineWidth = 2.5 * k
  for (const s of [-1, 1]) {
    c.beginPath()
    c.moveTo(cx + s * 120 * k, cy - 5 * k); c.lineTo(cx + s * 50 * k, cy - 5 * k); c.lineTo(cx + s * 50 * k, cy + 22 * k)
    c.lineTo(cx + s * 40 * k, cy + 22 * k); c.lineTo(cx + s * 40 * k, cy + 5 * k); c.lineTo(cx + s * 120 * k, cy + 5 * k); c.closePath()
    c.fill(); c.stroke()
  }
  c.fillRect(cx - 6 * k, cy - 6 * k, 12 * k, 12 * k); c.strokeRect(cx - 6 * k, cy - 6 * k, 12 * k, 12 * k)
  // ILS deviation scales.
  const dots = (x: number, y: number, vertical: boolean, dev: number | undefined): void => {
    c.strokeStyle = C.white; c.lineWidth = 2 * k
    for (const i of [-2, -1, 1, 2]) {
      c.beginPath(); c.arc(x + (vertical ? 0 : i * 40 * k), y + (vertical ? i * 40 * k : 0), 6 * k, 0, Math.PI * 2); c.stroke()
    }
    c.beginPath()
    if (vertical) { c.moveTo(x - 12 * k, y); c.lineTo(x + 12 * k, y) } else { c.moveTo(x, y - 12 * k); c.lineTo(x, y + 12 * k) }
    c.stroke()
    if (dev === undefined) return
    const p = Math.max(-2.5, Math.min(2.5, dev)) * 40 * k
    const px = vertical ? x : x + p, py = vertical ? y + p : y
    c.fillStyle = C.magenta
    c.beginPath(); c.moveTo(px, py - 12 * k); c.lineTo(px + 10 * k, py); c.lineTo(px, py + 12 * k); c.lineTo(px - 10 * k, py); c.closePath(); c.fill()
  }
  if (d.loc !== undefined || d.gs !== undefined) {
    dots(cx, cy + ah / 2 + 22 * k, false, d.loc)
    dots(cx + aw / 2 + 22 * k, cy, true, d.gs)
  }
  // Radio altitude (below 2500 ft).
  if (!d.onGround && d.radioAltFt !== null && d.radioAltFt < 2500) {
    const ra = d.radioAltFt < 100 ? Math.round(d.radioAltFt) : Math.round(d.radioAltFt / 10) * 10
    txt(c, String(ra), cx, cy + ah / 2 - 30 * k, 28 * k, d.radioAltFt < 500 ? C.amber : C.white)
  }

  // ---------- Speed tape ----------
  const tx = 50 * k, tw = 92 * k, ty = cy - 220 * k, th = 440 * k
  const pxPerKt = 4.2 * k
  c.save()
  c.beginPath(); c.rect(tx, ty, tw, th); c.clip()
  c.fillStyle = C.tape; c.fillRect(tx, ty, tw, th)
  const ky = (kt: number): number => cy - (kt - d.iasKt) * pxPerKt
  for (let kt = Math.max(30, Math.floor((d.iasKt - 60) / 10) * 10); kt <= d.iasKt + 60; kt += 10) {
    const y = ky(kt)
    c.strokeStyle = C.white; c.lineWidth = 2 * k
    c.beginPath(); c.moveTo(tx + tw - 16 * k, y); c.lineTo(tx + tw, y); c.stroke()
    if (kt % 20 === 0) txt(c, String(kt), tx + tw - 22 * k, y, 22 * k, C.white, 'right')
  }
  // Red/black barber poles: Vmo (top) and stall warning (bottom).
  const pole = (from: number, to: number): void => {
    const y0 = ky(to), y1 = ky(from)
    for (let y = Math.min(y0, y1); y < Math.max(y0, y1); y += 12 * k) {
      c.fillStyle = Math.round((y - ty) / (12 * k)) % 2 ? C.red : C.black
      c.fillRect(tx + tw - 10 * k, y, 10 * k, 12 * k)
    }
  }
  pole(d.vmoKt, d.vmoKt + 200)
  if (d.vArcs) {
    const band = (lo: number, hi: number, col: string): void => {
      const y0 = Math.max(ty, ky(hi)), y1 = Math.min(ty + th, ky(lo))
      if (y1 > y0) { c.fillStyle = col; c.fillRect(tx + tw - 20.5 * k, y0, 6 * k, y1 - y0) }
    }
    band(d.vArcs.whiteLow, d.vArcs.whiteHigh, C.white)
    band(d.vArcs.greenLow, d.vArcs.greenHigh, C.green)
    band(d.vArcs.yellowLow, d.vArcs.yellowHigh, C.amber)
  }
  pole(0, d.stallKt)
  // Amber minimum maneuver band: from stall warning up to 1.3 × stall.
  c.strokeStyle = C.amber; c.lineWidth = 3 * k
  c.beginPath(); c.moveTo(tx + tw - 13 * k, ky(d.stallKt)); c.lineTo(tx + tw - 13 * k, ky(d.stallKt * 1.3)); c.stroke()
  // Selected speed bug.
  const sy = ky(d.selSpeedKt)
  c.strokeStyle = C.magenta; c.lineWidth = 2.5 * k
  c.beginPath(); c.moveTo(tx + tw, sy - 10 * k); c.lineTo(tx + tw - 12 * k, sy - 10 * k); c.lineTo(tx + tw - 12 * k, sy + 10 * k); c.lineTo(tx + tw, sy + 10 * k); c.stroke()
  // Trend vector (green), 10-second prediction.
  if (Math.abs(d.trendKt10s) > 2) {
    c.strokeStyle = C.green; c.lineWidth = 3 * k
    const ey = ky(d.iasKt + d.trendKt10s)
    c.beginPath(); c.moveTo(tx + tw - 4 * k, cy); c.lineTo(tx + tw - 4 * k, ey); c.stroke()
    const s = Math.sign(-d.trendKt10s)
    c.beginPath(); c.moveTo(tx + tw - 12 * k, ey + s * 8 * k); c.lineTo(tx + tw - 4 * k, ey); c.lineTo(tx + tw + 4 * k, ey + s * 8 * k); c.stroke()
  }
  c.restore()
  // Current speed readout box.
  c.fillStyle = C.black; c.strokeStyle = C.white; c.lineWidth = 2.5 * k
  c.beginPath()
  c.moveTo(tx - 4 * k, cy - 22 * k); c.lineTo(tx + tw - 14 * k, cy - 22 * k); c.lineTo(tx + tw - 2 * k, cy); c.lineTo(tx + tw - 14 * k, cy + 22 * k); c.lineTo(tx - 4 * k, cy + 22 * k); c.closePath()
  c.fill(); c.stroke()
  txt(c, String(Math.max(30, Math.round(d.iasKt))), tx + tw / 2 - 8 * k, cy, 30 * k)
  txt(c, String(Math.round(d.selSpeedKt)), tx + tw / 2, ty - 18 * k, 24 * k, C.magenta)
  if (d.mach >= 0.4) txt(c, d.mach.toFixed(3).replace(/^0/, ''), tx + tw / 2, ty + th + 22 * k, 24 * k)

  // ---------- Altitude tape ----------
  const ax = 588 * k, aw2 = 100 * k
  const pxPerFt = 0.42 * k
  c.save()
  c.beginPath(); c.rect(ax, ty, aw2, th); c.clip()
  c.fillStyle = C.tape; c.fillRect(ax, ty, aw2, th)
  const fy = (ft: number): number => cy - (ft - d.altFt) * pxPerFt
  for (let ft = Math.floor((d.altFt - 600) / 100) * 100; ft <= d.altFt + 600; ft += 100) {
    const y = fy(ft)
    c.strokeStyle = C.white; c.lineWidth = 2 * k
    c.beginPath(); c.moveTo(ax, y); c.lineTo(ax + 14 * k, y); c.stroke()
    if (ft % 200 === 0) txt(c, String(ft), ax + aw2 - 6 * k, y, 19 * k, C.white, 'right')
    if (ft % 500 === 0) { c.beginPath(); c.moveTo(ax, y - 3 * k); c.lineTo(ax + aw2, y - 3 * k); c.moveTo(ax, y + 3 * k); c.lineTo(ax + aw2, y + 3 * k); c.lineWidth = 1 * k; c.stroke() }
  }
  const ay = fy(d.selAltFt)
  c.strokeStyle = C.magenta; c.lineWidth = 2.5 * k
  c.beginPath(); c.moveTo(ax, ay - 14 * k); c.lineTo(ax + 16 * k, ay - 14 * k); c.lineTo(ax + 16 * k, ay + 14 * k); c.lineTo(ax, ay + 14 * k); c.stroke()
  c.restore()
  c.fillStyle = C.black; c.strokeStyle = C.white; c.lineWidth = 2.5 * k
  c.beginPath()
  c.moveTo(ax + 4 * k, cy); c.lineTo(ax + 16 * k, cy - 24 * k); c.lineTo(ax + aw2 + 8 * k, cy - 24 * k); c.lineTo(ax + aw2 + 8 * k, cy + 24 * k); c.lineTo(ax + 16 * k, cy + 24 * k); c.closePath()
  c.fill(); c.stroke()
  const altR = Math.round(d.altFt / 20) * 20
  const thousands = Math.trunc(altR / 1000), hundreds = Math.abs(altR % 1000)
  txt(c, thousands ? String(thousands) : '', ax + 54 * k, cy, 30 * k, C.white, 'right')
  txt(c, String(hundreds).padStart(thousands ? 3 : 1, '0'), ax + 56 * k, cy + 2 * k, 23 * k, C.white, 'left')
  txt(c, String(Math.round(d.selAltFt)), ax + aw2 / 2, ty - 18 * k, 24 * k, C.magenta)
  const std = Math.abs(d.baroInHg - 29.92) < 0.005
  txt(c, std ? 'STD' : `${d.baroInHg.toFixed(2)} IN`, ax + aw2 / 2, ty + th + 22 * k, 22 * k, C.green)

  // ---------- VSI ----------
  const vx = 702 * k, vh = 190 * k
  c.fillStyle = C.tape
  c.beginPath(); c.moveTo(vx, cy - vh); c.lineTo(vx + 40 * k, cy - vh + 30 * k); c.lineTo(vx + 40 * k, cy + vh - 30 * k); c.lineTo(vx, cy + vh); c.closePath(); c.fill()
  c.strokeStyle = C.white; c.lineWidth = 2 * k
  for (const fpm of [-6000, -2000, -1000, -500, 0, 500, 1000, 2000, 6000]) {
    const y = cy - vsiFraction(fpm) * vh
    c.beginPath(); c.moveTo(vx, y); c.lineTo(vx + (fpm % 1000 === 0 ? 14 : 8) * k, y); c.stroke()
    if (fpm && Math.abs(fpm) !== 500) txt(c, String(Math.abs(fpm) / 1000), vx + 26 * k, y, 15 * k)
  }
  c.lineWidth = 3.5 * k
  c.beginPath(); c.moveTo(vx + 80 * k, cy); c.lineTo(vx + 2 * k, cy - vsiFraction(d.vsFpm) * vh); c.stroke()
  if (Math.abs(d.vsFpm) >= 400) txt(c, String(Math.round(Math.abs(d.vsFpm) / 50) * 50), vx + 22 * k, d.vsFpm > 0 ? cy - vh - 16 * k : cy + vh + 16 * k, 18 * k)

  // ---------- Heading arc ----------
  const hy = S + 140 * k, hr = 250 * k
  c.save()
  c.beginPath(); c.rect(0, 610 * k, S, S); c.clip()
  c.fillStyle = C.tape
  c.beginPath(); c.arc(cx, hy, hr, 0, Math.PI * 2); c.fill()
  c.strokeStyle = C.white; c.lineWidth = 2 * k
  for (let h = Math.floor(d.hdgDeg / 5) * 5 - 40; h <= d.hdgDeg + 40; h += 5) {
    const a = ((h - d.hdgDeg - 90) * Math.PI) / 180
    const len = (h % 10 === 0 ? 16 : 9) * k
    c.beginPath(); c.moveTo(cx + Math.cos(a) * hr, hy + Math.sin(a) * hr); c.lineTo(cx + Math.cos(a) * (hr - len), hy + Math.sin(a) * (hr - len)); c.stroke()
    if (h % 30 === 0) {
      const n = (((h % 360) + 360) % 360) / 10
      txt(c, String(n), cx + Math.cos(a) * (hr - 34 * k), hy + Math.sin(a) * (hr - 34 * k), 20 * k)
    }
  }
  const sa = ((d.selHdgDeg - d.hdgDeg - 90) * Math.PI) / 180
  c.strokeStyle = C.magenta; c.lineWidth = 3 * k
  c.beginPath(); c.arc(cx + Math.cos(sa) * hr, hy + Math.sin(sa) * hr, 9 * k, 0, Math.PI * 2); c.stroke()
  const ta = ((d.trackDeg - d.hdgDeg - 90) * Math.PI) / 180
  c.strokeStyle = C.white; c.lineWidth = 2 * k
  c.beginPath(); c.moveTo(cx + Math.cos(ta) * (hr - 60 * k), hy + Math.sin(ta) * (hr - 60 * k)); c.lineTo(cx + Math.cos(ta) * hr, hy + Math.sin(ta) * hr); c.stroke()
  c.restore()
  c.fillStyle = C.black; c.strokeStyle = C.white; c.lineWidth = 2 * k
  c.fillRect(cx - 34 * k, 618 * k, 68 * k, 32 * k); c.strokeRect(cx - 34 * k, 618 * k, 68 * k, 32 * k)
  txt(c, String(Math.round(((d.hdgDeg % 360) + 360) % 360) || 360).padStart(3, '0'), cx, 635 * k, 24 * k)
  txt(c, 'MAG', cx + 62 * k, 635 * k, 17 * k, C.green)
  txt(c, `${String(Math.round(d.selHdgDeg) % 360).padStart(3, '0')} H`, cx - 230 * k, 680 * k, 22 * k, C.magenta)
}

// ---------------------------------------------------------------------------
// Navigation display — expanded MAP mode
// ---------------------------------------------------------------------------

export interface BoeingNdInput {
  hdgDeg: number
  trackDeg: number
  selHdgDeg: number
  gsKt: number
  tasKt: number
  windDirDeg: number
  windKt: number
  rangeNm: number
  /** Points relative to the aircraft, nm north/east. */
  airports: ReadonlyArray<{ id: string; nN: number; nE: number }>
  route: ReadonlyArray<{ id: string; nN: number; nE: number; active: boolean }>
  activeWpt?: { id: string; distNm: number; etaZ: string }
  traffic: ReadonlyArray<{ nN: number; nE: number; relAltFt: number; alerted: boolean }>
  wx: ReadonlyArray<{ nN: number; nE: number; intensity: 1 | 2 | 3 }>
  /** Airspace outlines, pre-projected to nm offsets with the stroke style
   *  (GA map: Class B/C/D and special-use areas). */
  airspace?: ReadonlyArray<{ ring: ReadonlyArray<{ nN: number; nE: number }>; color: string; dash: readonly number[]; label?: string }>
  /** Best-glide range ring radius, nm (GA engine-out reference). */
  glideRingNm?: number
}

export function drawBoeingNd(c: Ctx, S: number, d: BoeingNdInput): void {
  const k = S / 768
  c.fillStyle = C.black
  c.fillRect(0, 0, S, S)
  const ox = 384 * k, oy = 650 * k, R = 560 * k
  const pxPerNm = R / d.rangeNm
  const toXY = (nN: number, nE: number): [number, number] => {
    const a = (-d.hdgDeg * Math.PI) / 180
    const x = nE * Math.cos(a) - nN * Math.sin(a)
    const y = nE * Math.sin(a) + nN * Math.cos(a)
    return [ox + x * pxPerNm, oy - y * pxPerNm]
  }
  c.save()
  c.beginPath(); c.rect(0, 70 * k, S, oy + 10 * k - 70 * k); c.clip()
  // Weather radar returns (green / amber / red).
  for (const w of d.wx) {
    const [x, y] = toXY(w.nN, w.nE)
    c.fillStyle = w.intensity === 3 ? 'rgba(255,40,40,0.75)' : w.intensity === 2 ? 'rgba(255,190,30,0.7)' : 'rgba(40,200,60,0.65)'
    c.fillRect(x - 4 * k, y - 4 * k, 8 * k, 8 * k)
  }
  // Half-range ring (dashed).
  c.strokeStyle = C.white; c.lineWidth = 1.5 * k
  c.setLineDash([10 * k, 10 * k])
  c.beginPath(); c.arc(ox, oy, R / 2, Math.PI * 1.22, Math.PI * 1.78); c.stroke()
  c.setLineDash([])
  txt(c, String(d.rangeNm / 2), ox - (R / 2) * 0.82, oy - (R / 2) * 0.62, 18 * k)
  // Airspace outlines and the engine-out glide ring (GA).
  for (const a of d.airspace ?? []) {
    if (a.ring.length < 3) continue
    c.strokeStyle = a.color; c.lineWidth = 2 * k
    c.setLineDash(a.dash.map((n) => n * k))
    c.beginPath()
    a.ring.forEach((p, i) => { const [x, y] = toXY(p.nN, p.nE); if (i) c.lineTo(x, y); else c.moveTo(x, y) })
    c.closePath(); c.stroke()
    c.setLineDash([])
    if (a.label) { const [x, y] = toXY(a.ring[0]!.nN, a.ring[0]!.nE); txt(c, a.label, x + 4 * k, y - 8 * k, 14 * k, a.color, 'left') }
  }
  if (d.glideRingNm !== undefined && d.glideRingNm > 0) {
    c.strokeStyle = C.cyan; c.lineWidth = 2 * k
    c.setLineDash([4 * k, 8 * k])
    c.beginPath(); c.arc(ox, oy, d.glideRingNm * pxPerNm, 0, Math.PI * 2); c.stroke()
    c.setLineDash([])
  }
  // Airports (cyan circles), route (magenta active leg, white others).
  for (const a of d.airports) {
    const [x, y] = toXY(a.nN, a.nE)
    c.strokeStyle = C.cyan; c.lineWidth = 2 * k
    c.beginPath(); c.arc(x, y, 8 * k, 0, Math.PI * 2); c.stroke()
    txt(c, a.id, x + 12 * k, y + 14 * k, 16 * k, C.cyan, 'left')
  }
  for (let i = 0; i < d.route.length; i++) {
    const p = d.route[i]!
    const [x, y] = toXY(p.nN, p.nE)
    if (i > 0) {
      const q = d.route[i - 1]!
      const [qx, qy] = toXY(q.nN, q.nE)
      c.strokeStyle = p.active ? C.magenta : C.white; c.lineWidth = 3 * k
      c.beginPath(); c.moveTo(qx, qy); c.lineTo(x, y); c.stroke()
    }
    c.strokeStyle = p.active ? C.magenta : C.white; c.lineWidth = 2 * k
    c.beginPath()
    for (let j = 0; j < 8; j++) { const r = j % 2 ? 4 * k : 11 * k, a = (j * Math.PI) / 4; j ? c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : c.moveTo(x + r, y) }
    c.closePath(); c.stroke()
    txt(c, p.id, x + 14 * k, y - 12 * k, 17 * k, p.active ? C.magenta : C.white, 'left')
  }
  // Traffic (TCAS symbology).
  for (const t of d.traffic) {
    const [x, y] = toXY(t.nN, t.nE)
    const col = t.alerted ? C.amber : C.white
    c.fillStyle = col; c.strokeStyle = col; c.lineWidth = 2 * k
    if (t.alerted) { c.beginPath(); c.arc(x, y, 8 * k, 0, Math.PI * 2); c.fill() }
    else { c.beginPath(); c.moveTo(x, y - 9 * k); c.lineTo(x + 9 * k, y); c.lineTo(x, y + 9 * k); c.lineTo(x - 9 * k, y); c.closePath(); c.stroke() }
    const rel = Math.round(t.relAltFt / 100)
    txt(c, `${rel >= 0 ? '+' : '-'}${String(Math.abs(rel)).padStart(2, '0')}`, x, y + (rel >= 0 ? -18 : 18) * k, 15 * k, col)
  }
  // Selected heading line (dashed magenta) and track line.
  const line = (deg: number, col: string, dash: boolean): void => {
    const a = ((deg - d.hdgDeg - 90) * Math.PI) / 180
    c.strokeStyle = col; c.lineWidth = 2 * k
    c.setLineDash(dash ? [12 * k, 10 * k] : [])
    c.beginPath(); c.moveTo(ox, oy); c.lineTo(ox + Math.cos(a) * R, oy + Math.sin(a) * R); c.stroke()
    c.setLineDash([])
  }
  line(d.selHdgDeg, C.magenta, true)
  line(d.trackDeg, C.white, false)
  c.restore()
  // Compass arc.
  c.strokeStyle = C.white; c.lineWidth = 2.5 * k
  c.beginPath(); c.arc(ox, oy, R, Math.PI * 1.22, Math.PI * 1.78); c.stroke()
  for (let h = Math.floor(d.hdgDeg / 5) * 5 - 50; h <= d.hdgDeg + 50; h += 5) {
    const a = ((h - d.hdgDeg - 90) * Math.PI) / 180
    const rel = h - d.hdgDeg
    if (Math.abs(rel) > 50) continue
    const len = (h % 10 === 0 ? 20 : 10) * k
    c.beginPath(); c.moveTo(ox + Math.cos(a) * R, oy + Math.sin(a) * R); c.lineTo(ox + Math.cos(a) * (R - len), oy + Math.sin(a) * (R - len)); c.stroke()
    if (h % 30 === 0) txt(c, String((((h % 360) + 360) % 360) / 10), ox + Math.cos(a) * (R - 40 * k), oy + Math.sin(a) * (R - 40 * k), 20 * k)
  }
  const sa = ((d.selHdgDeg - d.hdgDeg - 90) * Math.PI) / 180
  if (Math.abs((((d.selHdgDeg - d.hdgDeg) % 360) + 540) % 360 - 180) <= 50) {
    c.strokeStyle = C.magenta; c.lineWidth = 3 * k
    c.beginPath(); c.rect(ox + Math.cos(sa) * R - 9 * k, oy + Math.sin(sa) * R - 6 * k, 18 * k, 12 * k); c.stroke()
  }
  // Heading box + pointer.
  c.fillStyle = C.black; c.strokeStyle = C.white; c.lineWidth = 2 * k
  c.fillRect(ox - 40 * k, 52 * k, 80 * k, 34 * k); c.strokeRect(ox - 40 * k, 52 * k, 80 * k, 34 * k)
  txt(c, String(Math.round(((d.hdgDeg % 360) + 360) % 360) || 360).padStart(3, '0'), ox, 70 * k, 26 * k)
  txt(c, 'HDG', ox - 80 * k, 70 * k, 18 * k, C.green); txt(c, 'MAG', ox + 78 * k, 70 * k, 18 * k, C.green)
  c.fillStyle = C.white
  c.beginPath(); c.moveTo(ox, oy - R + 2 * k); c.lineTo(ox - 9 * k, oy - R - 14 * k); c.lineTo(ox + 9 * k, oy - R - 14 * k); c.closePath(); c.fill()
  // Own-ship triangle.
  c.strokeStyle = C.white; c.lineWidth = 3 * k
  c.beginPath(); c.moveTo(ox, oy - 26 * k); c.lineTo(ox - 14 * k, oy + 12 * k); c.lineTo(ox + 14 * k, oy + 12 * k); c.closePath(); c.stroke()
  // Data blocks.
  txt(c, 'GS', 20 * k, 30 * k, 18 * k, C.white, 'left', false)
  txt(c, String(Math.round(d.gsKt)), 52 * k, 30 * k, 26 * k, C.white, 'left')
  txt(c, 'TAS', 120 * k, 30 * k, 18 * k, C.white, 'left', false)
  txt(c, String(Math.round(d.tasKt)), 160 * k, 30 * k, 26 * k, C.white, 'left')
  if (d.windKt >= 1) {
    txt(c, `${String(Math.round(d.windDirDeg) % 360).padStart(3, '0')}°/${Math.round(d.windKt)}`, 20 * k, 62 * k, 22 * k, C.white, 'left')
    const wa = ((d.windDirDeg + 180 - d.hdgDeg - 90) * Math.PI) / 180
    const wx = 40 * k, wy = 110 * k
    c.strokeStyle = C.white; c.lineWidth = 3 * k
    c.beginPath(); c.moveTo(wx - Math.cos(wa) * 18 * k, wy - Math.sin(wa) * 18 * k); c.lineTo(wx + Math.cos(wa) * 18 * k, wy + Math.sin(wa) * 18 * k); c.stroke()
    c.beginPath(); c.arc(wx + Math.cos(wa) * 18 * k, wy + Math.sin(wa) * 18 * k, 4 * k, 0, Math.PI * 2); c.fill()
  }
  if (d.activeWpt) {
    txt(c, d.activeWpt.id, S - 20 * k, 26 * k, 24 * k, C.magenta, 'right')
    txt(c, `${d.activeWpt.etaZ}z`, S - 20 * k, 54 * k, 22 * k, C.white, 'right')
    txt(c, `${d.activeWpt.distNm.toFixed(1)} NM`, S - 20 * k, 82 * k, 22 * k, C.white, 'right')
  }
  txt(c, String(d.rangeNm), ox - R * 0.84, oy - R * 0.6, 18 * k)
  txt(c, 'MAP', S - 26 * k, S - 24 * k, 18 * k, C.green, 'right')
}

// ---------------------------------------------------------------------------
// Upper-center engine display
// ---------------------------------------------------------------------------

/** EGT model for the display (°C): a documented proxy from N1 and OAT —
 *  CFM56-class idle ≈ 450 °C, takeoff ≈ 880 °C — the sim has no EGT state
 *  of its own (recorded in PROGRESS.md as a modeled readout). */
export function egtFromN1(n1Pct: number, oatC: number): number {
  if (n1Pct < 5) return Math.max(oatC, 0)
  const f = Math.max(0, Math.min(1.1, n1Pct / 100))
  return Math.round(330 + 540 * f ** 2.1 + 0.55 * (oatC - 15))
}

export interface BoeingEicasInput {
  /** One entry per engine (2, 3 or 4). */
  n1Pct: readonly number[]
  n1RedlinePct: number
  n1CommandPct: number
  egtC: readonly number[]
  ffKgH: readonly number[]
  /** Tank quantities, kg (the sim models a left and a right tank). */
  fuelKg: readonly [number, number]
  tatC: number
  reverse: boolean
  /** Turboprop engine display: the two dial rows show torque and prop
   *  speed (NP) instead of N1 and EGT — values come in the same slots. */
  labels?: { primary: string; secondary: string; secondaryMax: number; secondaryRed: number }
}

export function drawBoeingEicas(c: Ctx, S: number, d: BoeingEicasInput): void {
  const k = S / 768
  c.fillStyle = C.black
  c.fillRect(0, 0, S, S)
  const n = Math.max(1, Math.min(4, d.n1Pct.length))
  txt(c, `TAT ${d.tatC >= 0 ? '+' : ''}${Math.round(d.tatC)}c`, 30 * k, 30 * k, 22 * k, C.white, 'left')
  const colW = (S - 40 * k) / n
  // Dial radius shrinks as engines are added so four columns still fit.
  const rN1 = Math.min(105, colW / k / 2 - 10) * k, rEgt = rN1 * 0.9
  const dial = (cx: number, cy: number, r: number, value: number, max: number, red: number, label: string, digits: string, cmd?: number): void => {
    const a0 = Math.PI, a1 = Math.PI * 2.1
    const ang = (v: number): number => a0 + (Math.max(0, Math.min(max, v)) / max) * (a1 - a0)
    c.fillStyle = '#3a3f45'
    c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, r, a0, ang(value)); c.closePath(); c.fill()
    c.strokeStyle = C.white; c.lineWidth = 3 * k
    c.beginPath(); c.arc(cx, cy, r, a0, ang(red)); c.stroke()
    c.strokeStyle = C.red; c.lineWidth = 5 * k
    c.beginPath(); c.moveTo(cx + Math.cos(ang(red)) * (r - 10 * k), cy + Math.sin(ang(red)) * (r - 10 * k)); c.lineTo(cx + Math.cos(ang(red)) * (r + 8 * k), cy + Math.sin(ang(red)) * (r + 8 * k)); c.stroke()
    if (cmd !== undefined) {
      c.strokeStyle = C.magenta; c.lineWidth = 3 * k
      c.beginPath(); c.moveTo(cx + Math.cos(ang(cmd)) * (r - 4 * k), cy + Math.sin(ang(cmd)) * (r - 4 * k)); c.lineTo(cx + Math.cos(ang(cmd)) * (r + 10 * k), cy + Math.sin(ang(cmd)) * (r + 10 * k)); c.stroke()
    }
    c.strokeStyle = C.white; c.lineWidth = 4 * k
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(ang(value)) * r * 0.95, cy + Math.sin(ang(value)) * r * 0.95); c.stroke()
    // Digits in a box under the hub, label above the dial.
    c.strokeStyle = C.white; c.lineWidth = 2 * k
    const bw = Math.min(100, r / k * 1.3) * k, bh = 34 * k
    c.strokeRect(cx - bw / 2, cy + 8 * k, bw, bh)
    txt(c, digits, cx + bw / 2 - 6 * k, cy + 8 * k + bh / 2, Math.min(28, r / k * 0.3) * k, value >= red ? C.red : C.white, 'right')
    if (label) txt(c, label, cx, cy - r - 14 * k, 20 * k, '#22d8f0')
  }
  for (let i = 0; i < n; i++) {
    const cx = 20 * k + colW * (i + 0.5)
    const L = d.labels
    const mid = i === Math.floor((n - 1) / 2)
    dial(cx, 200 * k, rN1, d.n1Pct[i]!, 110, d.n1RedlinePct, mid ? L?.primary ?? 'N1' : '', d.n1Pct[i]!.toFixed(1), d.n1CommandPct)
    if (d.reverse) txt(c, 'REV', cx, 90 * k, 20 * k, C.green)
    dial(cx, 430 * k, rEgt, d.egtC[i] ?? 0, L?.secondaryMax ?? 1000, L?.secondaryRed ?? 950, mid ? L?.secondary ?? 'EGT' : '', L ? (d.egtC[i] ?? 0).toFixed(0) : String(d.egtC[i] ?? 0))
    txt(c, ((d.ffKgH[i] ?? 0) / 1000).toFixed(2), cx, 530 * k, 24 * k, C.white)
  }
  txt(c, 'FF', 30 * k, 530 * k, 20 * k, '#22d8f0', 'left')
  txt(c, 'FUEL', 384 * k, 600 * k, 20 * k, '#22d8f0')
  for (const [i, x] of [[0, 230], [1, 538]] as const) {
    c.strokeStyle = C.white; c.lineWidth = 2 * k
    c.beginPath(); c.arc(x * k, 680 * k, 54 * k, Math.PI, Math.PI * 2); c.stroke()
    txt(c, String(Math.round(d.fuelKg[i])), x * k, 670 * k, 26 * k, d.fuelKg[i] < 453 ? C.amber : C.white)
    txt(c, i === 0 ? 'L' : 'R', x * k, 712 * k, 20 * k, C.white)
  }
  txt(c, `TOTAL ${Math.round(d.fuelKg[0] + d.fuelKg[1])} KG`, 384 * k, 740 * k, 20 * k)
}

// ---------------------------------------------------------------------------
// Integrated standby flight display (ISFD)
// ---------------------------------------------------------------------------

export function drawIsfd(c: Ctx, S: number, d: { iasKt: number; altFt: number; pitchDeg: number; rollDeg: number; baroInHg: number }): void {
  const k = S / 256
  c.fillStyle = C.black
  c.fillRect(0, 0, S, S)
  const cx = 128 * k, cy = 128 * k
  c.save()
  c.beginPath(); c.rect(48 * k, 26 * k, 160 * k, 200 * k); c.clip()
  c.translate(cx, cy); c.rotate((-d.rollDeg * Math.PI) / 180)
  const off = d.pitchDeg * 4 * k
  c.fillStyle = C.sky; c.fillRect(-S, -S + off, S * 2, S)
  c.fillStyle = C.ground; c.fillRect(-S, off, S * 2, S)
  c.strokeStyle = C.white; c.lineWidth = 1.5 * k
  for (const p of [-20, -10, 10, 20]) { const y = off - p * 4 * k; c.beginPath(); c.moveTo(-20 * k, y); c.lineTo(20 * k, y); c.stroke() }
  c.beginPath(); c.moveTo(-S, off); c.lineTo(S, off); c.stroke()
  c.restore()
  c.strokeStyle = '#ffd400'; c.lineWidth = 3 * k
  c.beginPath(); c.moveTo(cx - 40 * k, cy); c.lineTo(cx - 14 * k, cy); c.lineTo(cx - 14 * k, cy + 8 * k); c.moveTo(cx + 40 * k, cy); c.lineTo(cx + 14 * k, cy); c.lineTo(cx + 14 * k, cy + 8 * k); c.stroke()
  // Speed (left) and altitude (right) readouts on tape strips.
  c.fillStyle = C.tape; c.fillRect(0, 26 * k, 46 * k, 200 * k); c.fillRect(210 * k, 26 * k, 46 * k, 200 * k)
  c.fillStyle = C.black; c.fillRect(0, cy - 14 * k, 46 * k, 28 * k); c.fillRect(204 * k, cy - 14 * k, 52 * k, 28 * k)
  txt(c, String(Math.round(d.iasKt)), 23 * k, cy, 18 * k)
  txt(c, String(Math.round(d.altFt / 20) * 20), 230 * k, cy, 15 * k)
  txt(c, `${d.baroInHg.toFixed(2)} IN`, cx, 242 * k, 14 * k, C.cyan)
  txt(c, 'STBY', cx, 12 * k, 13 * k, C.white)
}

// ---------------------------------------------------------------------------
// Fitting the square formats into landscape display units
// ---------------------------------------------------------------------------

/** Draw a square format centred in a w×h canvas region (pillarboxed). */
export function drawSquareFitted(c: Ctx, x: number, y: number, w: number, h: number, draw: (c: Ctx, S: number) => void): void {
  c.fillStyle = C.black
  c.fillRect(x, y, w, h)
  const S = Math.min(w, h)
  c.save()
  c.translate(x + (w - S) / 2, y + (h - S) / 2)
  c.beginPath(); c.rect(0, 0, S, S); c.clip()
  draw(c, S)
  c.restore()
}

/** Landscape MFD (737 MAX inboard displays, Gulfstream / Citation /
 *  Phenom MFDs): engine display down the left, the map on the right. */
export function drawMfdWithEngines(c: Ctx, w: number, h: number, nd: BoeingNdInput, eng: BoeingEicasInput): void {
  c.fillStyle = C.black
  c.fillRect(0, 0, w, h)
  const colW = Math.round(Math.min(w * 0.36, h * 0.62))
  drawSquareFitted(c, 0, 0, colW, colW, (cc, S) => drawBoeingEicas(cc, S, eng))
  c.strokeStyle = '#2b3036'; c.lineWidth = 2
  c.beginPath(); c.moveTo(colW + 1, 8); c.lineTo(colW + 1, h - 8); c.stroke()
  drawSquareFitted(c, colW + 2, 0, w - colW - 2, h, (cc, S) => drawBoeingNd(cc, S, nd))
}
