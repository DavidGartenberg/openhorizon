/**
 * Atmospheric boundary-layer wind: the METAR wind is measured at 10 m; the
 * log law thins it toward the ground, it strengthens to the gradient wind at
 * the boundary-layer top, and Ekman turning veers it with height (clockwise
 * in the northern hemisphere). The classic consequence: an airplane
 * descending into a headwind loses airspeed near the ground ("wind gradient").
 */
import { describe, expect, it } from 'vitest'
import { boundaryLayerProfile, WindModel } from '../src/sim/wind'
import { Aircraft } from '../src/sim/aircraft'
import { C172S } from '../src/sim/aircraft/c172s'
import { trim } from '../src/sim/trim'
import { isa, KT } from '../src/sim/atmosphere'

const GRASS = 0.03, SEA = 0.0002
const dirFrom = (n: number, e: number): number => ((Math.atan2(-e, -n) * 180) / Math.PI + 360) % 360

describe('boundary-layer wind profile', () => {
  it('reproduces the METAR wind exactly at 10 m', () => {
    for (const z0 of [GRASS, SEA, 0.5]) {
      const p = boundaryLayerProfile(10, z0, 37)
      expect(p.factor).toBeCloseTo(1, 12)
      expect(p.veerRad).toBe(0)
    }
  })

  it('follows the log law below 10 m (a parked wing sees ~60% of the reported wind)', () => {
    expect(boundaryLayerProfile(1, GRASS, 37).factor).toBeCloseTo(Math.log(1 / GRASS) / Math.log(10 / GRASS), 12)
    expect(boundaryLayerProfile(1, GRASS, 37).factor).toBeCloseTo(0.6, 1)
    expect(boundaryLayerProfile(2, GRASS, 37).factor).toBeLessThan(boundaryLayerProfile(5, GRASS, 37).factor)
  })

  it('strengthens monotonically to the gradient wind, ~1.6× over land and ~1.25× over the sea', () => {
    let prev = 0
    for (let z = 2; z <= 3000; z *= 1.2) {
      const f = boundaryLayerProfile(z, GRASS, 37).factor
      expect(f).toBeGreaterThanOrEqual(prev)
      prev = f
    }
    expect(boundaryLayerProfile(1000, GRASS, 37).factor).toBeCloseTo(1.61, 1)
    expect(boundaryLayerProfile(5000, GRASS, 37).factor).toBeCloseTo(boundaryLayerProfile(1000, GRASS, 37).factor, 12)
    expect(boundaryLayerProfile(600, SEA, 37).factor).toBeCloseTo(1.24, 1)
  })

  it('veers clockwise with height in the north, backs in the south', () => {
    const w = new WindModel()
    w.setSteady(270, 20)
    w.setSurface(GRASS, 37)
    const lo = w.steadyAt(10, { x: 0, y: 0 }), hi = w.steadyAt(1500, { x: 0, y: 0 })
    expect(dirFrom(lo.x, lo.y)).toBeCloseTo(270, 6)
    expect(dirFrom(hi.x, hi.y)).toBeCloseTo(300, 1) // 30° of Ekman veer over land
    w.setSurface(GRASS, -34)
    const south = w.steadyAt(1500, { x: 0, y: 0 })
    expect(dirFrom(south.x, south.y)).toBeCloseTo(240, 1)
    w.setSurface(SEA, 37)
    const sea = w.steadyAt(1500, { x: 0, y: 0 })
    expect(dirFrom(sea.x, sea.y)).toBeCloseTo(282, 1)
  })

  it('calm stays calm, and without a surface the wind is the same at every height (legacy)', () => {
    const calm = new WindModel()
    calm.setSurface(GRASS, 37)
    calm.setFlightState(300, 50, 11)
    const out = { x: 0, y: 0, z: 0 }
    calm.step(0.01, out)
    expect([out.x, out.y]).toEqual([0, 0])
    const legacy = new WindModel()
    legacy.setSteady(270, 20)
    legacy.setFlightState(1500, 50, 11)
    legacy.step(0.01, out)
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(20 * KT, 9)
  })

  it('descending into a headwind: ground speed rises as it thins, and airspeed sags near the ground (wind gradient)', () => {
    const clamp = (v: number, a: number, b: number): number => Math.min(Math.max(v, a), b)
    // Steady wind only (no turbulence), wings and heading held as the default
    // assist does, so the profile is the only difference between the runs.
    const approach = (profiled: boolean): { gsTop: number; gsLow: number; iasLow: number } => {
      const ac = new Aircraft(C172S)
      const w = new WindModel()
      w.setSteady(0, 25) // headwind for a north-bound approach
      if (profiled) w.setSurface(GRASS, 37)
      const windAt = (h: number): void => { const s = w.steadyAt(h, { x: 0, y: 0 }); ac.windNed.x = s.x; ac.windNed.y = s.y; ac.windNed.z = 0 }
      const altM = 120
      windAt(altM)
      const tas = 70 * KT * Math.sqrt(1.225 / isa(altM).densityKgM3)
      const t = trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg: 10, gammaRad: -0.09, params: C172S })
      ac.resetFlaps(1)
      ac.applyTrimState(tas, t.alphaRad, altM, 0, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
      const DT = 1 / 120
      let gsTop = 0
      for (let i = 0; i < 400 / DT && -ac.posNed.z > 8; i++) {
        windAt(-ac.posNed.z)
        ac.controls.roll = clamp(-0.6 * (ac.data.rollDeg * Math.PI) / 180 - 0.3 * ac.rates.x, -0.35, 0.35)
        const err = ((((ac.data.headingDeg + 180) % 360) - 180) * Math.PI) / 180
        ac.controls.yaw = clamp(-2 * err - 0.8 * ac.rates.z, -0.4, 0.4)
        ac.step(DT)
        if (i === Math.round(2 / DT)) gsTop = ac.data.groundSpeedKt
      }
      return { gsTop, gsLow: ac.data.groundSpeedKt, iasLow: ac.data.kias }
    }
    const uniform = approach(false), gradient = approach(true)
    expect(Math.abs(uniform.gsLow - uniform.gsTop)).toBeLessThan(1.5)
    expect(gradient.gsLow - gradient.gsTop).toBeGreaterThan(5) // the headwind falls off near the ground
    expect(gradient.iasLow - uniform.iasLow).toBeLessThan(-1.5) // the wind-gradient airspeed loss
  })
})
