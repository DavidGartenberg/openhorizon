/**
 * Ground-speed crash guard (found by a user 737 takeoff): the "extreme
 * ground speed" impact rule was a C172-era 75 m/s (146 kt) — a 737
 * rotates through that on every normal takeoff roll and the sim froze
 * mid-runway. The guard exists to catch absurd states, not to police
 * speed: the bound must clear every legitimate fleet takeoff/landing
 * ground speed (B737 tire limit 195 kt) while still catching blowups.
 */
import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import { B738 } from '../src/sim/aircraft/b738'
import { KT } from '../src/sim/atmosphere'

function groundRollAt(gsMs: number): Aircraft {
  const ac = new Aircraft(B738)
  ac.fuelKg = 8000
  ac.spawnOnGround(0, 0, 0, 0)
  ac.velBody.x = gsMs
  ac.controls.throttle = 1
  return ac
}

describe('ground-speed crash guard vs fleet takeoff speeds', () => {
  it('a 737 rolling at 175 kt GS (fast heavy rotation) is NOT a crash', () => {
    const ac = groundRollAt(175 * KT)
    for (let i = 0; i < 30; i++) ac.step(1 / 60)
    expect(ac.crashed).toBe(false)
  })

  it('a 737 rolling through 146 kt GS (the old C172-era bound) is NOT a crash', () => {
    const ac = groundRollAt(146 * KT)
    for (let i = 0; i < 30; i++) ac.step(1 / 60)
    expect(ac.crashed).toBe(false)
  })

  it('ground contact beyond every fleet tire limit (215 kt GS) still crashes', () => {
    const ac = groundRollAt(215 * KT)
    for (let i = 0; i < 30; i++) ac.step(1 / 60)
    expect(ac.crashed).toBe(true)
  })
})
