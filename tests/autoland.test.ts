import { describe, expect, it } from 'vitest'
import {
  approachSpeedKt, autolandConfigFor, centerlineBankDeg, flareSinkFps, makeAutolandState, radioAltitudeFt, stepAutoland,
  type AutolandConfig, type AutolandInputs,
} from '../src/sim/autoland'
import { C172S } from '../src/sim/aircraft/c172s'
import { B738 } from '../src/sim/aircraft/b738'
import { J3CUB } from '../src/sim/aircraft/j3cub'

const jet = autolandConfigFor(B738)!
const ga = autolandConfigFor(C172S)!

function inputs(over: Partial<AutolandInputs> = {}): AutolandInputs {
  return {
    armed: true, locCaptured: true, gsCaptured: true, radioAltFt: 1000, iasKt: 145, tasKt: 150, alphaDeg: 5, groundSpeedKt: 145,
    verticalSpeedFpm: -740, pitchDeg: 2.5, rollDeg: 0, headingDeg: 298, trackDeg: 298, yawRateDegS: 0, onGround: false,
    courseDeg: 298, crossTrackM: 0, headwindKt: 0, throttle: 0.5, flapIndex: 0, gearDown: true,
    ...over,
  }
}

describe('autolandConfigFor', () => {
  it('is unavailable on taildraggers', () => {
    expect(autolandConfigFor(J3CUB)).toBeNull()
  })
  it('sets Vref = 1.3 × Vs0 and the right landing flaps', () => {
    expect(jet.vrefKt).toBeCloseTo(1.3 * B738.vSpeeds.vs0, 6)
    expect(B738.flapDetentsDeg[jet.finalFlapIndex]).toBeLessThanOrEqual(30)
    expect(B738.flapDetentsDeg[jet.finalFlapIndex]).toBeGreaterThanOrEqual(25)
    expect(ga.finalFlapIndex).toBe(C172S.flapDetentsDeg.length - 1)
  })
  it('only jets with reversers/spoilers use them', () => {
    expect(jet.reversers).toBe(true)
    expect(ga.reversers).toBe(false)
  })
})

describe('approachSpeedKt', () => {
  it('adds 5 kt plus half the headwind, capped at +10 for the wind', () => {
    expect(approachSpeedKt(140, 0)).toBe(145)
    expect(approachSpeedKt(140, 10)).toBe(150)
    expect(approachSpeedKt(140, 40)).toBe(155)
    expect(approachSpeedKt(140, -10)).toBe(145) // a tailwind never lowers it
  })
})

describe('flareSinkFps', () => {
  it('decays toward the touchdown sink as the ground nears', () => {
    expect(flareSinkFps(40, jet)).toBeGreaterThan(flareSinkFps(20, jet))
    expect(flareSinkFps(20, jet)).toBeGreaterThan(flareSinkFps(5, jet))
    expect(flareSinkFps(0, jet)).toBeCloseTo(jet.touchdownSinkFps, 6)
    expect(flareSinkFps(-3, jet)).toBeCloseTo(jet.touchdownSinkFps, 6)
  })
})

describe('centerlineBankDeg', () => {
  it('banks left when right of the centerline, right when left of it', () => {
    expect(centerlineBankDeg(15, 0, 140)).toBeLessThan(0)
    expect(centerlineBankDeg(-15, 0, 140)).toBeGreaterThan(0)
    expect(centerlineBankDeg(0, 0, 140)).toBeCloseTo(0, 6)
  })
  it('turns back when the track points away from the course', () => {
    expect(centerlineBankDeg(0, 2, 140)).toBeLessThan(0) // tracking right of course → bank left
    expect(centerlineBankDeg(0, -2, 140)).toBeGreaterThan(0)
  })
  it('is bounded to a gentle bank', () => {
    expect(Math.abs(centerlineBankDeg(500, 30, 140))).toBeLessThanOrEqual(8)
    expect(Math.abs(centerlineBankDeg(-500, -30, 140))).toBeLessThanOrEqual(8)
  })
})

describe('radioAltitudeFt', () => {
  it('is height above the wheels, not the CG', () => {
    const level = radioAltitudeFt(20, 0, B738)
    expect(level).toBeLessThan(20)
    expect(level).toBeCloseTo(20 - B738.gear.mainL.z / 0.3048, 0)
  })
  it('drops with nose-up pitch (the mains hang lower behind the CG)', () => {
    expect(radioAltitudeFt(20, 8, B738)).toBeLessThan(radioAltitudeFt(20, 0, B738))
  })
})

describe('stepAutoland state machine', () => {
  const dt = 1 / 60
  const step = (s = makeAutolandState(), i = inputs(), cfg: AutolandConfig = jet) => ({ s, o: stepAutoland(s, dt, i, cfg) })

  it('does nothing when not armed', () => {
    const { s, o } = step(makeAutolandState(), inputs({ armed: false }))
    expect(s.phase).toBe('OFF')
    expect(o.throttle).toBeNull()
    expect(o.pitchTargetDeg).toBeUndefined()
  })

  it('arms, then waits for both beams before taking anything', () => {
    const { s, o } = step(makeAutolandState(), inputs({ locCaptured: true, gsCaptured: false }))
    expect(s.phase).toBe('ARMED')
    expect(o.annunciation).toBe('LAND ARM')
    expect(o.throttle).toBeNull()
    expect(o.gearDown).toBe(false)
  })

  it('goes to LAND on LOC + GS capture and owns speed, gear and spoilers', () => {
    const { s, o } = step(makeAutolandState(), inputs({ radioAltFt: 1000 }))
    expect(s.phase).toBe('LAND')
    expect(o.annunciation).toBe('LAND')
    expect(o.gearDown).toBe(true)
    expect(o.throttle).not.toBeNull()
    expect(o.spoilerArm).toBe(true)
    expect(o.pitchTargetDeg).toBeUndefined() // the AP still flies the glideslope
  })

  it('steps flaps one detent at a time, only inside the limit speed', () => {
    const s = makeAutolandState()
    const fast = stepAutoland(s, dt, inputs({ iasKt: 200, flapIndex: 3 }), jet)
    expect(fast.flapIndex).toBeNull() // too fast for the next detent
    const s2 = makeAutolandState()
    const ok = stepAutoland(s2, dt, inputs({ iasKt: 150, flapIndex: 3 }), jet)
    expect(ok.flapIndex).toBe(4)
    // and not again for several seconds
    const again = stepAutoland(s2, dt, inputs({ iasKt: 150, flapIndex: 4 }), jet)
    expect(again.flapIndex).toBeNull()
  })

  it('falls back to ARMED, saying why, when a beam is lost above 100 ft', () => {
    const { s } = step(makeAutolandState(), inputs())
    const o = stepAutoland(s, dt, inputs({ gsCaptured: false, radioAltFt: 600 }), jet)
    expect(s.phase).toBe('ARMED')
    expect(o.message).toMatch(/GLIDESLOPE LOST/)
    expect(s.lostReason).toBe('GLIDESLOPE LOST')
  })

  it('keeps going below 100 ft even if the beam flickers', () => {
    const { s } = step(makeAutolandState(), inputs())
    stepAutoland(s, dt, inputs({ gsCaptured: false, locCaptured: false, radioAltFt: 80 }), jet)
    expect(s.phase).toBe('LAND')
  })

  it('flares when the exponential sink profile meets the current sink', () => {
    const { s } = step(makeAutolandState(), inputs())
    // 12 fps down: the profile equals it at (12 − 1.8)·τ ≈ 39 ft.
    stepAutoland(s, dt, inputs({ radioAltFt: 60, verticalSpeedFpm: -730 }), jet)
    expect(s.phase).toBe('LAND')
    const o = stepAutoland(s, dt, inputs({ radioAltFt: 38, verticalSpeedFpm: -730, pitchDeg: 2.6 }), jet)
    expect(s.phase).toBe('FLARE')
    expect(o.annunciation).toBe('LAND') // the flare is never shown on screen
    expect(o.pitchTargetDeg).toBeDefined()
    expect(o.maxBankDeg).toBe(5)
  })

  it('flare pitch rises (rate-limited) and respects the pitch ceiling', () => {
    const { s } = step(makeAutolandState(), inputs())
    stepAutoland(s, dt, inputs({ radioAltFt: 38, verticalSpeedFpm: -730, pitchDeg: 2.6 }), jet)
    let last = 2.6
    for (let k = 0; k < 600; k++) {
      const o = stepAutoland(s, dt, inputs({ radioAltFt: 20, verticalSpeedFpm: -700, pitchDeg: last, iasKt: 140 }), jet)
      expect(o.pitchTargetDeg!).toBeLessThanOrEqual(jet.maxFlarePitchDeg + 1e-9)
      expect(o.pitchTargetDeg! - last).toBeLessThanOrEqual(2.5 * dt * 60 + 1e-9) // never a step
      last = o.pitchTargetDeg!
    }
    expect(last).toBeGreaterThan(5)
  })

  it('retards the throttle to idle in the flare', () => {
    const { s } = step(makeAutolandState(), inputs({ throttle: 0.5 }))
    stepAutoland(s, dt, inputs({ radioAltFt: 38, verticalSpeedFpm: -730 }), jet)
    let o = stepAutoland(s, dt, inputs({ radioAltFt: 15, verticalSpeedFpm: -400 }), jet)
    for (let k = 0; k < 600; k++) o = stepAutoland(s, dt, inputs({ radioAltFt: 12, verticalSpeedFpm: -250 }), jet)
    expect(o.throttle).toBe(0)
  })

  it('touchdown → ROLLOUT: spoilers, reversers and brakes only after the nose settles; ends stopped on the runway', () => {
    const { s } = step(makeAutolandState(), inputs())
    stepAutoland(s, dt, inputs({ radioAltFt: 38, verticalSpeedFpm: -730 }), jet)
    let o = stepAutoland(s, dt, inputs({ radioAltFt: 0, onGround: true, verticalSpeedFpm: 0, groundSpeedKt: 140, pitchDeg: 7 }), jet)
    expect(s.phase).toBe('ROLLOUT')
    expect(o.message).toMatch(/ROLLOUT/)
    expect(o.brake).toBe(0)
    expect(o.maxBankDeg).toBe(0)
    expect(o.pitchTargetDeg!).toBeLessThanOrEqual(7)
    for (let k = 0; k < 120; k++) o = stepAutoland(s, dt, inputs({ radioAltFt: 0, onGround: true, verticalSpeedFpm: 0, groundSpeedKt: 135, pitchDeg: 1 }), jet)
    expect(o.reverse).toBe(true)
    expect(o.brake).toBeGreaterThan(0)
    expect(o.throttle).toBe(0)
    let handedBack: typeof o | null = null
    for (let k = 0; k < 400 && !handedBack; k++) {
      o = stepAutoland(s, dt, inputs({ radioAltFt: 0, onGround: true, verticalSpeedFpm: 0, groundSpeedKt: 3, pitchDeg: 0 }), jet)
      if (o.disconnect) handedBack = o
    }
    expect(s.phase).toBe('DONE')
    expect(handedBack).not.toBeNull() // a one-shot, so the app disconnects exactly once
    expect(handedBack!.brake).toBeGreaterThan(0) // the airplane is held still, not released
    expect(handedBack!.reverse).toBe(false)
    expect(handedBack!.message).toMatch(/AUTOLAND COMPLETE/)
    expect(stepAutoland(s, dt, inputs({ onGround: true, groundSpeedKt: 10 }), jet).disconnect).toBe(false)
  })

  it('light aircraft never ask for reversers', () => {
    const { s } = step(makeAutolandState(), inputs(), ga)
    stepAutoland(s, dt, inputs({ radioAltFt: 12, verticalSpeedFpm: -330, iasKt: 60, groundSpeedKt: 60 }), ga)
    let o = stepAutoland(s, dt, inputs({ radioAltFt: 0, onGround: true, verticalSpeedFpm: 0, groundSpeedKt: 55, pitchDeg: 6 }), ga)
    for (let k = 0; k < 200; k++) o = stepAutoland(s, dt, inputs({ radioAltFt: 0, onGround: true, groundSpeedKt: 50, pitchDeg: 0 }), ga)
    expect(o.reverse).toBe(false)
  })

  it('steers back to the centerline on the rollout (right of it → left rudder)', () => {
    const { s } = step(makeAutolandState(), inputs())
    stepAutoland(s, dt, inputs({ radioAltFt: 38, verticalSpeedFpm: -730 }), jet)
    const o = stepAutoland(s, dt, inputs({ radioAltFt: 0, onGround: true, groundSpeedKt: 100, crossTrackM: 6, pitchDeg: 1 }), jet)
    expect(o.yawCmd!).toBeLessThan(0)
    const o2 = stepAutoland(s, dt, inputs({ radioAltFt: 0, onGround: true, groundSpeedKt: 100, crossTrackM: -6, pitchDeg: 1 }), jet)
    expect(o2.yawCmd!).toBeGreaterThan(0)
  })

  it('disarming resets everything', () => {
    const { s } = step(makeAutolandState(), inputs())
    stepAutoland(s, dt, inputs({ armed: false }), jet)
    expect(s.phase).toBe('OFF')
    expect(s.lateralOwned).toBe(false)
  })

  it('takes over lateral tracking only low and near the centerline', () => {
    const far = step(makeAutolandState(), inputs({ radioAltFt: 1500 })).o
    expect(far.bankTargetDeg).toBeUndefined()
    const wide = step(makeAutolandState(), inputs({ radioAltFt: 600, crossTrackM: 300 })).o
    expect(wide.bankTargetDeg).toBeUndefined()
    const near = step(makeAutolandState(), inputs({ radioAltFt: 600, crossTrackM: 10 })).o
    expect(near.bankTargetDeg).toBeDefined()
    expect(near.bankTargetDeg!).toBeLessThan(0)
  })
})
