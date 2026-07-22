/**
 * Structural aircraft-parameter type (Phase 10a): the shape every fleet
 * member fills in. C172S is the reference instance; the shared sim modules
 * (aero/propulsion/gear/trim/aircraft) read ONLY through this interface, so
 * adding an aircraft is adding data, not forking physics. Jet-specific and
 * carburetor-specific fields are optional — a module keys off their presence,
 * never off an aircraft's name (§1: no special-casing the star of the show).
 */

export interface GearLeg {
  x: number // m fwd of CG
  y: number // m right of CG
  z: number // m below CG
  k: number // strut spring N/m
  c: number // strut damping N·s/m
  steerMaxRad: number // 0 = castoring/fixed
}

import type { JetParams } from '../turbofan'

export interface AircraftParams {
  /** Turbofan powerplant (Phase 11e). Present = jet: the piston/prop path
   *  (torque, P-factor, RPM) is bypassed; thrust comes from turbofan.ts.
   *  Jet aircraft should also set pFactorCn/propwashTailFactor to 0. */
  jet?: JetParams
  /** Retractable gear: transit time and the drag increment when extended.
   *  Absent = fixed gear (always down, no extra drag term). */
  gearRetractable?: { transitS: number; dCdExtended: number }
  /** Compressibility (Phase 11e): Prandtl–Glauert lift-slope correction and
   *  quadratic drag rise past the drag-divergence Mach. Absent = no Mach
   *  effects (piston fleet never gets near them). */
  machModel?: { mdd: number; dragRiseK: number }
  // geometry
  wingAreaM2: number
  spanM: number
  chordM: number
  oswald: number
  aspectRatio: number

  // mass & inertia
  emptyMassKg: number
  mtowKg: number
  fuelCapacityKg: number
  inertiaMtow: { ixx: number; iyy: number; izz: number }

  // lift
  cl0: number
  clAlpha: number
  clMaxClean: number
  clMin: number
  clDe: number
  clQ: number
  clAlphaDot: number

  // drag
  cd0: number
  cdBeta: number
  postStallCd: number

  // pitch
  cm0: number
  cmAlpha: number
  cmQ: number
  cmAlphaDot: number
  cmDe: number

  // lateral/directional
  cyBeta: number
  cyP: number
  cyR: number
  cyDr: number
  clBeta: number
  clP: number
  clR: number
  clDa: number
  clDr: number
  cnBeta: number
  cnP: number
  cnR: number
  cnDa: number
  cnDr: number

  // flaps (increments per detent; a flapless aircraft uses single-entry [0])
  flapDetentsDeg: readonly number[]
  flapDCl0: readonly number[]
  flapDClMax: readonly number[]
  flapDCd: readonly number[]
  flapDCm: readonly number[]
  flapRateDegS: number

  // control travels
  elevatorMaxRad: number
  aileronMaxRad: number
  rudderMaxRad: number
  trimMaxRad: number

  // stall shaping
  stallBlendWidthRad: number
  postStallCmDrop: number

  // piston propulsion (Phase 10c adds an optional jet block instead)
  ratedPowerW: number
  ratedRadS: number
  redlineRpm: number
  idleTorqueFraction: number
  propDiameterM: number
  rotInertiaKgM2: number
  bsfcKgPerWs: number
  /** J → Ct / J → Cp piecewise tables (moved from propulsion.ts in 10a). */
  propCtTable: ReadonlyArray<readonly [number, number]>
  propCpTable: ReadonlyArray<readonly [number, number]>
  /** Carbureted engine (carb-ice model applies); absent/false = injected. */
  carburetor?: boolean
  /** false = no electrical system (no battery/starter — hand-prop only).
   *  Absent means a normal electrical system. */
  electrical?: false
  /** Position-error calibration (KCAS→KIAS tables). Absent = no published
   *  table for this type: IAS = CAS, disclosed per tier notes. */
  pitotCal?: {
    clean: ReadonlyArray<readonly [number, number]>
    flap: ReadonlyArray<readonly [number, number]>
    flapFullDeg: number
  }

  propwashTailFactor: number
  pFactorCn: number

  // gear: three legs; tricycle uses `nose`, taildragger uses `tail`
  gear: {
    nose?: GearLeg
    tail?: GearLeg
    mainL: GearLeg
    mainR: GearLeg
  }
  rollingResistance: number
  brakeMu: number
  tireCorneringPerRad: number
  tireLatMuCap: number

  // reference speeds (KIAS, UI/tests)
  vSpeeds: {
    vs0: number
    vs1: number
    vx: number
    vy: number
    vfe10: number
    vfe30: number
    va: number
    vno: number
    vne: number
    glide: number
  }
}
