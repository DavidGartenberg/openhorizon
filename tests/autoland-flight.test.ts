/**
 * Closed-loop autoland: the real airframe, autopilot, ILS geometry and
 * autoland module (tests/helpers/autoland-harness.ts) flying a stabilized
 * ILS from several miles out to the end of the rollout, in the conditions a
 * pilot would call "normal": calm, headwind, tailwind, crosswind, gusts,
 * and a start well off the localizer.
 */
import { describe, expect, it } from 'vitest'
import { C172S } from '../src/sim/aircraft/c172s'
import { B738 } from '../src/sim/aircraft/b738'
import type { AircraftParams } from '../src/sim/aircraft/params'
import { flyLanding, type LandingOpts } from './helpers/autoland-harness'

interface Limits { vs: [number, number]; along: [number, number]; xt: number; hdg: number; rolloutXt: number }

function check(P: AircraftParams, o: Omit<LandingOpts, 'P'>, lim: Limits): void {
  const r = flyLanding({ P, maxSeconds: 700, ...o })
  expect(r.crashed, r.log.join('\n')).toBe(false)
  expect(r.phases).toEqual(['ARMED', 'LAND', 'FLARE', 'ROLLOUT', 'DONE'])
  const td = r.touchdown!
  expect(td, 'touched down').not.toBeNull()
  expect(td.vsFpm, 'sink at touchdown').toBeGreaterThanOrEqual(lim.vs[0])
  expect(td.vsFpm, 'sink at touchdown').toBeLessThanOrEqual(lim.vs[1])
  expect(td.alongM, 'touchdown point').toBeGreaterThanOrEqual(lim.along[0])
  expect(td.alongM, 'touchdown point').toBeLessThanOrEqual(lim.along[1])
  expect(Math.abs(td.crossM), 'centerline error at touchdown').toBeLessThanOrEqual(lim.xt)
  expect(Math.abs(td.headingErrDeg), 'heading error at touchdown').toBeLessThanOrEqual(lim.hdg)
  expect(Math.abs(td.rollDeg), 'bank at touchdown').toBeLessThanOrEqual(5)
  expect(r.bounced, 'bounced').toBe(false)
  expect(r.tailStrike, 'tail strike attitude').toBe(false)
  expect(r.maxCrossRolloutM, 'centerline excursion on the rollout').toBeLessThanOrEqual(lim.rolloutXt)
  expect(r.doneAtS, 'rollout completed').not.toBeNull()
  expect(r.stoppedOrSlowKt, 'handed back at taxi speed').toBeLessThanOrEqual(21)
}

describe('autoland: Cessna 172 (5 nm final, flaps and speed managed by autoland)', () => {
  const base = { distNm: 5, kias: 75 }
  const lim: Limits = { vs: [-300, -30], along: [100, 700], xt: 5, hdg: 9, rolloutXt: 12 }
  it('calm', () => check(C172S, { ...base }, lim))
  it('15 kt headwind', () => check(C172S, { ...base, headwindKt: 15 }, lim))
  it('8 kt tailwind', () => check(C172S, { ...base, headwindKt: -8 }, lim))
  it('15 kt crosswind from the right', () => check(C172S, { ...base, crosswindKt: 15 }, lim))
  it('15 kt crosswind from the left', () => check(C172S, { ...base, crosswindKt: -15 }, lim))
  it('gusty headwind', () => check(C172S, { ...base, headwindKt: 8, gustKt: 5 }, lim))
  it('starting 150 m right of the localizer', () => check(C172S, { ...base, offsetM: 150 }, lim))
  it('starting 150 m left of the localizer', () => check(C172S, { ...base, offsetM: -150 }, lim))
  it('20 kt crosswind with gusts', () => check(C172S, { ...base, crosswindKt: 20, headwindKt: 5, gustKt: 4 }, lim))
})

describe('autoland: Boeing 737-800 (7 nm final, flaps 5 → landing flaps by autoland)', () => {
  const base = { distNm: 7, kias: 160, flapsIndex: 3 }
  const lim: Limits = { vs: [-450, -40], along: [150, 900], xt: 9, hdg: 6, rolloutXt: 14 }
  it('calm', () => check(B738, { ...base }, lim))
  it('15 kt headwind', () => check(B738, { ...base, headwindKt: 15 }, lim))
  it('8 kt tailwind', () => check(B738, { ...base, headwindKt: -8 }, lim))
  it('15 kt crosswind from the right', () => check(B738, { ...base, crosswindKt: 15 }, lim))
  it('15 kt crosswind from the left', () => check(B738, { ...base, crosswindKt: -15 }, lim))
  it('gusty headwind', () => check(B738, { ...base, headwindKt: 8, gustKt: 5 }, lim))
  it('gusty headwind, different gust phase', () => check(B738, { ...base, headwindKt: 8, gustKt: 5, gustPhaseS: 17 }, lim))
  it('starting 150 m off the localizer', () => check(B738, { ...base, offsetM: 150 }, lim))
  it('20 kt crosswind with gusts', () => check(B738, { ...base, crosswindKt: 20, headwindKt: 5, gustKt: 4 }, { ...lim, rolloutXt: 16 }))
})

describe('autoland: quality of a normal landing', () => {
  it('a calm 737 landing is a good one (sink, touchdown zone, centerline, pitch)', () => {
    const r = flyLanding({ P: B738, distNm: 7, kias: 160, flapsIndex: 3 })
    const td = r.touchdown!
    expect(td.vsFpm).toBeGreaterThan(-250)
    expect(td.vsFpm).toBeLessThan(-60)
    expect(td.alongM).toBeGreaterThan(250)
    expect(td.alongM).toBeLessThan(650)
    expect(Math.abs(td.crossM)).toBeLessThan(3)
    expect(td.pitchDeg).toBeLessThan(9.5)
    expect(td.kias).toBeGreaterThan(125)
  })
  it('a calm Cessna landing is a good one', () => {
    const r = flyLanding({ P: C172S, distNm: 5, kias: 75 })
    const td = r.touchdown!
    expect(td.vsFpm).toBeGreaterThan(-220)
    expect(td.alongM).toBeGreaterThan(150)
    expect(td.alongM).toBeLessThan(500)
    expect(Math.abs(td.crossM)).toBeLessThan(3)
    expect(td.kias).toBeGreaterThan(40)
  })
})
