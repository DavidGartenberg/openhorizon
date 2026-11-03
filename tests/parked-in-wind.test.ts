/**
 * A parked, braked C172 in strong wind. Three aero shortcuts that are
 * harmless in flight rolled it over on the ramp:
 *  - lift used the full ½ρV² with the wind abeam (a straight wing lifts only
 *    on the in-plane flow, V²cos²β): 40 kt abeam lifted a third of its weight;
 *  - dihedral roll was linear in β all the way to ~1.2 rad;
 *  - α = atan2(w, max(u, 0.5)) read reversed flow (a tailwind) as flow from
 *    BELOW (α ≈ 85°), so flat-plate drag shoved it past its brakes and the
 *    pitching moment stood it on its nose.
 * The 24020G32KT +TSRA METAR of the browser sweep flipped it in seconds.
 */
import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import { C172S } from '../src/sim/aircraft/c172s'
import { WindModel } from '../src/sim/wind'
import { seededRandom } from '../src/sim/environment/rng'
import { computeAero, makeAeroOutput, alphaForMoment, type AeroInput } from '../src/sim/aero'
import { FT, KT } from '../src/sim/atmosphere'

const DT = 1 / 120

function parkedIn(fromDeg: number, kt: number, gustKt: number, intensity: number, seed: number, secs = 60) {
  const ac = new Aircraft(C172S)
  ac.spawnOnGround(0, 0, (304 * Math.PI) / 180, 0)
  ac.controls.brakeLeft = ac.controls.brakeRight = 1
  const w = new WindModel()
  w.rng = seededRandom(seed)
  w.setSteady(fromDeg, kt, gustKt)
  w.intensity = intensity
  let maxTilt = 0
  for (let i = 0; i < secs / DT; i++) {
    w.setFlightState(Math.max(ac.data.aglFt * FT, 0), ac.data.ktas * KT, C172S.spanM, ac.data.onGround)
    w.step(DT, ac.windNed)
    ac.step(DT)
    maxTilt = Math.max(maxTilt, Math.abs(ac.data.rollDeg), Math.abs(ac.data.pitchDeg))
  }
  return { maxTilt, moved: Math.hypot(ac.posNed.x, ac.posNed.y) }
}

describe('parked in strong wind', () => {
  it('rides out the 24020G32KT thunderstorm (severe turbulence) on its brakes', () => {
    for (const seed of [1, 2, 3]) {
      const r = parkedIn(240, 20, 32, 3, seed)
      expect(r.maxTilt, `seed ${seed}`).toBeLessThan(8)
      expect(r.moved, `seed ${seed}`).toBeLessThan(0.5)
    }
  })

  it('a 40-kt direct tailwind does not stand it on its nose', () => {
    const r = parkedIn((304 + 180) % 360, 40, 0, 0, 1)
    expect(r.maxTilt).toBeLessThan(8)
    expect(r.moved).toBeLessThan(0.5)
  })

  it('is not invulnerable: a 60-kt wind abeam still blows it over or across the ramp', () => {
    const r = parkedIn((304 - 90 + 360) % 360, 60, 0, 0, 1)
    expect(r.maxTilt > 25 || r.moved > 2).toBe(true)
  })
})

describe('aero at large sideslip and in reversed flow', () => {
  const base = (): AeroInput => ({
    rho: 1.225, vAir: 20, alpha: 0.08, beta: 0, alphaDot: 0, p: 0, q: 0, r: 0,
    elevatorRad: 0, aileronRad: 0, rudderRad: 0, flapsDeg: 0, thrustN: 0, propTorqueNm: 0, heightAglM: 1000,
  })

  it('lift follows the in-plane flow: cos²β', () => {
    const out0 = computeAero(base(), makeAeroOutput(), C172S)
    const cl0 = out0.cl
    const out = computeAero({ ...base(), beta: (70 * Math.PI) / 180 }, makeAeroOutput(), C172S)
    expect(out.cl / cl0).toBeCloseTo(Math.cos((70 * Math.PI) / 180) ** 2, 6)
  })

  it('the pitching moment is bounded and continuous through reversed flow (α = ±180°)', () => {
    const cmAt = (alpha: number): number => {
      const o = computeAero({ ...base(), alpha }, makeAeroOutput(), C172S)
      return o.moment.y / (0.5 * 1.225 * 400 * C172S.wingAreaM2 * C172S.chordM)
    }
    const eps = 1e-4
    expect(Math.abs(cmAt(Math.PI - eps) - cmAt(-Math.PI + eps))).toBeLessThan(0.01)
    for (let a = -Math.PI; a <= Math.PI; a += 0.05) expect(Math.abs(cmAt(a)), `α ${a.toFixed(2)}`).toBeLessThan(1.6)
    // Exact through the stall: the flight envelope is untouched.
    for (const a of [-0.3, 0, 0.1, 0.25, 0.5]) expect(alphaForMoment(a)).toBe(a)
    expect(alphaForMoment(Math.PI)).toBeCloseTo(0, 12)
  })

  it('reads a tailwind on the ramp as reversed flow, not as flow from below', () => {
    const ac = new Aircraft(C172S)
    ac.spawnOnGround(0, 0, 0, 0)
    ac.controls.brakeLeft = ac.controls.brakeRight = 1
    ac.windNed.x = 20 // air moving north, airplane facing north: 39 kt from behind
    for (let i = 0; i < 60; i++) ac.step(DT)
    expect(Math.abs(ac.data.alphaDeg)).toBeGreaterThan(150)
  })
})
