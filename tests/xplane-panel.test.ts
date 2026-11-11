import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseObj8 } from '../src/render/xplane-obj8'
import {
  XP_PANEL, XP_B738_PANEL, ledCells, mcpTexts, ledGlyph, LED_PITCH, type PanelRect,
} from '../src/render/xplane-panel'

const inside = (r: PanelRect): boolean => r.x >= 0 && r.y >= 0 && r.x + r.w <= XP_PANEL.width && r.y + r.h <= XP_PANEL.height
const overlap = (a: PanelRect, b: PanelRect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('panel layout', () => {
  const all = [...Object.entries(XP_B738_PANEL.displays), ...Object.entries(XP_B738_PANEL.mcp)] as Array<[string, PanelRect]>
  it('every rectangle is inside the 2048×1024 panel bitmap and non-empty', () => {
    for (const [name, r] of all) { expect(inside(r), name).toBe(true); expect(r.w, name).toBeGreaterThan(0); expect(r.h, name).toBeGreaterThan(0) }
  })
  it('no two rectangles overlap (each owns its own part of the bitmap)', () => {
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(all[i]![1], all[j]![1]), `${all[i]![0]} × ${all[j]![0]}`).toBe(false)
  })
  it('the five flight displays are the same size (they share one drawing)', () => {
    const d = XP_B738_PANEL.displays
    for (const k of ['captNd', 'eicas', 'foPfd', 'foNd'] as const) { expect(d[k].w).toBe(d.captPfd.w); expect(d[k].h).toBe(d.captPfd.h) }
  })
})

describe('MCP window text (what a 737 shows)', () => {
  const base = { iasKt: 250, hdgDeg: 90, altFt: 8000, vsFpm: 1500, vsActive: true, courseDeg: 280 }
  it('course and heading are three digits with leading zeros, 0 shown as 360', () => {
    const t = mcpTexts({ ...base, hdgDeg: 5, courseDeg: 0 })
    expect(t.hdg).toBe('005'); expect(t.crsL).toBe('360'); expect(t.crsR).toBe('360')
    expect(mcpTexts({ ...base, hdgDeg: 359.6 }).hdg).toBe('360')
    expect(mcpTexts({ ...base, hdgDeg: -10 }).hdg).toBe('350')
  })
  it('speed is three digits with the leading zero blanked; altitude is five cells with leading zeros blanked', () => {
    expect(mcpTexts({ ...base, iasKt: 80 }).spd).toBe(' 80')
    expect(mcpTexts(base).spd).toBe('250')
    expect(mcpTexts({ ...base, altFt: 8000 }).alt).toBe(' 8000')
    expect(mcpTexts({ ...base, altFt: 35000 }).alt).toBe('35000')
    expect(mcpTexts({ ...base, altFt: 500 }).alt).toBe('  500')
    expect(mcpTexts({ ...base, altFt: 0 }).alt).toBe('    0')
  })
  it('vertical speed shows a sign cell and four digits only while V/S is the vertical mode, rounded to 50', () => {
    expect(mcpTexts(base).vs).toBe('+1500')
    expect(mcpTexts({ ...base, vsFpm: -1000 }).vs).toBe('-1000')
    expect(mcpTexts({ ...base, vsFpm: -520 }).vs).toBe('- 500')
    expect(mcpTexts({ ...base, vsFpm: 0 }).vs).toBe('    0')
    expect(mcpTexts({ ...base, vsActive: false }).vs).toBe('     ')
  })
  it('never throws or prints NaN on bad input', () => {
    const t = mcpTexts({ iasKt: NaN, hdgDeg: Infinity, altFt: NaN, vsFpm: NaN, vsActive: true, courseDeg: NaN })
    for (const s of Object.values(t)) expect(s).not.toMatch(/NaN|Infinity/)
  })
})

describe('LED glyphs and cells', () => {
  it('digits are atlas cells 0–9, "." 10 and "-" 12; blanks have none', () => {
    expect('0123456789'.split('').map(ledGlyph)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(ledGlyph('.')).toBe(10); expect(ledGlyph('-')).toBe(12)
    expect(ledGlyph(' ')).toBeNull(); expect(ledGlyph('+')).toBeNull(); expect(ledGlyph('x')).toBeNull()
  })
  it('cells are LED_PITCH apart and centred on the window position', () => {
    expect(LED_PITCH).toBe(34)
    const c = ledCells('090', 1759)
    expect(c.map((x) => x.glyph)).toEqual([0, 9, 0])
    expect(c.map((x) => x.cx)).toEqual([1725, 1759, 1793])
    const five = ledCells('35000', 1953)
    expect(five.map((x) => x.cx)).toEqual([1885, 1919, 1953, 1987, 2021])
    expect(ledCells(' 80', 1987).map((x) => x.glyph)).toEqual([null, 8, 0])
  })
})

// The baked rectangles are measurements of the real asset: prove it against the file when the
// X-Plane install is present (these are skipped, not failed, on a machine without it).
const OBJ = (process.env.XPLANE_DIR ?? '/Users/davidgartenberg/X-Plane 12/Aircraft/Laminar Research') + '/Boeing 737-800/objects/b738_cockpit.obj'
describe.skipIf(!fs.existsSync(OBJ))('panel layout matches the X-Plane panel mesh (b738_cockpit.obj)', () => {
  let parsed: ReturnType<typeof parseObj8>
  let draw: (typeof parsed.draws)[number]
  // Vitest still calls the suite's registration callback when it is skipped.
  // Read the optional installed fixture only when this suite actually runs.
  beforeAll(() => {
    parsed = parseObj8(fs.readFileSync(OBJ, 'utf8'))
    const cockpit = parsed.draws.find((d) => d.cockpit)
    if (!cockpit) throw new Error('X-Plane cockpit OBJ has no cockpit draw')
    draw = cockpit
  })
  // The face of a region is the bounding box of the UVs of the triangles that cover it; compare each
  // baked rectangle with the triangle UV extents that lie inside it.
  const px = (vi: number): [number, number] => [parsed.uvs[vi * 2]! * XP_PANEL.width, (1 - parsed.uvs[vi * 2 + 1]!) * XP_PANEL.height]
  const trisInside = (r: PanelRect): number => {
    let n = 0
    for (let i = draw.start; i < draw.start + draw.count; i += 3) {
      const pts = [0, 1, 2].map((k) => px(parsed.indices[i + k]!))
      if (pts.every(([x, y]) => x >= r.x - 3 && x <= r.x + r.w + 3 && y >= r.y - 3 && y <= r.y + r.h + 3)) n++
    }
    return n
  }
  it('the panel draw is one 570-triangle mesh sampling the 2048×1024 panel', () => {
    expect(draw.count / 3).toBe(570)
  })
  it.each([...Object.entries(XP_B738_PANEL.displays), ...Object.entries(XP_B738_PANEL.mcp)] as Array<[string, PanelRect]>)('%s has geometry exactly on its rectangle', (_name, r) => {
    expect(trisInside(r)).toBeGreaterThanOrEqual(2)
    // A rectangle that is really a face has its four corners hit by vertices (within 3 px).
    const corners: Array<[number, number]> = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]
    const verts = new Set<string>()
    for (let i = draw.start; i < draw.start + draw.count; i++) { const [x, y] = px(parsed.indices[i]!); verts.add(`${Math.round(x)},${Math.round(y)}`) }
    for (const [cx, cy] of corners) {
      const hit = [...verts].some((v) => { const [x, y] = v.split(',').map(Number) as [number, number]; return Math.abs(x - cx) <= 3 && Math.abs(y - cy) <= 3 })
      expect(hit, `corner ${cx},${cy}`).toBe(true)
    }
  })
})

import { radioCells, formatCom, formatNav, RADIO_ADVANCE, type RadioWindow } from '../src/render/xplane-panel'

describe('radio windows', () => {
  it('formats COM to the kilohertz and NAV to 10 kHz, as the tune panels show them', () => {
    expect(formatCom(118.7)).toBe('118.700'); expect(formatCom(121.825)).toBe('121.825'); expect(formatCom(136)).toBe('136.000')
    expect(formatNav(108.1)).toBe('108.10'); expect(formatNav(110.35)).toBe('110.35')
    expect(formatCom(NaN)).toBe('       '); expect(formatNav(Infinity)).toBe('      ')
  })
  it('lays the digits 23 px apart with a narrower point, centred on the window', () => {
    const c = radioCells('118.700', 1801)
    expect(c.map((x) => x.glyph)).toEqual([1, 1, 8, 10, 7, 0, 0])
    const total = 6 * RADIO_ADVANCE.digit + RADIO_ADVANCE.point
    expect(c[0]!.x).toBeCloseTo(1801 - total / 2)
    expect(c[1]!.x - c[0]!.x).toBe(RADIO_ADVANCE.digit)
    expect(c[4]!.x - c[3]!.x).toBe(RADIO_ADVANCE.point)
    expect(radioCells('108.10', 1801).length).toBe(6)
  })
  it('the eight windows sit in two columns (active, standby) and four rows inside the bitmap', () => {
    const keys = ['com1A', 'com1S', 'nav1A', 'nav1S', 'com2A', 'com2S', 'nav2A', 'nav2S'] as RadioWindow[]
    const others = [...Object.entries(XP_B738_PANEL.displays), ...Object.entries(XP_B738_PANEL.mcp), ['xponder', XP_B738_PANEL.xponder]] as Array<[string, PanelRect]>
    for (const k of keys) {
      const r = XP_B738_PANEL.radio[k]
      expect(inside(r), k).toBe(true)
      for (const [name, o] of others) expect(overlap(r, o), `${k} × ${name}`).toBe(false)
      for (const k2 of keys) if (k2 !== k) expect(overlap(r, XP_B738_PANEL.radio[k2]), `${k} × ${k2}`).toBe(false)
    }
  })
})

import { clockField, clockRect } from '../src/render/xplane-panel'
describe('clocks', () => {
  it('fields are two digits, blank when there is no valid time', () => {
    expect(clockField(7)).toBe('07'); expect(clockField(23)).toBe('23'); expect(clockField(0)).toBe('00')
    expect(clockField(NaN)).toBe('  '); expect(clockField(-1)).toBe('  '); expect(clockField(100)).toBe('  ')
  })
  it('each clock face sits inside the bitmap and clear of every display, window and the other clock', () => {
    const others = [...Object.values(XP_B738_PANEL.displays), ...Object.values(XP_B738_PANEL.mcp), ...Object.values(XP_B738_PANEL.radio), XP_B738_PANEL.xponder]
    for (const side of ['capt', 'fo'] as const) {
      const r = clockRect(side)
      expect(inside(r), side).toBe(true)
      for (const o of others) expect(overlap(r, o), side).toBe(false)
    }
    expect(overlap(clockRect('capt'), clockRect('fo'))).toBe(false)
  })
  it('the digits sit on the face, hours left of minutes', () => {
    for (const side of ['capt', 'fo'] as const) {
      const at = XP_B738_PANEL.clock[side], r = clockRect(side)
      expect(at.hoursX).toBeLessThan(at.cx); expect(at.minutesX).toBeGreaterThan(at.cx)
      expect(at.digitsY).toBeGreaterThan(r.y); expect(at.digitsY).toBeLessThan(r.y + r.h)
    }
  })
})
