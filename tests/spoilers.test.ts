import { describe, expect, it } from 'vitest'
import {
  GROUND_SPOILER_THRUST_CUTOFF, SPOILER_LAYOUTS, makeSpoilerPanels, panelAngleAt, spoilerFamilyFor, spoilerLayoutFor, stepSpoilers,
  type SpoilerInputs, type SpoilerPanels,
} from '../src/sim/spoilers'
import { Aircraft } from '../src/sim/aircraft'
import { B738 } from '../src/sim/aircraft/b738'
import { rosterParams } from '../src/sim/aircraft/roster'

const air: SpoilerInputs = { lever: 0, onGround: false, groundSpeedKt: 250, throttle: 0.6, reverse: false, flapsFrac: 0, roll: 0, kcas: 250 }
const ground: SpoilerInputs = { ...air, onGround: true, groundSpeedKt: 130, throttle: 0, kcas: 130 }

function run(s: SpoilerPanels, i: SpoilerInputs, seconds: number, dt = 1 / 60, onStep?: (t: number) => void): void {
  for (let t = 0; t < seconds; t += dt) { stepSpoilers(s, i, dt); onStep?.(t + dt) }
}

describe('which arrangement a type flies', () => {
  it('maps designators to families by manufacturer and size', () => {
    expect(spoilerFamilyFor('A320')).toBe('a320'); expect(spoilerFamilyFor('A21N')).toBe('a320'); expect(spoilerFamilyFor('BCS3')).toBe('a320')
    expect(spoilerFamilyFor('A332')).toBe('a330'); expect(spoilerFamilyFor('A339')).toBe('a330'); expect(spoilerFamilyFor('A343')).toBe('a330')
    expect(spoilerFamilyFor('A359')).toBe('a350'); expect(spoilerFamilyFor('A388')).toBe('a380')
    expect(spoilerFamilyFor('B738')).toBe('b737'); expect(spoilerFamilyFor('B77W')).toBe('wide'); expect(spoilerFamilyFor('B748')).toBe('wide')
    expect(spoilerFamilyFor('CRJ9')).toBe('regional'); expect(spoilerFamilyFor('E75L')).toBe('regional')
    expect(spoilerFamilyFor('C25A')).toBe('bizjet')
  })
  it('the A320 has five panels a wing, the A330 six and the A380 eight; ground uses every one, speedbrakes not the outermost', () => {
    expect(SPOILER_LAYOUTS.a320.panels).toHaveLength(5); expect(SPOILER_LAYOUTS.a330.panels).toHaveLength(6); expect(SPOILER_LAYOUTS.a380.panels).toHaveLength(8)
    for (const family of ['a320', 'a330', 'a350', 'a380'] as const) {
      const p = SPOILER_LAYOUTS[family].panels
      expect(p.every((x) => x.ground), family).toBe(true)
      expect(p[0]!.brake, family).toBe(false); expect(p[p.length - 1]!.brake, family).toBe(false)
      expect(p.filter((x) => x.brake).length, family).toBeGreaterThanOrEqual(3)
    }
  })
  it('every airliner of the roster that has spoilers has a family, and the 737 is a 737', () => {
    expect(B738.spoilers?.family).toBe('b737')
    for (const d of ['A320', 'A333', 'A388', 'B77W', 'CRJ9', 'A359']) expect(rosterParams(d)?.spoilers?.family, d).toBeDefined()
    expect(rosterParams('A333')?.spoilers?.family).toBe('a330')
  })
})

describe('ground spoilers', () => {
  it('rise as a cascade from the root outward: each panel starts after the one inboard, and the last is full in about a second and a half', () => {
    const s = makeSpoilerPanels(spoilerLayoutFor('a330'))
    const started: number[] = [], full: number[] = []
    run(s, { ...ground, lever: 1 }, 3, 1 / 120, (t) => s.left.forEach((a, k) => {
      if (started[k] === undefined && a > 0.5) started[k] = t
      if (full[k] === undefined && a >= s.layout.groundMaxDeg - 0.01) full[k] = t
    }))
    expect(started).toHaveLength(6); expect(full).toHaveLength(6)
    for (let k = 1; k < 6; k++) { expect(started[k]!).toBeGreaterThan(started[k - 1]!); expect(full[k]!).toBeGreaterThan(full[k - 1]!) }
    expect(started[5]! - started[0]!).toBeCloseTo(5 * s.layout.staggerS, 1)
    expect(full[5]!).toBeGreaterThan(1.2); expect(full[5]!).toBeLessThan(2.1)
    expect(s.left.every((a) => a === s.layout.groundMaxDeg)).toBe(true)
    expect(s.right).toEqual(s.left)
  })

  it('the aerodynamic share is 1 once they are full and passes through the middle on the way', () => {
    const s = makeSpoilerPanels(spoilerLayoutFor('a320'))
    let mid = false, last = 0
    run(s, { ...ground, lever: 1 }, 3, 1 / 120, () => { const r = stepSpoilers(s, { ...ground, lever: 1 }, 0); last = r.aeroFrac; if (r.aeroFrac > 0.3 && r.aeroFrac < 0.9) mid = true })
    expect(mid).toBe(true); expect(last).toBeCloseTo(1, 5)
  })

  it('come up with reverse thrust above 40 kt even if the lever was not touched, and not below it', () => {
    const s = makeSpoilerPanels(spoilerLayoutFor('a330'))
    run(s, { ...ground, reverse: true, groundSpeedKt: 120 }, 3)
    expect(s.ground).toBe(true); expect(s.left[0]).toBe(50)
    const slow = makeSpoilerPanels(spoilerLayoutFor('a330'))
    run(slow, { ...ground, reverse: true, groundSpeedKt: 30 }, 3)
    expect(slow.ground).toBe(false); expect(slow.left.every((a) => a === 0)).toBe(true)
  })

  it('retract when the thrust levers go forward (a go-around or takeoff), faster than a speedbrake moves, and all the way', () => {
    const s = makeSpoilerPanels(spoilerLayoutFor('a330'))
    run(s, { ...ground, lever: 1 }, 3)
    const t0 = s.left[0]!
    stepSpoilers(s, { ...ground, lever: 1, throttle: GROUND_SPOILER_THRUST_CUTOFF + 0.05 }, 0.5)
    expect(s.ground).toBe(false)
    expect(s.left[0]!).toBeLessThan(t0 - 8)
    run(s, { ...ground, lever: 1, throttle: 1 }, 3)
    expect(s.left.every((a) => a === 0)).toBe(true)
  })

  it('stay stowed in the air whatever the lever says about the ground', () => {
    const s = makeSpoilerPanels(spoilerLayoutFor('a330'))
    run(s, { ...air, lever: 1 }, 6)
    expect(s.ground).toBe(false)
    expect(s.left[0]).toBe(0); expect(s.left[5]).toBe(0)        // the inner and outer panels are not speedbrakes
  })
})

describe('speedbrakes in the air', () => {
  it('raise only the speedbrake panels, together, at a slower rate than the ground cascade (about three seconds to full)', () => {
    const s = makeSpoilerPanels(spoilerLayoutFor('a330'))
    let t80 = -1
    run(s, { ...air, lever: 1, kcas: 200 }, 6, 1 / 120, (t) => { if (t80 < 0 && s.left[2]! >= 0.8 * s.layout.flightMaxDeg) t80 = t })
    expect(s.left[0]).toBe(0); expect(s.left[5]).toBe(0)
    for (let k = 1; k <= 4; k++) expect(s.left[k]!).toBeCloseTo(s.layout.flightMaxDeg, 5)
    expect(t80).toBeGreaterThan(1.5); expect(t80).toBeLessThan(3)
    expect(s.right).toEqual(s.left)
  })

  it('follow the lever: half a lever is half the angle', () => {
    const s = makeSpoilerPanels(spoilerLayoutFor('a330'))
    run(s, { ...air, lever: 0.5, kcas: 200 }, 6)
    expect(s.left[2]!).toBeCloseTo(0.5 * s.layout.flightMaxDeg, 5)
  })

  it('are pushed back by the airflow at high speed (blowdown), by the share the family gives', () => {
    const slow = makeSpoilerPanels(spoilerLayoutFor('a330')), fast = makeSpoilerPanels(spoilerLayoutFor('a330'))
    run(slow, { ...air, lever: 1, kcas: 200 }, 6); run(fast, { ...air, lever: 1, kcas: 350 }, 6)
    expect(fast.left[2]!).toBeLessThan(slow.left[2]!)
    expect(fast.left[2]! / slow.left[2]!).toBeCloseTo(1 - fast.layout.blowdownShare, 3)
  })

  it('stow themselves on an Airbus when the flaps are full, but not on a 737, and not on the ground', () => {
    const a = makeSpoilerPanels(spoilerLayoutFor('a320')), b = makeSpoilerPanels(spoilerLayoutFor('b737'))
    run(a, { ...air, lever: 1, kcas: 200 }, 5); run(b, { ...air, lever: 1, kcas: 200 }, 5)
    expect(a.left[2]!).toBeGreaterThan(20); expect(b.left[2]!).toBeGreaterThan(20)
    run(a, { ...air, lever: 1, kcas: 140, flapsFrac: 1 }, 6); run(b, { ...air, lever: 1, kcas: 140, flapsFrac: 1 }, 6)
    expect(a.left[2]).toBe(0); expect(b.left[2]!).toBeGreaterThan(20)
  })

  it('a 737 raises all four panels; the aerodynamic share is 1 at full lever in still air and 0 stowed', () => {
    const s = makeSpoilerPanels(spoilerLayoutFor('b737'))
    run(s, { ...air, lever: 1, kcas: 180 }, 6)
    expect(s.left).toEqual([33, 33, 33, 33])
    expect(stepSpoilers(s, { ...air, lever: 1, kcas: 180 }, 0).aeroFrac).toBeCloseTo(1, 5)
    run(s, { ...air, lever: 0, kcas: 180 }, 6)
    expect(stepSpoilers(s, { ...air, kcas: 180 }, 0).aeroFrac).toBe(0)
  })
})

describe('roll spoilers', () => {
  it('rise on the wing the airplane rolls toward, on the roll panels only, and not at all inside the deadband', () => {
    const s = makeSpoilerPanels(spoilerLayoutFor('a330'))
    run(s, { ...air, roll: 0.08 }, 3)
    expect(s.left.concat(s.right).every((a) => a === 0)).toBe(true)
    run(s, { ...air, roll: 1 }, 6)
    expect(s.right[1]!).toBeCloseTo(s.layout.rollMaxDeg, 5); expect(s.right[5]!).toBeCloseTo(s.layout.rollMaxDeg, 5)
    expect(s.right[0]).toBe(0)                                  // not a roll panel
    expect(s.left.every((a) => a === 0)).toBe(true)
    run(s, { ...air, roll: -1 }, 6)
    expect(s.right.every((a) => a === 0)).toBe(true); expect(s.left[3]!).toBeCloseTo(s.layout.rollMaxDeg, 5)
  })

  it('add to a speedbrake that is already out, on the rolling side only', () => {
    const s = makeSpoilerPanels(spoilerLayoutFor('a330'))
    run(s, { ...air, lever: 1, kcas: 200, roll: 1 }, 6)
    expect(s.right[2]!).toBeGreaterThan(s.left[2]!); expect(s.left[2]!).toBeCloseTo(s.layout.flightMaxDeg, 5)
  })

  it('roll input does not change the airplane-wide share (the symmetric part)', () => {
    const s = makeSpoilerPanels(spoilerLayoutFor('a330'))
    run(s, { ...air, roll: 1 }, 5)
    expect(stepSpoilers(s, { ...air, roll: 1 }, 0).aeroFrac).toBe(0)
  })
})

describe('mapping a panel of an exterior model to the type\'s panels', () => {
  it('takes the nearest panel by position along the wing, so a cascade keeps its separate panels', () => {
    const v = [0, 10, 20, 30, 40]
    expect(panelAngleAt(v, 0)).toBe(0); expect(panelAngleAt(v, 1)).toBe(40); expect(panelAngleAt(v, 0.5)).toBe(20); expect(panelAngleAt(v, 0.26)).toBe(10)
    expect(panelAngleAt([7], 0.9)).toBe(7); expect(panelAngleAt([], 0.5)).toBe(0)
    expect(panelAngleAt(v, -3)).toBe(0); expect(panelAngleAt(v, 3)).toBe(40)
  })
})

describe('in the airplane', () => {
  it('an A330 has panels and an old single-actuator type does not', () => {
    expect(new Aircraft(rosterParams('A333')!).spoilerPanels?.layout.family).toBe('a330')
    expect(new Aircraft(B738).spoilerPanels?.layout.family).toBe('b737')
    const glider = rosterParams('AS21')!
    expect(new Aircraft(glider).spoilerPanels).toBeNull()
  })

  it('on the runway with the lever full, the cascade runs, spoilerPos reaches 1, and stowing the lever brings it back', () => {
    const a = new Aircraft(rosterParams('A333')!)
    a.spawnOnGround(0, 0, 0)
    a.engineRunning = true
    a.controls.throttle = 0
    a.spoilerCmd = 1
    const hist: number[] = []
    for (let i = 0; i < 360; i++) { a.step(1 / 120); hist.push(a.spoilerPos) }
    expect(a.data.onGround).toBe(true)
    expect(a.spoilerPanels!.ground).toBe(true)
    expect(a.spoilerPos).toBeCloseTo(1, 3)
    expect(hist.some((v) => v > 0.1 && v < 0.9)).toBe(true)
    a.spoilerCmd = 0
    for (let i = 0; i < 480; i++) a.step(1 / 120)
    expect(a.spoilerPos).toBeLessThan(0.05)
  })
})
