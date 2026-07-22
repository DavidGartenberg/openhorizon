/**
 * 737-800 validation table (Phase 11f) — Tier A, honest tolerances against
 * published anchors (FCTM-class Vref tables, cruise burn, climb capability).
 * Same closed-loop methodology as the C172/Cub suites. IAS = CAS (no
 * published position-error table wired — disclosed).
 */
import { describe, expect, it } from 'vitest'
import { Aircraft } from '../../src/sim/aircraft'
import { trim } from '../../src/sim/trim'
import { isa, KT, FT } from '../../src/sim/atmosphere'
import { B738 } from '../../src/sim/aircraft/b738'
import { fuelFlowKgS, CFM56_7B26 } from '../../src/sim/turbofan'
import { TawsComputer } from '../../src/sim/taws'

const DT = 1 / 120

function b738At(massKg: number): Aircraft {
  const ac = new Aircraft(B738)
  ac.fuelKg = 8000
  ac.payloadKg = massKg - B738.emptyMassKg - ac.fuelKg
  expect(ac.massKg).toBeCloseTo(massKg, 0)
  return ac
}

function coordinate(ac: Aircraft): void {
  const rollRad = (ac.data.rollDeg * Math.PI) / 180
  ac.controls.roll = Math.min(Math.max(-1.4 * rollRad - 0.4 * ac.rates.x, -1), 1)
}

/** Flaps-30 1-g deceleration stall; returns CAS at the break. */
function stallKcasFlaps30(massKg: number): number {
  const ac = b738At(massKg)
  const altM = 5000 * FT
  const rho = isa(altM).densityKgM3
  // Start 1.35×Vs estimate, flaps 30, gear down, level.
  const vsEst = Math.sqrt((2 * massKg * 9.80665) / (1.225 * B738.wingAreaM2 * (B738.clMaxClean + 0.8)))
  const tas = 1.35 * vsEst * Math.sqrt(1.225 / rho)
  const t = trim({ tasMs: tas, altM, massKg, flapsDeg: 30, gammaRad: 0, params: B738, extraCd: 0.02 })
  expect(t.converged).toBe(true)
  ac.flapsDeg = 30
  ac.controls.flapsIndex = 5
  ac.applyTrimState(tas, t.alphaRad, altM, 0, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
  // 1-g level deceleration (the certification technique): hold VS near zero
  // with pitch as speed bleeds; the stabilizer supplies the authority to
  // reach the break at ~1 g.
  let stallKias = 0
  let pitchCmd = ac.controls.pitch
  const steps = Math.round(200 / DT)
  for (let i = 0; i < steps; i++) {
    const tt = i * DT
    ac.controls.throttle = Math.max(t.throttle * (1 - tt / 3), 0)
    coordinate(ac)
    const vs = ac.data.verticalSpeedFpm
    const target = Math.min(Math.max(-0.0009 * vs - 2.5 * ac.rates.y, -1), 1)
    pitchCmd += Math.min(Math.max(target - pitchCmd, -0.4 * DT), 0.4 * DT)
    ac.controls.pitch = pitchCmd
    ac.step(DT)
    if (ac.data.stallFraction > 0.5 && stallKias === 0) {
      stallKias = ac.data.kias
      break
    }
  }
  expect(stallKias, 'stall detected').toBeGreaterThan(0)
  return stallKias
}

describe('737-800 validation — published anchors, honest tolerances', () => {
  it('Vref30 (1.23·Vs30) at 60 t is 140 kt ±5', () => {
    const vref = 1.23 * stallKcasFlaps30(60_000)
    expect(vref).toBeGreaterThanOrEqual(135)
    expect(vref).toBeLessThanOrEqual(145)
  })

  it('Vref30 at 70 t is ~151 kt ±5 (√weight scaling emerges)', () => {
    const vref = 1.23 * stallKcasFlaps30(70_000)
    expect(vref).toBeGreaterThanOrEqual(146)
    expect(vref).toBeLessThanOrEqual(156)
  })

  it('FL350 M0.785 cruise at 65 t burns 2.4 t/h ±10%', () => {
    const altM = 35_000 * FT
    const air = isa(altM)
    const tas = 0.785 * air.speedOfSoundMs
    const t = trim({ tasMs: tas, altM, massKg: 65_000, flapsDeg: 0, gammaRad: 0, params: B738 })
    expect(t.converged).toBe(true)
    const ffKgH = fuelFlowKgS(t.thrustN, 0.785, CFM56_7B26) * 3600
    expect(ffKgH).toBeGreaterThan(2_160)
    expect(ffKgH).toBeLessThan(2_640)
    // And the implied L/D is in the published 16–17 class.
    const ld = (65_000 * 9.80665) / t.thrustN
    expect(ld).toBeGreaterThan(14.5)
    expect(ld).toBeLessThan(18.5)
  })

  it('climbs ≥2,000 fpm at 250 KCAS / FL100 / 65 t (full thrust)', () => {
    const altM = 10_000 * FT
    const rho = isa(altM).densityKgM3
    const tas = 250 * KT * Math.sqrt(1.225 / rho)
    const t = trim({ tasMs: tas, altM, massKg: 65_000, flapsDeg: 0, throttle: 1, params: B738 })
    expect(t.converged).toBe(true)
    const vsFpm = Math.sin(t.gammaRad) * tas * 196.85
    expect(vsFpm).toBeGreaterThanOrEqual(2_000)
  })

  it('flies a 20 s stable cruise leg in the 6-DOF (not just the trim solver)', () => {
    const ac = b738At(65_000)
    const altM = 35_000 * FT
    const tas = 0.785 * isa(altM).speedOfSoundMs
    const t = trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg: 0, gammaRad: 0, params: B738 })
    ac.gearDownCommanded = false
    ac.gearPos = 0
    ac.applyTrimState(tas, t.alphaRad, altM, 0, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
    ac.step(DT)
    const alt0 = ac.data.altitudeFt
    for (let i = 0; i < 20 * 120; i++) {
      coordinate(ac)
      ac.step(DT)
    }
    expect(Math.abs(ac.data.altitudeFt - alt0)).toBeLessThan(400)
    expect(ac.crashed).toBe(false)
    expect(ac.data.n1Pct).toBeGreaterThan(60) // real cruise N1 territory
  })

  it('GPWS jet profile: gear-up approach calls TOO LOW GEAR; gear-down is silent', () => {
    const flyApproach = (gearDown: boolean): string[] => {
      const taws = new TawsComputer()
      const heard: string[] = []
      // Scripted 3° descent from 800 AGL at 140 kt toward a runway.
      for (let agl = 800; agl > 5; agl -= 6) {
        const out = taws.step(0.5, {
          aglFt: agl, altFt: agl + 13, vsFpm: -700, gsKt: 140, headingDeg: 280,
          rollDeg: 0, flapsDeg: 30, sinceTakeoffS: 1e9,
          terrainAheadFt: () => 0, nearRunwayFinal: true, gsDeviation: 0,
          jetProfile: true, gearDown,
        })
        if (out.newAural && out.aural) heard.push(out.aural)
      }
      return heard
    }
    const gearUp = flyApproach(false)
    expect(gearUp).toContain('TOO LOW, GEAR')
    const normal = flyApproach(true)
    expect(normal).not.toContain('TOO LOW, GEAR')
    // Normal approach still gets the jet cadence, in order.
    const cadence = normal.filter((w) => ['FIFTY', 'FORTY', 'THIRTY', 'TWENTY', 'TEN'].includes(w))
    expect(cadence).toEqual(['FIFTY', 'FORTY', 'THIRTY', 'TWENTY', 'TEN'])
  })
})
