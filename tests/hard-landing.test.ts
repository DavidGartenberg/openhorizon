import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import { B738 } from '../src/sim/aircraft/b738'
import { KT } from '../src/sim/atmosphere'

/** A 737 just above the runway, level, at 140 kt, descending at `fpm`, gear as given. */
function arriving(fpm: number, gearDown = true): { ac: Aircraft; restZ: number } {
  const ac = new Aircraft(B738)
  ac.fuelKg = 6000
  ac.spawnOnGround(0, 0, 0, 0)
  for (let i = 0; i < 240; i++) ac.step(1 / 120)                   // settle on the gear
  const restZ = ac.posNed.z
  if (!gearDown) { ac.gearPos = 0; ac.gearDownCommanded = false }
  ac.posNed.z -= gearDown ? 1.5 : 3
  ac.velBody.x = 140 * KT
  ac.velBody.z = fpm / 196.850394                                  // body z is down
  ac.controls.throttle = 0
  return { ac, restZ }
}
const run = (ac: Aircraft, s: number): void => { for (let t = 0; t < s; t += 1 / 120) ac.step(1 / 120) }
const finite = (ac: Aircraft): boolean => [ac.posNed.x, ac.posNed.y, ac.posNed.z, ac.velBody.x, ac.velBody.z].every(Number.isFinite)

describe('hitting the ground hard does not stop the sim', () => {
  it('a firm 1,200 fpm touchdown is taken by the gear: no impact, the airplane rolls on', () => {
    const { ac } = arriving(1200)
    run(ac, 6)
    expect(ac.crashed).toBe(false); expect(ac.impactCount).toBe(0); expect(ac.data.groundSpeedKt).toBeGreaterThan(60)
  })

  it.each([2000, 3500, 6000])('a %i fpm touchdown bottoms the struts: held at the runway, reported, and the airplane rolls on', (fpm) => {
    const { ac, restZ } = arriving(fpm)
    run(ac, 6)
    expect(ac.crashed).toBe(false)
    expect(finite(ac)).toBe(true)
    expect(ac.impactCount).toBe(1)
    expect(ac.lastImpact?.kind).toBe('hard')
    expect(ac.lastImpact!.fpm).toBeGreaterThan(fpm * 0.5)
    expect(ac.data.onGround).toBe(true)
    expect(Math.abs(ac.posNed.z - restZ)).toBeLessThan(0.6)        // back on its gear, not through the runway
    expect(ac.data.groundSpeedKt).toBeGreaterThan(60)                // still rolling: the sim did not freeze
  })

  it('a normal touchdown is not reported as hard', () => {
    const { ac } = arriving(300)
    run(ac, 5)
    expect(ac.impactCount).toBe(0); expect(ac.crashed).toBe(false)
  })

  it('a gear-up landing slides on its belly to a stop instead of freezing', () => {
    const { ac } = arriving(600, false)
    run(ac, 40)
    expect(ac.crashed).toBe(false)
    expect(finite(ac)).toBe(true)
    expect(ac.lastImpact?.kind).toBe('belly')
    expect(ac.data.onGround).toBe(true)
    expect(ac.data.groundSpeedKt).toBeLessThan(5)
    expect(-ac.posNed.z).toBeGreaterThan(0.3)                         // resting on the belly, above the surface
  })

  it('the sim still keeps running after an impact: a new spawn clears the report', () => {
    const { ac } = arriving(2500)
    run(ac, 2)
    expect(ac.lastImpact).not.toBeNull()
    ac.spawnOnGround(0, 0, 0, 0)
    expect(ac.lastImpact).toBeNull()
  })
})
