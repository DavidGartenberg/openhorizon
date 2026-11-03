/**
 * Propeller gyroscopic precession: the airframe feels H × Ω, H = I·ω forward
 * for a propeller turning clockwise seen from behind (the fleet's sense, the
 * same one that gives every type its left-turning torque roll).
 */
import { describe, expect, it } from 'vitest'
import { gyroscopicMoment } from '../src/sim/prop-effects'
import { Aircraft } from '../src/sim/aircraft'
import { C172S } from '../src/sim/aircraft/c172s'
import { J3CUB } from '../src/sim/aircraft/j3cub'
import { trim } from '../src/sim/trim'
import { KT } from '../src/sim/atmosphere'

describe('propeller gyroscopic precession', () => {
  it('pitching down yaws left (the taildragger tail-up swing); yawing right pitches down', () => {
    const m = { y: 0, z: 0 }
    gyroscopicMoment(1.6, 251, -0.2, 0, m) // nose coming down
    expect(m.z).toBeLessThan(0) // yaw moment to the left
    gyroscopicMoment(1.6, 251, 0.2, 0, m)
    expect(m.z).toBeGreaterThan(0)
    gyroscopicMoment(1.6, 251, 0, 0.2, m) // yawing right
    expect(m.y).toBeLessThan(0) // nose-down pitching moment
  })

  it('has the size H·Ω: a C172 at 2,400 rpm pitching 10°/s feels ~70 N·m of yaw', () => {
    const m = gyroscopicMoment(C172S.rotInertiaKgM2, (2400 * Math.PI) / 30, (10 * Math.PI) / 180, 0, { y: 0, z: 0 })
    expect(m.z).toBeCloseTo(C172S.rotInertiaKgM2 * 251.33 * 0.17453, 0)
    expect(m.z).toBeGreaterThan(60)
    expect(m.z).toBeLessThan(80)
    expect(gyroscopicMoment(C172S.rotInertiaKgM2, 0, 0.5, 0.5, { y: 0, z: 0 })).toEqual({ y: -0, z: 0 })
  })

  it('in flight: a sharp push-over yaws a Cub left, a pull-up right (rudder neutral)', () => {
    const yawAfter = (pitch: number): number => {
      const ac = new Aircraft(J3CUB)
      const tas = 60 * KT
      const t = trim({ tasMs: tas, altM: 600, massKg: ac.massKg, flapsDeg: 0, gammaRad: 0, params: J3CUB })
      ac.applyTrimState(tas, t.alphaRad, 600, 0, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
      ac.controls.throttle = 1
      for (let i = 0; i < 120; i++) ac.step(1 / 120) // settle at full power
      const r0 = ac.rates.z
      ac.controls.pitch = pitch
      for (let i = 0; i < 36; i++) ac.step(1 / 120) // 0.3 s
      return ac.rates.z - r0
    }
    // The gyroscopic yaw is the antisymmetric part; P-factor and slipstream
    // change too, so compare the two directions against each other.
    expect(yawAfter(-0.8) - yawAfter(0.8)).toBeLessThan(0)
  })
})
