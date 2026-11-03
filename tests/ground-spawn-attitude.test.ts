/**
 * Ground spawns start at rest on the struts. Tricycles used a fixed 0.03 rad
 * (+1.7°) attitude: the C172 rests at −1.3°, a PA-28 / C152 near −3.9°, so
 * every ground spawn began with a nod onto the nose wheel (up to 9° across
 * the fleet). The spawn now solves the strut equilibrium, including the
 * load shift as the attitude moves the contacts under the CG.
 */
import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import { rosterParams, ROSTER } from '../src/sim/aircraft/roster'
import { C172S } from '../src/sim/aircraft/c172s'
import { B738 } from '../src/sim/aircraft/b738'

const DT = 1 / 120

function settle(P: typeof C172S): { start: number; maxNod: number; moved: number } {
  const ac = new Aircraft(P)
  ac.engineRunning = false // no idle-thrust couple: pure static rest
  ac.spawnOnGround(0, 0, 0, 0)
  ac.controls.brakeLeft = ac.controls.brakeRight = 1
  ac.step(DT)
  const start = ac.data.pitchDeg
  let maxNod = 0
  for (let i = 0; i < 5 / DT; i++) {
    ac.step(DT)
    maxNod = Math.max(maxNod, Math.abs(ac.data.pitchDeg - start))
  }
  return { start, maxNod, moved: Math.hypot(ac.posNed.x, ac.posNed.y) }
}

describe('ground spawn attitude', () => {
  it('the C172 starts at its rest attitude: no nod onto the nose wheel', () => {
    const r = settle(C172S)
    expect(r.start).toBeLessThan(0) // nose slightly down on the struts, as before (it used to settle there)
    expect(r.maxNod).toBeLessThan(0.5)
    expect(r.moved).toBeLessThan(0.02)
  })

  it('every tricycle in the fleet starts within 1° of rest', () => {
    const fleet: Array<[string, typeof C172S]> = [['737', B738 as unknown as typeof C172S]]
    for (const r of ROSTER) {
      const P = rosterParams(r.spec.designator)!
      if (P.gear.nose && !P.gear.tail) fleet.push([r.spec.designator, P as unknown as typeof C172S])
    }
    expect(fleet.length).toBeGreaterThan(50)
    for (const [des, P] of fleet) expect(settle(P).maxNod, des).toBeLessThan(1)
  })
})
