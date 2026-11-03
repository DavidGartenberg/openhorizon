/**
 * Wheel brakes heat up, cool down and fade. One maximum-braking stop must
 * leave the POH-calibrated braking intact; back-to-back stops must not.
 */
import { describe, expect, it } from 'vitest'
import { BrakeThermal, brakeFade, brakeSpecFor } from '../src/sim/systems/brakes'
import { Aircraft } from '../src/sim/aircraft'
import { C172S } from '../src/sim/aircraft/c172s'
import { KT } from '../src/sim/atmosphere'

describe('brake thermal model', () => {
  const ga = brakeSpecFor(1111, false), jet = brakeSpecFor(79_000, true)

  it('heats by energy / capacity, and cools with its time constant (faster in airflow)', () => {
    const b = new BrakeThermal(ga, 15)
    b.step(1, 50_000, 50_000, 0, 15) // 50 kJ a side in one second
    expect(b.tempC[0] - 15).toBeCloseTo(50_000 / ga.capacityJK, -1)
    const hot = new BrakeThermal(ga, 15)
    hot.tempC[0] = hot.tempC[1] = 315
    for (let t = 0; t < ga.coolTauS; t += 1) hot.step(1, 0, 0, 0, 15)
    expect(hot.tempC[0] - 15).toBeCloseTo(300 * Math.exp(-1), -1) // one τ standing
    const blown = new BrakeThermal(ga, 15)
    blown.tempC[0] = 315
    for (let t = 0; t < ga.coolTauS; t += 1) blown.step(1, 0, 0, 40, 15)
    expect(blown.tempC[0]).toBeLessThan(40) // much faster in a 40 m/s airflow
  })

  it('fades GA linings above 300 °C; carbon holds to 1,000 °C', () => {
    expect(brakeFade(250, ga)).toBe(1)
    expect(brakeFade(400, ga)).toBeLessThan(1)
    expect(brakeFade(500, ga)).toBeCloseTo(0.55, 6)
    expect(brakeFade(900, ga)).toBe(0.4)
    expect(brakeFade(900, jet)).toBe(1)
    expect(brakeFade(1250, jet)).toBeCloseTo(0.55, 6)
  })

  it('a C172: one hard stop heats without fading; back-to-back stops fade and lengthen', () => {
    const ac = new Aircraft(C172S)
    ac.spawnOnGround(0, 0, 0, 0)
    for (let i = 0; i < 120; i++) ac.step(1 / 120) // settle on the struts
    ac.controls.throttle = 0
    ac.controls.brakeLeft = ac.controls.brakeRight = 1
    // Each stop: launch at 50 kt along the runway, full brakes until stopped.
    const stop = (): number => {
      ac.velBody.x = 50 * KT
      const x0 = ac.posNed.x
      for (let i = 0; i < 60 * 120 && ac.velBody.x > 0.3; i++) ac.step(1 / 120)
      return ac.posNed.x - x0
    }
    const first = stop()
    const afterFirst = ac.brakes.maxTempC
    expect(afterFirst).toBeGreaterThan(120) // real heat…
    expect(afterFirst).toBeLessThan(300) // …but no fade on one stop
    stop()
    const third = stop()
    expect(ac.brakes.maxTempC).toBeGreaterThan(400)
    expect(third).toBeGreaterThan(first * 1.1) // faded brakes: a longer stop
  })
})
