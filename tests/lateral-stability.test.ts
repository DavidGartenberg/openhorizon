/**
 * Uncommanded-lateral-motion regressions (user report: "the Cessna moves
 * sideways without me doing it"). A real C172S is RIGGED — offset fin +
 * aileron rigging null the prop's yaw/roll moments at cruise — and
 * P-factor needs forward inflow to exist at all. Before these fixes the
 * model pirouetted at 5°/s under static power, drifted 40° off heading
 * by 29 KIAS on a no-rudder takeoff roll, and rolled hands-off cruise
 * into a 45°-bank spiral inside 40 s.
 */
import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import { trim } from '../src/sim/trim'
import { kcasFromKias, KT } from '../src/sim/atmosphere'

const DT = 1 / 120
const wrap = (d: number) => ((d + 540) % 360) - 180

describe('lateral stability (rigging + P-factor inflow)', () => {
  it('static full power: no pirouette (slipstream swirl creeps it, the tires hold it)', () => {
    // Prop-effects model: slipstream swirl on the fin is PRESENT at
    // static (torque-conserved — a real runup pushes the tail), so
    // feet-off full power creeps left a few degrees as it starts rolling;
    // the old hand-ramped model zeroed this. The contract is "no
    // pirouette" (the original bug was 5°/s — 30° in this window), not
    // "no physics".
    const ac = new Aircraft()
    ac.spawnOnGround(0, 0, 0)
    ac.controls.throttle = 1
    for (let t = 0; t < 6; t += DT) ac.step(DT)
    expect(Math.abs(wrap(ac.data.headingDeg))).toBeLessThan(10)
  })

  it('no-rudder takeoff roll veers left; WITH modest pedal it holds the centerline', () => {
    // Feet-off, the prop-effects swirl+P-factor walk it left from brake
    // release (real: a hands-off full-power 172 exits the runway edge) —
    // assert the character loosely. The user-facing contract is
    // CONTROLLABILITY: a proportional pedal ≤40% authority holds heading
    // within a few degrees all the way to 40 KIAS.
    const free = new Aircraft()
    free.spawnOnGround(0, 0, 0)
    free.controls.throttle = 1
    for (let t = 0; t < 40; t += DT) { free.step(DT); if (free.data.kias >= 40) break }
    const drift = wrap(free.data.headingDeg)
    expect(drift).toBeLessThan(0) // still honestly yaws LEFT
    expect(Math.abs(drift)).toBeLessThan(40)

    const held = new Aircraft()
    held.spawnOnGround(0, 0, 0)
    held.controls.throttle = 1
    let maxPedal = 0, maxErr = 0
    for (let t = 0; t < 40; t += DT) {
      const err = -wrap(held.data.headingDeg)
      const yaw = Math.max(-0.4, Math.min(0.4, err * 0.1))
      maxPedal = Math.max(maxPedal, Math.abs(yaw))
      maxErr = Math.max(maxErr, Math.abs(err))
      held.controls.yaw = yaw
      held.step(DT)
      if (held.data.kias >= 40) break
    }
    expect(maxErr).toBeLessThan(6)
    expect(maxPedal).toBeLessThanOrEqual(0.4)
  })

  it('hands-off cruise holds near wings-level for a minute (rigged, mild spiral only)', () => {
    const ac = new Aircraft()
    const tas = kcasFromKias(110, 0) * KT
    const t = trim({ tasMs: tas, altM: 914, massKg: ac.massKg, flapsDeg: 0, throttle: 0.75 })
    ac.applyTrimState(tas, t.alphaRad, 914, 0, t.gammaRad, t.elevatorRad, 0.75, t.rpm)
    let maxBank10 = 0
    for (let s = 0; s < 60; s += DT) {
      ac.step(DT)
      if (s < 10) maxBank10 = Math.max(maxBank10, Math.abs(ac.data.rollDeg))
    }
    expect(maxBank10).toBeLessThan(4) // was 20.7° inside 10 s
    expect(Math.abs(ac.data.rollDeg)).toBeLessThan(10) // was 44.6° (spiral dive)
  })
})
