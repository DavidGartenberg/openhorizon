/**
 * §14 TCAS scripted-encounter tests (§24: alert at the correct tau ±1 s).
 * Geometries are driven point-mass style; the module under test sees only
 * position/velocity states, exactly what the sim feeds it.
 */
import { describe, expect, it } from 'vitest'
import { TcasComputer, sensitivityLevel, type TcasTrack } from '../src/sim/tcas'

interface Sim {
  ownN: number; ownE: number; ownAltFt: number; ownVsFpm: number
  ownVn: number; ownVe: number // m/s
  intN: number; intE: number; intAltFt: number; intVsFpm: number
  intVn: number; intVe: number
}

function run(sim: Sim, seconds: number, taOnly = false) {
  const tcas = new TcasComputer({ taOnly })
  let taAtS = -1
  let raAtS = -1
  let raSense: string | null = null
  let clearAtS = -1
  for (let t = 0; t < seconds; t += 1) {
    sim.ownN += sim.ownVn; sim.ownE += sim.ownVe
    sim.intN += sim.intVn; sim.intE += sim.intVe
    sim.ownAltFt += sim.ownVsFpm / 60
    sim.intAltFt += sim.intVsFpm / 60
    const track: TcasTrack = {
      id: 'X', relNorthM: sim.intN - sim.ownN, relEastM: sim.intE - sim.ownE,
      relVnMs: sim.intVn - sim.ownVn, relVeMs: sim.intVe - sim.ownVe,
      altFt: sim.intAltFt, vsFpm: sim.intVsFpm,
    }
    const out = tcas.step(1, { altFt: sim.ownAltFt, aglFt: sim.ownAltFt, vsFpm: sim.ownVsFpm }, [track])
    if (out.level === 'TA' && taAtS < 0) taAtS = t
    if (out.level === 'RA' && raAtS < 0) { raAtS = t; raSense = out.raSense ?? null }
    if (taAtS >= 0 && out.level === 'CLEAR' && clearAtS < 0) clearAtS = t
  }
  return { taAtS, raAtS, raSense, clearAtS }
}

describe('sensitivity levels (published table)', () => {
  it('maps altitude bands to TA/RA tau', () => {
    expect(sensitivityLevel(1500, 1500)).toEqual({ sl: 3, taTauS: 25, raTauS: 15 })
    expect(sensitivityLevel(4000, 4000)).toEqual({ sl: 4, taTauS: 30, raTauS: 20 })
    expect(sensitivityLevel(8000, 8000)).toEqual({ sl: 5, taTauS: 40, raTauS: 25 })
    expect(sensitivityLevel(15000, 15000)).toEqual({ sl: 6, taTauS: 45, raTauS: 30 })
    expect(sensitivityLevel(25000, 25000)).toEqual({ sl: 7, taTauS: 48, raTauS: 35 })
    expect(sensitivityLevel(800, 800).raTauS).toBeNull() // SL2: TA-only below 1000 AGL
  })
})

describe('scripted encounters', () => {
  it('head-on co-altitude at 8000 ft: TA at 40 s tau, RA at 25 s (±1 s)', () => {
    // Closure 120 m/s; start 6000 m apart → range/rate hits 40 s at t=10,
    // 25 s at t=25.
    const r = run({
      ownN: 0, ownE: 0, ownAltFt: 8000, ownVsFpm: 0, ownVn: 60, ownVe: 0,
      intN: 6000, intE: 0, intAltFt: 8000, intVsFpm: 0, intVn: -60, intVe: 0,
    }, 45)
    expect(Math.abs(r.taAtS - 10)).toBeLessThanOrEqual(1)
    expect(Math.abs(r.raAtS - 25)).toBeLessThanOrEqual(1)
  })

  it('RA sense: intruder below and climbing → own aircraft told to CLIMB', () => {
    const r = run({
      ownN: 0, ownE: 0, ownAltFt: 8000, ownVsFpm: 0, ownVn: 60, ownVe: 0,
      intN: 5000, intE: 0, intAltFt: 7500, intVsFpm: 500, intVn: -60, intVe: 0,
    }, 40)
    expect(r.raAtS).toBeGreaterThanOrEqual(0)
    expect(r.raSense).toBe('CLIMB')
  })

  it('slow overtake inside DMOD alerts even with long tau', () => {
    // 8 m/s closure at 1500 m: tau ≈ 188 s — but inside the SL5 TA DMOD.
    const r = run({
      ownN: 0, ownE: 0, ownAltFt: 8000, ownVsFpm: 0, ownVn: 60, ownVe: 0,
      intN: 1500, intE: 0, intAltFt: 8050, intVsFpm: 0, intVn: 52, intVe: 0,
    }, 30)
    expect(r.taAtS).toBeGreaterThanOrEqual(0)
  })

  it('diverging traffic never alerts; passing traffic clears', () => {
    const diverge = run({
      ownN: 0, ownE: 0, ownAltFt: 8000, ownVsFpm: 0, ownVn: 60, ownVe: 0,
      intN: 3000, intE: 0, intAltFt: 8000, intVsFpm: 0, intVn: 80, intVe: 0,
    }, 40)
    expect(diverge.taAtS).toBe(-1)
    const pass = run({
      ownN: 0, ownE: 0, ownAltFt: 8000, ownVsFpm: 0, ownVn: 60, ownVe: 0,
      intN: 4000, intE: 800, intAltFt: 9500, intVsFpm: 0, intVn: -60, intVe: 0,
    }, 80)
    if (pass.taAtS >= 0) expect(pass.clearAtS).toBeGreaterThan(pass.taAtS)
  })

  it('vertical separation gates the alert (ZTHR)', () => {
    const r = run({
      ownN: 0, ownE: 0, ownAltFt: 8000, ownVsFpm: 0, ownVn: 60, ownVe: 0,
      intN: 6000, intE: 0, intAltFt: 11000, intVsFpm: 0, intVn: -60, intVe: 0,
    }, 45)
    expect(r.taAtS).toBe(-1) // 3000 ft above, level — no threat
  })

  it('TA-only mode (C172 TAS presentation) never issues an RA', () => {
    const r = run({
      ownN: 0, ownE: 0, ownAltFt: 8000, ownVsFpm: 0, ownVn: 60, ownVe: 0,
      intN: 6000, intE: 0, intAltFt: 8000, intVsFpm: 0, intVn: -60, intVe: 0,
    }, 45, true)
    expect(r.taAtS).toBeGreaterThanOrEqual(0)
    expect(r.raAtS).toBe(-1)
  })
})
