/**
 * §5.6 POH validation table — the contract's definition of "exact physics".
 * Headless closed-loop flights of the real sim (120 Hz), reading airspeeds
 * through the pitot calibration exactly as the panel would show them.
 * All at MTOW, ISA, sea level unless noted.
 */
import { describe, expect, it } from 'vitest'
import { Aircraft } from '../../src/sim/aircraft'
import { trim } from '../../src/sim/trim'
import { kcasFromKias, isa, casFromTas, kiasFromKcas, KT, FT } from '../../src/sim/atmosphere'
import { C172S } from '../../src/sim/aircraft/c172s'

const DT = 1 / 120

function mtowAircraft(): Aircraft {
  const ac = new Aircraft()
  ac.fuelKg = C172S.fuelCapacityKg
  ac.payloadKg = C172S.mtowKg - C172S.emptyMassKg - ac.fuelKg
  expect(ac.massKg).toBeCloseTo(C172S.mtowKg, 0)
  return ac
}

function fly(ac: Aircraft, seconds: number, control?: (ac: Aircraft, t: number) => void): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) {
    control?.(ac, i * DT)
    ac.step(DT)
  }
}

/** IAS-hold: hold the trimmed pitch attitude, nudged by speed error — the
 *  way a pilot actually flies Vy. Attitude inner loop with rate damping. */
function speedHold(targetKias: number, thetaTrimDeg: number) {
  let integralDeg = 0
  return (ac: Aircraft) => {
    const errKt = ac.data.kias - targetKias
    integralDeg = Math.min(Math.max(integralDeg + 0.25 * errKt * DT, -8), 8)
    const thetaCmdDeg =
      thetaTrimDeg + Math.min(Math.max(0.8 * errKt + integralDeg, -10), 6)
    const thetaErrDeg = thetaCmdDeg - ac.data.pitchDeg
    ac.controls.pitch = Math.min(Math.max(0.12 * thetaErrDeg - 3 * ac.rates.y, -0.8), 0.8)
  }
}

/** Wings-leveler + rudder coordination — the "pilot" that keeps open-loop
 *  tests from spiraling under torque/P-factor (which is real behavior). */
function coordinate(ac: Aircraft): void {
  const rollRad = (ac.data.rollDeg * Math.PI) / 180
  ac.controls.roll = Math.min(Math.max(-1.4 * rollRad - 0.4 * ac.rates.x, -1), 1)
  // +β (wind from the right) → right pedal to center the ball.
  const betaRad = (ac.data.betaDeg * Math.PI) / 180
  ac.controls.yaw = Math.min(Math.max(1.8 * betaRad - 0.9 * ac.rates.z, -1), 1)
}

/** Level-deceleration 1-g stall (the POH technique): start trimmed level,
 *  fade the throttle out over 3 s, hold vertical speed near zero with pitch
 *  as speed bleeds; return IAS at the break. */
function stallBreakKias(ac: Aircraft, trimThrottle: number): number {
  let stallKias = 0
  let pitchCmd = ac.controls.pitch
  fly(ac, 120, (a, t) => {
    a.controls.throttle = Math.max(trimThrottle * (1 - t / 3), 0)
    coordinate(a)
    const vs = a.data.verticalSpeedFpm
    const target = Math.min(Math.max(-0.0009 * vs - 2.5 * a.rates.y, -1), 1)
    pitchCmd += Math.min(Math.max(target - pitchCmd, -0.4 * DT), 0.4 * DT)
    a.controls.pitch = pitchCmd
    if (a.data.stallFraction > 0.5 && stallKias === 0) stallKias = a.data.kias
  })
  return stallKias
}

function trimInto(ac: Aircraft, kias: number, altFt: number, opts: { throttle?: number; gammaRad?: number; flapsDeg?: number }): ReturnType<typeof trim> {
  const flapsDeg = opts.flapsDeg ?? 0
  const kcas = kcasFromKias(kias, flapsDeg)
  const altM = altFt * FT
  const rho = isa(altM).densityKgM3
  const tas = kcas * KT * Math.sqrt(1.225 / rho)
  const t = trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg, gammaRad: opts.gammaRad, throttle: opts.throttle })
  expect(t.converged, `trim converged at ${kias} KIAS / ${altFt} ft`).toBe(true)
  ac.flapsDeg = flapsDeg
  ac.controls.flapsIndex = C172S.flapDetentsDeg.indexOf(flapsDeg as 0) >= 0 ? C172S.flapDetentsDeg.indexOf(flapsDeg as 0) : 0
  ac.applyTrimState(tas, t.alphaRad, altM, 0, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
  return t
}

describe('POH §5.6 validation — C172S at MTOW, ISA', () => {
  it('stalls clean at 48 KIAS ±2 (power idle, 1-g level deceleration)', () => {
    const ac = mtowAircraft()
    const t = trimInto(ac, 65, 3000, { gammaRad: 0 })
    const stallKias = stallBreakKias(ac, t.throttle)
    expect(stallKias, 'stall detected').toBeGreaterThan(0)
    expect(stallKias).toBeGreaterThanOrEqual(46)
    expect(stallKias).toBeLessThanOrEqual(50)
  })

  it('stalls at 40 KIAS ±2 with full flaps (power idle)', () => {
    const ac = mtowAircraft()
    const t = trimInto(ac, 55, 3000, { gammaRad: 0, flapsDeg: 30 })
    ac.controls.flapsIndex = 3
    const stallKias = stallBreakKias(ac, t.throttle)
    expect(stallKias, 'stall detected').toBeGreaterThan(0)
    expect(stallKias).toBeGreaterThanOrEqual(38)
    expect(stallKias).toBeLessThanOrEqual(42)
  })

  it('climbs 730 ±60 fpm at Vy (74 KIAS), sea level, full throttle', () => {
    const ac = mtowAircraft()
    const t = trimInto(ac, 74, 500, { throttle: 1 })
    const thetaTrimDeg = ((t.alphaRad + t.gammaRad) * 180) / Math.PI
    const hold = speedHold(74, thetaTrimDeg)
    fly(ac, 30, (a) => {
      a.controls.throttle = 1
      hold(a)
      coordinate(a)
    })
    // Average VS over a further 20 s of stabilized climb.
    const alt0 = ac.data.altitudeFt
    fly(ac, 20, (a) => {
      a.controls.throttle = 1
      hold(a)
      coordinate(a)
    })
    const vs = ((ac.data.altitudeFt - alt0) / 20) * 60
    // Guard: VS must be measured near Vy (airmanship tolerance ±5 kt).
    expect(ac.data.kias).toBeGreaterThan(69)
    expect(ac.data.kias).toBeLessThan(79)
    expect(vs).toBeGreaterThanOrEqual(670)
    expect(vs).toBeLessThanOrEqual(790)
  })

  it('cruises 124 ±4 KTAS at 8000 ft, full throttle (≈75% by Gagg-Ferrar)', () => {
    // At 8000 ft ISA a normally-aspirated IO-360 at full throttle/2700 makes
    // ≈75% power — that IS the POH 75%-cruise condition.
    const ac = mtowAircraft()
    const altM = 8000 * FT
    let lo = 45, hi = 75
    for (let i = 0; i < 40; i++) {
      const tas = (lo + hi) / 2
      const t = trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg: 0, gammaRad: 0 })
      if (t.throttle < 1 && t.rpm <= C172S.redlineRpm && t.converged) lo = tas
      else hi = tas
    }
    const tas = (lo + hi) / 2
    const t = trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg: 0, gammaRad: 0 })
    const powerFrac = t.shaftPowerW / C172S.ratedPowerW
    expect(powerFrac).toBeGreaterThan(0.68)
    expect(powerFrac).toBeLessThan(0.8)
    const ktas = tas / KT
    expect(ktas).toBeGreaterThanOrEqual(120)
    expect(ktas).toBeLessThanOrEqual(128)
  })

  it('tops out at ~126 ±4 KIAS in level flight at sea level (max continuous)', () => {
    const ac = mtowAircraft()
    // Level trim at full throttle, but never past the 2700 RPM redline.
    let lo = 55, hi = 75
    for (let i = 0; i < 30; i++) {
      const tas = (lo + hi) / 2
      const t = trim({ tasMs: tas, altM: 0, massKg: ac.massKg, flapsDeg: 0, gammaRad: 0 })
      const overRedline = t.rpm > C172S.redlineRpm
      if (t.throttle < 1 && !overRedline) lo = tas
      else hi = tas
    }
    const tas = (lo + hi) / 2
    const kcas = casFromTas(tas, isa(0).densityKgM3) / KT
    const kias = kiasFromKcas(kcas, 0)
    expect(kias).toBeGreaterThanOrEqual(122)
    expect(kias).toBeLessThanOrEqual(130)
  })

  it('glides ~9:1 ±0.8 at 68 KIAS, power idle', () => {
    const ac = mtowAircraft()
    const kcas = kcasFromKias(68, 0)
    const t = trim({ tasMs: kcas * KT, altM: 1500, massKg: ac.massKg, flapsDeg: 0, throttle: 0 })
    expect(t.converged).toBe(true)
    const ratio = -1 / Math.tan(t.gammaRad)
    expect(ratio).toBeGreaterThanOrEqual(8.2)
    expect(ratio).toBeLessThanOrEqual(9.8)
  })

  it('lifts off within 960 ft ±15% ground roll (SL, ISA, MTOW)', () => {
    const ac = mtowAircraft()
    ac.spawnOnGround(0, 0, 0)
    fly(ac, 2) // settle on gear
    const startN = ac.posNed.x
    let liftoffDist = 0
    fly(ac, 40, (a) => {
      a.controls.throttle = 1
      // Rotate at 55 KIAS.
      a.controls.pitch = a.data.kias >= 55 ? 0.35 : 0.05
      // Smooth heading-hold with rudder/steering (no bang-bang scrub).
      const hdgErr = a.data.headingDeg > 180 ? a.data.headingDeg - 360 : a.data.headingDeg
      a.controls.yaw = Math.min(Math.max(-0.04 * hdgErr - 6 * a.rates.z, -0.6), 0.6)
      if (!a.data.onGround && liftoffDist === 0 && a.data.kias > 40) {
        liftoffDist = (a.posNed.x - startN) / FT
      }
    })
    expect(liftoffDist, 'lifted off').toBeGreaterThan(0)
    expect(liftoffDist).toBeGreaterThanOrEqual(816)
    expect(liftoffDist).toBeLessThanOrEqual(1104)
  })

  it('stops within 575 ft ±15% with max braking (SL, ISA, MTOW, flaps 30)', () => {
    const ac = mtowAircraft()
    ac.spawnOnGround(0, 0, 0)
    ac.flapsDeg = 30
    ac.controls.flapsIndex = 3
    fly(ac, 2) // settle
    // Roll at touchdown speed (48 KCAS ≈ 41 KIAS flaps 30).
    const vTd = kcasFromKias(40, 30) * KT
    ac.velBody.x = vTd
    const startN = ac.posNed.x
    fly(ac, 40, (a) => {
      a.controls.throttle = 0
      a.controls.brakeLeft = 1
      a.controls.brakeRight = 1
      a.controls.pitch = 0
    })
    const rollFt = (ac.posNed.x - startN) / FT
    expect(ac.data.groundSpeedKt).toBeLessThan(1)
    expect(rollFt).toBeGreaterThanOrEqual(489)
    expect(rollFt).toBeLessThanOrEqual(661)
  })

  it('service ceiling ≈ 14,000 ft ±1,500 (climb crosses 100 fpm)', () => {
    const ac = mtowAircraft()
    const rateAt = (altFt: number): number => {
      const t = trim({
        tasMs: kcasFromKias(70, 0) * KT * Math.sqrt(1.225 / isa(altFt * FT).densityKgM3),
        altM: altFt * FT, massKg: ac.massKg, flapsDeg: 0, throttle: 1,
      })
      return Math.tan(t.gammaRad) * kcasFromKias(70, 0) * KT * Math.sqrt(1.225 / isa(altFt * FT).densityKgM3) * 196.85
    }
    expect(rateAt(12_500)).toBeGreaterThan(100)
    expect(rateAt(15_500)).toBeLessThan(100)
  })

  it('turns 2300–2400 static RPM at full throttle', () => {
    const ac = mtowAircraft()
    ac.spawnOnGround(0, 0, 0)
    fly(ac, 2)
    fly(ac, 6, (a) => {
      a.controls.throttle = 1
      a.controls.brakeLeft = 1
      a.controls.brakeRight = 1
    })
    expect(ac.data.rpm).toBeGreaterThanOrEqual(2300)
    expect(ac.data.rpm).toBeLessThanOrEqual(2400)
  })
})
