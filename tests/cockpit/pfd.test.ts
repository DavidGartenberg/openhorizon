import { describe, expect, it } from 'vitest'
import {
  headingDeltaDeg,
  makePfdTrendState,
  pfdSoftkeyRegions,
  PFD_SOFTKEY_LABELS,
  tapeValueToY,
  updateIasTrend,
  vSpeedArcs,
} from '../../src/cockpit/pfd'
import { C172S } from '../../src/sim/aircraft/c172s'

describe('tapeValueToY (tape scroll/scaling math)', () => {
  it('places the center value exactly at centerY', () => {
    expect(tapeValueToY(100, 100, 4, 300)).toBe(300)
  })

  it('places a higher value above center (smaller y)', () => {
    // current=100, tick at 110, 4px/kt -> 40px above center
    expect(tapeValueToY(100, 110, 4, 300)).toBe(260)
  })

  it('places a lower value below center (larger y)', () => {
    expect(tapeValueToY(100, 90, 4, 300)).toBe(340)
  })

  it('scales linearly with pxPerUnit', () => {
    const y1 = tapeValueToY(100, 120, 2, 300)
    const y2 = tapeValueToY(100, 120, 4, 300)
    expect(300 - y2).toBe((300 - y1) * 2)
  })
})

describe('vSpeedArcs (V-speed arc boundary math, sourced from c172s.ts vSpeeds)', () => {
  const arcs = vSpeedArcs(C172S.vSpeeds)

  it('white arc spans Vs0 to full-flaps Vfe', () => {
    expect(arcs.whiteLowKt).toBe(C172S.vSpeeds.vs0)
    expect(arcs.whiteHighKt).toBe(C172S.vSpeeds.vfe30)
  })

  it('green arc spans Vs1 to Vno', () => {
    expect(arcs.greenLowKt).toBe(C172S.vSpeeds.vs1)
    expect(arcs.greenHighKt).toBe(C172S.vSpeeds.vno)
  })

  it('yellow arc spans Vno to Vne, and the red line sits at Vne', () => {
    expect(arcs.yellowLowKt).toBe(C172S.vSpeeds.vno)
    expect(arcs.yellowHighKt).toBe(C172S.vSpeeds.vne)
    expect(arcs.redLineKt).toBe(C172S.vSpeeds.vne)
  })

  it('arc boundaries are monotonically increasing (white <= green <= yellow <= red)', () => {
    expect(arcs.whiteLowKt).toBeLessThan(arcs.whiteHighKt)
    expect(arcs.greenLowKt).toBeLessThan(arcs.greenHighKt)
    expect(arcs.yellowLowKt).toBeLessThanOrEqual(arcs.redLineKt)
  })

  it('translates to a consistent pixel span via tapeValueToY', () => {
    const pxPerKt = 4
    const centerY = 300
    const currentIas = 90
    const yTop = tapeValueToY(currentIas, arcs.greenHighKt, pxPerKt, centerY)
    const yBot = tapeValueToY(currentIas, arcs.greenLowKt, pxPerKt, centerY)
    expect(yBot - yTop).toBeCloseTo((arcs.greenHighKt - arcs.greenLowKt) * pxPerKt, 6)
  })
})

describe('updateIasTrend (trend-vector delta computation)', () => {
  it('returns 0 on the first sample (no prior value)', () => {
    const st = makePfdTrendState()
    expect(updateIasTrend(st, 90, 1)).toBe(0)
  })

  it('computes kt/s rate from consecutive samples', () => {
    const st = makePfdTrendState()
    updateIasTrend(st, 90, 1)
    const rate = updateIasTrend(st, 95, 1)
    expect(rate).toBeCloseTo(5, 6)
  })

  it('is negative when decelerating', () => {
    const st = makePfdTrendState()
    updateIasTrend(st, 100, 1)
    const rate = updateIasTrend(st, 92, 1)
    expect(rate).toBeCloseTo(-8, 6)
  })

  it('scales inversely with dt', () => {
    const st1 = makePfdTrendState()
    updateIasTrend(st1, 100, 1)
    const r1 = updateIasTrend(st1, 110, 1)

    const st2 = makePfdTrendState()
    updateIasTrend(st2, 100, 1)
    const r2 = updateIasTrend(st2, 110, 2)

    expect(r1).toBeCloseTo(r2 * 2, 6)
  })

  it('returns 0 for a non-positive dt rather than dividing by zero', () => {
    const st = makePfdTrendState()
    updateIasTrend(st, 100, 1)
    expect(updateIasTrend(st, 110, 0)).toBe(0)
  })
})

describe('headingDeltaDeg', () => {
  it('is 0 for equal headings', () => {
    expect(headingDeltaDeg(90, 90)).toBe(0)
  })

  it('handles wraparound the short way (350 -> 10 is +20, not -340)', () => {
    expect(headingDeltaDeg(350, 10)).toBe(20)
  })

  it('handles the other wraparound direction (10 -> 350 is -20)', () => {
    expect(headingDeltaDeg(10, 350)).toBe(-20)
  })

  it('stays within (-180, 180]', () => {
    for (let a = 0; a < 360; a += 37) {
      for (let b = 0; b < 360; b += 53) {
        const d = headingDeltaDeg(a, b)
        expect(d).toBeGreaterThan(-180)
        expect(d).toBeLessThanOrEqual(180)
      }
    }
  })
})

describe('pfdSoftkeyRegions', () => {
  it('returns one region per softkey label', () => {
    const regions = pfdSoftkeyRegions(2048, 1024)
    expect(regions.length).toBe(PFD_SOFTKEY_LABELS.length)
    expect(regions.map((r) => r.label)).toEqual([...PFD_SOFTKEY_LABELS])
  })

  it('regions are non-overlapping and cover the row left-to-right', () => {
    const regions = pfdSoftkeyRegions(2048, 1024)
    for (let i = 1; i < regions.length; i++) {
      const prev = regions[i - 1]!
      const cur = regions[i]!
      expect(cur.x).toBeCloseTo(prev.x + prev.w, 6)
    }
  })

  it('all regions stay within canvas bounds', () => {
    const width = 2048
    const height = 1024
    const regions = pfdSoftkeyRegions(width, height)
    for (const r of regions) {
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.x + r.w).toBeLessThanOrEqual(width + 1e-6)
      expect(r.y + r.h).toBeLessThanOrEqual(height + 1e-6)
    }
  })

  it('scales proportionally with different width/height', () => {
    const small = pfdSoftkeyRegions(1024, 512)
    const big = pfdSoftkeyRegions(2048, 1024)
    expect(big[0]!.w).toBeCloseTo(small[0]!.w * 2, 6)
    expect(big[0]!.h).toBeCloseTo(small[0]!.h * 2, 6)
  })
})
