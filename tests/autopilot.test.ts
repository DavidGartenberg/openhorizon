import { describe, expect, it } from 'vitest'
import {
  makeAutopilotState, stepAutopilot, disconnect, gainScale, altsLeadFt,
  MAX_BANK_DEG, SERVO_RATE_PER_S, GAIN_REF_IAS_KT,
  type AutopilotState, type AutopilotInputs, type LateralMode, type VerticalMode,
} from '../src/sim/autopilot'

/** Baseline inputs: wings level, altitude/heading hold at current value,
 *  AP engaged, no nav deviation. Individual tests override only what they
 *  need. */
function baseInputs(overrides: Partial<AutopilotInputs> = {}): AutopilotInputs {
  return {
    iasKt: 100,
    altitudeFt: 3000,
    verticalSpeedFpm: 0,
    headingDeg: 0,
    pitchDeg: 0,
    rollDeg: 0,
    masterEnabled: true,
    lateralMode: 'ROL',
    verticalMode: 'PIT',
    headingBugDeg: 0,
    altitudeBugFt: 3000,
    vsTargetFpm: 0,
    iasTargetKt: 100,
    bankCommandDeg: 0,
    pitchCommandDeg: 0,
    navDeviation: 0,
    glideslopeDeviation: 0,
    ...overrides,
  }
}

/**
 * Minimal first-order-lag test plant: NOT the real `Aircraft`/flight model
 * (deliberately, so this test doesn't couple to the whole flight-dynamics
 * stack). Roll rate moves toward a target proportional to `rollCmd`, pitch
 * rate similarly toward a target proportional to `pitchCmd`; heading
 * derives from roll (a standard-rate-ish turn), altitude/VS from pitch, and
 * IAS drifts slowly toward a value set by pitch (steeper pitch = slower),
 * so FLC/ALT/VS closed loops all have something to converge against.
 */
class TestPlant {
  rollDeg = 0
  pitchDeg = 0
  headingDeg = 0
  altitudeFt = 3000
  verticalSpeedFpm = 0
  iasKt = 100

  step(dt: number, rollCmd: number, pitchCmd: number): void {
    const targetRoll = rollCmd * 30 // full deflection -> 30 deg bank steady state
    this.rollDeg += (targetRoll - this.rollDeg) * Math.min(1, dt * 1.5)
    const targetPitch = pitchCmd * 15
    this.pitchDeg += (targetPitch - this.pitchDeg) * Math.min(1, dt * 1.5)

    // Turn: heading rate proportional to bank (small-angle, good enough for a test plant).
    this.headingDeg = (this.headingDeg + this.rollDeg * 0.5 * dt + 360) % 360

    // Climb: VS proportional to pitch attitude, with a first-order lag.
    const targetVs = this.pitchDeg * 100 // 100 fpm per deg of pitch
    this.verticalSpeedFpm += (targetVs - this.verticalSpeedFpm) * Math.min(1, dt * 1.0)
    this.altitudeFt += (this.verticalSpeedFpm / 60) * dt

    // Airspeed bleeds off with positive pitch, builds with negative pitch.
    const targetIas = 100 - this.pitchDeg * 2
    this.iasKt += (targetIas - this.iasKt) * Math.min(1, dt * 0.5)
  }
}

function runClosedLoop(
  state: AutopilotState,
  plant: TestPlant,
  inputsFor: (plant: TestPlant) => AutopilotInputs,
  steps: number,
  dt = 0.1,
): void {
  for (let i = 0; i < steps; i++) {
    const inputs = inputsFor(plant)
    stepAutopilot(state, dt, inputs)
    plant.step(dt, state.rollCmd, state.pitchCmd)
  }
}

describe('ROL mode', () => {
  it('commands roll toward a stepped bank target and converges', () => {
    const state = makeAutopilotState()
    const plant = new TestPlant()
    runClosedLoop(
      state, plant,
      (p) => baseInputs({ lateralMode: 'ROL', bankCommandDeg: 20, rollDeg: p.rollDeg }),
      300,
    )
    expect(plant.rollDeg).toBeGreaterThan(15)
    expect(plant.rollDeg).toBeLessThan(25)
  })

  it('respects the servo rate limit — output does not snap to a large command', () => {
    const state = makeAutopilotState()
    stepAutopilot(state, 0.1, baseInputs({ lateralMode: 'ROL', bankCommandDeg: 20 }))
    // Max possible movement in one 0.1s step at SERVO_RATE_PER_S:
    expect(Math.abs(state.rollCmd)).toBeLessThanOrEqual(SERVO_RATE_PER_S * 0.1 + 1e-9)
  })
})

describe('HDG mode', () => {
  it('rolls toward a 30-deg-off heading bug and converges heading over time', () => {
    const state = makeAutopilotState()
    const plant = new TestPlant()
    plant.headingDeg = 0
    runClosedLoop(
      state, plant,
      (p) => baseInputs({
        lateralMode: 'HDG', headingBugDeg: 30, headingDeg: p.headingDeg, rollDeg: p.rollDeg,
      }),
      600,
    )
    // Should have turned toward the bug (not stayed at 0, not overshot wildly).
    const err = Math.abs(((plant.headingDeg - 30 + 540) % 360) - 180)
    expect(err).toBeLessThan(5)
  })

  it('commands a bank in the correct direction for a step heading change', () => {
    const state = makeAutopilotState()
    stepAutopilot(state, 0.1, baseInputs({ lateralMode: 'HDG', headingBugDeg: 30, headingDeg: 0 }))
    expect(state.fdBankDeg).toBeGreaterThan(0) // right turn for +30 deg bug
    expect(state.rollCmd).toBeGreaterThan(0)

    const state2 = makeAutopilotState()
    stepAutopilot(state2, 0.1, baseInputs({ lateralMode: 'HDG', headingBugDeg: -30 + 360, headingDeg: 0 }))
    // -30 wrapped: heading bug 330, current 0 -> should turn left (negative)
    expect(state2.fdBankDeg).toBeLessThan(0)
  })
})

describe('NAV mode capture/track', () => {
  it('arms on selection with a large deviation, then activates once within capture threshold', () => {
    const state = makeAutopilotState()
    stepAutopilot(state, 0.1, baseInputs({ lateralMode: 'NAV', navDeviation: 1.0, headingBugDeg: 90, headingDeg: 0 }))
    expect(state.lateralArmed).toBe(true) // too far off to capture yet

    stepAutopilot(state, 0.1, baseInputs({ lateralMode: 'NAV', navDeviation: 0.3, headingBugDeg: 90, headingDeg: 45 }))
    expect(state.lateralArmed).toBe(false) // within half-scale -> captured
  })

  it('does not capture too early (large deviation stays armed across many steps)', () => {
    const state = makeAutopilotState()
    for (let i = 0; i < 20; i++) {
      stepAutopilot(state, 0.1, baseInputs({ lateralMode: 'NAV', navDeviation: 0.9, headingBugDeg: 90, headingDeg: 0 }))
    }
    expect(state.lateralArmed).toBe(true)
  })

  it('converges bank toward zero as deviation is driven to zero in closed loop', () => {
    const state = makeAutopilotState()
    // Start already captured (small deviation) so we test the tracking loop.
    // Crude dt-scaled plant: bank angle reduces cross-track deviation over
    // time (a banked turn closes cross-track error at a rate roughly
    // proportional to bank), not the real flight model.
    let deviation = 0.4
    const dt = 0.1
    for (let i = 0; i < 3000; i++) {
      stepAutopilot(state, dt, baseInputs({ lateralMode: 'NAV', navDeviation: deviation, headingBugDeg: 90, headingDeg: 0 }))
      // Negative (left) bank reduces a positive (right-of-course) deviation.
      deviation += state.rollCmd * 0.02 * dt
    }
    expect(Math.abs(deviation)).toBeLessThan(0.1)
  })
})

describe('APR vs BC — reversed CDI sense', () => {
  it('same raw deviation produces opposite-signed bank command once active', () => {
    const aprState = makeAutopilotState()
    const bcState = makeAutopilotState()
    // Select + immediately capture (small deviation) for both.
    stepAutopilot(aprState, 0.1, baseInputs({ lateralMode: 'APR', navDeviation: 0.2 }))
    stepAutopilot(bcState, 0.1, baseInputs({ lateralMode: 'BC', navDeviation: 0.2 }))
    expect(aprState.lateralArmed).toBe(false)
    expect(bcState.lateralArmed).toBe(false)

    // Now feed the same deviation again and compare the active-tracking bank sign.
    stepAutopilot(aprState, 0.1, baseInputs({ lateralMode: 'APR', navDeviation: 0.2 }))
    stepAutopilot(bcState, 0.1, baseInputs({ lateralMode: 'BC', navDeviation: 0.2 }))
    expect(aprState.fdBankDeg).not.toBe(0)
    expect(Math.sign(aprState.fdBankDeg)).toBe(-Math.sign(bcState.fdBankDeg))
  })
})

describe('ALT mode', () => {
  it('commands pitch in the correct direction for a step altitude change and converges', () => {
    const state = makeAutopilotState()
    const plant = new TestPlant()
    plant.altitudeFt = 3000
    // Command 500 ft higher -> should pitch up (positive) initially.
    stepAutopilot(state, 0.1, baseInputs({ verticalMode: 'ALT', altitudeBugFt: 3500, altitudeFt: 3000, pitchDeg: 0 }))
    expect(state.fdPitchDeg).toBeGreaterThan(0)

    runClosedLoop(
      state, plant,
      (p) => baseInputs({
        verticalMode: 'ALT', altitudeBugFt: 3500, altitudeFt: p.altitudeFt,
        pitchDeg: p.pitchDeg, verticalSpeedFpm: p.verticalSpeedFpm, iasKt: p.iasKt,
      }),
      2000,
    )
    expect(plant.altitudeFt).toBeGreaterThan(3400)
    expect(plant.altitudeFt).toBeLessThan(3600)
  })
})

describe('VS mode', () => {
  it('commands pitch to drive vertical speed toward the target, distinct from FLC', () => {
    const state = makeAutopilotState()
    const plant = new TestPlant()
    runClosedLoop(
      state, plant,
      (p) => baseInputs({
        verticalMode: 'VS', vsTargetFpm: 500, verticalSpeedFpm: p.verticalSpeedFpm,
        pitchDeg: p.pitchDeg, altitudeFt: p.altitudeFt, iasKt: p.iasKt,
      }),
      600,
    )
    expect(plant.verticalSpeedFpm).toBeGreaterThan(400)
    expect(plant.verticalSpeedFpm).toBeLessThan(600)
  })
})

describe('FLC mode (pitch-for-airspeed)', () => {
  it('pitches down when too slow (regains airspeed) and converges on target IAS', () => {
    const state = makeAutopilotState()
    const plant = new TestPlant()
    plant.iasKt = 80 // slower than the 100 kt target
    stepAutopilot(state, 0.1, baseInputs({
      verticalMode: 'FLC', iasTargetKt: 100, iasKt: 80, pitchDeg: 0,
    }))
    expect(state.fdPitchDeg).toBeLessThan(0) // pitch down to speed up

    runClosedLoop(
      state, plant,
      (p) => baseInputs({
        verticalMode: 'FLC', iasTargetKt: 100, iasKt: p.iasKt,
        pitchDeg: p.pitchDeg, altitudeFt: p.altitudeFt, verticalSpeedFpm: p.verticalSpeedFpm,
      }),
      800,
    )
    expect(plant.iasKt).toBeGreaterThan(90)
    expect(plant.iasKt).toBeLessThan(110)
  })

  it('is a genuinely different control target than VS (same starting condition, different response)', () => {
    const vsState = makeAutopilotState()
    const flcState = makeAutopilotState()
    const common = { pitchDeg: 2, altitudeFt: 3000, verticalSpeedFpm: 200, iasKt: 95 }
    stepAutopilot(vsState, 0.1, baseInputs({ verticalMode: 'VS', vsTargetFpm: 500, ...common }))
    stepAutopilot(flcState, 0.1, baseInputs({ verticalMode: 'FLC', iasTargetKt: 100, ...common }))
    expect(vsState.fdPitchDeg).not.toBeCloseTo(flcState.fdPitchDeg, 3)
  })
})

describe('ALTS armed -> ALT capture', () => {
  it('stays armed far from the bugged altitude, captures near it based on VS-predicted lead point', () => {
    const state = makeAutopilotState()
    // 2000 fpm descent, far from the bugged altitude -> still armed.
    stepAutopilot(state, 0.1, baseInputs({
      verticalMode: 'ALTS', underlyingVerticalMode: 'VS', vsTargetFpm: -2000,
      verticalSpeedFpm: -2000, altitudeFt: 5000, altitudeBugFt: 3000,
    }))
    expect(state.verticalMode).toBe('ALTS')
    expect(state.verticalArmed).toBe(true)

    // Close enough (within the predicted lead distance) -> captures to ALT.
    const leadFt = altsLeadFt(-2000)
    stepAutopilot(state, 0.1, baseInputs({
      verticalMode: 'ALTS', underlyingVerticalMode: 'VS', vsTargetFpm: -2000,
      verticalSpeedFpm: -2000, altitudeFt: 3000 + leadFt * 0.5, altitudeBugFt: 3000,
    }))
    expect(state.verticalMode).toBe('ALT')
    expect(state.verticalArmed).toBe(false)
  })

  it('does not capture too early (well outside the lead window)', () => {
    const state = makeAutopilotState()
    stepAutopilot(state, 0.1, baseInputs({
      verticalMode: 'ALTS', underlyingVerticalMode: 'VS', vsTargetFpm: -500,
      verticalSpeedFpm: -500, altitudeFt: 10000, altitudeBugFt: 3000,
    }))
    expect(state.verticalMode).toBe('ALTS')
    expect(state.verticalArmed).toBe(true)
  })

  it('a faster descent rate predicts a bigger (earlier) capture window', () => {
    expect(altsLeadFt(-2000)).toBeGreaterThan(altsLeadFt(-500))
  })
})

describe('GS mode (glideslope)', () => {
  it('arms then captures once within threshold, and pitches down when above the glidepath', () => {
    const state = makeAutopilotState()
    stepAutopilot(state, 0.1, baseInputs({ verticalMode: 'GS', glideslopeDeviation: 0.9, underlyingVerticalMode: 'VS' }))
    expect(state.verticalArmed).toBe(true)

    stepAutopilot(state, 0.1, baseInputs({ verticalMode: 'GS', glideslopeDeviation: 0.3 }))
    expect(state.verticalArmed).toBe(false)

    stepAutopilot(state, 0.1, baseInputs({ verticalMode: 'GS', glideslopeDeviation: 0.5 }))
    expect(state.fdPitchDeg).toBeLessThan(0) // above glidepath -> pitch down
  })
})

describe('gain scheduling', () => {
  it('produces a larger-magnitude command at low IAS than at high IAS for the same error', () => {
    const lowIasState = makeAutopilotState()
    const highIasState = makeAutopilotState()
    // A modest bank command (well under the servo-rate-limit's one-step
    // reach and under the [-1,1] output clamp) so the IAS-driven gain
    // difference actually shows up instead of both saturating identically.
    for (let i = 0; i < 20; i++) {
      stepAutopilot(lowIasState, 0.1, baseInputs({ iasKt: 60, lateralMode: 'ROL', bankCommandDeg: 5 }))
      stepAutopilot(highIasState, 0.1, baseInputs({ iasKt: 150, lateralMode: 'ROL', bankCommandDeg: 5 }))
    }
    expect(Math.abs(lowIasState.rollCmd)).toBeGreaterThan(Math.abs(highIasState.rollCmd))
  })

  it('gainScale decreases monotonically with IAS', () => {
    expect(gainScale(60)).toBeGreaterThan(gainScale(GAIN_REF_IAS_KT))
    expect(gainScale(GAIN_REF_IAS_KT)).toBeGreaterThan(gainScale(150))
  })
})

describe('trim follow-up', () => {
  it('moves trimCommand over time under sustained ALT-hold operation, same sign as the sustained pitch command', () => {
    const state = makeAutopilotState()
    // Altitude bug well above current altitude, held fixed (plant not
    // advancing) so the pitch command stays persistently positive.
    for (let i = 0; i < 400; i++) {
      stepAutopilot(state, 0.1, baseInputs({ verticalMode: 'ALT', altitudeBugFt: 3500, altitudeFt: 3000, pitchDeg: 0 }))
    }
    expect(state.pitchCmd).toBeGreaterThan(0)
    expect(state.trimCommand).toBeGreaterThan(0)
  })

  it('does not move trim under PIT (short-term attitude hold, not a sustained mode)', () => {
    const state = makeAutopilotState()
    for (let i = 0; i < 400; i++) {
      stepAutopilot(state, 0.1, baseInputs({ verticalMode: 'PIT', pitchCommandDeg: 10, pitchDeg: 0 }))
    }
    expect(state.trimCommand).toBe(0)
  })
})

describe('AP disconnect', () => {
  it('instantly zeroes commands and returns no active modes, with a one-shot signal', () => {
    const state = makeAutopilotState()
    stepAutopilot(state, 0.1, baseInputs({ lateralMode: 'HDG', headingBugDeg: 30, verticalMode: 'ALT', altitudeBugFt: 3500 }))
    expect(state.rollCmd).not.toBe(0)

    disconnect(state)
    expect(state.masterEnabled).toBe(false)
    expect(state.rollCmd).toBe(0)
    expect(state.pitchCmd).toBe(0)
    expect(state.lateralMode).toBe('ROL')
    expect(state.verticalMode).toBe('PIT')
    expect(state.justDisconnected).toBe(true)

    // One-shot: consumed by the next step call.
    stepAutopilot(state, 0.1, baseInputs({ masterEnabled: false }))
    expect(state.justDisconnected).toBe(false)
  })

  it('toggling masterEnabled off via inputs also disconnects', () => {
    const state = makeAutopilotState()
    stepAutopilot(state, 0.1, baseInputs({ lateralMode: 'ROL', bankCommandDeg: 20 }))
    expect(state.rollCmd).not.toBe(0)
    stepAutopilot(state, 0.1, baseInputs({ masterEnabled: false }))
    expect(state.rollCmd).toBe(0)
    expect(state.justDisconnected).toBe(true)
  })
})

describe('mode identity sanity', () => {
  it('exports the expected lateral/vertical mode literal sets', () => {
    const lateral: LateralMode[] = ['ROL', 'HDG', 'NAV', 'APR', 'BC']
    const vertical: VerticalMode[] = ['PIT', 'ALT', 'ALTS', 'VS', 'FLC', 'GS']
    expect(lateral.length).toBe(5)
    expect(vertical.length).toBe(6)
  })

  it('MAX_BANK_DEG caps ROL mode target bank', () => {
    const state = makeAutopilotState()
    stepAutopilot(state, 0.1, baseInputs({ lateralMode: 'ROL', bankCommandDeg: 90 }))
    expect(state.fdBankDeg).toBe(MAX_BANK_DEG)
  })
})
