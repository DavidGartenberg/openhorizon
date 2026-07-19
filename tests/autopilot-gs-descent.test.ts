/**
 * Round 4 regression coverage — lateral tracking coupled to a REAL
 * GS-engaged descent (the blind spot that let rounds 1-3 each look
 * complete: every prior test froze altitude). Two families:
 *
 * 1. On-beam control cases (0°/20° heading error, teleported onto the
 *    centerline): directly regression-tests the round-4 root cause — the
 *    fraction-domain loop's physical gain grew ~1/range as the localizer
 *    beam narrowed, going unstable inside ~5-7 km (0° case previously hit
 *    full-scale at t≈180s). Fixed by range-normalizing the deviation via
 *    `AutopilotInputs.navRangeM` (see autopilot.ts tracking branch).
 *
 * 2. Realistic vectors-to-final intercepts (offset from the beam, ARMED on
 *    an intercept heading, bug flipped to course at capture — real GFC700
 *    technique): 30/45/60° cuts must stay within half-scale from capture
 *    continuously down to 200 ft AGL — Phase 4 Task 7's acceptance bar.
 *
 * NOT covered on purpose: teleported-on-centerline entries with 40-90°
 * heading error. Capture fires instantly there and a 25°-bank-limited turn
 * (radius ≈460 m at ~100 kt) geometrically overshoots a ≈240 m half-scale
 * — round 3's envelope analysis, matching real GA-autopilot limits; no
 * real procedure enters a localizer that way.
 */
import { describe, expect, it } from 'vitest'
import { makeAutopilotState, stepAutopilot, type AutopilotInputs } from '../src/sim/autopilot'
import { Aircraft } from '../src/sim/aircraft'
import { trim } from '../src/sim/trim'
import { kcasFromKias, KT, FT } from '../src/sim/atmosphere'
import { localizerDeflection, glideslopeDeflection, LOC_FULL_SCALE_DEG, GS_FULL_SCALE_DEG, type IlsRef } from '../src/sim/nav/navaids'
import { fromNedMeters, type LatLon } from '../src/math/geo'

const REAL_DT = 1 / 60
const THRESHOLD: LatLon = { lat: 37.613, lon: -122.357 }
const COURSE_DEG = 298
const ILS: IlsRef = {
  threshold: THRESHOLD, courseDeg: COURSE_DEG, thresholdElevFt: 13,
  gsAntenna: THRESHOLD, gsAntennaElevFt: 13, gsAngleDeg: 3.0,
}

function baseInputs(overrides: Partial<AutopilotInputs>): AutopilotInputs {
  return {
    iasKt: 90, altitudeFt: 3000, verticalSpeedFpm: 0, headingDeg: 0, pitchDeg: 0, rollDeg: 0,
    masterEnabled: true, lateralMode: 'ROL', verticalMode: 'PIT', headingBugDeg: 0,
    altitudeBugFt: 3000, vsTargetFpm: 0, iasTargetKt: 90, bankCommandDeg: 0, pitchCommandDeg: 0,
    navDeviation: 0, glideslopeDeviation: 0,
    ...overrides,
  }
}

function trimmedOnGlidepath(headingDeg: number, distNm: number): Aircraft {
  const glideAglFt = distNm * 6076.12 * Math.tan((3.0 * Math.PI) / 180)
  const altFt = ILS.thresholdElevFt + glideAglFt
  const ac = new Aircraft()
  const altM = altFt * FT
  const tas = kcasFromKias(90, altM) * KT
  const t = trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg: 0, throttle: 0.6 })
  ac.applyTrimState(tas, t.alphaRad, altM, (headingDeg * Math.PI) / 180, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
  ac.controls.throttle = t.throttle
  const reciprocalRad = ((COURSE_DEG + 180) * Math.PI) / 180
  ac.posNed.x = Math.cos(reciprocalRad) * distNm * 1852
  ac.posNed.y = Math.sin(reciprocalRad) * distNm * 1852
  ac.posNed.z = -altM
  return ac
}

interface RunResult {
  worstLocAfterCapture: number
  worstGsAfter30s: number
  reachedDh: boolean
  captured: boolean
}

/** Fly APR+GS to 200 ft AGL; heading bug starts at `bugDeg` and flips to
 *  the course at capture (real technique — the bug is this AP's course
 *  datum for tracking). */
function flyApproach(ac: Aircraft, bugDeg: number, maxSeconds: number): RunResult {
  const ap = makeAutopilotState()
  const inputs = baseInputs({
    lateralMode: 'APR', verticalMode: 'GS', underlyingVerticalMode: 'VS',
    headingBugDeg: bugDeg, iasTargetKt: 90, vsTargetFpm: -300,
  })
  const n = Math.round(maxSeconds / REAL_DT)
  let capturedAtT = -1
  let worstLoc = 0
  let worstGs = 0
  let reachedDh = false
  for (let i = 0; i < n; i++) {
    const ll = fromNedMeters(ac.posNed.x, ac.posNed.y, THRESHOLD)
    const locDev = -localizerDeflection(ILS, ll) / LOC_FULL_SCALE_DEG
    const gsDev = glideslopeDeflection(ILS, ll, ac.data.altitudeFt) / GS_FULL_SCALE_DEG
    inputs.iasKt = ac.data.kias
    inputs.altitudeFt = ac.data.altitudeFt
    inputs.verticalSpeedFpm = ac.data.verticalSpeedFpm
    inputs.headingDeg = ac.data.headingDeg
    inputs.rollDeg = ac.data.rollDeg
    inputs.pitchDeg = ac.data.pitchDeg
    inputs.trackDeg = ac.data.trackDeg // mirrors main.ts wiring
    inputs.navDeviation = locDev
    inputs.glideslopeDeviation = gsDev
    inputs.navRangeM = Math.hypot(ac.posNed.x, ac.posNed.y)
    stepAutopilot(ap, REAL_DT, inputs)
    const t = i * REAL_DT
    if (!ap.lateralArmed && capturedAtT < 0) capturedAtT = t
    // Mirror main.ts exactly: while tracking, the bug is pinned to the
    // course (continuous, not edge-triggered — covers instant capture).
    if (!ap.lateralArmed) inputs.headingBugDeg = COURSE_DEG
    ac.controls.pitch = ap.pitchCmd
    ac.controls.roll = ap.rollCmd
    ac.controls.yaw = ap.yawCmd
    ac.controls.trim = ap.trimCommand
    ac.step(REAL_DT)
    if (capturedAtT >= 0) {
      worstLoc = Math.max(worstLoc, Math.abs(locDev))
      if (t - capturedAtT > 30) worstGs = Math.max(worstGs, Math.abs(gsDev))
    }
    const aglFt = ac.data.altitudeFt - ILS.thresholdElevFt
    if (aglFt <= 200) {
      reachedDh = true
      break
    }
    if (!isFinite(ac.data.altitudeFt)) break
  }
  return { worstLocAfterCapture: worstLoc, worstGsAfter30s: worstGs, reachedDh, captured: capturedAtT >= 0 }
}

describe('coupled GS-descent: instant capture with stale vector bug (reviewer repro)', () => {
  it('on-beam instant capture + 15 kt crosswind: track steering holds the crab', () => {
    // Diverged to full-scale pre-track-steering: the range-scaled P under-
    // commands near the threshold and the integral can't discover ~12° of
    // steady crab within a 2-minute approach. Steering ground track makes
    // wind transparent (worst 0.104 in the discriminator run).
    const ac = trimmedOnGlidepath(COURSE_DEG, 3)
    const toRad = ((28 + 180) % 360) * (Math.PI / 180)
    ac.windNed.x = Math.cos(toRad) * 15 * KT
    ac.windNed.y = Math.sin(toRad) * 15 * KT
    const r = flyApproach(ac, COURSE_DEG, 250)
    expect(r.captured).toBe(true)
    expect(r.reachedDh).toBe(true)
    expect(r.worstLocAfterCapture).toBeLessThanOrEqual(0.5)
  })

  it('APR engaged on-beam with the bug still 30° off: course pin recovers it', () => {
    // stepAutopilot arms AND captures in one step here; the edge-triggered
    // slew never fired and the app diverged (|loc|=1.0 by t=24 s). The
    // continuous course pin (mirrored from main.ts above) must recover it.
    const ac = trimmedOnGlidepath(COURSE_DEG, 6)
    const staleVectorBug = (((COURSE_DEG - 30) % 360) + 360) % 360
    const r = flyApproach(ac, staleVectorBug, 320)
    expect(r.captured).toBe(true)
    expect(r.reachedDh).toBe(true)
    expect(r.worstLocAfterCapture).toBeLessThanOrEqual(0.5)
  })
})

describe('coupled GS-descent: on-beam control cases (range-instability regression)', () => {
  for (const [errDeg, distNm] of [[0, 6], [20, 6], [20, 8]] as const) {
    it(`${errDeg}° heading error at ${distNm} nm stays within half-scale to 200 AGL`, () => {
      const hdg = (((COURSE_DEG - errDeg) % 360) + 360) % 360
      const ac = trimmedOnGlidepath(hdg, distNm)
      const r = flyApproach(ac, COURSE_DEG, 320)
      expect(r.captured).toBe(true)
      expect(r.reachedDh).toBe(true)
      expect(r.worstLocAfterCapture).toBeLessThanOrEqual(0.5)
      expect(r.worstGsAfter30s).toBeLessThanOrEqual(0.5)
    })
  }
})

describe('coupled GS-descent: realistic vectors-to-final intercepts (Task 7 acceptance)', () => {
  for (const [cutDeg, offsetM, distNm, xwindKt] of [
    [30, 1500, 8, 0], [45, 2500, 9, 0], [45, 1500, 8, 0], [60, 3000, 9, 0],
    // §24 Phase 4 acceptance names a 15 kt crosswind explicitly.
    [30, 1500, 8, 15], [45, 2500, 9, 15],
  ] as const) {
    it(`${cutDeg}° intercept, ${offsetM} m offset, ${distNm} nm, ${xwindKt} kt crosswind: tracks to 200 AGL`, () => {
      const hdg = (((COURSE_DEG - cutDeg) % 360) + 360) % 360
      const ac = trimmedOnGlidepath(hdg, distNm)
      const courseRad = (COURSE_DEG * Math.PI) / 180
      ac.posNed.x += Math.cos(courseRad + Math.PI / 2) * offsetM
      ac.posNed.y += Math.sin(courseRad + Math.PI / 2) * offsetM
      if (xwindKt > 0) {
        // Wind FROM the right of the approach course, pushing the aircraft
        // left across the localizer — the AP must hold a crab.
        ac.windNed.x = -Math.cos(courseRad + Math.PI / 2) * xwindKt * KT
        ac.windNed.y = -Math.sin(courseRad + Math.PI / 2) * xwindKt * KT
      }
      const r = flyApproach(ac, hdg, 420)
      expect(r.captured).toBe(true)
      expect(r.reachedDh).toBe(true)
      expect(r.worstLocAfterCapture).toBeLessThanOrEqual(0.5)
      expect(r.worstGsAfter30s).toBeLessThanOrEqual(0.5)
    })
  }
})
