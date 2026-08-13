/**
 * Boeing 737-800 (CFM56-7B26, winglets) — Tier A fleet member #3 (11f).
 *
 * Published anchors: S 124.6 m², span 34.32 m, OEW ≈ 41.4 t, MTOW 79.0 t,
 * usable fuel ≈ 20.9 t; Vref30 ≈ 140 kt at 60 t (FCTM class tables);
 * FL350 M0.785 cruise burn ≈ 2.4 t/h at mid-weight; cruise L/D ≈ 16–17.
 * Derivative buildup from published 737-class stability data + the same
 * estimation chains as the rest of the fleet; the flap and drag tables are
 * point-tuned to the b738 validation rows (documented policy, C172 prop
 * precedent).
 *
 * Honesty notes (PROGRESS): no CDU/FMC/MCP UI, no autothrottle servo, no
 * spoilers/speedbrakes, no CLB thrust derate (climb uses takeoff-rated
 * availability), PFD remains G1000-style with an honest jet EIS, pitot
 * calibration absent → IAS = CAS, no belly-slide (gear-up contact is a
 * crash). Full TCAS-II RA presentation remains a recorded gap.
 */
import type { AircraftParams } from './params'
import { CFM56_7B26 } from '../turbofan'

export const B738: AircraftParams = {
  // ---- geometry ----
  wingAreaM2: 124.6,
  spanM: 34.32,
  chordM: 4.17,
  oswald: 0.80,
  aspectRatio: 9.45,

  // ---- mass & inertia ----
  emptyMassKg: 41_413,
  mtowKg: 79_015,
  fuelCapacityKg: 20_894,
  inertiaMtow: { ixx: 1.45e6, iyy: 3.31e6, izz: 4.62e6 },

  // ---- lift ----
  cl0: 0.15,
  clAlpha: 5.0, // low-speed; Prandtl–Glauert grows it with Mach
  clMaxClean: 1.45,
  clMin: -0.8,
  clDe: 0.28,
  clQ: 4.6,
  clAlphaDot: 1.6,

  // ---- drag ----
  cd0: 0.0195,
  cdBeta: 0.15,
  postStallCd: 1.9,

  // ---- pitch ----
  cm0: 0.03,
  cmAlpha: -1.35,
  cmQ: -23,
  cmAlphaDot: -6.5,
  cmDe: -1.5,

  // ---- lateral/directional (737-class) ----
  cyBeta: -0.68,
  cyP: -0.03,
  cyR: 0.32,
  cyDr: 0.19,
  clBeta: -0.14, // sweep + dihedral
  clP: -0.48,
  clR: 0.14,
  clDa: 0.13,
  clDr: 0.008,
  cnBeta: 0.17,
  cnP: -0.03,
  cnR: -0.3,
  cnDa: -0.015,
  cnDr: -0.1,

  // ---- flaps 1/5/15/25/30/40 (Fowler: big CL0 shift, big drag late) ----
  flapDetentsDeg: [0, 1, 5, 15, 25, 30, 40],
  flapDCl0: [0, 0.08, 0.2, 0.38, 0.58, 0.72, 0.88],
  flapDClMax: [0, 0.12, 0.28, 0.48, 0.65, 0.8, 0.9],
  flapDCd: [0, 0.002, 0.006, 0.016, 0.038, 0.058, 0.09],
  flapDCm: [0, -0.01, -0.035, -0.075, -0.12, -0.15, -0.19],
  flapRateDegS: 1.5, // full travel ~27 s

  // ---- control travels ----
  elevatorMaxRad: 0.32,
  aileronMaxRad: 0.3,
  rudderMaxRad: 0.35,
  trimMaxRad: 0.22, // trimmable stabilizer authority

  // ---- stall shaping ----
  stallBlendWidthRad: 0.03,
  postStallCmDrop: -0.5,

  // ---- piston block: unused (jet present) — interface placeholder ----
  ratedPowerW: 1,
  ratedRadS: 1,
  redlineRpm: 1,
  idleTorqueFraction: 0,
  propDiameterM: 1,
  rotInertiaKgM2: 1,
  bsfcKgPerWs: 0,
  propCtTable: [[0, 0], [1, 0]],
  propCpTable: [[0, 0], [1, 0]],

  propwashTailFactor: 0, // no propwash
  pFactorK: 0, // no P-factor
  swirlK: 0,
  // Flight spoilers/speedbrake: in-flight drag + lift dump at full
  // deflection (class figures for a narrowbody: ΔCD ≈ 0.05, ΔCL ≈ 0.35);
  // ~1.2 s full travel. Symmetric speedbrake only (documented above).
  spoilers: { dCd: 0.05, dCl: 0.35, ratePerS: 0.85 },
  // CFM56 fan-air cascade reversers: ~45% of forward thrust at the same
  // N1 (class figure), ~1.5 s sleeve transit, weight-on-wheels interlock.
  reversers: { effectiveness: 0.45, transitS: 1.5 },

  jet: CFM56_7B26,
  machModel: { mdd: 0.82, dragRiseK: 20 },
  gearRetractable: { transitS: 9, dCdExtended: 0.02 },
  trimIsStabilizer: true, // jackscrew stab: authority beyond elevator stops

  // ---- gear: wheelbase 15.6 m, track 5.72 m; CG just ahead of mains ----
  gear: {
    nose: { x: 14.6, y: 0, z: 2.84, k: 2.4e6, c: 1.8e5, steerMaxRad: 0.6, maxNormalN: 5e5 },
    mainL: { x: -1.0, y: -2.86, z: 2.9, k: 6.2e6, c: 4.2e5, steerMaxRad: 0, maxNormalN: 1.4e6 },
    mainR: { x: -1.0, y: 2.86, z: 2.9, k: 6.2e6, c: 4.2e5, steerMaxRad: 0, maxNormalN: 1.4e6 },
  },
  rollingResistance: 0.014,
  brakeMu: 0.45,
  tireCorneringPerRad: 8,
  tireLatMuCap: 0.8,

  // ---- reference speeds (UI arcs; jet speeds vary with weight —
  // representative mid-weight values, Vne slot carries Vmo 340) ----
  vSpeeds: { vs0: 108, vs1: 142, vx: 165, vy: 175, vfe10: 250, vfe30: 175, va: 270, vno: 320, vne: 340, glide: 210 },
}
