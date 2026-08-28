/**
 * Tier-B roster (Phase 12c): published spec records for the proving set —
 * one of every powerplant/gear/flap combination — driven through
 * `derive.ts`. Numbers are published figures (POH/type-certificate/
 * manufacturer data); `targets` are what the validation table checks:
 * stall is CALIBRATED (see derive.ts header), cruise/climb are PREDICTED,
 * handling is INHERITED from the class anchor. Explicit `tuning` entries
 * are the documented per-type corrections — never silent widening.
 */
import type { RosterSpec, DeriveOptions } from './derive'

export interface RosterTargets {
  /** Max-level-speed check at altitude (props): published cruise TAS ±5%. */
  cruiseTasKt?: number
  cruiseAltFt?: number
  /** Jets: thrust-required at published cruise must sit in [35%, 92%] of
   *  available (drag model inside the envelope) — burn was Tier A's row. */
  jetCruise?: { mach: number; altFt: number }
  /** Published sea-level Vy climb, fpm (props ±20%; jets lower-bound). */
  climbFpm?: number
  climbIsMinimum?: boolean
  /** Gliders: published best L/D ±20% at the glide speed. */
  glideRatio?: number
}

export interface RosterEntry {
  spec: RosterSpec
  opts: DeriveOptions
  targets: RosterTargets
  /** B1 = curated, full rows (default). B2 = family variant / bulk entry:
   *  cruise band widens to ±10% and climb is not asserted — the honest
   *  fidelity ladder's bottom flyable rung. */
  tier?: 'B1' | 'B2'
}

/** Family inheritance (12d): a variant derives from a validated base with
 *  delta specs — stretch/shrink, weights, thrust — keeping the base's
 *  aero class and tunings unless overridden. */
export function variant(
  base: RosterEntry,
  spec: Partial<RosterSpec> & { designator: string; label: string },
  targets: RosterTargets,
  opts?: Partial<DeriveOptions>,
): RosterEntry {
  // Tuning MERGES over the base (one level + the jet block): a variant's
  // tuning override used to REPLACE the whole object, silently dropping
  // the base's documented control travels (the DA42 lost the Baron's).
  // An EXPLICIT `tuning: undefined` still clears it (the Arrow does this
  // on purpose to shed the Archer's prop tuning).
  const tuning = 'tuning' in spec
    ? spec.tuning === undefined
      ? undefined
      : {
          ...base.spec.tuning,
          ...spec.tuning,
          ...(base.spec.tuning?.jet || spec.tuning.jet
            ? { jet: { ...base.spec.tuning?.jet, ...spec.tuning.jet } }
            : {}),
        }
    : base.spec.tuning
  return {
    spec: { ...base.spec, ...spec, tuning },
    opts: { ...base.opts, ...(opts ?? {}) },
    targets,
    tier: 'B2',
  }
}

export const CORE_ROSTER: RosterEntry[] = [
  {
    spec: {
      designator: 'P28A', label: 'Piper Archer II',
      wingAreaM2: 15.8, spanM: 10.67, lengthM: 7.25,
      emptyKg: 758, mtowKg: 1157, fuelKg: 130,
      powerplant: { kind: 'piston', ratedPowerW: 134_225, count: 1, propDiameterM: 1.88, redlineRpm: 2700 },
      gear: { layout: 'tricycle' },
      flapDetentsDeg: [0, 10, 25, 40], flapMaxDClMax: 0.5,
      stallCleanKcas: 55,
      vSpeeds: { vyKcas: 76, approachKcas: 66, vneKcas: 154, glideKcas: 76 },
      // Tuning: first pass over-predicted climb 851 vs 667 — the Archer's
      // blunt cruise prop is less efficient at Vy than the C172 anchor.
      propThrustScale: 0.90,
    },
    opts: { cd0Class: 'fixedPistonSingle' },
    targets: { cruiseTasKt: 128, cruiseAltFt: 8000, climbFpm: 667 },
  },
  {
    spec: {
      designator: 'SR22', label: 'Cirrus SR22',
      wingAreaM2: 13.5, spanM: 11.68, lengthM: 7.92,
      emptyKg: 1009, mtowKg: 1633, fuelKg: 251,
      powerplant: { kind: 'piston', ratedPowerW: 231_170, count: 1, propDiameterM: 1.98, redlineRpm: 2700, governed: true },
      gear: { layout: 'tricycle' },
      flapDetentsDeg: [0, 16, 32], flapMaxDClMax: 0.55,
      stallCleanKcas: 73,
      vSpeeds: { vyKcas: 101, approachKcas: 85, vneKcas: 205, glideKcas: 88 },
      // Tuning: cruise under-predicted 168 vs 180 — the laminar composite
      // Cirrus is cleaner than the class cd0; set from the cruise anchor.
      // rudderMaxRad: SR22 carries a modest 15° rudder (X-Plane tail audit).
      tuning: { cd0: 0.0235, rudderMaxRad: 0.262 },
    },
    opts: { cd0Class: 'cleanPistonSingle' },
    targets: { cruiseTasKt: 180, cruiseAltFt: 8000, climbFpm: 1270 },
  },
  {
    spec: {
      designator: 'C182', label: 'Cessna 182T Skylane',
      wingAreaM2: 16.2, spanM: 11.0, lengthM: 8.84,
      emptyKg: 894, mtowKg: 1406, fuelKg: 236,
      powerplant: { kind: 'piston', ratedPowerW: 171_512, count: 1, propDiameterM: 2.03, redlineRpm: 2400, governed: true },
      gear: { layout: 'tricycle' },
      flapDetentsDeg: [0, 10, 20, 30], flapMaxDClMax: 0.5,
      stallCleanKcas: 54,
      vSpeeds: { vyKcas: 80, approachKcas: 70, vneKcas: 175, glideKcas: 76 },
    },
    opts: { cd0Class: 'fixedPistonSingle' },
    targets: { cruiseTasKt: 145, cruiseAltFt: 8000, climbFpm: 924 },
  },
  {
    spec: {
      designator: 'PA18', label: 'Piper Super Cub 150',
      wingAreaM2: 16.6, spanM: 10.73, lengthM: 6.88,
      emptyKg: 422, mtowKg: 794, fuelKg: 98,
      powerplant: { kind: 'piston', ratedPowerW: 111_855, count: 1, propDiameterM: 1.88, redlineRpm: 2700 },
      gear: { layout: 'taildragger' },
      flapDetentsDeg: [0, 25, 50], flapMaxDClMax: 0.45,
      stallCleanKcas: 41,
      vSpeeds: { vyKcas: 65, approachKcas: 55, vneKcas: 132, glideKcas: 65 },
      // Tuning: cruise over-predicted 111 vs 100 — bungee gear, exposed
      // wires and no fairings put the real Super Cub above the class cd0.
      tuning: { cd0: 0.054 },
    },
    opts: { cd0Class: 'bushTaildragger' },
    targets: { cruiseTasKt: 100, cruiseAltFt: 6000, climbFpm: 960 },
  },
  {
    spec: {
      designator: 'BE58', label: 'Beechcraft Baron 58',
      wingAreaM2: 18.5, spanM: 11.53, lengthM: 9.09,
      emptyKg: 1732, mtowKg: 2495, fuelKg: 452,
      powerplant: { kind: 'piston', ratedPowerW: 223_710, count: 2, propDiameterM: 1.96, redlineRpm: 2700, governed: true },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 12, 30], flapMaxDClMax: 0.5,
      stallCleanKcas: 84,
      vSpeeds: { vyKcas: 105, approachKcas: 96, vneKcas: 223, glideKcas: 115 },
      // X-Plane tail audit: Baron ailerons 18/12 (mean 15°) — inherited 20°
      // was high; rudder 25-27° (twin Vmca sizing) — inherited 20° was low.
      tuning: { aileronMaxRad: 0.262, rudderMaxRad: 0.436 },
    },
    opts: { cd0Class: 'pistonTwin' },
    targets: { cruiseTasKt: 200, cruiseAltFt: 7000, climbFpm: 1735 },
  },
  {
    spec: {
      designator: 'TBM9', label: 'Daher TBM 930',
      wingAreaM2: 18.0, spanM: 12.83, lengthM: 10.72,
      emptyKg: 2097, mtowKg: 3354, fuelKg: 806,
      powerplant: { kind: 'turboprop', ratedPowerW: 633_845, count: 1, propDiameterM: 2.31, redlineRpm: 2000, thermoMargin: 2.5 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 10, 34], flapMaxDClMax: 0.6,
      stallCleanKcas: 78,
      vSpeeds: { vyKcas: 124, approachKcas: 85, vneKcas: 271, glideKcas: 120 },
      // Tuning: cruise −1.5% short at the class cd0 — the TBM is the
      // slickest single-turboprop flying; set from the cruise anchor.
      tuning: { cd0: 0.0196 }, // (rig pins superseded by the self-audit)
    },
    opts: { cd0Class: 'turbopropSingle' },
    targets: { cruiseTasKt: 330, cruiseAltFt: 28_000, climbFpm: 2380 },
  },
  {
    spec: {
      designator: 'B350', label: 'King Air 350',
      wingAreaM2: 28.8, spanM: 17.65, lengthM: 14.22,
      emptyKg: 4100, mtowKg: 6804, fuelKg: 1646,
      powerplant: { kind: 'turboprop', ratedPowerW: 783_000, count: 2, propDiameterM: 2.67, redlineRpm: 1700, thermoMargin: 2.16 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 14, 35], flapMaxDClMax: 0.6,
      stallCleanKcas: 99,
      vSpeeds: { vyKcas: 135, approachKcas: 110, vneKcas: 263, glideKcas: 135 },
    },
    opts: { cd0Class: 'turbopropTwin' },
    targets: { cruiseTasKt: 312, cruiseAltFt: 28_000, climbFpm: 2731 },
  },
  {
    spec: {
      designator: 'DHC6', label: 'DHC-6 Twin Otter',
      wingAreaM2: 39.0, spanM: 19.8, lengthM: 15.77,
      emptyKg: 3363, mtowKg: 5670, fuelKg: 1172,
      powerplant: { kind: 'turboprop', ratedPowerW: 462_180, count: 2, propDiameterM: 2.59, redlineRpm: 2200, thermoMargin: 1.6 },
      gear: { layout: 'tricycle' },
      flapDetentsDeg: [0, 10, 20, 37], flapMaxDClMax: 0.75,
      stallCleanKcas: 74,
      vSpeeds: { vyKcas: 100, approachKcas: 75, vneKcas: 170, glideKcas: 95 },
      // Tuning: the Twin Otter is a fixed-gear strutted STOL box — its
      // published 160 kt on 1,240 shp implies cd0 far above the class
      // (equivalent flat plate ~2.4 m²); set from the cruise anchor. The
      // big slow discs beat the class climb-η ramp (propThrustScale).
      // (both knobs express the same STOL truth: climb-optimized big
      // discs AND barn-door parasite drag)
      tuning: { cd0: 0.085 },
      propThrustScale: 1.22,
    },
    opts: { cd0Class: 'turbopropTwin' },
    targets: { cruiseTasKt: 160, cruiseAltFt: 10_000, climbFpm: 1600 },
  },
  {
    spec: {
      designator: 'C25A', label: 'Citation CJ2',
      wingAreaM2: 24.5, spanM: 15.19, lengthM: 14.53,
      emptyKg: 3466, mtowKg: 5670, fuelKg: 1783,
      powerplant: { kind: 'jet', staticThrustN: 10_680, count: 2 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 15, 35], flapMaxDClMax: 0.7,
      stallCleanKcas: 94,
      vSpeeds: { vyKcas: 160, approachKcas: 110, vneKcas: 305, glideKcas: 160 },
    },
    opts: { cd0Class: 'bizjet', sweptJet: false },
    targets: { jetCruise: { mach: 0.66, altFt: 35_000 }, climbFpm: 2500, climbIsMinimum: true },
  },
  {
    spec: {
      designator: 'E75L', label: 'Embraer E175',
      wingAreaM2: 72.72, spanM: 28.65, lengthM: 31.68,
      emptyKg: 21_890, mtowKg: 40_370, fuelKg: 9335,
      powerplant: { kind: 'jet', staticThrustN: 63_200, count: 2 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 7, 20, 37], flapMaxDClMax: 0.85,
      stallCleanKcas: 115,
      vSpeeds: { vyKcas: 200, approachKcas: 126, vneKcas: 320, glideKcas: 210 },
    },
    opts: { cd0Class: 'airliner', sweptJet: true },
    targets: { jetCruise: { mach: 0.78, altFt: 35_000 }, climbFpm: 2000, climbIsMinimum: true },
  },
  {
    spec: {
      designator: 'A320', label: 'Airbus A320',
      wingAreaM2: 122.4, spanM: 35.8, lengthM: 37.57,
      emptyKg: 42_600, mtowKg: 78_000, fuelKg: 18_728,
      powerplant: { kind: 'jet', staticThrustN: 120_000, count: 2 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 10, 15, 20, 35], flapMaxDClMax: 0.85,
      stallCleanKcas: 118,
      vSpeeds: { vyKcas: 200, approachKcas: 136, vneKcas: 350, glideKcas: 210 },
    },
    opts: { cd0Class: 'airliner', sweptJet: true },
    targets: { jetCruise: { mach: 0.78, altFt: 36_000 }, climbFpm: 2200, climbIsMinimum: true },
  },
  {
    // Family-variant derivation: the -900ER differs from the Tier-A B738
    // by stretch/weights — proves 12d's variant mechanism early.
    spec: {
      designator: 'B739', label: 'Boeing 737-900ER',
      wingAreaM2: 124.6, spanM: 35.8, lengthM: 42.1,
      emptyKg: 44_676, mtowKg: 85_130, fuelKg: 20_894,
      powerplant: { kind: 'jet', staticThrustN: 121_000, count: 2 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 1, 5, 15, 25, 30, 40], flapMaxDClMax: 0.9,
      stallCleanKcas: 121,
      vSpeeds: { vyKcas: 200, approachKcas: 144, vneKcas: 340, glideKcas: 210 },
    },
    opts: { cd0Class: 'airliner', sweptJet: true },
    targets: { jetCruise: { mach: 0.785, altFt: 35_000 }, climbFpm: 2000, climbIsMinimum: true },
  },
  {
    spec: {
      designator: 'B763', label: 'Boeing 767-300ER',
      wingAreaM2: 283.3, spanM: 47.57, lengthM: 54.94,
      emptyKg: 90_011, mtowKg: 186_880, fuelKg: 63_000,
      powerplant: { kind: 'jet', staticThrustN: 276_000, count: 2 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 1, 5, 15, 20, 25, 30], flapMaxDClMax: 0.85,
      stallCleanKcas: 150,
      vSpeeds: { vyKcas: 250, approachKcas: 140, vneKcas: 360, glideKcas: 240 },
    },
    opts: { cd0Class: 'airliner', sweptJet: true },
    targets: { jetCruise: { mach: 0.80, altFt: 35_000 }, climbFpm: 2000, climbIsMinimum: true },
  },
  {
    spec: {
      designator: 'B744', label: 'Boeing 747-400',
      wingAreaM2: 511, spanM: 64.44, lengthM: 70.67,
      emptyKg: 178_756, mtowKg: 396_890, fuelKg: 173_000,
      powerplant: { kind: 'jet', staticThrustN: 276_000, count: 4 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 1, 5, 10, 20, 25, 30], flapMaxDClMax: 0.9,
      stallCleanKcas: 165,
      vSpeeds: { vyKcas: 290, approachKcas: 154, vneKcas: 365, glideKcas: 250 },
      // Tuning: the 747's supercritical-era wing has drag divergence near
      // M0.86 (it CRUISES at M0.85) — the M0.82 fleet default is 737-class.
      tuning: { machModel: { mdd: 0.86, dragRiseK: 20 } },
    },
    opts: { cd0Class: 'airliner', sweptJet: true },
    targets: { jetCruise: { mach: 0.85, altFt: 35_000 }, climbFpm: 1500, climbIsMinimum: true },
  },
  {
    spec: {
      designator: 'AS21', label: 'Schleicher ASK 21',
      wingAreaM2: 17.95, spanM: 17.0, lengthM: 8.35,
      emptyKg: 360, mtowKg: 600, fuelKg: 0.1,
      powerplant: { kind: 'none' },
      gear: { layout: 'taildragger' },
      flapDetentsDeg: [0], flapMaxDClMax: 0,
      stallCleanKcas: 35,
      vSpeeds: { vyKcas: 49, approachKcas: 49, vneKcas: 151, glideKcas: 49 },
      // X-Plane tail audit: a 17-m glider carries 2/3 the C172's pitch
      // volume (cmAlpha ×0.66) and HALF its weathercock (cnBeta ×0.45,
      // cnR ×0.27) with a huge 35° rudder — the coordination workload IS
      // the glider experience; inherited C172 values erased it. cmQ stays
      // (long arm compensates in the arm-squared term).
      tuning: { cmAlpha: -0.59, cnBeta: 0.029, cnR: -0.027, rudderMaxRad: 0.611 },
    },
    opts: { cd0Class: 'glider' },
    targets: { glideRatio: 34 },
  },
]

