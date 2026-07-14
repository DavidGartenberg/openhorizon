/**
 * Regression: a non-finite terrain elevation sample (flaky tile decode over
 * water — see PROGRESS.md) must never reach the integrator. It previously
 * poisoned the aero path via AGL (ground effect: Math.max(NaN, 0.1) → NaN
 * drag → NaN forces) and crashed the sim in one tick on the KSFO 3 nm final
 * spawn, even with the gear-side NaN guard in place.
 */
import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import { trim } from '../src/sim/trim'
import { kcasFromKias, KT } from '../src/sim/atmosphere'

describe('non-finite ground elevation', () => {
  it('does not crash or NaN the state when groundElevAt returns NaN', () => {
    const ac = new Aircraft()
    ac.groundElevAt = () => NaN // worst case: every sample bad
    const tas = kcasFromKias(70, 0) * KT
    const t = trim({ tasMs: tas, altM: 275, massKg: ac.massKg, flapsDeg: 10, gammaRad: -0.052 })
    expect(t.converged).toBe(true)
    ac.flapsDeg = 10
    ac.controls.flapsIndex = 1
    ac.applyTrimState(tas, t.alphaRad, 275, 0, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
    for (let i = 0; i < 240; i++) ac.step(1 / 120) // 2 s
    expect(ac.crashed).toBe(false)
    expect(Number.isFinite(ac.posNed.x + ac.posNed.z)).toBe(true)
    expect(Number.isFinite(ac.data.kias)).toBe(true)
    // AGL falls back to MSL (sea-level ground) rather than NaN.
    expect(Number.isFinite(ac.data.aglFt)).toBe(true)
  })

  it('intermittent NaN samples also stay contained', () => {
    const ac = new Aircraft()
    let n = 0
    ac.groundElevAt = () => (n++ % 3 === 0 ? NaN : 2)
    const tas = kcasFromKias(70, 0) * KT
    const t = trim({ tasMs: tas, altM: 275, massKg: ac.massKg, flapsDeg: 0, gammaRad: -0.052 })
    ac.applyTrimState(tas, t.alphaRad, 275, 0, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
    for (let i = 0; i < 240; i++) ac.step(1 / 120)
    expect(ac.crashed).toBe(false)
    expect(Number.isFinite(ac.data.aglFt)).toBe(true)
  })
})
