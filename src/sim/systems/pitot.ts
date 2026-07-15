/**
 * Pitot-static instrument model (Phase 3 §8): pitot heat switch, and two
 * independent blockage failure modes (pitot icing, static-port blockage).
 * Pure function of true air data → what the gauges would show; never
 * touches `Aircraft.data` truth values (§4.1, no three.js/DOM).
 *
 * Physics modeled (classic instrument-training pattern):
 *  - Pitot blocked (heat off + icing conditions): the pitot line seals at
 *    whatever ram pressure existed at the moment of blockage while the
 *    static port keeps sensing ambient pressure. The airspeed indicator
 *    then reads the difference between that frozen ram pressure and the
 *    *current* static pressure, so it behaves like an altimeter: climbing
 *    lowers static pressure → indicated airspeed rises; descending raises
 *    static pressure → indicated airspeed falls.
 *  - Static blocked: the static line seals at the pressure/altitude at the
 *    moment of blockage. Altimeter freezes at that altitude and VSI reads
 *    zero (no sensed change), while airspeed stays roughly correct (the
 *    classic opposite symptom pattern) since it's dominated by the still-
 *    live pitot ram pressure at/near the blockage altitude.
 *
 * Incompressible dynamic-pressure relation (qc = ½·ρ0·V²) mirrors the CAS
 * definition already used in atmosphere.ts (`casFromTas`) — consistent
 * with the rest of this repo's low-speed calibration rather than a full
 * compressible pitot equation.
 */
import { isa, RHO0, KT } from '../atmosphere'

export interface PitotStaticInputs {
  trueIasKt: number
  trueAltFt: number
  trueVsiFpm: number
  pitotHeatOn: boolean
  /** Caller-controlled scenario flag — icing conditions present. */
  icingConditions: boolean
  /** Independent failure: static port blocked (e.g. tape, insects, ice). */
  staticBlocked: boolean
}

export interface PitotStaticReadings {
  iasKt: number
  altFt: number
  vsiFpm: number
  pitotBlocked: boolean
  staticBlockedActive: boolean
}

function qcFromKt(kt: number): number {
  const v = Math.max(kt, 0) * KT
  return 0.5 * RHO0 * v * v
}

function ktFromQc(qc: number): number {
  const v = Math.sqrt((2 * Math.max(qc, 0)) / RHO0)
  return v / KT
}

const FT = 0.3048

export class PitotStaticSystem {
  private pitotWasBlocked = false
  private frozenTotalPa = 0
  private staticWasBlocked = false
  private frozenAltFt = 0

  step(inp: PitotStaticInputs): PitotStaticReadings {
    const pitotBlocked = !inp.pitotHeatOn && inp.icingConditions

    if (pitotBlocked && !this.pitotWasBlocked) {
      // Capture the ram pressure at the instant of blockage.
      const staticPaAtBlock = isa(inp.trueAltFt * FT).pressurePa
      this.frozenTotalPa = staticPaAtBlock + qcFromKt(inp.trueIasKt)
    }
    this.pitotWasBlocked = pitotBlocked

    if (inp.staticBlocked && !this.staticWasBlocked) {
      this.frozenAltFt = inp.trueAltFt
    }
    this.staticWasBlocked = inp.staticBlocked

    let iasKt: number
    if (pitotBlocked) {
      // Static port (if not itself blocked) still senses current ambient
      // pressure; the pitot side is stuck at the frozen total pressure.
      const staticPaNow = isa((inp.staticBlocked ? this.frozenAltFt : inp.trueAltFt) * FT).pressurePa
      iasKt = ktFromQc(this.frozenTotalPa - staticPaNow)
    } else if (inp.staticBlocked) {
      // Static blocked alone: airspeed stays roughly correct (dominated by
      // the still-live pitot line), per the classic training pattern.
      iasKt = inp.trueIasKt
    } else {
      iasKt = inp.trueIasKt
    }

    let altFt: number
    let vsiFpm: number
    if (inp.staticBlocked) {
      altFt = this.frozenAltFt
      vsiFpm = 0
    } else {
      altFt = inp.trueAltFt
      vsiFpm = inp.trueVsiFpm
    }

    return { iasKt, altFt, vsiFpm, pitotBlocked, staticBlockedActive: inp.staticBlocked }
  }
}
