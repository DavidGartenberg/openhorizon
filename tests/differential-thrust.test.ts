import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import { rosterParams } from '../src/sim/aircraft/roster'
import { B738 } from '../src/sim/aircraft/b738'
import { engineArmM } from '../src/sim/aircraft/derive'

const wrap = (d: number): number => ((d + 540) % 360) - 180

function onRunway(designator = 'A333'): Aircraft {
  const a = new Aircraft(rosterParams(designator)!)
  a.spawnOnGround(0, 0, 0)
  a.engineRunning = true
  a.controls.brakeLeft = a.controls.brakeRight = 0
  return a
}
function split(a: Aircraft, left: number, right: number, reverseLeft = false, reverseRight = false): void {
  a.controls.throttle = (left + right) / 2
  a.throttleSplit = { left, right, reverseLeft, reverseRight }
  a.reverseCmd = reverseLeft || reverseRight
}
function run(a: Aircraft, seconds: number, each?: () => void): void {
  for (let t = 0; t < seconds; t += 1 / 120) { each?.(); a.step(1 / 120) }
}

describe('differential thrust', () => {
  it('with both levers together it is the old single engine model: same thrust, same N1, no yaw', () => {
    const a = onRunway(), b = onRunway()
    split(a, 0.7, 0.7); b.controls.throttle = 0.7
    run(a, 4); run(b, 4)
    expect(a.data.thrustN).toBeCloseTo(b.data.thrustN, 3)
    expect(a.data.n1Pct).toBeCloseTo(b.data.n1Pct, 6)
    expect(a.data.n1SidesPct[0]).toBeCloseTo(a.data.n1SidesPct[1], 9)
    expect(Math.abs(wrap(a.data.headingDeg - b.data.headingDeg))).toBeLessThan(1e-6)
  })

  it('more thrust on the left turns the airplane right on the ground, and on the right turns it left', () => {
    const right = onRunway(), left = onRunway()
    run(right, 20, () => split(right, 0.55, 0.05)); run(left, 20, () => split(left, 0.05, 0.55))
    const dR = wrap(right.data.headingDeg), dL = wrap(left.data.headingDeg)
    expect(dR).toBeGreaterThan(1); expect(dL).toBeLessThan(-1)                // the nosewheel's side grip resists, so it is slow
    expect(dR).toBeCloseTo(-dL, 1)
    expect(right.data.n1SidesPct[0]).toBeGreaterThan(right.data.n1SidesPct[1] + 20)
  })

  it('each side has its own reverser: ENG 1 in reverse with ENG 2 forward at idle deploys only the left sleeves and swings the nose left', () => {
    const a = onRunway()
    run(a, 15, () => split(a, 0.3, 0.3))                                    // rolling
    const h0 = a.data.headingDeg
    run(a, 3, () => split(a, 0.8, 0, true, false))
    expect(a.reversePosSides[0]).toBe(1); expect(a.reversePosSides[1]).toBe(0); expect(a.reversePos).toBe(1)
    expect(a.thrustSidesN[0]).toBeLessThan(0); expect(a.thrustSidesN[1]).toBeGreaterThan(0)
    expect(wrap(a.data.headingDeg - h0)).toBeLessThan(-0.05)
  })

  it('in the air, splitting the levers yaws the airplane toward the lower one', () => {
    const a = new Aircraft(B738)
    a.applyTrimState(130, 0.08, 1500, 0, 0, 0, 0.75, 85)
    run(a, 3, () => split(a, 1, 0.4))
    expect(wrap(a.data.headingDeg)).toBeGreaterThan(1)
    const b = new Aircraft(B738)
    b.applyTrimState(130, 0.08, 1500, 0, 0, 0, 0.75, 85)
    run(b, 3, () => split(b, 0.4, 1))
    expect(wrap(b.data.headingDeg)).toBeLessThan(-1)
  })

  it('an engine out yaws the airplane toward the dead engine in the air', () => {
    const a = new Aircraft(B738)
    a.applyTrimState(130, 0.08, 1500, 0, 0, 0, 0.75, 85)
    a.engineRunning = true
    a.jetSidePower = [1, 0]                                                 // ENG 2 (right) out
    run(a, 3, () => { a.controls.throttle = 0.9 })
    expect(a.thrustSidesN[1]).toBeLessThan(0)                               // the dead side drags
    expect(wrap(a.data.headingDeg)).toBeGreaterThan(1)                      // nose right, toward the dead engine
    expect(a.data.n1SidesPct[1]).toBeLessThan(a.data.n1SidesPct[0])
  })

  it('anything else that sets the throttle drives both sides together: a split that no longer matches is not used', () => {
    const a = onRunway()
    split(a, 0.2, 0.8)
    a.controls.throttle = 0.9                                                // autothrottle / keyboard after the levers
    run(a, 6)
    expect(a.data.n1SidesPct[0]).toBeCloseTo(a.data.n1SidesPct[1], 6)
    expect(Math.abs(wrap(a.data.headingDeg))).toBeLessThan(0.5)
  })

  it('reset puts both sides back to idle with the reversers stowed and no split', () => {
    const a = onRunway()
    run(a, 3, () => split(a, 0.9, 0, true, false))
    a.spawnOnGround(0, 0, 0)
    expect(a.reversePosSides).toEqual([0, 0]); expect(a.throttleSplit).toBeNull()
    expect(a.jetSides![0].n1Pct).toBe(a.jetSides![1].n1Pct)
  })

  it('the thrust lines sit where the engines are: wing twins, quads, rear-mounted', () => {
    expect(engineArmM('A333', 60.3, 2)).toBeCloseTo(8.7, 1)
    expect(engineArmM('B744', 64.4, 4)).toBeCloseTo(16.1, 1)
    expect(engineArmM('CRJ9', 24.9, 2)).toBeLessThan(2)
    expect(B738.jet?.armM).toBe(4.9)
    expect(rosterParams('A333')!.jet?.armM).toBeGreaterThan(8)
  })
})
