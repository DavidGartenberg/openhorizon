/**
 * Proper prop-effect physics (user goal: "fix the physics of all the
 * planes with proper thrust and P[-factor]"). Replaces the old
 * coefficient hack (pFactorCn·T/qS with a q-floor, an alpha-mix floor,
 * and per-type inflow ramps) with terms derived from thrust, torque, and
 * momentum-theory inflow:
 *
 *  - Disk axial velocity: vDisk = ½(V + √(V² + 2T/ρA)) — momentum theory.
 *  - P-factor yaw: N = kP·T·R·(V·sinα)/vDisk — asymmetric blade loading
 *    needs CROSSFLOW (V·sinα) relative to the disk's own inflow; at V=0
 *    the inflow is purely axial and P-factor vanishes BY PHYSICS (the old
 *    model needed a hand-tuned ramp for this).
 *  - Slipstream swirl on the fin: torque conservation gives the swirl
 *    velocity ṁ·r̄·vswirl = Q, and the fin side-force folds to
 *    N ≈ kS·Q — linear in engine torque, present at static (real runups
 *    do push the tail), bounded.
 */
import { describe, expect, it } from 'vitest'
import { diskAxialVMs, pFactorYawNm, swirlYawNm, propEffectsYawNm } from '../src/sim/prop-effects'

const RHO = 1.225
const D172 = 1.93

describe('momentum-theory disk velocity', () => {
  it('static: pure induced flow, well above zero', () => {
    const v = diskAxialVMs(2200, 0, RHO, D172)
    expect(v).toBeGreaterThan(10) // ~19 m/s for a C172 at static thrust
    expect(v).toBeLessThan(30)
  })
  it('fast flight: approaches V', () => {
    const v = diskAxialVMs(500, 60, RHO, D172)
    expect(v).toBeGreaterThan(60)
    expect(v).toBeLessThan(66)
  })
  it('zero thrust: equals V', () => {
    expect(diskAxialVMs(0, 50, RHO, D172)).toBeCloseTo(50, 6)
  })
})

describe('P-factor', () => {
  it('vanishes at zero forward speed regardless of thrust/alpha', () => {
    expect(pFactorYawNm(1, 2200, 0, 0.16, RHO, D172) === 0).toBe(true)
  })
  it('vanishes at zero alpha', () => {
    expect(Math.abs(pFactorYawNm(1, 1500, 40, 0, RHO, D172))).toBe(0)
  })
  it('left yaw (negative), growing with alpha and speed', () => {
    const slow = pFactorYawNm(1, 1500, 30, 0.08, RHO, D172)
    const fast = pFactorYawNm(1, 1500, 45, 0.08, RHO, D172)
    const steep = pFactorYawNm(1, 1500, 30, 0.14, RHO, D172)
    expect(slow).toBeLessThan(0)
    expect(fast).toBeLessThan(slow)
    expect(steep).toBeLessThan(slow)
  })
})

describe('swirl', () => {
  it('left yaw, linear in torque, present at static', () => {
    expect(swirlYawNm(0.6, 300)).toBeCloseTo(-180, 6)
    expect(swirlYawNm(0.6, 150)).toBeCloseTo(-90, 6)
    expect(Math.abs(swirlYawNm(0.6, 0))).toBe(0)
  })
})

describe('C172 calibration anchor (kP/kS reproduce the audited cruise moment)', () => {
  // Bench audit (lateral-stability work): 110 KIAS / 75% / 3,000 ft gave
  // total prop yaw −236.8 N·m at T=1094 N, Q=317.7 N·m, TAS 55.6 m/s,
  // α=1.05°. The old model's alpha-floor share (0.4/0.4915) attributes
  // −192.7 N·m to swirl → kS = 0.607; the remainder −44.1 N·m to
  // P-factor at that condition → kP solved there. This keeps the cruise
  // moment (and its alpha-slope scale) the AP law was re-tuned against.
  it('total at the audited cruise point ≈ −236.8 N·m', () => {
    const total = propEffectsYawNm(
      { pFactorK: 2.397, swirlK: 0.607 },
      1094, 317.7, 55.6, (1.05 * Math.PI) / 180, RHO * 0.915, D172,
    )
    expect(total).toBeGreaterThan(-250)
    expect(total).toBeLessThan(-224)
  })
  it('static full power: swirl only, about half the old hacked static moment', () => {
    const total = propEffectsYawNm({ pFactorK: 2.397, swirlK: 0.607 }, 2200, 330, 0, 0.16, RHO, D172)
    expect(total).toBeCloseTo(-0.607 * 330, 3) // pure torque swirl, no P-factor
  })
})
