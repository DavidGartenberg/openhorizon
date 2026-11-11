/**
 * Copilot callout engine (Slice 4) — pure. A first officer who calls the
 * takeoff roll (airspeed alive / eighty knots / V1 / rotate), climb-out
 * (positive rate, gear-up acknowledgment, flaps-up schedule), and the
 * arrival ("one thousand", "sixty knots" on rollout). TAWS owns "five
 * hundred" and FIFTY…TEN — the copilot must never duplicate those.
 * Latched: each call fires once per phase; touchdown re-arms the
 * takeoff family, liftoff re-arms the landing family.
 */
import { describe, expect, it } from 'vitest'
import { copilotCallouts, copilotSpeedsFor, makeCopilotLatches, type CopilotObs } from '../src/sim/copilot'

const JET = { vrKt: 145, v1Kt: 140, flapsUpKt: 210 }
const GA = { vrKt: 51, v1Kt: 0, flapsUpKt: 60 }

const obs = (o: Partial<CopilotObs>): CopilotObs => ({
  kias: 0, aglFt: 0, vsFpm: 0, onGround: true, gearDown: true, flapsIndex: 2, throttle: 1,
  ...o,
})

describe('copilotSpeedsFor', () => {
  it('derives Vr from the takeoff-detent stall (mid detent), V1 = Vr − 5 for jets', () => {
    // B738-like: clean stall 125, clMaxClean 1.45, takeoff detent adds 0.5.
    const sp = copilotSpeedsFor({
      vs1Kt: 125, clMaxClean: 1.45, flapDClMax: [0, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9, 1.0, 1.1],
      flapDetentsDeg: [0, 1, 2, 5, 10, 15, 25, 30, 40], jet: true,
    })
    // vsTO = 125·sqrt(1.45/1.95) ≈ 107.8 → Vr ≈ 124
    expect(sp.vrKt).toBeGreaterThan(115)
    expect(sp.vrKt).toBeLessThan(130)
    expect(sp.v1Kt).toBe(sp.vrKt - 5)
  })
  it('GA gets no V1 call and a low Vr', () => {
    const sp = copilotSpeedsFor({
      vs1Kt: 48, clMaxClean: 1.63, flapDClMax: [0, 0.25, 0.4, 0.5],
      flapDetentsDeg: [0, 10, 20, 30], jet: false,
    })
    expect(sp.v1Kt).toBe(0)
    expect(sp.vrKt).toBeLessThan(60)
  })
})

describe('copilot takeoff sequence (jet)', () => {
  it('calls airspeed alive, eighty knots, one hundred knots, vee one, rotate, positive rate, gear up, flaps up in order', () => {
    const L = makeCopilotLatches()
    const calls: string[] = []
    let prev = obs({ kias: 10 })
    const step = (o: CopilotObs): void => {
      calls.push(...copilotCallouts(o, prev, JET, L, true))
      prev = o
    }
    step(obs({ kias: 45 }))
    step(obs({ kias: 85 }))
    step(obs({ kias: 141 }))
    step(obs({ kias: 146 }))
    step(obs({ kias: 155, onGround: false, aglFt: 60, vsFpm: 900 }))
    step(obs({ kias: 165, onGround: false, aglFt: 300, vsFpm: 1500, gearDown: false }))
    step(obs({ kias: 215, onGround: false, aglFt: 2000, vsFpm: 1800, gearDown: false, flapsIndex: 2 }))
    expect(calls).toEqual([
      'airspeed alive', 'eighty knots', 'one hundred knots', 'vee one', 'rotate',
      'positive rate', 'gear up', 'flaps up speed',
    ])
  })

  it('never repeats a latched call', () => {
    const L = makeCopilotLatches()
    const a = obs({ kias: 146 })
    const first = copilotCallouts(a, obs({ kias: 10 }), JET, L, true)
    expect(first).toContain('rotate')
    expect(copilotCallouts(a, a, JET, L, true)).toEqual([])
  })

  it('GA: no eighty-knots or V1 call — just airspeed alive and rotate', () => {
    const L = makeCopilotLatches()
    const calls: string[] = []
    let prev = obs({ kias: 5, flapsIndex: 0 })
    for (const k of [45, 52, 60]) {
      const o = obs({ kias: k, flapsIndex: 0 })
      calls.push(...copilotCallouts(o, prev, GA, L, false))
      prev = o
    }
    expect(calls).toEqual(['airspeed alive', 'rotate'])
  })
})

describe('copilot arrival + re-arm', () => {
  it('calls one thousand descending through 1000 AGL and sixty knots on rollout', () => {
    const L = makeCopilotLatches()
    L.wasAirborne = true
    const calls: string[] = []
    let prev = obs({ kias: 140, onGround: false, aglFt: 1200, vsFpm: -700 })
    for (const o of [
      obs({ kias: 138, onGround: false, aglFt: 950, vsFpm: -700 }),
      obs({ kias: 130, onGround: false, aglFt: 300, vsFpm: -700 }),
      obs({ kias: 120, onGround: true, aglFt: 0 }),
      obs({ kias: 58, onGround: true, aglFt: 0 }),
    ]) {
      calls.push(...copilotCallouts(o, prev, JET, L, true))
      prev = o
    }
    expect(calls).toEqual(['one thousand', 'sixty knots'])
    // NOT five hundred — that aural belongs to TAWS.
    expect(calls.join(' ')).not.toContain('five hundred')
  })

  it('touchdown re-arms the takeoff family: rotate can fire again on the next leg', () => {
    const L = makeCopilotLatches()
    // First takeoff.
    let prev = obs({ kias: 10 })
    let o = obs({ kias: 146 })
    expect(copilotCallouts(o, prev, JET, L, true)).toContain('rotate')
    prev = o
    // Fly, then land.
    o = obs({ kias: 150, onGround: false, aglFt: 500, vsFpm: 600 })
    copilotCallouts(o, prev, JET, L, true); prev = o
    o = obs({ kias: 130, onGround: true })
    copilotCallouts(o, prev, JET, L, true); prev = o
    // Second takeoff.
    o = obs({ kias: 146 })
    expect(copilotCallouts(o, prev, JET, L, true)).toContain('rotate')
  })
})

import { COPILOT_CALLOUTS, COPILOT_CALLOUT_TEXT } from '../src/sim/copilot'
describe('copilot callout inventory (used to render the voice ahead of time)', () => {
  it('lists every callout the copilot can say, with no duplicates', () => {
    expect(COPILOT_CALLOUTS).toHaveLength(Object.keys(COPILOT_CALLOUT_TEXT).length)
    expect(new Set(COPILOT_CALLOUTS).size).toBe(COPILOT_CALLOUTS.length)
    for (const t of ['airspeed alive', 'rotate', 'positive rate', 'vee one', 'gear up', 'one thousand']) expect(COPILOT_CALLOUTS).toContain(t)
  })
})

describe('ILS minimums callouts', () => {
  const fly = (path: Array<Partial<CopilotObs>>, ils: boolean): string[] => {
    const L = makeCopilotLatches(); L.wasAirborne = true
    const calls: string[] = []
    let prev = obs({ kias: 140, onGround: false, aglFt: 1200, vsFpm: -700, ils })
    for (const p of path) {
      const o = obs({ kias: 135, onGround: false, vsFpm: -700, ils, ...p })
      calls.push(...copilotCallouts(o, prev, JET, L, true)); prev = o
    }
    return calls.filter((c) => /minimums/.test(c))
  }
  it('calls approaching minimums at 300 ft and minimums at 200 ft AGL while flying an ILS', () => {
    expect(fly([{ aglFt: 700 }, { aglFt: 310 }, { aglFt: 290 }, { aglFt: 205 }, { aglFt: 195 }, { aglFt: 120 }], true))
      .toEqual(['approaching minimums', 'minimums'])
  })
  it('both fire in order on a coarse step that crosses both altitudes', () => {
    expect(fly([{ aglFt: 350 }, { aglFt: 150 }], true)).toEqual(['approaching minimums', 'minimums'])
  })
  it('stays silent when no ILS is being flown (visual or non-precision approach)', () => {
    expect(fly([{ aglFt: 310 }, { aglFt: 290 }, { aglFt: 195 }], false)).toEqual([])
  })
  it('stays silent when not descending (a go-around climb through 300 ft)', () => {
    expect(fly([{ aglFt: 250, vsFpm: 900 }, { aglFt: 320, vsFpm: 900 }], true)).toEqual([])
  })
  it('never repeats on the same approach, and re-arms after the next liftoff', () => {
    const L = makeCopilotLatches(); L.wasAirborne = true
    const step = (prev: CopilotObs, o: CopilotObs): string[] => copilotCallouts(o, prev, JET, L, true).filter((c) => /minimums/.test(c))
    let prev = obs({ kias: 135, onGround: false, aglFt: 400, vsFpm: -700, ils: true })
    const a = obs({ kias: 135, onGround: false, aglFt: 190, vsFpm: -700, ils: true })
    expect(step(prev, a)).toEqual(['approaching minimums', 'minimums'])
    expect(step(a, a)).toEqual([])
    // touch down, take off again, fly the approach again
    const down = obs({ kias: 120, onGround: true, aglFt: 0 })
    step(a, down)
    const up = obs({ kias: 150, onGround: false, aglFt: 50, vsFpm: 900, ils: false })
    step(down, up)
    prev = obs({ kias: 135, onGround: false, aglFt: 400, vsFpm: -700, ils: true })
    expect(step(up, prev)).toEqual([])
    expect(step(prev, a)).toEqual(['approaching minimums', 'minimums'])
  })
  it('a go-around re-arms the approach calls: the second approach gets them again', () => {
    const L = makeCopilotLatches(); L.wasAirborne = true
    const calls: string[] = []
    let prev = obs({ kias: 135, onGround: false, aglFt: 400, vsFpm: -700, ils: true })
    const go = (o: CopilotObs): void => { calls.push(...copilotCallouts(o, prev, JET, L, true).filter((c) => /minimums|one thousand/.test(c))); prev = o }
    go(obs({ kias: 135, onGround: false, aglFt: 190, vsFpm: -700, ils: true }))        // first approach: both calls
    go(obs({ kias: 150, onGround: false, aglFt: 600, vsFpm: 1500, ils: true }))         // go-around climb
    go(obs({ kias: 160, onGround: false, aglFt: 1600, vsFpm: 1500, ils: true }))        // above 1200 ft climbing: re-armed
    go(obs({ kias: 140, onGround: false, aglFt: 1200, vsFpm: -700, ils: true }))        // downwind/final again
    go(obs({ kias: 135, onGround: false, aglFt: 950, vsFpm: -700, ils: true }))         // one thousand again
    go(obs({ kias: 135, onGround: false, aglFt: 290, vsFpm: -700, ils: true }))
    go(obs({ kias: 135, onGround: false, aglFt: 190, vsFpm: -700, ils: true }))
    expect(calls).toEqual(['approaching minimums', 'minimums', 'one thousand', 'approaching minimums', 'minimums'])
  })
})
