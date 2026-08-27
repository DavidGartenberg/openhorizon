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
  it('calls airspeed alive, eighty knots, vee one, rotate, positive rate, gear up, flaps up in order', () => {
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
      'airspeed alive', 'eighty knots', 'vee one', 'rotate',
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
