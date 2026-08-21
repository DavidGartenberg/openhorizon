/**
 * Fleet takeoff lattice (night-shift N4, triggered by N1): EVERY type in
 * the aircraft menu must fly — spawn on the ground, takeoff flaps, full
 * power, rotate at 1.2×Vs, climb away. No type may crash. Caught on
 * night one: the menu exposed roster jets that had only ever been
 * trim-validated in the air; the A350 crashed on its first ground roll.
 */
import { describe, expect, it } from 'vitest'
import { Aircraft } from '../../src/sim/aircraft'
import { ROSTER, rosterParams } from '../../src/sim/aircraft/roster'
import { J3CUB } from '../../src/sim/aircraft/j3cub'
import { B738 } from '../../src/sim/aircraft/b738'
import { C172S } from '../../src/sim/aircraft/c172s'
import type { AircraftParams } from '../../src/sim/aircraft/params'
const DT = 1 / 120

function takeoff(P: AircraftParams, label: string): { ok: boolean; why: string } {
  const ac = new Aircraft({ ...P })
  // Never take off overweight: some types (A340 class) exceed MTOW with
  // full tanks — defuel to 97% MTOW like a real dispatch would.
  if (ac.massKg > P.mtowKg * 0.97) {
    ac.fuelKg = Math.max(P.mtowKg * 0.97 - P.emptyMassKg, P.fuelCapacityKg * 0.2)
  }
  ac.spawnOnGround(0, 0, 0)
  ac.engineRunning = true
  ac.controls.mixture = 1
  ac.controls.throttle = 1
  // Takeoff flaps for jets/heavies only (GA singles use flaps 0 —
  // the C172 browser-proven technique).
  const heavy = !!P.trimIsStabilizer || P.mtowKg > 5000
  // Transports set a realistic MID takeoff detent (X-Plane-audit fix:
  // clean stalls are physical now, so rotating off the CLEAN Vs1 sent
  // heavies past their runway/energy budget — real jets rotate relative
  // to the FLAPPED stall of their takeoff config).
  const toIdx = P.trimIsStabilizer && P.flapDetentsDeg.length > 3
    ? Math.ceil((P.flapDetentsDeg.length - 1) / 2)
    : heavy && P.flapDetentsDeg.length > 1 ? 1 : 0
  ac.controls.flapsIndex = toIdx
  // Jets: takeoff stabilizer trim, like the real airplane.
  if (P.trimIsStabilizer) ac.controls.trim = 0.4
  const dClTo = P.flapDClMax[toIdx] ?? 0
  const vsConfig = P.vSpeeds.vs1 * Math.sqrt(P.clMaxClean / (P.clMaxClean + dClTo))
  const vr = Math.max(vsConfig * (P.trimIsStabilizer ? 1.15 : 1.2), 35)
  const isTaildragger = !P.gear.nose
  // Transports climb out at ~V2+10 ≈ 1.1×Vr (1.3× gave the 747 a
  // 235-kt target — the law pushed the nose down at 204 chasing it).
  const climbTgt = vr * (P.trimIsStabilizer ? 1.1 : 1.3)
  let rotated = false
  let airborne = false
  for (let t = 0; t < 180; t += DT) {
    const d = ac.data
    const hdgErr = -(((d.headingDeg + 180) % 360) - 180)
    ac.controls.yaw = Math.max(-0.7, Math.min(0.7, hdgErr * 0.1))
    // Wings level: without this the P-51's torque rolled it over on
    // liftoff (the harness never commanded aileron at all).
    ac.controls.roll = Math.max(-0.5, Math.min(0.5, -d.rollDeg * 0.05 - ac.rates.x * 8))
    if (!airborne && !d.onGround && d.aglFt > 3 && t > 1) airborne = true
    if (!rotated) {
      // Taildraggers: aft-stick schedule (the Cub contract's proven
      // technique). Tricycles: neutral until Vr.
      ac.controls.pitch = isTaildragger ? (d.kias < vr * 0.55 ? 0.25 : 0.14) : 0
      if (d.kias >= vr) rotated = true
    } else if (!airborne) {
      // Rotation force by class: transports need a firm pull against the
      // nose gear; a light single leaps off with a savage 0.5 and stalls.
      // Progressive: if she isn't flying 25 kt past Vr, pull harder.
      // Transports: firm flat pull (the 77W's nose breaks out ~25 kt
      // past Vr at 0.6 — a late progressive lost the race to the guard).
      ac.controls.pitch = P.trimIsStabilizer ? 0.6 : heavy ? 0.4 : 0.28
    } else {
      // Climb law: speed-by-pitch (FAST -> more aft stick to trade speed
      // for climb; the reversed sign pinned everything level at 3 ft) +
      // a climb objective (without the vs term
      // the attitude damping leveled everything at 3 ft accelerating to
      // the ground-impact guard) + attitude ceiling damping.
      ac.controls.pitch = Math.max(-0.05, Math.min(0.25,
        0.06 + (d.kias - climbTgt) * 0.006 + (700 - d.verticalSpeedFpm) * 0.00008
          - Math.max(0, d.pitchDeg - 12) * 0.012))
    }
    ac.step(DT)
    if (ac.crashed) return { ok: false, why: `${label}: crashed at ${Math.round(d.kias)} kt (rotated=${rotated}, airborne=${airborne})` }
    if (airborne && ac.data.aglFt > 300) return { ok: true, why: '' }
  }
  return { ok: false, why: `${label}: never reached 300 ft AGL (kias ${Math.round(ac.data.kias)}, rotated=${rotated})` }
}

describe('every menu aircraft takes off (N1 hard rule)', () => {
  it('study-level trio', () => {
    for (const [P, label] of [[C172S, 'C172S'], [J3CUB, 'J-3'], [B738, 'B738']] as const) {
      const r = takeoff(P as AircraftParams, label as string)
      expect(r.ok, r.why).toBe(true)
    }
  })
  for (const entry of ROSTER) {
    const d = entry.spec.designator
    it(`${d} — ${entry.spec.label}`, () => {
      if (entry.spec.powerplant.kind === 'none') return // gliders: no self-launch
      const P = rosterParams(d)!
      const r = takeoff(P, d)
      expect(r.ok, r.why).toBe(true)
    })
  }
})
