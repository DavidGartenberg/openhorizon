import { describe, it, expect } from 'vitest'
import { runwayMarkQuads, splitDesignator, designatorLayout, thresholdStripes, DASH_LEN_M, DASH_GAP_M } from '../src/world/runway-marks'

describe('splitDesignator', () => {
  it('splits numerals from the L/R/C suffix', () => {
    expect(splitDesignator('28L')).toEqual({ digits: '28', letter: 'L' })
    expect(splitDesignator('10R')).toEqual({ digits: '10', letter: 'R' })
    expect(splitDesignator('9')).toEqual({ digits: '9', letter: '' })
    expect(splitDesignator('36C')).toEqual({ digits: '36', letter: 'C' })
  })
  it('passes odd identifiers (helipads, water) through untouched', () => {
    expect(splitDesignator('H1')).toEqual({ digits: 'H1', letter: '' })
  })
})

describe('designatorLayout', () => {
  it('puts the suffix letter nearer the threshold than the numerals', () => {
    const l = designatorLayout('28L')
    expect(l.glyphs.map((g) => g.text)).toEqual(['L', '28'])
    expect(l.glyphs[0]!.distM).toBeLessThan(l.glyphs[1]!.distM)
  })
  it('starts 12 m beyond the threshold stripes and keeps glyphs clear of each other', () => {
    const l = designatorLayout('28L')
    expect(l.glyphs[0]!.distM - l.heightM / 2).toBeCloseTo(48, 5)
    expect(l.glyphs[1]!.distM - l.glyphs[0]!.distM).toBeGreaterThanOrEqual(l.heightM)
  })
  it('a lone numeral sits at the first position', () => {
    expect(designatorLayout('09').glyphs).toHaveLength(1)
  })
})

describe('thresholdStripes', () => {
  it('follows the FAA count by width', () => {
    expect(thresholdStripes(15)).toBe(4) // < 60 ft
    expect(thresholdStripes(18.3)).toBe(6) // 60 ft
    expect(thresholdStripes(22.9)).toBe(8) // 75 ft
    expect(thresholdStripes(30.5)).toBe(12) // 100 ft
    expect(thresholdStripes(46)).toBe(16) // 150 ft
    expect(thresholdStripes(61)).toBe(16) // 200 ft
  })
})

describe('runwayMarkQuads', () => {
  const lenM = 3618, widM = 61 // KSFO 28L-ish
  const q = runwayMarkQuads(lenM, widM)

  it('keeps every stripe on the pavement', () => {
    for (const s of q) {
      expect(Math.abs(s.x) + s.w / 2).toBeLessThanOrEqual(widM / 2 + 1e-6)
      expect(Math.abs(s.y) + s.l / 2).toBeLessThanOrEqual(lenM / 2 + 1e-6)
    }
  })

  it('draws two symmetric continuous edge lines', () => {
    const edges = q.filter((s) => s.l > lenM * 0.9)
    expect(edges).toHaveLength(2)
    expect(edges[0]!.x).toBeCloseTo(-edges[1]!.x, 6)
    expect(edges[0]!.w).toBeCloseTo(0.9, 6)
  })

  it('lays 36.6 m dashes with ≥ 24.4 m gaps on the centreline, clear of the designators', () => {
    const dashes = q.filter((s) => s.x === 0 && Math.abs(s.l - DASH_LEN_M) < 1e-6).sort((a, b) => a.y - b.y)
    expect(dashes.length).toBeGreaterThan(30)
    for (let i = 1; i < dashes.length; i++) {
      const gap = dashes[i]!.y - dashes[i - 1]!.y - DASH_LEN_M
      expect(gap).toBeGreaterThanOrEqual(DASH_GAP_M - 1e-6)
      expect(gap).toBeLessThan(DASH_GAP_M + 12)
    }
    expect(Math.abs(dashes[0]!.y) + DASH_LEN_M / 2).toBeLessThanOrEqual(lenM / 2 - 100 + 1e-6)
    expect(dashes[0]!.y).toBeCloseTo(-dashes[dashes.length - 1]!.y, 4)
  })

  it('paints the touchdown zone 3-2-2-1-1 per side at each end', () => {
    const lowEnd = q.filter((s) => s.y < 0 && Math.abs(s.l - 22.9) < 1e-6 && s.x < 0)
    const byStation = new Map<number, number>()
    for (const s of lowEnd) byStation.set(Math.round(s.y), (byStation.get(Math.round(s.y)) ?? 0) + 1)
    expect([...byStation.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n)).toEqual([3, 2, 2, 1, 1])
  })

  it('adds an aiming-point pair at 1,000 ft only on runways ≥ 4,200 ft', () => {
    const has = (s: ReturnType<typeof runwayMarkQuads>): boolean => s.some((x) => x.l === 45 && x.w === 6)
    expect(has(q)).toBe(true)
    expect(has(runwayMarkQuads(1000, 30))).toBe(false)
  })

  it('short narrow runways get only the basics (no TDZ bars, thin lines)', () => {
    const s = runwayMarkQuads(900, 18)
    expect(s.some((x) => Math.abs(x.l - 22.9) < 1e-6)).toBe(false)
    expect(s.find((x) => x.l > 800)!.w).toBeCloseTo(0.45, 6)
    for (const x of s) expect(Math.abs(x.x) + x.w / 2).toBeLessThanOrEqual(9 + 1e-6)
  })
})

describe('displaced thresholds', () => {
  const LEN = 3000, W = 45
  const inY = (q: { y: number; l: number }, lo: number, hi: number): boolean => q.y - q.l / 2 >= lo - 0.01 && q.y + q.l / 2 <= hi + 0.01
  it('no displacement is the same markings as before', () => {
    expect(runwayMarkQuads(LEN, W, {})).toEqual(runwayMarkQuads(LEN, W))
    expect(runwayMarkQuads(LEN, W, { displacedLowM: 0, displacedHighM: 0 })).toEqual(runwayMarkQuads(LEN, W))
  })
  it('the threshold stripes, aiming point and touchdown bars start at the displaced threshold, not at the pavement end', () => {
    const base = runwayMarkQuads(LEN, W)
    const d = runwayMarkQuads(LEN, W, { displacedLowM: 300 })
    // the 30 m threshold stripes of the low end (centred 6 + 15 m in from the threshold) move 300 m inward
    const stripes = (qs: typeof base): number[] => qs.filter((q) => q.w === 1.8 && q.l === 30 && q.y < 0).map((q) => q.y)
    expect(Math.max(...stripes(base))).toBeCloseTo(-LEN / 2 + 21, 3)
    expect(Math.min(...stripes(d))).toBeGreaterThan(-LEN / 2 + 300)
    // nothing but arrows, edges and the centreline lies in the displaced stretch
    const inside = d.filter((q) => inY(q, -LEN / 2, -LEN / 2 + 300) && !(Math.abs(q.x) > W / 2 - 3))
    expect(inside.length).toBeGreaterThan(0)
    expect(inside.every((q) => q.w <= 2.0 || q.x === 0)).toBe(true)
  })
  it('the displaced stretch carries centreline arrows pointing at the threshold, and a threshold bar across the runway', () => {
    const d = runwayMarkQuads(LEN, W, { displacedLowM: 300 })
    const bar = d.find((q) => q.w > W * 0.6 && q.l <= 3.5 && Math.abs(q.y - (-LEN / 2 + 300)) < 3)
    expect(bar, 'threshold bar').toBeTruthy()
    const arrows = d.filter((q) => q.x === 0 && q.w <= 1.0 && inY(q, -LEN / 2, -LEN / 2 + 300) && q.l <= 12)
    expect(arrows.length).toBeGreaterThanOrEqual(8)
    const heads = d.filter((q) => q.rotZ !== undefined && Math.abs(q.x) > 1 && inY(q, -LEN / 2, -LEN / 2 + 300))
    expect(heads.length).toBe(arrows.length * 2)
    // the tip is toward the threshold: the head strokes lie nearer the threshold than the shaft's centre
    const shaft = arrows.find((q) => q.y > -LEN / 2 + 250)!
    for (const h of heads.filter((x) => Math.abs(x.y - shaft.y) < 20)) expect(h.y).toBeGreaterThan(shaft.y)
    // every painted piece stays on the pavement
    for (const q of d) expect(q.y - q.l / 2).toBeGreaterThanOrEqual(-LEN / 2 - 0.5)
  })
  it('the edge lines still run the full length of the pavement', () => {
    const d = runwayMarkQuads(LEN, W, { displacedLowM: 300, displacedHighM: 200 })
    const edges = d.filter((q) => Math.abs(q.x) > W / 2 - 2 && q.l > LEN * 0.9)
    expect(edges).toHaveLength(2)
  })
  it('displaced ends on both sides are symmetric about the middle', () => {
    const d = runwayMarkQuads(LEN, W, { displacedLowM: 250, displacedHighM: 250 })
    const ys = d.filter((q) => q.w === 1.8 && q.l === 30).map((q) => q.y).sort((a, b) => a - b)
    expect(ys[0]).toBeCloseTo(-ys[ys.length - 1]!, 3)
  })
  it('an absurd displacement is limited to what the pavement can hold', () => {
    const d = runwayMarkQuads(LEN, W, { displacedLowM: 99999, displacedHighM: 99999 })
    for (const q of d) expect(Math.abs(q.y) - q.l / 2).toBeLessThanOrEqual(LEN / 2 + 0.5)
  })
})
