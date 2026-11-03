/**
 * Static tyre friction (stick-slip). The low-speed tyre model was purely
 * viscous — force ∝ velocity — so any steady torque (the fin weathervaning in
 * a crosswind, idle prop effects) made a BRAKED, parked airplane creep round
 * forever: measured 34° in 50 s in a 12 kt quartering wind, 3° with no wind.
 */
import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import { WindModel } from '../src/sim/wind'

const DT = 1 / 120
const wrap = (d: number): number => ((d + 540) % 360) - 180

function parked(opts: { windKt: number; throttle?: number; brakes: number; secs?: number }) {
  const ac = new Aircraft()
  ac.spawnOnGround(0, 0, (304 * Math.PI) / 180, 0)
  ac.controls.throttle = opts.throttle ?? 0
  ac.controls.brakeLeft = opts.brakes
  ac.controls.brakeRight = opts.brakes
  const w = new WindModel()
  w.setSteady(210, opts.windKt) // quartering from the left front
  for (let t = 0; t < (opts.secs ?? 50); t += DT) {
    w.step(DT, ac.windNed)
    ac.step(DT)
  }
  return { hdg: wrap(ac.data.headingDeg - 304), moved: Math.hypot(ac.posNed.x, ac.posNed.y), gs: ac.data.groundSpeedKt }
}

describe('parked aircraft hold with brakes (static friction)', () => {
  it('a braked C172 in a 12 kt quartering wind holds heading and position', () => {
    const r = parked({ windKt: 12, brakes: 1 })
    expect(Math.abs(r.hdg)).toBeLessThan(1)
    expect(r.moved).toBeLessThan(0.3)
  })

  it('no wind, idle, brakes: no creep at all', () => {
    const r = parked({ windKt: 0, brakes: 1 })
    expect(Math.abs(r.hdg)).toBeLessThan(0.2)
    expect(r.moved).toBeLessThan(0.1)
  })

  it('the brakes hold a full-power run-up', () => {
    const r = parked({ windKt: 0, brakes: 1, throttle: 1, secs: 8 })
    expect(r.moved).toBeLessThan(0.5)
  })

  it('unbraked wheels still roll: idle thrust creeps the airplane forward', () => {
    const r = parked({ windKt: 0, brakes: 0, secs: 20 })
    expect(r.moved).toBeGreaterThan(1)
    expect(r.gs).toBeLessThan(15) // a taxi creep, not a takeoff
  })
})
