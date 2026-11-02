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
} as const

/** Pixels, top-left origin. */
export interface PanelRect { x: number; y: number; w: number; h: number }
const rect = (x0: number, y0: number, x1: number, y1: number): PanelRect => ({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })

export type XpDisplayName = 'captPfd' | 'captNd' | 'eicas' | 'lowerDu' | 'foPfd' | 'foNd' | 'standby'
export type XpMcpWindow = 'crsL' | 'spd' | 'hdg' | 'alt' | 'vs' | 'crsR'

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
    const [bg, atlas] = await Promise.all([this.image(XP_PANEL.background), this.image(XP_PANEL.ledAtlas)])
    this.atlas = atlas
    if (bg) {
      this.ctx.drawImage(bg, 0, 0, XP_PANEL.width, XP_PANEL.height)
      // A pristine copy: an MCP window is restored from it before its digits are relit.
      this.background = document.createElement('canvas')
      this.background.width = XP_PANEL.width; this.background.height = XP_PANEL.height
      this.background.getContext('2d')?.drawImage(this.canvas, 0, 0)
    }
    this.lit.clear()
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

  commit(): void { this.texture.needsUpdate = true }

  dispose(): void { this.texture.dispose(); this.background = null; this.atlas = null }
}
