/**
 * Tier-B roster derivation (Phase 12c): published spec record → flyable
 * AircraftParams through documented estimation chains. THE HONESTY LADDER:
 *
 *  - CALIBRATED (by construction): clean CLmax is back-solved from the
 *    published stall speed at MTOW — the stall row validates plumbing,
 *    not prediction. Same policy as the C172's point-tuned prop tables.
 *  - PREDICTED (the real validation): cruise speed and climb rate follow
 *    from the derived drag polar + scaled powerplant — the roster test's
 *    cruise/climb rows are where the derivation earns its keep.
 *  - INHERITED (documented limitation): handling derivatives come from
 *    the class anchor (C172S for light types, B738 for jet transports).
 *    Tier B is performance-validated, NOT handling-validated.
 *
 * Estimation chains (citations in comments): Helmbold-corrected lift
 * slope, Oswald e by planform class, CD0 by equivalent-flat-plate class,
 * radius-of-gyration inertia scaling from the class anchors, prop tables
 * power-scaled from the C172 anchor (Cp ∝ P/(ρn³D⁵)), jet block scaled
 * from the CFM56 anchor by thrust ratio. Per-type `tuning` overrides are
 * explicit and documented in roster.ts — never silent tolerance widening.
 */
import type { AircraftParams, GearLeg } from './params'
import { C172S } from './c172s'
import { B738 } from './b738'
import { CFM56_7B26 } from '../turbofan'
import { G, RHO0, KT } from '../atmosphere'
import { propEffectsYawNm } from '../prop-effects'

export type RosterPowerplant =
  | { kind: 'piston'; ratedPowerW: number; count: number; propDiameterM: number; redlineRpm: number; governed?: boolean }
  | { kind: 'turboprop'; ratedPowerW: number; count: number; propDiameterM: number; redlineRpm: number; thermoMargin?: number }
  | { kind: 'jet'; staticThrustN: number; count: number }
  | { kind: 'none' }

export interface RosterSpec {
  designator: string
  label: string
  // geometry
  wingAreaM2: number
  spanM: number
  lengthM: number
  // masses (kg)
  emptyKg: number
  mtowKg: number
  fuelKg: number
  powerplant: RosterPowerplant
  gear: { layout: 'tricycle' | 'taildragger'; retractable?: boolean }
  flapDetentsDeg: readonly number[]
  /** CLmax increment at full landing flaps (class estimate/published). */
  flapMaxDClMax: number
  /** Published clean stall, CAS kt at MTOW — the CLmax calibration anchor. */
  stallCleanKcas: number
  /** UI arcs / validation targets. */
  vSpeeds: { vyKcas: number; approachKcas: number; vneKcas: number; glideKcas: number }
  /** Ct-only multiplier — the documented point-tuning knob (C172-table
   *  policy) for types whose climb/cruise split misses on the first pass. */
  propThrustScale?: number
  /** Explicit, documented per-type corrections (usually cd0 or e). */
  tuning?: Omit<Partial<AircraftParams>, 'jet'> & { jet?: Partial<import('../turbofan').JetParams> }
}

const FT_PANTS = 0.028 // faired fixed gear (wheel-pants singles)
const CD0_BY_CLASS = {
  fixedPistonSingle: 0.032, // strutted/fixed gear (C172 class 0.034 anchor)
  bushTaildragger: 0.042,
  cleanPistonSingle: FT_PANTS, // SR22/Cirrus class composite
  retractPistonSingle: 0.025,
  pistonTwin: 0.027,
  turbopropSingle: 0.024,
  turbopropTwin: 0.026,
  bizjet: 0.021,
  airliner: 0.0195, // B738 anchor
  glider: 0.010,
}
export type Cd0Class = keyof typeof CD0_BY_CLASS

export interface DeriveOptions {
  cd0Class: Cd0Class
  /** Oswald e override; default by planform (0.78 straight, 0.80 swept jet, 0.9 glider). */
  oswald?: number
  sweptJet?: boolean
}

/** Scale the C172 Ct/Cp tables so the new prop absorbs `powerW` at redline
 *  through diameter D: Cp ∝ P/(ρ n³ D⁵) (standard propeller coefficients).
 *  Fixed-pitch shape — pistons only. */
function scaledPropTables(powerW: number, redlineRpm: number, dM: number, thrustScale = 1): Pick<AircraftParams, 'propCtTable' | 'propCpTable'> {
  const n = redlineRpm / 60
  const cpNeeded = powerW / (RHO0 * n * n * n * dM ** 5)
  const anchorCp = C172S.propCpTable[0]![1] // 0.059 at J=0
  const s = cpNeeded / anchorCp
  return {
    propCtTable: C172S.propCtTable.map(([j, ct]) => [j, ct * s * thrustScale] as const),
    propCpTable: C172S.propCpTable.map(([j, cp]) => [j, cp * s] as const),
  }
}

/** Main-gear contact depth below the body origin, from length. Anchored
 *  on the hand-authored B738 (2.9 m on 39.5 m = 0.073·L — the real 737
 *  stands ~2.9 m at the mains): the old 0.14·L made every derived jet
 *  tower at DOUBLE its real height (B77W 10.3 m vs the real ~5.2) and
 *  halved apparent ground effect through the flare. The 1.1 m floor
 *  keeps GA singles/twins at their verified stance. The render builders
 *  import this so wheels and physics agree on where the ground is. */
export function standardGearZ(lengthM: number): number {
  return Math.max(lengthM * 0.073, 1.1)
}

function gearLegs(spec: RosterSpec): AircraftParams['gear'] {
  const m = spec.mtowKg
  const L = spec.lengthM
  const track = Math.max(spec.spanM * 0.16, 1.7)
  const k = 54 * m // N/m per leg (C172 anchor: 62 kN/m at 1157 kg)
  const c = 4.6 * m
  const maxNormalN = 3.5 * m * G // C172 anchor: 40 kN ≈ 3.5× weight
  const zMain = standardGearZ(L)
  if (spec.gear.layout === 'taildragger') {
    return {
      tail: { x: -L * 0.58, y: 0, z: zMain * 0.45, k: k * 0.4, c: c * 0.4, steerMaxRad: 0.31, maxNormalN },
      mainL: { x: L * 0.045, y: -track / 2, z: zMain, k, c, steerMaxRad: 0, maxNormalN },
      mainR: { x: L * 0.045, y: track / 2, z: zMain, k, c, steerMaxRad: 0, maxNormalN },
    }
  }
  // Mains-behind-CG offset: transports carry ~6-8% of weight on the nose
  // (mains ≈ 2.8% of length aft of CG — the study 737's own geometry);
  // the old generic 4.5% figure put ~11% on the nose and made rotation
  // physically impossible below ~170 kt for the jets (N1 lattice finding:
  // the A320 pinned at −0.3° pitch to the 204-kt crash guard under FULL
  // aft stick). GA keeps 4.5% (C172-class anchor).
  const jetlike = spec.powerplant.kind === 'jet'
  const mainsAft = jetlike ? 0.028 : 0.045
  // X-Plane gear audit (2026-08-13): the 0.38L nose arm was fitted to
  // jets (B738/A333/C750 wheelbases verify within ~4%) but parked GA
  // nosewheels absurdly far forward — SR22 wheelbase read 11 ft vs the
  // real 4.6. Class split: piston/tp singles 0.13L, twins 0.27L (Baron
  // verifies), jets keep 0.38L.
  const noseFrac = jetlike ? 0.38 : (spec.powerplant.kind !== 'none' && 'count' in spec.powerplant && spec.powerplant.count >= 2) ? 0.27 : 0.13
  const nose: GearLeg = { x: L * noseFrac, y: 0, z: zMain * 0.98, k: k * 0.45, c: c * 0.45, steerMaxRad: 0.4, maxNormalN }
  return {
    nose,
    mainL: { x: -L * mainsAft, y: -track / 2, z: zMain, k, c, steerMaxRad: 0, maxNormalN },
    mainR: { x: -L * mainsAft, y: track / 2, z: zMain, k, c, steerMaxRad: 0, maxNormalN },
  }
}

export function deriveParams(spec: RosterSpec, opts: DeriveOptions): AircraftParams {
  const AR = (spec.spanM * spec.spanM) / spec.wingAreaM2
  const jet = spec.powerplant.kind === 'jet'
  const glider = spec.powerplant.kind === 'none'
  const e = opts.oswald ?? (glider ? 0.9 : opts.sweptJet ? 0.8 : 0.78)
  // Helmbold-corrected lift slope from a0 ≈ 5.9/rad (same chain as the Cub).
  const clAlpha = 5.9 / (1 + 5.9 / (Math.PI * e * AR))
  // CALIBRATED: CLmax from the published clean stall at MTOW (see header).
  const vs = spec.stallCleanKcas * KT
  let clMaxClean = (2 * spec.mtowKg * G) / (RHO0 * vs * vs * spec.wingAreaM2)
  // X-Plane 12 audit (2026-08-13): jet rows' stallCleanKcas were
  // systematically optimistic — back-solving gave clean CLmax up to 2.8
  // where a real clean swept wing tops out ≈1.4-1.5 (X-Plane's B738/A330/
  // MD-82 files and first principles agree). The calibration now CAPS
  // clean CLmax per jet class and re-derives the placarded stall from the
  // effective value; the flap system is simultaneously recalibrated so
  // LANDING CLmax reaches the slats+flaps physical target (airliner ≈2.9,
  // bizjet ≈2.2) — approach speeds stay real while clean stall stops
  // being fictional. GA/turboprop rows audited clean; uncapped.
  const jetCap = opts.cd0Class === 'airliner' ? { clean: 1.45, land: 2.9 }
    : opts.cd0Class === 'bizjet' ? { clean: 1.5, land: 2.2 } : null
  let flapMaxDClMaxEff = spec.flapMaxDClMax
  if (jetCap && clMaxClean > jetCap.clean) {
    clMaxClean = jetCap.clean
    flapMaxDClMaxEff = Math.max(spec.flapMaxDClMax, jetCap.land - jetCap.clean)
  }
  const effStallKcas = Math.sqrt((2 * spec.mtowKg * G) / (RHO0 * clMaxClean * spec.wingAreaM2)) / KT

  // Anchor for handling derivatives + shape constants (INHERITED, see header).
  const anchor = jet ? B738 : C172S

  // Flap increment curves: dClMax distributed by detent fraction; dCl0 at
  // 85% of dClMax (Fowler-ish); drag quadratic to a class max; pitch
  // moment proportional (anchor-shaped).
  const detents = spec.flapDetentsDeg
  const maxDet = detents[detents.length - 1] || 1
  const frac = detents.map((d) => d / maxDet)
  const dCdFull = jet ? 0.09 : 0.065
  const flapDClMax = frac.map((f) => f * flapMaxDClMaxEff)
  const flapDCl0 = frac.map((f) => f * flapMaxDClMaxEff * 0.85)
  const flapDCd = frac.map((f) => f * f * dCdFull)
  const flapDCm = frac.map((f) => -f * (jet ? 0.19 : 0.09))

  // Inertias: radius-of-gyration scaling from the class anchor
  // (ixx ∝ m·b², iyy ∝ m·L², izz ∝ m·(b²+L²) — Roskam class regressions).
  const aL = jet ? 39.5 : 8.28
  const mR = spec.mtowKg / anchor.mtowKg
  const bR = (spec.spanM / anchor.spanM) ** 2
  const lR = (spec.lengthM / aL) ** 2
  const inertiaMtow = {
    ixx: anchor.inertiaMtow.ixx * mR * bR,
    iyy: anchor.inertiaMtow.iyy * mR * lR,
    izz: anchor.inertiaMtow.izz * mR * ((bR + lR) / 2),
  }

  const pp = spec.powerplant
  const totalPowerW = pp.kind === 'piston' || pp.kind === 'turboprop' ? pp.ratedPowerW * pp.count : 1
  const propD = pp.kind === 'piston' || pp.kind === 'turboprop' ? pp.propDiameterM : 1
  const redline = pp.kind === 'piston' || pp.kind === 'turboprop' ? pp.redlineRpm : 1
  // Multi-engine props run as ONE combined disc absorbing total power
  // (documented deviation: no asymmetric thrust / engine-out for Tier B).
  const governed = pp.kind === 'turboprop' || (pp.kind === 'piston' && pp.governed === true)
  // Governed types bypass the Ct/Cp tables entirely (propulsion.ts's
  // explicit governor model) — inert tables keep the interface satisfied.
  const propTables = glider || jet || governed
    ? { propCtTable: [[0, 0], [1, 0]] as AircraftParams['propCtTable'], propCpTable: [[0, 0], [1, 0]] as AircraftParams['propCpTable'] }
    : scaledPropTables(totalPowerW, redline, propD, spec.propThrustScale)

  const multiEngineProp = (pp.kind === 'piston' || pp.kind === 'turboprop') && pp.count > 1

  // Prop-effect gains + rigging (prop-effects.ts — user goal "proper
  // thrust and P-factor"): the gains are geometry-class constants
  // (calibrated on the C172 audit; twins get partial values — the
  // combined-disc model splits the crossflow across two discs and the
  // fin sits between the slipstream tubes). Rigging then cancels EXACTLY
  // the moments the sim computes, because it is derived by calling the
  // same pure functions at the canonical level-cruise point (CL≈0.35,
  // thrust=drag, mid mass, 3,000 ft):
  //  - T = D = qS·cd_cruise, qS = W/CL, v from CL (all level-flight
  //    identities);
  //  - Q from power required, D·v/(η·ω) — cross-checks the C172 bench
  //    audit to 1% (a rated-power-fraction guess missed 3× on
  //    oversized-engine types).
  const PF_K_SINGLE = 2.397
  const SWIRL_K_SINGLE = 0.607
  const propGains = glider || jet
    ? { pFactorK: 0, swirlK: 0 }
    : multiEngineProp
      ? { pFactorK: PF_K_SINGLE * 0.5, swirlK: SWIRL_K_SINGLE * 0.5 }
      : { pFactorK: PF_K_SINGLE, swirlK: SWIRL_K_SINGLE }
  // Slipstream-swirl roll recovery (params.ts): singles have the wing in
  // the slipstream (0.5); twins only nacelle-adjacent wing (0.3).
  const swirlRollRecovery = glider || jet ? 0 : multiEngineProp ? 0.3 : 0.5
  const rigging = (() => {
    if (glider || jet) return {}
    const clCruise = 0.35
    const kInd = 1 / (Math.PI * e * AR)
    const cdCruise = CD0_BY_CLASS[opts.cd0Class] + kInd * clCruise * clCruise
    const alphaCruise = Math.max((clCruise - 0.25) / clAlpha, 0) // prop cl0 = 0.25 below
    const midMassKg = (spec.emptyKg + spec.mtowKg) / 2
    const qS = (midMassKg * G) / clCruise
    const RHO_3000FT = 1.121
    const vCruise = Math.sqrt((2 * midMassKg * G) / (RHO_3000FT * clCruise * spec.wingAreaM2))
    const dragN = qS * cdCruise
    const omega = ((redline * Math.PI) / 30) * (governed ? 1 : 0.85)
    const torqueNm = (dragN * vCruise) / (0.78 * omega)
    const yawNm = propEffectsYawNm(propGains, dragN, torqueNm, vCruise, alphaCruise, RHO_3000FT, propD)
    // Same physics as aero.ts: the fin offset acts in tail q (propwash
    // included), the aileron rig cancels the NET torque roll.
    const qCruise = qS / spec.wingAreaM2
    const diskA = (Math.PI * propD * propD) / 4
    // aero.ts: dqProp = T / (2·diskArea), tailQ = clamp((q + 0.7·dqProp)/q, 1, 2.5)
    const tailQ = Math.min(Math.max((qCruise + 0.7 * (dragN / (2 * diskA))) / qCruise, 1), 2.5)
    return {
      rigCn: -yawNm / (qS * spec.spanM) / tailQ,
      rigCl: (torqueNm * (1 - swirlRollRecovery)) / (qS * spec.spanM),
    }
  })()

  const p: AircraftParams = {
    wingAreaM2: spec.wingAreaM2,
    spanM: spec.spanM,
    chordM: spec.wingAreaM2 / spec.spanM,
    oswald: e,
    aspectRatio: AR,
    emptyMassKg: spec.emptyKg,
    mtowKg: spec.mtowKg,
    fuelCapacityKg: spec.fuelKg,
    inertiaMtow,
    cl0: glider ? 0.4 : jet ? 0.15 : 0.25,
    clAlpha,
    clMaxClean,
    clMin: -0.8,
    clDe: anchor.clDe,
    clQ: anchor.clQ,
    clAlphaDot: anchor.clAlphaDot,
    cd0: CD0_BY_CLASS[opts.cd0Class],
    cdBeta: anchor.cdBeta,
    postStallCd: 1.28, // X-Plane airfoil-table audit (see c172s.ts note)
    cm0: jet ? 0.03 : 0.02,
    cmAlpha: anchor.cmAlpha,
    cmQ: anchor.cmQ,
    cmAlphaDot: anchor.cmAlphaDot,
    cmDe: anchor.cmDe,
    cyBeta: anchor.cyBeta, cyP: anchor.cyP, cyR: anchor.cyR, cyDr: anchor.cyDr,
    clBeta: anchor.clBeta, clP: anchor.clP, clR: anchor.clR, clDa: anchor.clDa, clDr: anchor.clDr,
    cnBeta: anchor.cnBeta, cnP: anchor.cnP, cnR: anchor.cnR, cnDa: anchor.cnDa, cnDr: anchor.cnDr,
    flapDetentsDeg: detents,
    flapDCl0, flapDClMax, flapDCd, flapDCm,
    flapRateDegS: jet ? 1.5 : 8,
    elevatorMaxRad: anchor.elevatorMaxRad,
    aileronMaxRad: anchor.aileronMaxRad,
    rudderMaxRad: anchor.rudderMaxRad,
    trimMaxRad: anchor.trimMaxRad,
    stallBlendWidthRad: 0.035,
    postStallCmDrop: jet ? -0.5 : -0.35,
    ratedPowerW: totalPowerW,
    ratedRadS: (redline * Math.PI) / 30,
    redlineRpm: redline,
    idleTorqueFraction: glider || jet ? 0 : 0.11,
    propDiameterM: propD,
    rotInertiaKgM2: glider || jet ? 1 : Math.max(1.6 * (totalPowerW / C172S.ratedPowerW), 0.6),
    bsfcKgPerWs: pp.kind === 'turboprop' ? 9.3e-8 : 7.27e-8, // TP ~0.55 lb/shp/hr
    ...propTables,
    ...(pp.kind === 'turboprop' ? { thermoMargin: pp.thermoMargin ?? 2.1 } : {}),
    ...(governed ? { propGoverned: true as const, ...(spec.propThrustScale ? { propEtaScale: spec.propThrustScale } : {}) } : {}),
    carburetor: false,
    propwashTailFactor: glider || jet ? 0 : multiEngineProp ? 0.35 : 0.7,
    ...propGains,
    swirlRollRecovery,
    ...rigging,
    ...(jet && pp.kind === 'jet'
      ? {
          spoilers: { dCd: 0.05, dCl: 0.35, ratePerS: 0.85 },
          reversers: { effectiveness: 0.45, transitS: 1.5 },
          jet: {
            ...CFM56_7B26,
            engines: pp.count,
            staticThrustN: pp.staticThrustN,
            // Windmill drag scales with fan area (∝ per-engine thrust
            // ratio vs the 117 kN CFM56-7B26 anchor) — the fixed 0.47
            // gave a Williams FJ44 bizjet a CFM56's dead-engine drag and
            // a Trent-class widebody a quarter of its real value.
            windmillCdA: 0.47 * (pp.staticThrustN / 117_000),
          },
          machModel: { mdd: 0.82, dragRiseK: 20 },
          trimIsStabilizer: true,
        }
      : {}),
    ...(spec.gear.retractable ? { gearRetractable: { transitS: 8, dCdExtended: 0.02 } } : {}),
    gear: gearLegs(spec),
    rollingResistance: 0.02,
    brakeMu: jet ? 0.45 : 0.3,
    tireCorneringPerRad: 8,
    tireLatMuCap: 0.75,
    vSpeeds: {
      // Placards from the EFFECTIVE (physics-capped) stall, not the spec
      // literal: vs0 from the full-flap CLmax ratio.
      vs0: Math.round(effStallKcas * Math.sqrt(clMaxClean / (clMaxClean + flapMaxDClMaxEff))),
      vs1: Math.round(effStallKcas),
      vx: Math.round(spec.vSpeeds.vyKcas * 0.9),
      vy: spec.vSpeeds.vyKcas,
      vfe10: Math.round(spec.vSpeeds.approachKcas * 1.5),
      vfe30: Math.round(spec.vSpeeds.approachKcas * 1.25),
      // Va from the SPEC stall, capped below Vno — the physics-capped
      // effective stall of a heavy (CLmax floor) pushed 1.95× past Vne
      // (the MD-11's Va exceeded its own redline).
      va: Math.min(Math.round(spec.stallCleanKcas * 1.95), Math.round(spec.vSpeeds.vneKcas * 0.8)),
      vno: Math.round(spec.vSpeeds.vneKcas * 0.83),
      vne: spec.vSpeeds.vneKcas,
      glide: spec.vSpeeds.glideKcas,
    },
    // pitotCal absent: IAS = CAS for every Tier-B type (disclosed).
  }
  const { jet: jetTuning, ...flatTuning } = spec.tuning ?? {}
  const merged: AircraftParams = { ...p, ...flatTuning }
  // Partial jet-block tuning deep-merges over the derived CFM56-anchored
  // block (X-Plane engine audit: per-type spool/TSFC/idle overrides).
  if (jetTuning && p.jet) merged.jet = { ...p.jet, ...jetTuning }
  return merged
}
