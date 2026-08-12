/**
 * Takeoff ground-roll validation (user goal: "proper thrust"). Anchors:
 *  - C172S POH: ground roll 960 ft (SL/ISA/MTOW, ~55 KIAS liftoff).
 *  - J-3: A-65 static thrust cross-checked against momentum theory
 *    (ideal ~1,950 N for 65 hp through a 1.83 m disc; real fixed-pitch
 *    props deliver 55-65% of ideal → ~1,050-1,250 N, ≈250-280 lbf,
 *    matching published A-65 static measurements).
 *  - 737-800: FAR takeoff field length at MTOW/SL is ~2,300-2,600 m
 *    (Boeing ACAP class data); all-engine ground roll ≈ 60-65% of field
 *    length → 1,350-1,750 m to Vr≈155. The pre-fix lapse (machA 0.45)
 *    rolled it in ~870 m even at MTOW-ish weights.
 */
import { describe, expect, it } from 'vitest'
import { Aircraft } from '../../src/sim/aircraft'
import { J3CUB } from '../../src/sim/aircraft/j3cub'
import { B738 } from '../../src/sim/aircraft/b738'
const DT = 1 / 120

function holdCenterline(ac: Aircraft): void {
  const err = -(((ac.data.headingDeg + 180) % 360) - 180)
  ac.controls.yaw = Math.max(-0.5, Math.min(0.5, err * 0.1))
}

describe('takeoff ground roll vs published', () => {
  it('C172S: roll to 55 KIAS within POH ballpark (960 ft)', () => {
    const ac = new Aircraft()
    ac.spawnOnGround(0, 0, 0)
    ac.controls.throttle = 1
    for (let t = 0; t < 60; t += DT) {
      holdCenterline(ac)
      ac.step(DT)
      if (ac.data.kias >= 55) break
    }
    const rollFt = Math.hypot(ac.posNed.x, ac.posNed.y) * 3.281
    expect(rollFt).toBeGreaterThan(750)
    expect(rollFt).toBeLessThan(1150)
  })

  it('J-3: static thrust matches the momentum-theory band for 65 hp', () => {
    const ac = new Aircraft({ ...J3CUB })
    ac.spawnOnGround(0, 0, 0)
    ac.engineRunning = true
    ac.controls.mixture = 1
    ac.controls.throttle = 1
    ac.controls.brakeLeft = 1; ac.controls.brakeRight = 1
    ac.controls.pitch = 0.3
    for (let t = 0; t < 4; t += DT) ac.step(DT)
    expect(ac.prop.thrustN).toBeGreaterThan(900)
    expect(ac.prop.thrustN).toBeLessThan(1400)
    expect(ac.data.rpm).toBeGreaterThan(2100) // A-65 static ~2,150-2,300
    expect(ac.data.rpm).toBeLessThan(2400)
  })

  it('737-800 at MTOW: all-engine roll to 155 KIAS in the FCOM band', () => {
    const ac = new Aircraft({ ...B738 })
    ac.payloadKg = Math.max(B738.mtowKg - ac.massKg, 0) // load to MTOW
    ac.spawnOnGround(0, 0, 0)
    ac.flapsDeg = 5
    ac.controls.throttle = 1
    for (let t = 0; t < 120; t += DT) {
      holdCenterline(ac)
      ac.step(DT)
      if (ac.data.kias >= 155) break
    }
    const rollM = Math.hypot(ac.posNed.x, ac.posNed.y)
    expect(ac.massKg).toBeGreaterThan(B738.mtowKg * 0.98)
    expect(rollM).toBeGreaterThan(1250)
    expect(rollM).toBeLessThan(1850)
  })
})
