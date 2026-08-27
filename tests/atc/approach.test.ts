import { describe, expect, it } from 'vitest'
import { ApproachController } from '../../src/sim/atc/approach'

const NM = 1852

function make(): ApproachController {
  return new ApproachController({
    facility: 'Norcal Approach',
    freqMhz: 135.65,
    activeRunway: '28R',
    towerFreqMhz: 120.5,
  })
}

describe('ApproachController (N7 arrival chain)', () => {
  it('check-in reads radar contact, expected ILS, and platform altitude', () => {
    const app = make()
    const out = app.checkIn('N1', { distanceM: 22 * NM, aglFt: 6000 }, 0)
    expect(out).toHaveLength(1)
    expect(out[0]!.text).toContain('N1, radar contact 22 miles')
    expect(out[0]!.text).toContain('expect ILS runway 28R')
    expect(out[0]!.text).toContain('descend and maintain 3,000')
    expect(out[0]!.freqMhz).toBe(135.65)
  })

  it('clears the approach inside 14 nm, once, with the until-established restriction', () => {
    const app = make()
    app.checkIn('N1', { distanceM: 22 * NM, aglFt: 6000 }, 0)
    let out = app.tick(10, [{ callsign: 'N1', view: { distanceM: 16 * NM, aglFt: 5000 } }])
    expect(out).toHaveLength(0) // still outside the gate
    out = app.tick(20, [{ callsign: 'N1', view: { distanceM: 13 * NM, aglFt: 4000 } }])
    expect(out).toHaveLength(1)
    expect(out[0]!.text).toContain('cleared ILS runway 28R approach')
    expect(out[0]!.text).toContain('maintain 3,000 until established')
    out = app.tick(30, [{ callsign: 'N1', view: { distanceM: 12 * NM, aglFt: 3800 } }])
    expect(out).toHaveLength(0) // no repeat clearance
  })

  it('hands off to the tower once inside 8 nm with the real tower frequency', () => {
    const app = make()
    app.checkIn('N1', { distanceM: 20 * NM, aglFt: 6000 }, 0)
    app.tick(10, [{ callsign: 'N1', view: { distanceM: 13 * NM, aglFt: 4000 } }])
    let out = app.tick(20, [{ callsign: 'N1', view: { distanceM: 7 * NM, aglFt: 2500 } }])
    expect(out).toHaveLength(1)
    expect(out[0]!.text).toContain('contact tower 120.50')
    expect(app.handedOff('N1')).toBe(true)
    out = app.tick(30, [{ callsign: 'N1', view: { distanceM: 6 * NM, aglFt: 2200 } }])
    expect(out).toHaveLength(0) // handoff is one-shot
  })

  it('a rush of range steps the ladder one call per tick (Slice 5: no double transmission)', () => {
    // BEHAVIOR CHANGE (recorded): this used to assert BOTH the approach
    // clearance and the tower handoff in ONE tick — exactly the
    // double-transmission the bug hunt flagged. One step per tick now.
    const app = make()
    app.checkIn('N1', { distanceM: 20 * NM, aglFt: 6000 }, 0)
    const first = app.tick(10, [{ callsign: 'N1', view: { distanceM: 7 * NM, aglFt: 2500 } }])
    expect(first).toHaveLength(1)
    expect(first[0]!.text).toContain('cleared ILS')
    const second = app.tick(15, [{ callsign: 'N1', view: { distanceM: 6.5 * NM, aglFt: 2400 } }])
    expect(second).toHaveLength(1)
    expect(second[0]!.text).toContain('contact tower')
  })

  it('unknown callsigns are ignored by tick', () => {
    const app = make()
    const out = app.tick(10, [{ callsign: 'GHOST', view: { distanceM: 5 * NM, aglFt: 2000 } }])
    expect(out).toHaveLength(0)
  })
})

describe('Slice 5 / 9B: idempotent check-in, one ladder step per tick', () => {
  it('re-checking in repeats the expectation without resetting progress', async () => {
    const { ApproachController } = await import('../../src/sim/atc/approach')
    const app = new ApproachController({ facility: 'A', freqMhz: 125.0, activeRunway: '28R', towerFreqMhz: 118.0 })
    app.checkIn('N1', { distanceM: 20 * 1852, aglFt: 5000 }, 0)
    app.tick(5, [{ callsign: 'N1', view: { distanceM: 12 * 1852, aglFt: 4000 } }]) // cleared approach
    app.checkIn('N1', { distanceM: 11 * 1852, aglFt: 3500 }, 10) // re-check-in must NOT reset
    const out = app.tick(15, [{ callsign: 'N1', view: { distanceM: 11 * 1852, aglFt: 3200 } }])
    // Already clearedApproach: no second approach clearance.
    expect(out.some((t) => t.text.includes('cleared ILS'))).toBe(false)
  })

  it('a check-in inside both gates takes two ticks (clearance, THEN handoff)', async () => {
    const { ApproachController } = await import('../../src/sim/atc/approach')
    const app = new ApproachController({ facility: 'A', freqMhz: 125.0, activeRunway: '28R', towerFreqMhz: 118.0 })
    app.checkIn('N1', { distanceM: 6 * 1852, aglFt: 2500 }, 0)
    const first = app.tick(5, [{ callsign: 'N1', view: { distanceM: 6 * 1852, aglFt: 2400 } }])
    expect(first.some((t) => t.text.includes('cleared ILS'))).toBe(true)
    expect(first.some((t) => t.text.includes('contact tower'))).toBe(false)
    const second = app.tick(10, [{ callsign: 'N1', view: { distanceM: 5.5 * 1852, aglFt: 2200 } }])
    expect(second.some((t) => t.text.includes('contact tower'))).toBe(true)
  })
})
