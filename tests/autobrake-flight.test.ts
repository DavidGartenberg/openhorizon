import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import { B738 } from '../src/sim/aircraft/b738'
import { AUTOBRAKE_TARGET_MS2, makeAutobrake, selectAutobrake, stepAutobrake, type AutobrakeSetting } from '../src/sim/autobrake'

const DT = 1 / 120
const KT = 0.514444

/** The real 737 on a runway: accelerate to `speedKt`, then run the autobrake. */
function rollout(setting: AutobrakeSetting, speedKt: number, opts: { spoilers?: boolean } = {}) {
  const ac = new Aircraft({ ...B738 })
  ac.spawnOnGround(0, 0, 0)
  ac.engineRunning = true
  ac.controls.throttle = 1
  ac.controls.flapsIndex = 2
  ac.controls.trim = 0.4
  const hold = (): void => {
    const d = ac.data
    ac.controls.yaw = Math.max(-0.7, Math.min(0.7, -(((d.headingDeg + 180) % 360) - 180) * 0.1))
  }
  let ab = selectAutobrake(makeAutobrake(), setting)
  const maxBrake = B738.brakeMu * 9.81 * 0.9
  const feed = (onGround: boolean, throttle: number): void => {
    ab = stepAutobrake(ab, {
      dt: DT, onGround, groundSpeedMs: ac.data.groundSpeedKt * KT, throttle, reverse: false, pilotBrake: 0,
      spoilerPos: ac.spoilerPos, maxBrakeDecelMs2: maxBrake,
    })
  }
  // Accelerate (a landing setting needs the airplane to have "flown": feed one airborne tick).
  if (setting !== 'rto') feed(false, 1)
  for (let t = 0; t < 120 && ac.data.groundSpeedKt < speedKt; t += DT) {
    hold(); feed(true, 1); ac.controls.brakeLeft = ac.controls.brakeRight = 0
    ac.step(DT)
  }
  const startKt = ac.data.groundSpeedKt
  ac.controls.throttle = 0
  if (opts.spoilers) ac.spoilerCmd = 1
  const samples: Array<{ t: number; v: number; demand: number; phase: string }> = []
  let x0 = ac.posNed.x, y0 = ac.posNed.y
  let dist = 0
  for (let t = 0; t < 90; t += DT) {
    hold(); feed(ac.data.onGround, 0)
    ac.controls.brakeLeft = ac.controls.brakeRight = ab.demand
    ac.step(DT)
    dist += Math.hypot(ac.posNed.x - x0, ac.posNed.y - y0); x0 = ac.posNed.x; y0 = ac.posNed.y
    samples.push({ t, v: ac.data.groundSpeedKt * KT, demand: ab.demand, phase: ab.phase })
    if (ac.data.groundSpeedKt < 1) break
  }
  return { startKt, samples, dist, ab, crashed: ac.crashed }
}

/** Mean deceleration (m/s²) between two speeds, from the speed trace. */
function meanDecel(samples: Array<{ t: number; v: number }>, hi: number, lo: number): number {
  const a = samples.find((s) => s.v <= hi)!, b = samples.find((s) => s.v <= lo)!
  return (a.v - b.v) / (b.t - a.t)
}

describe('autobrake on the real 737 model', () => {
  it('RTO: a rejected takeoff at 110+ kt stops the airplane hard and in a short distance', () => {
    const r = rollout('rto', 115)
    expect(r.crashed).toBe(false)
    expect(r.startKt).toBeGreaterThan(110)
    expect(r.samples.some((s) => s.phase === 'active')).toBe(true)
    const stopped = r.samples.at(-1)!
    expect(stopped.v).toBeLessThan(1)
    expect(r.dist).toBeLessThan(800) // ~59 m/s at ≈4 m/s² is ~430 m plus the ramp
    expect(meanDecel(r.samples, 50, 20)).toBeGreaterThan(3)
  })
  it.each(['1', '2', '3'] as const)('landing setting %s holds its own deceleration through the rollout', (setting) => {
    const r = rollout(setting, 135)
    expect(r.crashed).toBe(false)
    const target = AUTOBRAKE_TARGET_MS2[setting]
    // Idle-thrust drag helps a little, so the controller backs off to keep the target: within 12 %.
    const decel = meanDecel(r.samples, 55, 25)
    expect(decel).toBeGreaterThan(target * 0.88)
    expect(decel).toBeLessThan(target * 1.12)
  })
  it('higher settings stop the airplane in shorter distances', () => {
    const d1 = rollout('1', 135).dist, d2 = rollout('2', 135).dist, d3 = rollout('3', 135).dist
    expect(d1).toBeGreaterThan(d2); expect(d2).toBeGreaterThan(d3)
  })
  it('ground spoilers share the work: with the speedbrake up the brakes are used less', () => {
    const plain = rollout('2', 135), spoil = rollout('2', 135, { spoilers: true })
    const mean = (r: ReturnType<typeof rollout>): number => {
      const a = r.samples.filter((s) => s.phase === 'active' && s.v > 30)
      return a.reduce((x, s) => x + s.demand, 0) / Math.max(1, a.length)
    }
    expect(mean(spoil)).toBeLessThan(mean(plain))
  })
})
