/**
 * Engine failure on a twin jet: the live engine's thrust and the dead one's
 * windmilling drag yaw the airplane toward the dead engine; rudder holds it.
 * Both engines running is unchanged (validated performance stands).
 */
import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import { B738 } from '../src/sim/aircraft/b738'
import { trim } from '../src/sim/trim'
import { isa, KT } from '../src/sim/atmosphere'

const DT = 1 / 120

function cut(deadSide: -1 | 0 | 1, rudder: number, secs = 4): number {
  const ac = new Aircraft(B738)
  const altM = 600, tas = 160 * KT * Math.sqrt(1.225 / isa(altM).densityKgM3)
  const t = trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg: 5, gammaRad: 0.05, params: B738 })
  ac.resetFlaps(2)
  ac.applyTrimState(tas, t.alphaRad, altM, 0, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
  ac.controls.throttle = 1
  for (let i = 0; i < 120; i++) ac.step(DT) // spool to takeoff thrust
  ac.jetPowerFactor = deadSide === 0 ? 1 : 0.5
  ac.engineDeadSide = deadSide
  ac.controls.yaw = rudder
  const h0 = ac.data.headingDeg
  for (let i = 0; i < secs / DT; i++) ac.step(DT)
  return ((ac.data.headingDeg - h0 + 540) % 360) - 180
}

describe('engine failure on a twin jet', () => {
  it('yaws toward the dead engine', () => {
    expect(cut(1, 0)).toBeGreaterThan(2) // right engine out → nose right
    expect(cut(-1, 0)).toBeLessThan(-2) // left engine out → nose left
    expect(Math.abs(cut(0, 0))).toBeLessThan(0.5)
  })
  it('opposite rudder holds it (above Vmc)', () => {
    const free = cut(1, 0), held = cut(1, -0.6)
    expect(Math.abs(held)).toBeLessThan(Math.abs(free) / 3)
  })
})
