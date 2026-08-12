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
  /** Strut normal-force cap, N (numeric spike guard). Default 40 kN — the
   *  C172 value; transport-category legs MUST override or the airplane
   *  collapses through its own gear (found by the 737 browser landing). */
  maxNormalN?: number
}

import type { JetParams } from '../turbofan'

export interface AircraftParams {
  /** Turbofan powerplant (Phase 11e). Present = jet: the piston/prop path
   *  (torque, P-factor, RPM) is bypassed; thrust comes from turbofan.ts.
   *  Jet aircraft should also set pFactorK/swirlK/propwashTailFactor to 0. */
  jet?: JetParams
  /** Retractable gear: transit time and the drag increment when extended.
   *  Absent = fixed gear (always down, no extra drag term). */
  gearRetractable?: { transitS: number; dCdExtended: number }
  /** Compressibility (Phase 11e): Prandtl–Glauert lift-slope correction and
   *  quadratic drag rise past the drag-divergence Mach. Absent = no Mach
   *  effects (piston fleet never gets near them). */
  machModel?: { mdd: number; dragRiseK: number }
  /** true = pitch trim is a trimmable STABILIZER (jet transports): its
   *  authority adds beyond the elevator's travel stops. Absent/false =
   *  trim tab folded into the elevator limit (C172 behavior, bit-exact). */
  trimIsStabilizer?: boolean
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
  /** Constant-speed (governed) prop (12c): the governor pins RPM at
   *  redline — equilibrium and dynamics clamp there instead of
   *  overspeeding. Absent = fixed-pitch (C172 behavior, bit-exact).
   *  Simplification (documented): no prop lever — governed RPM sags with
   *  throttle instead of holding a set speed. */
  propGoverned?: true
  /** Governed-prop efficiency multiplier (per-type documented tuning —
   *  big slow discs beat the class η ramp, stubby props miss it). */
  propEtaScale?: number
  /** Turboprop flat-rating (12c): available power = min(1, thermoMargin ×
   *  GaggFerrar(ρ)) × rated — the thermodynamic margin that holds flat
   *  rating to altitude (PT6 class ~2.1). Absent = pure Gagg–Ferrar
   *  (normally-aspirated pistons, bit-exact legacy behavior). */
  thermoMargin?: number
  /** Carbureted engine (carb-ice model applies); absent/false = injected. */
  carburetor?: boolean
  /** false = no electrical system (no battery/starter — hand-prop only).
   *  Absent means a normal electrical system. */
  electrical?: false
  /** Aircraft has a stall-warning device (C172 vane+horn). The J-3 has
   *  none and the 737's stick shaker is not a horn — absent = silent. */
  stallHorn?: boolean
  /** Position-error calibration (KCAS→KIAS tables). Absent = no published
   *  table for this type: IAS = CAS, disclosed per tier notes. */
  pitotCal?: {
    clean: ReadonlyArray<readonly [number, number]>
    flap: ReadonlyArray<readonly [number, number]>
    flapFullDeg: number
  }

  propwashTailFactor: number
  /** P-factor gain (prop-effects.ts): yaw from asymmetric blade loading,
   *  N = −kP·T·R·(V·sinα)/vDisk. 0 for jets/gliders. */
  pFactorK: number
  /** Slipstream-swirl gain: fin yaw per N·m of engine torque (geometry
   *  constant, ~0.6 for a single with the fin in the slipstream). */
  swirlK: number
  /** Rigging compensation (real aircraft are built with it): offset fin /
   *  rudder-tab yaw coefficient and aileron-rigging roll coefficient,
   *  sized to null the prop's yaw (P-factor/slipstream) and roll (torque
   *  reaction) moments at the type's normal cruise. Constant-coefficient
   *  is the right shape — a fixed fin offset's moment scales with q just
   *  like the airframe terms. Below cruise power/speed the net is still
   *  left (full-power climb needs right rudder, honestly); at idle it
   *  over-compensates slightly right (also real — gliding 172s want a
   *  touch of left rudder). Omit (0) = unrigged. */
  rigCn?: number
  rigCl?: number

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
