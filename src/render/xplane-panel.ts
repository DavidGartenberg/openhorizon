import * as THREE from 'three'

/**
 * The X-Plane 737's "3D panel": one 2048×1024 bitmap that every glass display,
 * MCP window, radio and clock of the flight deck is drawn into, and a single
 * 570-triangle mesh (`objects/b738_cockpit.obj`, the draw under
 * ATTR_cockpit_lit_only) that puts each part of that bitmap on its place in
 * the cockpit. This module owns the bitmap: the background art comes from the
 * user's own install (`objects/Panel_background.png`, read at run time like
 * every other X-Plane asset — nothing is copied here), the displays are this
 * simulator's live PFD / ND / EICAS / ISFD, and the MCP windows are lit with
 * X-Plane's own LED glyph atlas.
 *
 * The rectangles below are measurements of the real mesh: the UV extents of
 * each display's face (pixels, top-left origin — v is flipped) and the LED
 * cell centres from the airplane's panel definition (POS x, y = 768 − POS y;
 * a cell is 34 px apart). `tests/xplane-panel.test.ts` re-derives them from
 * the OBJ whenever the install is present.
 */

export const XP_PANEL = {
  width: 2048,
  height: 1024,
  /** Relative to the airplane folder (…/Boeing 737-800/). */
  background: 'objects/Panel_background.png',
  /** 16 × 6 grid of 34 × 48 glyph cells, white with the shape in alpha; row 0 is "0123456789.", then "-". */
  ledAtlas: 'cockpit_3d/generic/TYPE/Digital_Large-4.png',
  /** The orange radio / transponder fonts: 16 × 6 grids of 23 × 34 and 25 × 38 cells, same character order. */
  radioAtlas: 'cockpit_3d/generic/TYPE/RadioOrange-4.png',
  transponderAtlas: 'cockpit_3d/generic/TYPE/TransponderOrange-4.png',
  /** The clocks' art (214 px face, 6 × 22 separator, 16 × 6 grid of 21 × 34 digit cells), relative to the airplane folder. */
  clockFace: 'cockpit_3d/generic/Clocks/clock_face-1.png',
  clockSeparator: 'cockpit_3d/generic/Clocks/separator-1.png',
  clockDigits: 'cockpit_3d/generic/Clocks/Digital-4.png',
} as const

/** Pixels, top-left origin. */
export interface PanelRect { x: number; y: number; w: number; h: number }
const rect = (x0: number, y0: number, x1: number, y1: number): PanelRect => ({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })

export type XpDisplayName = 'captPfd' | 'captNd' | 'eicas' | 'lowerDu' | 'foPfd' | 'foNd' | 'standby'
export type XpMcpWindow = 'crsL' | 'spd' | 'hdg' | 'alt' | 'vs' | 'crsR'
export type ClockSide = 'capt' | 'fo'
export type RadioWindow = 'com1A' | 'com1S' | 'nav1A' | 'nav1S' | 'com2A' | 'com2S' | 'nav2A' | 'nav2S'

export const XP_B738_PANEL = {
  /** The screen of each display. The five flight displays are 501 × 469 px for a face ~176 × 162 mm: ≈ square pixels. */
  displays: {
    captPfd: rect(12, 532, 513, 1001),
    captNd: rect(520, 532, 1021, 1001),
    eicas: rect(1028, 532, 1529, 1001),
    lowerDu: rect(1537, 532, 2038, 1001),
    foPfd: rect(12, 20, 513, 489),
    foNd: rect(520, 20, 1021, 489),
    standby: rect(1034, 1, 1322, 287),
  } satisfies Record<XpDisplayName, PanelRect>,
  /** The six MCP windows (glareshield). */
  mcp: {
    crsL: rect(1706, 2, 1812, 52),
    spd: rect(1820, 2, 2040, 52),
    hdg: rect(1706, 56, 1812, 106),
    alt: rect(1820, 56, 2040, 106),
    vs: rect(1706, 109, 1926, 159),
    crsR: rect(1935, 109, 2041, 159),
  } satisfies Record<XpMcpWindow, PanelRect>,
  /** Active (left) and standby (right) windows of the pedestal's radio tune panels, two rows each. */
  radio: {
    com1A: rect(1724, 243, 1878, 293), com1S: rect(1888, 243, 2042, 293),
    nav1A: rect(1724, 297, 1878, 347), nav1S: rect(1888, 297, 2042, 347),
    com2A: rect(1724, 351, 1878, 401), com2S: rect(1888, 351, 2042, 401),
    nav2A: rect(1724, 405, 1878, 455), nav2S: rect(1888, 405, 2042, 455),
  } satisfies Record<RadioWindow, PanelRect>,
  /**
   * The two clocks (UTC mode). POS of the ACF's clock face; the digits (hours, minutes) sit 25 px above the centre
   * and the separator between them (y = 768 − POS y). The captain's POS is (1139, 367), the first officer's (1365, 367).
   */
  clock: {
    capt: { cx: 1139, cy: 401, hoursX: 1114, minutesX: 1161, digitsY: 376 },
    fo: { cx: 1365, cy: 401, hoursX: 1340, minutesX: 1388, digitsY: 376 },
  } satisfies Record<ClockSide, { cx: number; cy: number; hoursX: number; minutesX: number; digitsY: number }>,
  /** The transponder code window. */
  xponder: rect(1432, 162, 1553, 238),
  /** Centre of each window's digit field (POS x, 768 − POS y of its gen_LED instrument). */
  led: {
    crsL: { cx: 1759, cy: 27 },
    spd: { cx: 1987, cy: 27 },
    hdg: { cx: 1759, cy: 81 },
    alt: { cx: 1953, cy: 81 },
    vs: { cx: 1840, cy: 134 },
    crsR: { cx: 1988, cy: 134 },
  } satisfies Record<XpMcpWindow, { cx: number; cy: number }>,
} as const

// ---------------------------------------------------------------- LED --

export const LED_PITCH = 34
export const LED_CELL = { w: 34, h: 48 } as const

/** The glyph cell (in atlas row 0) for a character, or null for a blank. */
export function ledGlyph(ch: string): number | null {
  if (ch.length === 1 && ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48
  if (ch === '.') return 10
  if (ch === '-') return 12
  return null
}

/** Where each character of a window's text sits: centred on `cx`, LED_PITCH apart. */
export function ledCells(text: string, cx: number): Array<{ glyph: number | null; cx: number }> {
  const n = text.length
  return Array.from(text, (ch, i) => ({ glyph: ledGlyph(ch), cx: cx + (i - (n - 1) / 2) * LED_PITCH }))
}

// ------------------------------------------------------------- radio LED --

export const RADIO_CELL = { w: 23, h: 34 } as const
/** Horizontal advance of a digit and of the decimal point in the radio windows (px). */
export const RADIO_ADVANCE = { digit: 23, point: 12 } as const
export const XPONDER_CELL = { w: 25, h: 38 } as const
export const CLOCK_CELL = { w: 21, h: 34 } as const
export const CLOCK_FACE_PX = 214
/** The bitmap area a clock's face covers. */
export const clockRect = (side: ClockSide): PanelRect => { const at = XP_B738_PANEL.clock[side]; return { x: at.cx - CLOCK_FACE_PX / 2, y: at.cy - CLOCK_FACE_PX / 2, w: CLOCK_FACE_PX, h: CLOCK_FACE_PX } }

/** "07" for 7: the clock's two-digit fields. Out-of-range or non-finite input blanks the field. */
export const clockField = (n: number): string => (Number.isFinite(n) && n >= 0 && n < 100 ? String(Math.floor(n)).padStart(2, '0') : '  ')

export const formatCom = (mhz: number): string => (Number.isFinite(mhz) ? mhz.toFixed(3) : ' '.repeat(7))
export const formatNav = (mhz: number): string => (Number.isFinite(mhz) ? mhz.toFixed(2) : ' '.repeat(6))

/** Glyph and left edge (px) of each character of a radio window's text, centred on `cx`. */
export function radioCells(text: string, cx: number): Array<{ glyph: number | null; x: number; advance: number }> {
  const adv = (ch: string): number => (ch === '.' ? RADIO_ADVANCE.point : RADIO_ADVANCE.digit)
  const total = Array.from(text).reduce((w, ch) => w + adv(ch), 0)
  let x = cx - total / 2
  return Array.from(text, (ch) => { const cell = { glyph: ledGlyph(ch), x, advance: adv(ch) }; x += cell.advance; return cell })
}

export interface McpValues { iasKt: number; hdgDeg: number; altFt: number; vsFpm: number; vsActive: boolean; courseDeg: number }

const pad = (s: string, n: number): string => s.padStart(n, ' ')
const blank = (n: number): string => ' '.repeat(n)
const bearing3 = (deg: number): string => (Number.isFinite(deg) ? pad(String(Math.round(((deg % 360) + 360) % 360) || 360).padStart(3, '0'), 3) : blank(3))

/** What each MCP window reads, one character per LED cell (blank = space). */
export function mcpTexts(v: McpValues): Record<XpMcpWindow, string> {
  const spd = Number.isFinite(v.iasKt) ? pad(String(Math.min(999, Math.max(0, Math.round(v.iasKt)))), 3) : blank(3)
  const alt = Number.isFinite(v.altFt) ? pad(String(Math.min(99999, Math.max(0, Math.round(v.altFt)))), 5) : blank(5)
  let vs = blank(5)
  if (v.vsActive && Number.isFinite(v.vsFpm)) {
    const r = Math.round(v.vsFpm / 50) * 50
    const mag = Math.min(9999, Math.abs(r))
    vs = (r === 0 ? ' ' : r < 0 ? '-' : '+') + pad(String(mag), 4)
  }
  return { crsL: bearing3(v.courseDeg), spd, hdg: bearing3(v.hdgDeg), alt, vs, crsR: bearing3(v.courseDeg) }
}

// ------------------------------------------------------------- bitmap --

/** Loads the panel art from the user's X-Plane install and owns the live bitmap. */
export class XpPanel {
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  readonly texture: THREE.CanvasTexture
  private background: HTMLCanvasElement | null = null
  private atlas: HTMLImageElement | null = null
  private radioAtlas: HTMLImageElement | null = null
  private xponderAtlas: HTMLImageElement | null = null
  private clockArt: { face: HTMLImageElement | null; separator: HTMLImageElement | null; digits: HTMLImageElement | null } = { face: null, separator: null, digits: null }
  private readonly litRadio = new Map<string, string>()
  private readonly lit = new Map<XpMcpWindow, string>()
  /** Any asset that did not load (the panel still works, without that art). */
  readonly warnings: string[] = []

  constructor(private readonly base: string) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = XP_PANEL.width
    this.canvas.height = XP_PANEL.height
    const ctx = this.canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('XpPanel: no 2D canvas context')
    this.ctx = ctx
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, XP_PANEL.width, XP_PANEL.height)
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 8
  }

  private async image(rel: string): Promise<HTMLImageElement | null> {
    const img = new Image()
    img.src = this.base + rel.split('/').map(encodeURIComponent).join('/')
    try { await img.decode(); return img } catch { this.warnings.push(`panel art missing: ${rel}`); return null }
  }

  async load(): Promise<void> {
    const [bg, atlas, radio, xpdr, face, separator, digits] = await Promise.all([this.image(XP_PANEL.background), this.image(XP_PANEL.ledAtlas), this.image(XP_PANEL.radioAtlas), this.image(XP_PANEL.transponderAtlas), this.image(XP_PANEL.clockFace), this.image(XP_PANEL.clockSeparator), this.image(XP_PANEL.clockDigits)])
    this.atlas = atlas; this.radioAtlas = radio; this.xponderAtlas = xpdr; this.clockArt = { face, separator, digits }
    if (bg) {
      this.ctx.drawImage(bg, 0, 0, XP_PANEL.width, XP_PANEL.height)
      // A pristine copy: an MCP window is restored from it before its digits are relit.
      this.background = document.createElement('canvas')
      this.background.width = XP_PANEL.width; this.background.height = XP_PANEL.height
      this.background.getContext('2d')?.drawImage(this.canvas, 0, 0)
    }
    this.lit.clear(); this.litRadio.clear()
    this.texture.needsUpdate = true
  }

  /** Run `draw` with the context clipped and translated to a display's face; it draws in (0,0)–(w,h). */
  display(name: XpDisplayName, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    const r = XP_B738_PANEL.displays[name]
    const c = this.ctx
    c.save()
    c.beginPath(); c.rect(r.x, r.y, r.w, r.h); c.clip()
    c.translate(r.x, r.y)
    draw(c, r.w, r.h)
    c.restore()
  }

  /** Copy one display's picture to another (the first officer's side shows the same picture). */
  copyDisplay(from: XpDisplayName, to: XpDisplayName): void {
    const a = XP_B738_PANEL.displays[from], b = XP_B738_PANEL.displays[to]
    this.ctx.drawImage(this.canvas, a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h)
  }

  /** Light an MCP window with `text` (one char per cell). Only repaints when the text changed. */
  led(win: XpMcpWindow, text: string): void {
    if (this.lit.get(win) === text) return
    this.lit.set(win, text)
    const r = XP_B738_PANEL.mcp[win], at = XP_B738_PANEL.led[win]
    if (this.background) this.ctx.drawImage(this.background, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h)
    if (!this.atlas) return
    for (const cell of ledCells(text, at.cx)) {
      if (cell.glyph === null) continue
      this.ctx.drawImage(this.atlas, cell.glyph * LED_CELL.w, 0, LED_CELL.w, LED_CELL.h, Math.round(cell.cx - LED_CELL.w / 2), at.cy - LED_CELL.h / 2, LED_CELL.w, LED_CELL.h)
    }
  }

  private restore(r: PanelRect): void {
    if (this.background) this.ctx.drawImage(this.background, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h)
  }

  /** Light a radio tune panel window with a frequency string ("118.700"); only repaints when it changed. */
  radio(win: RadioWindow, text: string): void {
    if (this.litRadio.get(win) === text) return
    this.litRadio.set(win, text)
    const r = XP_B738_PANEL.radio[win]
    this.restore(r)
    if (!this.radioAtlas) return
    const cy = r.y + r.h / 2
    for (const cell of radioCells(text, r.x + r.w / 2)) {
      if (cell.glyph === null) continue
      // The decimal point sits at the right of its cell: pull its cell left so it falls between the digits.
      const dx = cell.glyph === 10 ? cell.x - (RADIO_CELL.w - RADIO_ADVANCE.point) : cell.x
      this.ctx.drawImage(this.radioAtlas, cell.glyph * RADIO_CELL.w, 0, RADIO_CELL.w, RADIO_CELL.h, Math.round(dx), Math.round(cy - RADIO_CELL.h / 2), RADIO_CELL.w, RADIO_CELL.h)
    }
  }

  /** Light the transponder code window ("1200"). */
  xponder(code: string): void {
    if (this.litRadio.get('xponder') === code) return
    this.litRadio.set('xponder', code)
    const r = XP_B738_PANEL.xponder
    this.restore(r)
    if (!this.xponderAtlas) return
    const digits = code.slice(0, 4)
    // POS (1505, 555) of the ACF's transponder field: four cells centred on x = 1505, y = 768 − 555.
    digits.split('').forEach((ch, i) => {
      const g = ledGlyph(ch)
      if (g === null) return
      const cx = 1505 + (i - (digits.length - 1) / 2) * XPONDER_CELL.w
      this.ctx.drawImage(this.xponderAtlas!, g * XPONDER_CELL.w, 0, XPONDER_CELL.w, XPONDER_CELL.h, Math.round(cx - XPONDER_CELL.w / 2), 213 - XPONDER_CELL.h / 2, XPONDER_CELL.w, XPONDER_CELL.h)
    })
  }

  /** One clock in UTC mode: the face, the separator and the hours / minutes digits. Only repaints when the minute changes. */
  clock(side: ClockSide, hours: number, minutes: number): void {
    const key = `clock:${side}`, text = `${clockField(hours)}:${clockField(minutes)}`
    if (this.litRadio.get(key) === text) return
    this.litRadio.set(key, text)
    const at = XP_B738_PANEL.clock[side], half = CLOCK_FACE_PX / 2
    this.restore(clockRect(side))
    const { face, separator, digits } = this.clockArt
    if (face) this.ctx.drawImage(face, Math.round(at.cx - half), Math.round(at.cy - half))
    if (separator) this.ctx.drawImage(separator, Math.round(at.cx - 1 - separator.width / 2), Math.round(at.digitsY + 1 - separator.height / 2))
    if (!digits) return
    for (const [x, field] of [[at.hoursX, text.slice(0, 2)], [at.minutesX, text.slice(3)]] as const) {
      Array.from(field).forEach((ch, i) => {
        const g = ledGlyph(ch)
        if (g === null) return
        this.ctx.drawImage(digits, g * CLOCK_CELL.w, 0, CLOCK_CELL.w, CLOCK_CELL.h, Math.round(x + (i - 0.5) * CLOCK_CELL.w - CLOCK_CELL.w / 2), Math.round(at.digitsY - CLOCK_CELL.h / 2), CLOCK_CELL.w, CLOCK_CELL.h)
      })
    }
  }

  commit(): void { this.texture.needsUpdate = true }

  dispose(): void { this.texture.dispose(); this.background = null; this.atlas = null }
}
