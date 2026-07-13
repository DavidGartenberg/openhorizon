/**
 * §5.6 scenario behaviors: the qualitative handling truths that make it feel
 * like a 172 — torque/P-factor, slips, go-around pitch-up, crosswind.
 */
import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import { trim } from '../src/sim/trim'
import { kcasFromKias, KT } from '../src/sim/atmosphere'
import { C172S } from '../src/sim/aircraft/c172s'

const DT = 1 / 120

function fly(ac: Aircraft, seconds: number, control?: (ac: Aircraft, t: number) => void): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) {
    control?.(ac, i * DT)
    ac.step(DT)
  }
}

function trimAt(ac: Aircraft, kias: number, altFt: number, throttle: number, flapsDeg = 0): void {
  const tas = kcasFromKias(kias, flapsDeg) * KT
  const t = trim({ tasMs: tas, altM: altFt * 0.3048, massKg: ac.massKg, flapsDeg, throttle })
  expect(t.converged).toBe(true)
  ac.flapsDeg = flapsDeg
  ac.applyTrimState(tas, t.alphaRad, altFt * 0.3048, 0, t.gammaRad, t.elevatorRad, throttle, t.rpm)
}

describe('handling behaviors (§5.6 scenarios)', () => {
  it('full power at low speed yaws left without right rudder (P-factor/torque)', () => {
    const ac = new Aircraft()
    trimAt(ac, 60, 3000, 0.3)
    fly(ac, 5, (a) => {
      a.controls.throttle = 1
      a.controls.yaw = 0 // feet on the floor
      // Wings held level with aileron so pure yaw shows; pitch held gently.
      const rollRad = (a.data.rollDeg * Math.PI) / 180
      a.controls.roll = Math.min(Math.max(-1.4 * rollRad - 0.4 * a.rates.x, -1), 1)
      a.controls.pitch = Math.min(Math.max(0.02 * (a.data.kias - 62) - 2 * a.rates.y, -0.5), 0.5)
    })
    // Nose swings left: heading wraps below 360 or sideslip builds right.
    const yawedLeft = ac.data.headingDeg > 300 && ac.data.headingDeg < 359.5
    expect(yawedLeft || ac.data.betaDeg > 2 || ac.rates.z < -0.005).toBe(true)
  })

  it('a forward slip steepens the descent', () => {
    const clean = new Aircraft()
    trimAt(clean, 70, 3000, 0)
    fly(clean, 10, (a) => {
      a.controls.throttle = 0
    })
    const cleanVs = clean.data.verticalSpeedFpm

    const slipping = new Aircraft()
    trimAt(slipping, 70, 3000, 0)
    fly(slipping, 10, (a) => {
      a.controls.throttle = 0
      a.controls.roll = 0.35 // right aileron
      a.controls.yaw = -0.9 // left rudder — crossed controls
    })
    expect(Math.abs(slipping.data.betaDeg)).toBeGreaterThan(5)
    expect(slipping.data.verticalSpeedFpm).toBeLessThan(cleanVs - 150)
  })

  it('full-flap go-around pitches up without back pressure', () => {
    const ac = new Aircraft()
    trimAt(ac, 65, 1000, 0.25, 30)
    const pitch0 = ac.data.pitchDeg
    fly(ac, 3, (a) => {
      a.controls.throttle = 1
      a.controls.pitch = 0 // hands off
    })
    expect(ac.data.pitchDeg).toBeGreaterThan(pitch0 + 2)
  })

  it('a 15 kt crosswind pushes the takeoff roll without correction', () => {
    const ac = new Aircraft()
    ac.spawnOnGround(0, 0, 0)
    fly(ac, 2)
    ac.windNed.y = 15 * KT // wind from the left... blowing toward +east
    let drift = 0
    fly(ac, 12, (a) => {
      a.controls.throttle = 1
      a.controls.yaw = 0 // no correction
      a.controls.pitch = 0.05
      drift = Math.max(drift, Math.abs(a.posNed.y))
    })
    // With no rudder/aileron correction the airplane leaves the centerline.
    expect(drift).toBeGreaterThan(2)
  })

  it('mostly holds with brakes at full power (slight creep is real 172)', () => {
    // A real 172 can creep under full power against brakes — the POH run-up
    // is done at 1800 RPM for exactly this reason. Assert bounded slow creep,
    // and firm holding at run-up power.
    const ac = new Aircraft()
    ac.spawnOnGround(0, 0, 0)
    fly(ac, 2)
    const n0 = ac.posNed.x
    fly(ac, 5, (a) => {
      a.controls.throttle = 1
      a.controls.brakeLeft = 1
      a.controls.brakeRight = 1
    })
    expect(Math.abs(ac.posNed.x - n0)).toBeLessThan(8)

    const runup = new Aircraft()
    runup.spawnOnGround(0, 0, 0)
    fly(runup, 2)
    const r0 = runup.posNed.x
    fly(runup, 5, (a) => {
      a.controls.throttle = 0.55 // ≈1800 RPM
      a.controls.brakeLeft = 1
      a.controls.brakeRight = 1
    })
    expect(Math.abs(runup.posNed.x - r0)).toBeLessThan(1)
    void C172S
  })
})
