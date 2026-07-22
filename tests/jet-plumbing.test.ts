/**
 * Phase 11e — jet/retract/Mach plumbing proven with a SYNTHETIC jet before
 * any real 737 numbers exist (keeps tuning risk out of the plumbing).
 */
import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import type { AircraftParams } from '../src/sim/aircraft/params'
import { CFM56_7B26 } from '../src/sim/turbofan'
import { computeAero, makeAeroOutput, type AeroInput } from '../src/sim/aero'
import { trim } from '../src/sim/trim'
import { isa, KT, FT } from '../src/sim/atmosphere'

const DT = 1 / 120

/** A plausible-but-fictional twin-jet: airliner-class numbers, no claims. */
const SYNTH_JET: AircraftParams = {
  wingAreaM2: 125, spanM: 34.3, chordM: 4.17, oswald: 0.75, aspectRatio: 9.4,
  emptyMassKg: 41_400, mtowKg: 79_000, fuelCapacityKg: 20_000,
  inertiaMtow: { ixx: 1.6e6, iyy: 3.3e6, izz: 4.8e6 },
  cl0: 0.1, clAlpha: 5.5, clMaxClean: 1.45, clMin: -0.8, clDe: 0.3, clQ: 4.5, clAlphaDot: 1.6,
  cd0: 0.021, cdBeta: 0.15, postStallCd: 1.9,
  cm0: 0.03, cmAlpha: -1.3, cmQ: -22, cmAlphaDot: -6, cmDe: -1.5,
  cyBeta: -0.6, cyP: -0.03, cyR: 0.3, cyDr: 0.18,
  clBeta: -0.12, clP: -0.5, clR: 0.12, clDa: 0.14, clDr: 0.01,
  cnBeta: 0.16, cnP: -0.03, cnR: -0.28, cnDa: -0.02, cnDr: -0.1,
  flapDetentsDeg: [0, 5, 15, 30], flapDCl0: [0, 0.25, 0.55, 0.95],
  flapDClMax: [0, 0.25, 0.45, 0.75], flapDCd: [0, 0.008, 0.025, 0.07],
  flapDCm: [0, -0.05, -0.12, -0.2], flapRateDegS: 3,
  elevatorMaxRad: 0.35, aileronMaxRad: 0.3, rudderMaxRad: 0.35, trimMaxRad: 0.2,
  stallBlendWidthRad: 0.03, postStallCmDrop: -0.5,
  // Piston block unused when `jet` is present (interface keeps it required
  // for simplicity — recorded).
  ratedPowerW: 1, ratedRadS: 1, redlineRpm: 1, idleTorqueFraction: 0,
  propDiameterM: 1, rotInertiaKgM2: 1, bsfcKgPerWs: 0,
  propCtTable: [[0, 0], [1, 0]], propCpTable: [[0, 0], [1, 0]],
  propwashTailFactor: 0, pFactorCn: 0,
  jet: CFM56_7B26,
  machModel: { mdd: 0.82, dragRiseK: 18 },
  gearRetractable: { transitS: 8, dCdExtended: 0.02 },
  gear: {
    nose: { x: 15.0, y: 0, z: 2.8, k: 2.2e6, c: 1.6e5, steerMaxRad: 0.6, maxNormalN: 5e5 },
    mainL: { x: -1.2, y: -3.4, z: 2.9, k: 5.5e6, c: 3.5e5, steerMaxRad: 0, maxNormalN: 1.4e6 },
    mainR: { x: -1.2, y: 3.4, z: 2.9, k: 5.5e6, c: 3.5e5, steerMaxRad: 0, maxNormalN: 1.4e6 },
  },
  rollingResistance: 0.015, brakeMu: 0.45, tireCorneringPerRad: 8, tireLatMuCap: 0.8,
  vSpeeds: { vs0: 108, vs1: 125, vx: 165, vy: 175, vfe10: 250, vfe30: 175, va: 270, vno: 320, vne: 340, glide: 210 },
}

function jetAt(massKg: number): Aircraft {
  const ac = new Aircraft(SYNTH_JET)
  ac.fuelKg = 10_000
  ac.payloadKg = massKg - SYNTH_JET.emptyMassKg - ac.fuelKg
  return ac
}

describe('jet/retract/Mach plumbing (11e, synthetic jet)', () => {
  it('trims level at 250 KTAS / 10,000 ft with mid-range N1', () => {
    const tas = 250 * KT
    const t = trim({ tasMs: tas, altM: 10_000 * FT, massKg: 60_000, flapsDeg: 0, gammaRad: 0, params: SYNTH_JET })
    expect(t.converged).toBe(true)
    expect(t.throttle).toBeGreaterThan(0.1)
    expect(t.throttle).toBeLessThan(0.9)
    expect(t.thrustN).toBeGreaterThan(20_000) // ~60 t at L/D ~15-18
    expect(t.thrustN).toBeLessThan(50_000)
  })

  it('flies the trim stably for 20 s (6-DOF jet loop closes)', () => {
    const ac = jetAt(60_000)
    const tas = 250 * KT
    const altM = 10_000 * FT
    const t = trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg: 0, gammaRad: 0, params: SYNTH_JET })
    ac.gearDownCommanded = false
    ac.gearPos = 0
    ac.applyTrimState(tas, t.alphaRad, altM, 0, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
    ac.step(DT) // mirror state into data before sampling the baseline
    const alt0 = ac.data.altitudeFt
    for (let i = 0; i < 20 * 120; i++) {
      // wings-level keeper only; pitch/throttle frozen at trim
      const rollRad = (ac.data.rollDeg * Math.PI) / 180
      ac.controls.roll = Math.min(Math.max(-1.4 * rollRad - 0.4 * ac.rates.x, -1), 1)
      ac.step(DT)
    }
    expect(Math.abs(ac.data.altitudeFt - alt0)).toBeLessThan(250)
    expect(Math.abs(ac.data.ktas - 250)).toBeLessThan(12)
    expect(ac.data.n1Pct).toBeGreaterThan(20)
    expect(ac.crashed).toBe(false)
  })

  it('extending the gear costs real energy (altitude+speed) vs a clean run', () => {
    // At frozen pitch the airplane trades altitude to hold speed, so the
    // honest metric is specific energy: h + V²/2g.
    const energyAfter = (gearDown: boolean): number => {
      const ac = jetAt(60_000)
      const tas = 250 * KT
      const altM = 10_000 * FT
      const t = trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg: 0, gammaRad: 0, params: SYNTH_JET })
      ac.gearDownCommanded = false
      ac.gearPos = 0
      ac.applyTrimState(tas, t.alphaRad, altM, 0, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
      if (gearDown) ac.gearDownCommanded = true
      for (let i = 0; i < 30 * 120; i++) {
        const rollRad = (ac.data.rollDeg * Math.PI) / 180
        ac.controls.roll = Math.min(Math.max(-1.4 * rollRad - 0.4 * ac.rates.x, -1), 1)
        ac.step(DT)
      }
      expect(ac.crashed).toBe(false)
      const v = ac.data.ktas * KT
      return ac.data.altitudeFt * FT + (v * v) / (2 * 9.80665)
    }
    const clean = energyAfter(false)
    const dirty = energyAfter(true)
    expect(clean - dirty).toBeGreaterThan(60) // ≥60 m specific energy in 30 s
  })

  it('gear transit takes the configured time (measured airborne)', () => {
    const ac = jetAt(60_000)
    const tas = 250 * KT
    const altM = 10_000 * FT
    const t = trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg: 0, gammaRad: 0, params: SYNTH_JET })
    ac.applyTrimState(tas, t.alphaRad, altM, 0, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
    ac.gearPos = 0
    ac.gearDownCommanded = true
    let tSec = 0
    for (; tSec < 15; tSec += DT) {
      ac.step(DT)
      if (ac.gearPos >= 1) break
    }
    expect(tSec).toBeGreaterThan(7)
    expect(tSec).toBeLessThan(9.5)
  })

  it('Mach drag rise appears past Mdd (pure aero check)', () => {
    const out = makeAeroOutput()
    const base: AeroInput = {
      rho: isa(35_000 * FT).densityKgM3, vAir: 230, alpha: 0.02, beta: 0, alphaDot: 0,
      p: 0, q: 0, r: 0, elevatorRad: 0, aileronRad: 0, rudderRad: 0, flapsDeg: 0,
      thrustN: 0, propTorqueNm: 0, heightAglM: 10_000,
    }
    computeAero({ ...base, mach: 0.6 }, out, SYNTH_JET)
    const cdSlow = out.cd
    computeAero({ ...base, mach: 0.86 }, out, SYNTH_JET)
    const cdFast = out.cd
    expect(cdFast - cdSlow).toBeGreaterThan(0.005) // 18·(0.04)² ≈ 0.029 minus PG-induced shifts
  })

  it('a dead jet windmills as drag (negative thrust), and belly contact crashes', () => {
    const ac = jetAt(60_000)
    const tas = 200 * KT
    const altM = 3000 * FT
    const t = trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg: 0, gammaRad: 0, params: SYNTH_JET })
    ac.gearPos = 0
    ac.gearDownCommanded = false
    ac.applyTrimState(tas, t.alphaRad, altM, 0, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
    ac.engineRunning = false
    for (let i = 0; i < 2 * 120; i++) ac.step(DT)
    expect(ac.data.thrustN).toBeLessThan(0)
    // Belly contact gear-up = crash (recorded simplification).
    const ac2 = jetAt(60_000)
    ac2.gearPos = 0
    ac2.gearDownCommanded = false
    ac2.applyTrimState(80, 0.05, 1, 0, 0, 0, 0.3, 40)
    for (let i = 0; i < 3 * 120 && !ac2.crashed; i++) ac2.step(DT)
    expect(ac2.crashed).toBe(true)
  })
})
