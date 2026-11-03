/**
 * Gliders on a trimmed path. The trim solver's third unknown is the throttle,
 * which does nothing on a glider: the Jacobian was singular, the solve gave
 * up on its first iteration and returned its initial guess (α 1.7°, δe 0),
 * and a glider spawned on final entered a ±20° phugoid (−2,900 / +2,200 fpm,
 * "PULL UP"). Unpowered aircraft now hold the path on their airbrakes, and a
 * path they cannot fly (level flight) becomes their steady clean glide.
 */
import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import { rosterParams, ROSTER } from '../src/sim/aircraft/roster'
import { C172S } from '../src/sim/aircraft/c172s'
import { trim, stallTasMs } from '../src/sim/trim'
import { isa, KT } from '../src/sim/atmosphere'

const GLIDERS = ['AS21', 'LS8', 'DG80', 'DISC'] as const
const DT = 1 / 120

function finalOf(des: string) {
  const P = rosterParams(des)!
  const entry = ROSTER.find((r) => r.spec.designator === des)!
  // Same selection as main.ts's onFinal spawn.
  const flapsIndex = P.flaperons ? P.flapDetentsDeg.indexOf(13) : entry.spec.flapDetentsDeg.length - 1
  return { P, flapsIndex, flapsDeg: entry.spec.flapDetentsDeg[flapsIndex]!, kias: entry.spec.vSpeeds.approachKcas }
}

describe('glider trim', () => {
  for (const des of GLIDERS) {
    it(`${des}: a 3° final is trimmed on the airbrakes and flies hands-off`, () => {
      const { P, flapsIndex, flapsDeg, kias } = finalOf(des)
      const ac = new Aircraft(P)
      const altM = 300
      const tas = kias * KT * Math.sqrt(1.225 / isa(altM).densityKgM3)
      const t = trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg, gammaRad: -0.052, params: P })
      expect(t.converged).toBe(true)
      expect(t.throttle).toBe(0)
      expect(t.airbrake).toBeGreaterThan(0.05)
      expect(t.airbrake).toBeLessThan(0.6) // half airbrake or less: room both ways
      expect(t.gammaRad).toBeCloseTo(-0.052, 6)

      ac.resetFlaps(flapsIndex)
      ac.applyTrimState(tas, t.alphaRad, altM, 0, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
      ac.spoilerCmd = ac.spoilerPos = t.airbrake
      ac.step(DT)
      const vs0 = ac.data.verticalSpeedFpm, pitch0 = ac.data.pitchDeg
      let worstVs = 0, worstPitch = 0
      for (let i = 0; i < 40 / DT; i++) {
        ac.step(DT)
        worstVs = Math.max(worstVs, Math.abs(ac.data.verticalSpeedFpm - vs0))
        worstPitch = Math.max(worstPitch, Math.abs(ac.data.pitchDeg - pitch0))
      }
      expect(worstVs).toBeLessThan(30)
      expect(worstPitch).toBeLessThan(0.3)
      expect(ac.data.kias).toBeCloseTo(kias, 0)
    })
  }

  it('a path flatter than the glide (level flight) becomes the steady clean glide', () => {
    const P = rosterParams('LS8')!
    const ac = new Aircraft(P)
    const t = trim({ tasMs: 55 * KT, altM: 1000, massKg: ac.massKg, flapsDeg: 0, gammaRad: 0, params: P })
    expect(t.converged).toBe(true)
    expect(t.airbrake).toBe(0)
    // L/D ≈ 43 → about −1.3°; anywhere in a sane sailplane band.
    expect(t.gammaRad).toBeLessThan(-0.015)
    expect(t.gammaRad).toBeGreaterThan(-0.04)
  })

  it('powered aircraft still trim on the throttle with the airbrakes closed', () => {
    const t = trim({ tasMs: 70 * KT, altM: 300, massKg: 1100, flapsDeg: 10, gammaRad: -0.052, params: C172S })
    expect(t.converged).toBe(true)
    expect(t.airbrake).toBe(0)
    expect(t.throttle).toBeGreaterThan(0)
    expect(t.throttle).toBeLessThan(1)
  })
})

describe('sailplane clean CLmax', () => {
  it('stays physical: published (minimum wing loading) stalls no longer back-solve to CLmax > 2', () => {
    for (const des of GLIDERS) expect(rosterParams(des)!.clMaxClean, des).toBeLessThanOrEqual(1.65)
    // Ballasted LS8 at 525 kg: the manual's ≈80 km/h (43 kt).
    const vs = stallTasMs(525, 0, 0, rosterParams('LS8')!) / KT
    expect(vs).toBeGreaterThan(41)
    expect(vs).toBeLessThan(46)
    // The ASK 21 (stall quoted at MTOW) is untouched.
    expect(rosterParams('AS21')!.clMaxClean).toBeCloseTo(1.65, 1)
  })
})
