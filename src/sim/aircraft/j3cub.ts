/**
 * Piper J-3 Cub (J3C-65) parameters — Tier A fleet member #2 (Phase 11c).
 *
 * Sources: published J3C-65 type data (span 35'3", area 178.5 ft², gross
 * 1,220 lb, Continental A-65-8 65 hp @ 2300, Sensenich ~72" wood prop),
 * USA 35B section characteristics, and the same estimation chains used for
 * the C172 (Helmbold-corrected lift slope, e·AR induced factor, Roskam
 * radius-of-gyration inertia class). Point figures are tuned only as far
 * as the j3cub validation table demands — same policy as the C172 prop.
 *
 * Honesty notes (recorded in PROGRESS):
 * - No published J-3 position-error table → `pitotCal` absent → IAS = CAS.
 *   The famous "38 mph stall" is INDICATED with the type's notoriously
 *   large high-α position error; true CAS stall is ~42 mph ≈ 36.5 kt,
 *   which is what our (calibrated-reading) gauge will show.
 * - Ct/Cp tables are the C172 table shapes rescaled to A-65 power and the
 *   72" wood prop, then point-tuned to the validation rows.
 * - No flaps, no electrical system (hand-prop only), carbureted.
 */
import type { AircraftParams } from './params'

export const J3CUB: AircraftParams = {
  // ---- geometry ----
  wingAreaM2: 16.58, // 178.5 ft²
  spanM: 10.74, // 35 ft 3 in
  chordM: 1.60,
  oswald: 0.78, // rectangular planform
  aspectRatio: 6.96,

  // ---- mass & inertia ----
  emptyMassKg: 345, // ~765 lb
  mtowKg: 553.4, // 1,220 lb
  fuelCapacityKg: 32.7, // 12 US gal
  inertiaMtow: { ixx: 590, iyy: 700, izz: 1100 }, // estimated (Roskam class)

  // ---- lift (USA 35B: heavily cambered, thick) ----
  cl0: 0.42, // α0L ≈ −5.5° at a ≈ 4.4/rad
  clAlpha: 4.38, // Helmbold-corrected for AR 6.96
  clMaxClean: 1.51, // 1-g stall ≈ 36.5 kt CAS at gross
  clMin: -0.6, // cambered section: weak inverted lift
  clDe: 0.35,
  clQ: 3.5,
  clAlphaDot: 1.5,

  // ---- drag (struts, wires, open cowl, bungee gear) ----
  cd0: 0.045,
  cdBeta: 0.18,
  postStallCd: 1.9,

  // ---- pitch ----
  cm0: -0.02, // cambered wing pitches down; balanced by tail at trim
  cmAlpha: -0.65, // shorter tail arm than the 172
  cmQ: -10.5,
  cmAlphaDot: -4.2,
  cmDe: -1.05,

  // ---- lateral/directional ----
  cyBeta: -0.28,
  cyP: -0.03,
  cyR: 0.2,
  cyDr: 0.17,
  clBeta: -0.055, // modest effective dihedral
  clP: -0.45,
  clR: 0.1,
  clDa: 0.16,
  clDr: 0.012,
  cnBeta: 0.052, // less fin volume than the 172
  cnP: -0.035,
  cnR: -0.09,
  cnDa: -0.06, // pronounced adverse yaw — the Cub teaches feet
  cnDr: -0.06,

  // ---- flaps: none ----
  flapDetentsDeg: [0],
  flapDCl0: [0],
  flapDClMax: [0],
  flapDCd: [0],
  flapDCm: [0],
  flapRateDegS: 1,

  // ---- control travels ----
  elevatorMaxRad: 0.44,
  aileronMaxRad: 0.32,
  rudderMaxRad: 0.42, // big rudder, big travel
  trimMaxRad: 0.14,

  // ---- stall shaping (gentle, mushing break) ----
  stallBlendWidthRad: 0.045,
  postStallCmDrop: -0.28,

  // ---- propulsion: Continental A-65-8 + wood prop ----
  ratedPowerW: 48_470, // 65 BHP
  ratedRadS: 240.86, // 2300 RPM
  redlineRpm: 2300,
  idleTorqueFraction: 0.12,
  propDiameterM: 1.83, // ~72 in
  rotInertiaKgM2: 0.7, // light wood prop
  bsfcKgPerWs: 7.6e-8,
  // C172 table shapes rescaled (×~0.58 = A-65 Cp at 2300 through D=1.83 m),
  // then point-tuned to the j3cub validation rows.
  propCtTable: [
    [0.0, 0.057],
    [0.26, 0.048],
    [0.47, 0.040],
    [0.6, 0.0335],
    [0.72, 0.0302],
    [0.78, 0.0243],
    [1.0, 0.007],
    [1.07, 0.0],
    [1.17, -0.033],
    [1.4, -0.079],
  ],
  propCpTable: [
    [0.0, 0.0343],
    [0.26, 0.0313],
    [0.747, 0.026],
    [0.95, 0.0233],
    [1.05, 0.0116],
    [1.15, -0.003],
    [1.3, -0.026],
  ],
  carburetor: true,
  electrical: false,
  // pitotCal: absent — IAS = CAS (see header)

  propwashTailFactor: 0.85, // everything sits in the slipstream
  pFactorCn: 0.05,
  // Rigging (fleet lateral-stability fix — see c172s.ts): LEVEL-cruise
  // bench audit at 70 kt TAS / 2,000 ft (own-params trim, throttle 0.87
  // level) gave prop-yaw coefficient 0.001476 and torque 161.1 N·m over
  // qS·span 133,340. pfInflowRefMs 20 kills only the static-pirouette
  // artifact — full moment by 39 kt, so the VALIDATED emergent
  // ground-loop at 38 kt (tail-up, feet asleep) keeps its historical
  // dynamics.
  rigCn: 0.001476,
  rigCl: 161.1 / 133_340,
  pfInflowRefMs: 20,

  // ---- gear: taildragger. Mains AHEAD of the CG (x +0.25 m) — the
  // ground-loop tendency is this geometry, not a scripted behavior. ----
  gear: {
    tail: { x: -4.11, y: 0, z: 0.55, k: 12_000, c: 1_100, steerMaxRad: 0.31 },
    mainL: { x: 0.25, y: -0.9, z: 1.25, k: 30_000, c: 2_600, steerMaxRad: 0 },
    mainR: { x: 0.25, y: 0.9, z: 1.25, k: 30_000, c: 2_600, steerMaxRad: 0 },
  },
  rollingResistance: 0.025, // grass-era tires
  brakeMu: 0.18, // heel brakes, famously weak
  tireCorneringPerRad: 6,
  tireLatMuCap: 0.7,

  // ---- reference speeds (KIAS=KCAS here; no flap arcs) ----
  vSpeeds: { vs0: 36, vs1: 36, vx: 45, vy: 52, vfe10: 0, vfe30: 0, va: 70, vno: 78, vne: 106, glide: 45 },
}
