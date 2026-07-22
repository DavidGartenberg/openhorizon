/**
 * J-3 Cub validation table (Phase 11c) — Tier A, honest tolerances against
 * published J3C-65 figures. Same closed-loop 120 Hz methodology as the C172
 * POH suite. The Cub has no pitot-calibration table (IAS = CAS, disclosed),
 * so speed rows are stated in CAS: the famous "38 mph indicated" stall is
 * ~42 mph ≈ 36.5 kt CAS with the type's real high-α position error.
 */
import { describe, expect, it } from 'vitest'
import { Aircraft } from '../../src/sim/aircraft'
import { trim } from '../../src/sim/trim'
import { isa, KT, FT } from '../../src/sim/atmosphere'
import { J3CUB } from '../../src/sim/aircraft/j3cub'

const DT = 1 / 120

function grossCub(): Aircraft {
  const ac = new Aircraft(J3CUB)
  ac.fuelKg = J3CUB.fuelCapacityKg
  ac.payloadKg = J3CUB.mtowKg - J3CUB.emptyMassKg - ac.fuelKg
  expect(ac.massKg).toBeCloseTo(J3CUB.mtowKg, 0)
  return ac
}

function fly(ac: Aircraft, seconds: number, control?: (ac: Aircraft, t: number) => void): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) {
    control?.(ac, i * DT)
    ac.step(DT)
  }
}

function coordinate(ac: Aircraft): void {
  const rollRad = (ac.data.rollDeg * Math.PI) / 180
  ac.controls.roll = Math.min(Math.max(-1.4 * rollRad - 0.4 * ac.rates.x, -1), 1)
  const betaRad = (ac.data.betaDeg * Math.PI) / 180
  ac.controls.yaw = Math.min(Math.max(1.8 * betaRad - 0.9 * ac.rates.z, -1), 1)
}

function trimInto(ac: Aircraft, kcas: number, altFt: number, opts: { throttle?: number; gammaRad?: number }): ReturnType<typeof trim> {
  const altM = altFt * FT
  const rho = isa(altM).densityKgM3
  const tas = kcas * KT * Math.sqrt(1.225 / rho)
  const t = trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg: 0, gammaRad: opts.gammaRad, throttle: opts.throttle, params: J3CUB })
  expect(t.converged, `trim converged at ${kcas} KCAS / ${altFt} ft`).toBe(true)
  ac.applyTrimState(tas, t.alphaRad, altM, 0, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
  return t
}

describe('J-3 Cub validation — gross weight, ISA', () => {
  it('stalls clean at ~36.5 KCAS ±3 (power idle, 1-g deceleration)', () => {
    const ac = grossCub()
    const t = trimInto(ac, 50, 3000, { gammaRad: 0 })
    let stallKias = 0
    let pitchCmd = ac.controls.pitch
    fly(ac, 120, (a, tt) => {
      a.controls.throttle = Math.max(t.throttle * (1 - tt / 3), 0)
      coordinate(a)
      const vs = a.data.verticalSpeedFpm
      const target = Math.min(Math.max(-0.0009 * vs - 2.5 * a.rates.y, -1), 1)
      pitchCmd += Math.min(Math.max(target - pitchCmd, -0.4 * DT), 0.4 * DT)
      a.controls.pitch = pitchCmd
      if (a.data.stallFraction > 0.5 && stallKias === 0) stallKias = a.data.kias
    })
    expect(stallKias, 'stall detected').toBeGreaterThan(0)
    expect(stallKias).toBeGreaterThanOrEqual(33.5)
    expect(stallKias).toBeLessThanOrEqual(39.5)
  })

  it('cruises 63–70 KCAS at ~2150 RPM (75 mph book cruise)', () => {
    const ac = grossCub()
    const t = trimInto(ac, 65, 2000, { gammaRad: 0 })
    expect(t.rpm).toBeGreaterThanOrEqual(2000)
    expect(t.rpm).toBeLessThanOrEqual(2250)
    expect(t.throttle).toBeLessThan(0.92) // level cruise isn't full throttle
    // Hold it 30 s hands-off-ish: speed stays in the cruise band.
    fly(ac, 30, (a) => coordinate(a))
    expect(ac.data.kias).toBeGreaterThan(60)
    expect(ac.data.kias).toBeLessThan(72)
  })

  it('climbs ~450 fpm ±80 at Vy 52 KCAS, full throttle, sea level', () => {
    const ac = grossCub()
    const t = trimInto(ac, 52, 200, { throttle: 1 })
    expect(t.gammaRad).toBeGreaterThan(0)
    const vsFpm = Math.sin(t.gammaRad) * 52 * KT * Math.sqrt(1.225 / isa(200 * FT).densityKgM3) * 196.85
    expect(vsFpm).toBeGreaterThanOrEqual(370)
    expect(vsFpm).toBeLessThanOrEqual(530)
  })

  it('rests three-point at the geometric attitude (~9° nose-up) and stays put', () => {
    const ac = grossCub()
    ac.spawnOnGround(0, 0, 0, 0)
    fly(ac, 3) // settle on the struts
    expect(ac.data.pitchDeg).toBeGreaterThan(6.5)
    expect(ac.data.pitchDeg).toBeLessThan(11.5)
    expect(ac.data.onGround).toBe(true)
    expect(Math.abs(ac.data.groundSpeedKt)).toBeLessThan(0.5)
    expect(ac.crashed).toBe(false)
  })

  it('ground-loops: tail-up wheel landing at 38 kt, feet asleep, diverges past 25°', () => {
    // The classic entry: wheel-landing speed, tail flying (no stabilizing
    // tailwheel contact), a small touchdown swerve (3°/s), and no rudder.
    // Mains ahead of the CG make this yaw-divergent as the fin dies with
    // speed — emergent from the gear geometry, not scripted. (Probed: same
    // entry three-point at 20 kt with stick back deviates <5° — docile.)
    const ac = grossCub()
    ac.spawnOnGround(0, 0, 0, 0)
    ac.velBody.x = 38 * KT
    ac.rates.z = 0.05 // ~3°/s touchdown swerve
    let maxDev = 0
    fly(ac, 10, (a) => {
      a.controls.yaw = 0 // frozen feet
      a.controls.pitch = -0.15 // forward stick, tail up (wheel-landing attitude)
      a.controls.throttle = 0
      let dev = a.data.headingDeg
      if (dev > 180) dev -= 360
      maxDev = Math.max(maxDev, Math.abs(dev))
    })
    expect(maxDev).toBeGreaterThan(25)
  })

  it('the SAME entry with active rudder stays straight (it IS controllable)', () => {
    const ac = grossCub()
    ac.spawnOnGround(0, 0, 0, 0)
    ac.velBody.x = 38 * KT
    ac.rates.z = 0.05
    let maxDev = 0
    fly(ac, 10, (a) => {
      let dev = a.data.headingDeg
      if (dev > 180) dev -= 360
      a.controls.yaw = Math.min(Math.max(-dev * 0.12 - a.rates.z * 2.2, -1), 1)
      a.controls.pitch = -0.15 // same wheel-landing attitude
      a.controls.throttle = 0
      maxDev = Math.max(maxDev, Math.abs(dev))
    })
    expect(maxDev).toBeLessThan(12)
    expect(ac.crashed).toBe(false)
  })

  it('three-point rollout with stick back is docile even with the same swerve', () => {
    const ac = grossCub()
    ac.spawnOnGround(0, 0, 0, 0)
    ac.velBody.x = 20 * KT
    ac.rates.z = 0.05
    let maxDev = 0
    fly(ac, 10, (a) => {
      a.controls.yaw = 0
      a.controls.pitch = 0.25 // stick back, tailwheel planted
      a.controls.throttle = 0
      let dev = a.data.headingDeg
      if (dev > 180) dev -= 360
      maxDev = Math.max(maxDev, Math.abs(dev))
    })
    expect(maxDev).toBeLessThan(10)
  })
})
