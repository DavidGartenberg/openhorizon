/**
 * Closed-loop autoland harness: the real Aircraft model, the real autopilot,
 * the real autoland module and ILS geometry, wired the way main.ts wires
 * them. Frame origin = the runway threshold; the runway runs along COURSE.
 */
import { makeAutopilotState, stepAutopilot, type AutopilotInputs } from '../../src/sim/autopilot'
import { Aircraft } from '../../src/sim/aircraft'
import type { AircraftParams } from '../../src/sim/aircraft/params'
import { trim } from '../../src/sim/trim'
import { KT, FT, isa } from '../../src/sim/atmosphere'
import { localizerDeflection, glideslopeDeflection, LOC_FULL_SCALE_DEG, GS_FULL_SCALE_DEG, type IlsRef } from '../../src/sim/nav/navaids'
import { runwayOffsets, glidepathHeightFt } from '../../src/sim/nav/tuning'
import { fromNedMeters, distanceM, type LatLon } from '../../src/math/geo'
import { autolandConfigFor, makeAutolandState, stepAutoland, radioAltitudeFt, type AutolandPhase } from '../../src/sim/autoland'

export const DT = 1 / 60
export const THRESHOLD: LatLon = { lat: 37.613, lon: -122.357 }
export const COURSE_DEG = 298
export const FIELD_ELEV_FT = 13
export const RUNWAY_LEN_M = 3000
const courseRad = (COURSE_DEG * Math.PI) / 180
const along = (m: number): LatLon => fromNedMeters(Math.cos(courseRad) * m, Math.sin(courseRad) * m, THRESHOLD)
export const ILS: IlsRef = {
  threshold: THRESHOLD, courseDeg: COURSE_DEG, thresholdElevFt: FIELD_ELEV_FT,
  gsAntenna: along(300), gsAntennaElevFt: FIELD_ELEV_FT, locAntenna: along(RUNWAY_LEN_M + 300),
}

export interface LandingOpts {
  P: AircraftParams
  distNm?: number
  kias: number
  flapsIndex?: number
  /** Wind: headwind kt (+ = from ahead) and crosswind kt (+ = from the right). */
  headwindKt?: number
  crosswindKt?: number
  /** Lateral start offset from the centerline, m (+ right). */
  offsetM?: number
  maxSeconds?: number
  /** Sinusoidal turbulence amplitude, kt, on the wind components. */
  gustKt?: number
  /** The ILS thinks the field is this many ft higher than the ground really is (datum mismatch). */
  ilsElevErrorFt?: number
  /** Phase offset of the gust pattern, s (vary for robustness runs). */
  gustPhaseS?: number
  debugLateral?: boolean
  /** Tuning overrides for the autoland config. */
  cfg?: Partial<import('../../src/sim/autoland').AutolandConfig>
}

export interface LandingResult {
  phases: AutolandPhase[]
  reachedFlareAtS: number | null
  touchdown: null | { t: number; vsFpm: number; alongM: number; crossM: number; headingErrDeg: number; kias: number; pitchDeg: number; rollDeg: number }
  maxCrossRolloutM: number
  maxCrossFinalM: number
  doneAtS: number | null
  stoppedOrSlowKt: number
  crashed: boolean
  bounced: boolean
  finalAlongM: number
  tailStrike: boolean
  /** Smallest sink rate magnitude seen between flare start and touchdown, fpm (balloon indicator). */
  minSinkInFlareFpm: number
  log: string[]
}

export function flyLanding(o: LandingOpts): LandingResult {
  const P = o.P
  const cfg = { ...autolandConfigFor(P)!, ...(o.cfg ?? {}) }
  const ac = new Aircraft(P)
  ac.groundElevAt = () => FIELD_ELEV_FT * FT
  const distNm = o.distNm ?? 6
  const glideAglFt = distNm * 6076.12 * Math.tan((3.0 * Math.PI) / 180) + 52
  const altM = (FIELD_ELEV_FT + glideAglFt) * FT
  const tas = o.kias * KT * Math.sqrt(1.225 / isa(altM).densityKgM3)
  ac.resetFlaps(o.flapsIndex ?? 0)
  const gearCd = P.gearRetractable ? P.gearRetractable.dCdExtended : 0
  const t = trim({ tasMs: tas, altM, massKg: ac.massKg, flapsDeg: P.flapDetentsDeg[o.flapsIndex ?? 0]!, gammaRad: (-3 * Math.PI) / 180, params: P, extraCd: gearCd })
  ac.applyTrimState(tas, t.alphaRad, altM, courseRad, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
  ac.controls.throttle = t.throttle
  // Place on final.
  const back = distNm * 1852
  ac.posNed.x = -Math.cos(courseRad) * back + Math.cos(courseRad + Math.PI / 2) * (o.offsetM ?? 0)
  ac.posNed.y = -Math.sin(courseRad) * back + Math.sin(courseRad + Math.PI / 2) * (o.offsetM ?? 0)
  ac.posNed.z = -altM
  const wind = (head: number, cross: number, tSec: number): void => {
    // wind blows toward: tailwind component = -head along course; from the right = pushes left.
    const g = o.gustKt ? o.gustKt * Math.sin((tSec + (o.gustPhaseS ?? 0)) * 0.5) * Math.cos((tSec + (o.gustPhaseS ?? 0)) * 0.23) : 0
    const alongV = -(head + g) * KT
    const crossV = -(cross + g * 0.6) * KT // + crosswind from the right blows toward the left (−right)
    ac.windNed.x = Math.cos(courseRad) * alongV + Math.cos(courseRad + Math.PI / 2) * crossV
    ac.windNed.y = Math.sin(courseRad) * alongV + Math.sin(courseRad + Math.PI / 2) * crossV
  }
  wind(o.headwindKt ?? 0, o.crosswindKt ?? 0, 0)

  const ils: IlsRef = { ...ILS, thresholdElevFt: FIELD_ELEV_FT + (o.ilsElevErrorFt ?? 0), gsAntennaElevFt: FIELD_ELEV_FT + (o.ilsElevErrorFt ?? 0) }
  const ap = makeAutopilotState()
  const al = makeAutolandState()
  const inputs: AutopilotInputs = {
    iasKt: 0, altitudeFt: 0, verticalSpeedFpm: 0, headingDeg: 0, pitchDeg: 0, rollDeg: 0,
    masterEnabled: true, lateralMode: 'APR', verticalMode: 'GS', underlyingVerticalMode: 'VS',
    headingBugDeg: COURSE_DEG, altitudeBugFt: 0, vsTargetFpm: -600, iasTargetKt: o.kias, bankCommandDeg: 0, pitchCommandDeg: 0,
    navDeviation: 0, glideslopeDeviation: 0,
  }
  const res: LandingResult = {
    phases: [], reachedFlareAtS: null, touchdown: null, maxCrossRolloutM: 0, maxCrossFinalM: 0, doneAtS: null,
    stoppedOrSlowKt: 0, crashed: false, bounced: false, finalAlongM: 0, tailStrike: false, minSinkInFlareFpm: 9999, log: [],
  }
  let lastAirVs = 0
  let wasOnGround = false
  let lastLog = -1
  const maxSteps = Math.round((o.maxSeconds ?? 600) / DT)
  for (let i = 0; i < maxSteps; i++) {
    const tSec = i * DT
    wind(o.headwindKt ?? 0, o.crosswindKt ?? 0, tSec)
    const d = ac.data
    const ll = fromNedMeters(ac.posNed.x, ac.posNed.y, THRESHOLD)
    const locDev = -localizerDeflection(ILS, ll) / LOC_FULL_SCALE_DEG
    const gsDev = glideslopeDeflection(ils, ll, d.altitudeFt) / GS_FULL_SCALE_DEG
    const off = runwayOffsets(ILS, ll)
    const ra = radioAltitudeFt(d.aglFt, d.pitchDeg, P)
    const locCaptured = !ap.lateralArmed && ap.lateralMode === 'APR'
    const gsCaptured = ap.verticalMode === 'GS' && !ap.verticalArmed
    const headwind = o.headwindKt ?? 0
    const out = stepAutoland(al, DT, {
      armed: true, locCaptured, gsCaptured, radioAltFt: ra, iasKt: d.kias, tasKt: d.ktas, alphaDeg: d.alphaDeg, groundSpeedKt: d.groundSpeedKt,
      verticalSpeedFpm: d.verticalSpeedFpm, pitchDeg: d.pitchDeg, rollDeg: d.rollDeg, headingDeg: d.headingDeg, trackDeg: d.trackDeg,
      yawRateDegS: (ac.rates.z * 180) / Math.PI, onGround: d.onGround, courseDeg: COURSE_DEG, crossTrackM: off.crossM,
      glidepathHeightFt: glidepathHeightFt(ILS, off.alongM), glidepathAngleDeg: 3, headwindKt: headwind, throttle: ac.controls.throttle, flapIndex: ac.controls.flapsIndex, gearDown: ac.gearPos > 0.99,
    }, cfg)
    if (res.phases[res.phases.length - 1] !== out.phase) res.phases.push(out.phase)
    if (out.phase === 'FLARE' && res.reachedFlareAtS === null) res.reachedFlareAtS = tSec
    if (out.message) res.log.push(`${tSec.toFixed(1)}s ${out.message}`)

    inputs.iasKt = d.kias; inputs.altitudeFt = d.altitudeFt; inputs.verticalSpeedFpm = d.verticalSpeedFpm
    inputs.headingDeg = d.headingDeg; inputs.rollDeg = d.rollDeg; inputs.pitchDeg = d.pitchDeg; inputs.trackDeg = d.trackDeg
    inputs.navDeviation = locDev; inputs.glideslopeDeviation = gsDev
    inputs.navRangeM = distanceM(ll, ILS.locAntenna!) // as main.ts: LOC gain normalizes on the localizer antenna…
    inputs.glideslopeRangeM = distanceM(ll, ILS.gsAntenna) // …and the GS law on the glideslope antenna
    inputs.pitchTargetOverrideDeg = out.pitchTargetDeg
    inputs.maxBankDeg = out.maxBankDeg
    inputs.bankTargetOverrideDeg = out.bankTargetDeg
    inputs.yawOverride = out.yawCmd
    stepAutopilot(ap, DT, inputs)
    if (!ap.lateralArmed) inputs.headingBugDeg = COURSE_DEG
    ac.controls.pitch = ap.pitchCmd; ac.controls.roll = ap.rollCmd; ac.controls.yaw = ap.yawCmd; ac.controls.trim = ap.trimCommand
    if (out.throttle !== null) ac.controls.throttle = out.throttle
    if (out.flapIndex !== null) ac.selectFlaps(out.flapIndex, false)
    if (out.gearDown) ac.gearDownCommanded = true
    if (out.spoilerArm && cfg.spoilers && !d.onGround) ac.spoilerArmed = true
    ac.reverseCmd = out.reverse
    ac.controls.brakeLeft = ac.controls.brakeRight = out.brake
    if (!d.onGround) lastAirVs = d.verticalSpeedFpm
    if (out.phase === 'FLARE' && ra < 12 && ra > 1.5) res.minSinkInFlareFpm = Math.min(res.minSinkInFlareFpm, -d.verticalSpeedFpm)
    ac.step(DT)

    const onG = ac.data.onGround
    if (onG && !wasOnGround) {
      if (res.touchdown === null) {
        res.touchdown = {
          t: tSec, vsFpm: lastAirVs, alongM: off.alongM, crossM: off.crossM,
          headingErrDeg: ((ac.data.headingDeg - COURSE_DEG + 540) % 360) - 180, kias: ac.data.kias, pitchDeg: ac.data.pitchDeg, rollDeg: ac.data.rollDeg,
        }
      }
    }
    if (res.touchdown && !onG && ra > 2 && tSec > res.touchdown.t) res.bounced = true // a real bounce: > 2 ft off the runway
    if (onG !== wasOnGround && res.touchdown) res.log.push(`${tSec.toFixed(2)}s onGround=${onG} ra=${ra.toFixed(1)} vs=${ac.data.verticalSpeedFpm.toFixed(0)} pit=${ac.data.pitchDeg.toFixed(1)}`)
    wasOnGround = onG
    if (res.touchdown === null) res.maxCrossFinalM = Math.max(res.maxCrossFinalM, Math.abs(off.crossM))
    else res.maxCrossRolloutM = Math.max(res.maxCrossRolloutM, Math.abs(off.crossM))
    if (res.touchdown && ac.data.pitchDeg > 11) res.tailStrike = true
    if (tSec - lastLog >= (out.phase === 'FLARE' || (o.debugLateral && ra < 900) ? 0.4 : 5) && ra < 900) { lastLog = tSec; res.log.push(`${tSec.toFixed(1)}s tgt=${out.pitchTargetDeg?.toFixed(1) ?? '-'} a=${d.alphaDeg.toFixed(1)} thr=${ac.controls.throttle.toFixed(2)} bk=${d.rollDeg.toFixed(1)} bt=${out.bankTargetDeg?.toFixed(1) ?? '-'} trk=${(((d.trackDeg - COURSE_DEG + 540) % 360) - 180).toFixed(1)} ra=${ra.toFixed(0)} vs=${d.verticalSpeedFpm.toFixed(0)} ias=${d.kias.toFixed(0)} pit=${d.pitchDeg.toFixed(1)} xt=${off.crossM.toFixed(1)} al=${off.alongM.toFixed(0)} ${out.phase}`) }
    if (ac.crashed) { res.crashed = true; break }
    if (!Number.isFinite(ac.data.altitudeFt)) { res.crashed = true; break }
    if (out.disconnect) { res.doneAtS = tSec; res.stoppedOrSlowKt = ac.data.groundSpeedKt; res.finalAlongM = runwayOffsets(ILS, fromNedMeters(ac.posNed.x, ac.posNed.y, THRESHOLD)).alongM; break }
  }
  return res
}
