/**
 * Cessna 172S (G1000) parameters — the single source of truth for the flight
 * model. Starting values from the POH, Roskam's published C172 derivative
 * tables, and standard prop theory; tuned only as far as needed to pass the
 * §5.6 POH validation table. Units SI, angles rad, derivatives per rad.
 */

import type { AircraftParams } from './params'
import { C172_PITOT_CAL } from '../atmosphere'

export const C172S: AircraftParams = {
  // POH position-error calibration (same object the atmosphere module
  // defaults to — explicitly wired so the fleet path is bit-exact).
  pitotCal: C172_PITOT_CAL,
  stallHorn: true, // AoA vane + horn
  // ---- geometry ----
  wingAreaM2: 16.165, // 174 ft²
  spanM: 11.0, // 36.1 ft
  chordM: 1.494, // MAC ≈ 4.9 ft
  oswald: 0.75,
  aspectRatio: 7.48, // b²/S

  // ---- mass & inertia (MTOW; inertia scales with mass) ----
  emptyMassKg: 762, // ~1680 lb (G1000 empty)
  mtowKg: 1156.6, // 2550 lb
  fuelCapacityKg: 144.2, // 53 US gal usable @ 6 lb/gal
  inertiaMtow: { ixx: 1285, iyy: 1825, izz: 2667 }, // kg·m² (948/1346/1967 slug·ft²)

  // ---- lift ----
  cl0: 0.31,
  clAlpha: 5.1,
  clMaxClean: 1.63,
  clMin: -1.0,
  clDe: 0.43, // elevator lift
  clQ: 3.9,
  clAlphaDot: 1.7,

  // ---- drag ----
  cd0: 0.034,
  // induced factor k = 1/(π e AR)
  cdBeta: 0.17, // sideslip drag ∝ β²
  postStallCd: 1.9, // flat-plate blend target

  // ---- pitch ----
  cm0: 0.02,
  cmAlpha: -0.89,
  cmQ: -12.4,
  cmAlphaDot: -5.2,
  cmDe: -1.28,

  // ---- lateral/directional ----
  cyBeta: -0.31,
  cyP: -0.037,
  cyR: 0.21,
  cyDr: 0.187,
  clBeta: -0.089,
  clP: -0.47,
  clR: 0.096,
  clDa: 0.178,
  clDr: 0.0147,
  cnBeta: 0.065,
  cnP: -0.03,
  cnR: -0.099,
  cnDa: -0.053, // adverse yaw
  cnDr: -0.0657,

  // ---- flaps (0/10/20/30°): increments at each detent ----
  flapDetentsDeg: [0, 10, 20, 30],
  flapDCl0: [0, 0.2, 0.38, 0.55],
  flapDClMax: [0, 0.17, 0.27, 0.36],
  flapDCd: [0, 0.011, 0.03, 0.062],
  flapDCm: [0, -0.03, -0.06, -0.09],
  flapRateDegS: 8, // electric actuator travel rate

  // ---- control travels (rad), input in [-1, 1] ----
  elevatorMaxRad: 0.436, // ±25°
  aileronMaxRad: 0.35, // ±20°
  rudderMaxRad: 0.35, // ±20°
  trimMaxRad: 0.175, // ±10° equivalent elevator

  // ---- stall shaping ----
  stallBlendWidthRad: 0.035, // ~2°
  postStallCmDrop: -0.4, // nose-down break strength

  // ---- propulsion: Lycoming IO-360-L2A + fixed-pitch McCauley ----
  ratedPowerW: 134_225, // 180 BHP (brake)
  ratedRadS: 282.74, // 2700 RPM
  redlineRpm: 2700,
  idleTorqueFraction: 0.11, // idle circuit holds ~700 RPM static
  propDiameterM: 1.93, // 76 in
  rotInertiaKgM2: 1.6, // prop + engine rotating assembly
  bsfcKgPerWs: 7.27e-8, // 0.43 lb/hp/hr

  // J → Ct / J → Cp piecewise tables (point-tuned so the §5.6 POH table
  // passes; moved verbatim from propulsion.ts in the 10a fleet refactor).
  // Windmilling Ct branch reaches ~0.1·disk-area equivalent plate drag.
  propCtTable: [
    [0.0, 0.098],
    [0.26, 0.082],
    [0.47, 0.0684],
    [0.6, 0.0575],
    [0.72, 0.052],
    [0.78, 0.0418],
    [1.0, 0.012],
    [1.07, 0.0],
    [1.17, -0.056],
    [1.4, -0.135],
  ],
  propCpTable: [
    [0.0, 0.059],
    [0.26, 0.0538],
    [0.747, 0.0448],
    [0.95, 0.04],
    [1.05, 0.02],
    [1.15, -0.005],
    [1.3, -0.045],
  ],

  // propwash: fraction of disk-loading Δq reaching the tail
  propwashTailFactor: 0.7,
  // Prop-effect gains (prop-effects.ts): calibrated so the total yaw at
  // the audited 110 KIAS / 75% cruise reproduces the legacy −236.8 N·m
  // the AP lateral law was re-tuned against (swirl share from the old
  // model's alpha-floor: kS = 192.7/317.7; P-factor takes the rest).
  pFactorK: 2.397,
  swirlK: 0.607,
  // Rigging (offset fin + aileron rigging, like the real airplane): sized
  // to null the measured prop moments at 110 KIAS / 75% / 3,000 ft —
  // P-factor yaw −236.8 N·m and torque roll −317.7 N·m over qS·span
  // 307,678 (bench audit). Before rigging the model flew hands-off
  // cruise into a 45°-bank spiral inside 40 s.
  // Scaled +8% from the exact-cruise derivation: a fixed tab is a
  // compromise across the envelope, and the browser's typical hands-off
  // condition (~102 KIAS, mid fuel, 2,500 ft) sits below the 110-KIAS
  // audit point where q·S is 14% smaller — nulling mid-envelope leaves a
  // slight RIGHT tendency at exactly 110/MTOW and a slight LEFT below,
  // like the real airplane's ground-adjustable tab.
  rigCn: (236.8 / 307_678) * 1.08,
  rigCl: (317.7 / 307_678) * 1.08,

  // ---- gear (positions rel. CG, body frame x fwd / y right / z down) ----
  gear: {
    nose: { x: 1.3, y: 0, z: 1.3, k: 30_000, c: 3_200, steerMaxRad: 0.17 },
    mainL: { x: -0.35, y: -1.15, z: 1.32, k: 62_000, c: 5_500, steerMaxRad: 0 },
    mainR: { x: -0.35, y: 1.15, z: 1.32, k: 62_000, c: 5_500, steerMaxRad: 0 },
  },
  rollingResistance: 0.02,
  brakeMu: 0.3,
  tireCorneringPerRad: 10, // light-aircraft tire ~0.1-0.2/deg; midpoint (was 8)
  tireLatMuCap: 0.75,

  // ---- reference speeds (KIAS, for UI/tests) ----
  vSpeeds: { vs0: 40, vs1: 48, vx: 62, vy: 74, vfe10: 110, vfe30: 85, va: 105, vno: 129, vne: 163, glide: 68 },
}

export type C172SParams = typeof C172S

/** Linear interpolation over the flap detent tables by current flap angle. */
export function flapInterp(
  table: readonly number[],
  flapsDeg: number,
  detents: readonly number[] = C172S.flapDetentsDeg,
): number {
  if (detents.length < 2) return table[0] ?? 0 // flapless aircraft
  const f = Math.min(Math.max(flapsDeg, 0), detents[detents.length - 1]!)
  for (let i = 1; i < detents.length; i++) {
    if (f <= detents[i]!) {
      const t = (f - detents[i - 1]!) / (detents[i]! - detents[i - 1]!)
      return table[i - 1]! + t * (table[i]! - table[i - 1]!)
    }
  }
  return table[table.length - 1]!
}
