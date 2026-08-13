/** Thrust reversers + ground-spoiler ARM (night-shift N4 landing kit). */
import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import { B738 } from '../src/sim/aircraft/b738'
const DT = 1/120

describe('reversers', () => {
  it('weight-on-wheels interlock: commanded in the air, sleeves stay stowed', () => {
    const ac = new Aircraft({ ...B738 })
    const tas = 80
    ac.applyTrimState(tas, 0.03, 500, 0, 0, 0, 0.4, 0)
    ac.reverseCmd = true
    for (let t = 0; t < 3; t += DT) ac.step(DT)
    expect(ac.reversePos).toBe(0)
  })

  it('ARM + touchdown-config stop from 140 kt sits in the FCOM ground-roll band', () => {
    const ac = new Aircraft({ ...B738 })
    ac.spawnOnGround(0, 0, 0)
    ac.flapsDeg = 30
    ac.controls.flapsIndex = 6
    ac.spoilerArmed = true
    // Inject a 140-kt rollout: measure the resting gear height, then
    // re-apply the state 0.3 m above it at 72 m/s — a gentle touchdown.
    for (let t = 0; t < 1; t += DT) ac.step(DT)
    const restM = ac.data.altitudeFt * 0.3048
    ac.applyTrimState(72, 0, restM + 0.3, 0, 0, 0, 0, 0)
    let x0 = ac.posNed.x
    ac.reverseCmd = true
    ac.controls.brakeLeft = 1
    ac.controls.brakeRight = 1
    ac.controls.throttle = 0.25 // reverse detent N1 comes off the same lever here
    for (let t = 0; t < 90; t += DT) {
      const err = -(((ac.data.headingDeg + 180) % 360) - 180)
      ac.controls.yaw = Math.max(-0.5, Math.min(0.5, err * 0.1))
      ac.step(DT)
      if (ac.data.kias < 30) break
    }
    const rollM = Math.abs(ac.posNed.x - x0)
    expect(ac.crashed).toBe(false)
    expect(ac.spoilerPos).toBeGreaterThan(0.9) // ground spoilers auto-deployed
    expect(ac.reversePos).toBeGreaterThan(0.9) // sleeves out on the ground
    // Max-manual braking + full reverse at ~62 t: FCOM-class numbers
    // reach down toward ~700 m; the band brackets max-effort to relaxed.
    expect(rollM).toBeGreaterThan(600)
    expect(rollM).toBeLessThan(1600)
  })

  it('C172 has no reversers: command inert', () => {
    const ac = new Aircraft()
    ac.spawnOnGround(0, 0, 0)
    ac.reverseCmd = true
    for (let t = 0; t < 2; t += DT) ac.step(DT)
    expect(ac.reversePos).toBe(0)
  })
})
