/**
 * C172 hands-off lateral character (user: "it glides to the side when it
 * should be flying forward"). Physics contract after the slipstream fixes
 * (swirl roll recovery + fin offset in tail q, rig re-derived):
 *  - approach power (the regime the rig now nulls) flies straight;
 *  - cruise drift stays a gentle spiral either side of the null point;
 *  - an idle glide still wants a touch of left rudder (real airplane —
 *    the fin offset persists without prop moments to cancel), but far
 *    less than before (40° bank in 40 s → ≤35°);
 *  - a full-power Vy climb honestly rolls LEFT hands-off (documented open
 *    item: the P-factor gain is cruise-calibrated and reads strong at Vy).
 * The default-on SAS in main.ts (yaw damper + gentle wing leveler on
 * untouched axes) is what makes hands-off flight docile for the user; it
 * is verified in-browser, this file pins the raw physics.
 */
import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import { trim } from '../src/sim/trim'
import { kcasFromKias, KT, isa } from '../src/sim/atmosphere'

const DT = 1 / 120
const wrap = (d: number) => ((d + 540) % 360) - 180

function handsOff(kias: number, throttle: number | null, altFt: number, secs: number) {
  const ac = new Aircraft()
  const altM = altFt * 0.3048
  const tas = kcasFromKias(kias, 0) * KT * Math.sqrt(1.225 / isa(altM).densityKgM3)
  const t = throttle === null
    ? trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg: 0, gammaRad: 0 })
    : trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg: 0, throttle })
  expect(t.converged).toBe(true)
  ac.applyTrimState(tas, t.alphaRad, altM, 0, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
  let maxBank = 0
  let bankAtEnd = 0
  for (let s = 0; s <= secs; s += DT) {
    ac.step(DT)
    maxBank = Math.max(maxBank, Math.abs(ac.data.rollDeg))
    bankAtEnd = ac.data.rollDeg
  }
  return { hdg: wrap(ac.data.headingDeg), maxBank, bankAtEnd }
}

describe('C172 hands-off lateral character', () => {
  it('approach power (75 KIAS, 30%) flies straight for 40 s', () => {
    const r = handsOff(75, 0.3, 1500, 40)
    expect(Math.abs(r.hdg)).toBeLessThan(8)
    expect(r.maxBank).toBeLessThan(3)
  })

  it('cruise either side of the rig null stays a gentle spiral (≤8° bank in 40 s)', () => {
    expect(handsOff(110, null, 3000, 40).maxBank).toBeLessThan(8)
    expect(handsOff(100, null, 2500, 40).maxBank).toBeLessThan(8)
  })

  it('idle glide rolls gently RIGHT (fin offset uncancelled — real), well under the old 40°', () => {
    const r = handsOff(68, 0, 2500, 40)
    expect(r.bankAtEnd).toBeGreaterThan(0) // right, like the real airplane
    expect(r.maxBank).toBeLessThan(35)
  })

  it('full-power Vy climb rolls LEFT hands-off (P-factor/swirl — documented open item on magnitude)', () => {
    const r = handsOff(74, 1.0, 1000, 10)
    expect(r.bankAtEnd).toBeLessThan(0)
  })
})
