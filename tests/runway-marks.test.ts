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
