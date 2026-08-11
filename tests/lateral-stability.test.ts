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
  it('static full power: the nosewheel pins it — no pirouette', () => {
    const ac = new Aircraft()
    ac.spawnOnGround(0, 0, 0)
    ac.controls.throttle = 1
    for (let t = 0; t < 6; t += DT) ac.step(DT)
    expect(Math.abs(wrap(ac.data.headingDeg))).toBeLessThan(4)
  })

  it('no-rudder takeoff roll veers left but stays driveable (<15° by 40 KIAS)', () => {
    const ac = new Aircraft()
    ac.spawnOnGround(0, 0, 0)
    ac.controls.throttle = 1
    for (let t = 0; t < 40; t += DT) {
      ac.step(DT)
      if (ac.data.kias >= 40) break
    }
    const drift = wrap(ac.data.headingDeg)
    expect(drift).toBeLessThan(0) // still honestly yaws LEFT
    expect(Math.abs(drift)).toBeLessThan(15)
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
