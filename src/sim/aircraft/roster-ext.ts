/**
 * Tier-B roster expansion (Phase 12d): wave 2 — curated B1 types with full
 * validation rows — and wave 3 — B2 family variants through `variant()`
 * (2-row sanity: calibrated stall + cruise ±10% / jet envelope; climb not
 * asserted). Numbers are published figures at spec coarseness; per-type
 * tunings are documented inline. Handling remains INHERITED (class
 * anchors) for every entry — the Tier-B ladder from derive.ts applies.
 */
import { CORE_ROSTER, variant, type RosterEntry } from './roster-core'

const core = (d: string): RosterEntry => {
  const e = CORE_ROSTER.find((r) => r.spec.designator === d)
  if (!e) throw new Error(`roster-ext: missing core base ${d}`)
  return e
}

// ---- Wave 2: curated B1 ----
const WAVE2: RosterEntry[] = [
  {
    spec: {
      designator: 'C152', label: 'Cessna 152',
      wingAreaM2: 14.6, spanM: 10.2, lengthM: 7.34,
      emptyKg: 490, mtowKg: 757, fuelKg: 66,
      powerplant: { kind: 'piston', ratedPowerW: 82_027, count: 1, propDiameterM: 1.75, redlineRpm: 2550 },
      gear: { layout: 'tricycle' },
      flapDetentsDeg: [0, 10, 20, 30], flapMaxDClMax: 0.5,
      stallCleanKcas: 43,
      vSpeeds: { vyKcas: 67, approachKcas: 60, vneKcas: 149, glideKcas: 60 },
      propThrustScale: 0.85, // O-235 climb prop: cruise anchor sets the scale
    },
    opts: { cd0Class: 'fixedPistonSingle' },
    targets: { cruiseTasKt: 107, cruiseAltFt: 8000, climbFpm: 715 },
  },
  {
    spec: {
      designator: 'BE36', label: 'Beechcraft Bonanza G36',
      wingAreaM2: 16.8, spanM: 10.2, lengthM: 8.38,
      emptyKg: 1211, mtowKg: 1656, fuelKg: 224,
      powerplant: { kind: 'piston', ratedPowerW: 223_710, count: 1, propDiameterM: 2.03, redlineRpm: 2700, governed: true },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 12, 30], flapMaxDClMax: 0.5,
      stallCleanKcas: 72,
      vSpeeds: { vyKcas: 100, approachKcas: 85, vneKcas: 205, glideKcas: 105 },
      tuning: { cd0: 0.0223 }, // cruise anchor: cleaner than the class
    },
    opts: { cd0Class: 'retractPistonSingle', oswald: 0.78 },
    targets: { cruiseTasKt: 176, cruiseAltFt: 8000, climbFpm: 1230 },
  },
  {
    spec: {
      designator: 'M20P', label: 'Mooney M20J 201',
      wingAreaM2: 16.3, spanM: 11.0, lengthM: 7.52,
      emptyKg: 733, mtowKg: 1247, fuelKg: 175,
      powerplant: { kind: 'piston', ratedPowerW: 149_140, count: 1, propDiameterM: 1.88, redlineRpm: 2700, governed: true },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 15, 33], flapMaxDClMax: 0.5,
      stallCleanKcas: 59,
      vSpeeds: { vyKcas: 88, approachKcas: 70, vneKcas: 195, glideKcas: 91 },
      // Tuning: the 201's famous drag cleanup beats the retract class.
      tuning: { cd0: 0.021 },
    },
    opts: { cd0Class: 'retractPistonSingle' },
    targets: { cruiseTasKt: 160, cruiseAltFt: 8000, climbFpm: 1030 },
  },
  {
    spec: {
      designator: 'C206', label: 'Cessna T206H Stationair',
      wingAreaM2: 16.3, spanM: 10.97, lengthM: 8.61,
      emptyKg: 1015, mtowKg: 1633, fuelKg: 240,
      powerplant: { kind: 'piston', ratedPowerW: 223_710, count: 1, propDiameterM: 2.03, redlineRpm: 2700, governed: true },
      gear: { layout: 'tricycle' },
      flapDetentsDeg: [0, 10, 20, 40], flapMaxDClMax: 0.55,
      stallCleanKcas: 57,
      vSpeeds: { vyKcas: 89, approachKcas: 75, vneKcas: 182, glideKcas: 85 },
    },
    opts: { cd0Class: 'fixedPistonSingle' },
    targets: { cruiseTasKt: 145, cruiseAltFt: 8000, climbFpm: 989 },
  },
  {
    spec: {
      designator: 'SR20', label: 'Cirrus SR20',
      wingAreaM2: 13.5, spanM: 11.68, lengthM: 7.92,
      emptyKg: 953, mtowKg: 1386, fuelKg: 152,
      powerplant: { kind: 'piston', ratedPowerW: 160_330, count: 1, propDiameterM: 1.88, redlineRpm: 2700, governed: true },
      gear: { layout: 'tricycle' },
      flapDetentsDeg: [0, 16, 32], flapMaxDClMax: 0.55,
      stallCleanKcas: 69,
      vSpeeds: { vyKcas: 96, approachKcas: 80, vneKcas: 200, glideKcas: 88 },
      tuning: { cd0: 0.026 }, // composite, wheel pants — between classes
    },
    opts: { cd0Class: 'cleanPistonSingle' },
    targets: { cruiseTasKt: 155, cruiseAltFt: 8000, climbFpm: 828 },
  },
  {
    spec: {
      designator: 'DA40', label: 'Diamond DA40 Star',
      wingAreaM2: 13.5, spanM: 11.94, lengthM: 8.06,
      emptyKg: 795, mtowKg: 1200, fuelKg: 106,
      powerplant: { kind: 'piston', ratedPowerW: 134_225, count: 1, propDiameterM: 1.9, redlineRpm: 2700 },
      gear: { layout: 'tricycle' },
      flapDetentsDeg: [0, 15, 42], flapMaxDClMax: 0.5,
      stallCleanKcas: 52,
      vSpeeds: { vyKcas: 72, approachKcas: 67, vneKcas: 178, glideKcas: 73 },
      tuning: { cd0: 0.0335 }, // cruise anchor (climb prop below)
      propThrustScale: 1.06,
    },
    opts: { cd0Class: 'cleanPistonSingle' },
    targets: { cruiseTasKt: 135, cruiseAltFt: 8000, climbFpm: 1120 },
  },
  {
    spec: {
      designator: 'DHC2', label: 'DHC-2 Beaver',
      wingAreaM2: 23.2, spanM: 14.63, lengthM: 9.22,
      emptyKg: 1361, mtowKg: 2313, fuelKg: 347,
      powerplant: { kind: 'piston', ratedPowerW: 335_565, count: 1, propDiameterM: 2.59, redlineRpm: 2300, governed: true },
      gear: { layout: 'taildragger' },
      flapDetentsDeg: [0, 15, 40], flapMaxDClMax: 0.6,
      stallCleanKcas: 52,
      vSpeeds: { vyKcas: 80, approachKcas: 65, vneKcas: 155, glideKcas: 80 },
      tuning: { cd0: 0.055 }, // radial + struts + bush plumbing (cruise anchor)
    },
    opts: { cd0Class: 'bushTaildragger' },
    targets: { cruiseTasKt: 120, cruiseAltFt: 5000, climbFpm: 1020 },
  },
  {
    spec: {
      designator: 'P51', label: 'P-51D Mustang',
      wingAreaM2: 21.65, spanM: 11.28, lengthM: 9.83,
      emptyKg: 3465, mtowKg: 5262, fuelKg: 490,
      powerplant: { kind: 'piston', ratedPowerW: 1_111_000, count: 1, propDiameterM: 3.4, redlineRpm: 3000, governed: true },
      gear: { layout: 'taildragger', retractable: true },
      flapDetentsDeg: [0, 20, 50], flapMaxDClMax: 0.6,
      stallCleanKcas: 90,
      vSpeeds: { vyKcas: 150, approachKcas: 120, vneKcas: 439, glideKcas: 150 },
      // Tuning: the laminar-flow wing — cruise anchor sets cd0; the
      // paddle-blade prop beats the class climb-η ramp.
      tuning: { cd0: 0.019 },
      propThrustScale: 1.12,
    },
    opts: { cd0Class: 'retractPistonSingle' },
    // 3,200 fpm is the ~9,500 lb combat figure; at 12,100 lb MTOW the
    // book number is ~2,150 (documented).
    targets: { cruiseTasKt: 275, cruiseAltFt: 10_000, climbFpm: 2150 },
  },
  {
    spec: {
      designator: 'E300', label: 'Extra 300L',
      wingAreaM2: 10.7, spanM: 8.0, lengthM: 6.94,
      emptyKg: 680, mtowKg: 950, fuelKg: 120,
      powerplant: { kind: 'piston', ratedPowerW: 223_710, count: 1, propDiameterM: 1.98, redlineRpm: 2700, governed: true },
      gear: { layout: 'taildragger' },
      flapDetentsDeg: [0], flapMaxDClMax: 0,
      stallCleanKcas: 55,
      vSpeeds: { vyKcas: 96, approachKcas: 80, vneKcas: 220, glideKcas: 90 },
      tuning: { cd0: 0.036 }, // fixed gear + struts + flat plates everywhere
      propThrustScale: 1.18, // MT climb prop
    },
    opts: { cd0Class: 'cleanPistonSingle' },
    targets: { cruiseTasKt: 170, cruiseAltFt: 6000, climbFpm: 3200 },
  },
  {
    spec: {
      designator: 'PC12', label: 'Pilatus PC-12 NG',
      wingAreaM2: 25.81, spanM: 16.28, lengthM: 14.4,
      emptyKg: 2761, mtowKg: 4740, fuelKg: 1226,
      powerplant: { kind: 'turboprop', ratedPowerW: 894_840, count: 1, propDiameterM: 2.67, redlineRpm: 1700, thermoMargin: 2.4 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 15, 30, 40], flapMaxDClMax: 0.65,
      stallCleanKcas: 92,
      vSpeeds: { vyKcas: 120, approachKcas: 85, vneKcas: 240, glideKcas: 115 },
      propThrustScale: 0.97,
    },
    opts: { cd0Class: 'turbopropSingle' },
    targets: { cruiseTasKt: 280, cruiseAltFt: 28_000, climbFpm: 1920 },
  },
  {
    spec: {
      designator: 'C208', label: 'Cessna 208B Grand Caravan',
      wingAreaM2: 25.96, spanM: 15.88, lengthM: 12.68,
      emptyKg: 2145, mtowKg: 3629, fuelKg: 1009,
      powerplant: { kind: 'turboprop', ratedPowerW: 503_347, count: 1, propDiameterM: 2.69, redlineRpm: 1900, thermoMargin: 1.6 },
      gear: { layout: 'tricycle' },
      flapDetentsDeg: [0, 10, 20, 30], flapMaxDClMax: 0.65,
      stallCleanKcas: 70,
      vSpeeds: { vyKcas: 104, approachKcas: 85, vneKcas: 175, glideKcas: 95 },
      tuning: { cd0: 0.045 }, // fixed gear + cargo pod
    },
    opts: { cd0Class: 'turbopropSingle' },
    targets: { cruiseTasKt: 175, cruiseAltFt: 10_000, climbFpm: 925 },
  },
  {
    spec: {
      designator: 'AT76', label: 'ATR 72-600',
      wingAreaM2: 61.0, spanM: 27.05, lengthM: 27.17,
      emptyKg: 13_010, mtowKg: 23_000, fuelKg: 5000,
      powerplant: { kind: 'turboprop', ratedPowerW: 1_846_000, count: 2, propDiameterM: 3.93, redlineRpm: 1200, thermoMargin: 1.7 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 15, 30], flapMaxDClMax: 0.75,
      stallCleanKcas: 105,
      vSpeeds: { vyKcas: 140, approachKcas: 115, vneKcas: 250, glideKcas: 150 },
      propThrustScale: 0.84,
    },
    opts: { cd0Class: 'turbopropTwin' },
    targets: { cruiseTasKt: 275, cruiseAltFt: 20_000, climbFpm: 1355 },
  },
  {
    spec: {
      designator: 'SF34', label: 'Saab 340B',
      wingAreaM2: 41.8, spanM: 21.44, lengthM: 19.73,
      emptyKg: 8140, mtowKg: 13_155, fuelKg: 3220,
      powerplant: { kind: 'turboprop', ratedPowerW: 1_305_000, count: 2, propDiameterM: 3.35, redlineRpm: 1400, thermoMargin: 1.7 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 15, 35], flapMaxDClMax: 0.7,
      stallCleanKcas: 100,
      vSpeeds: { vyKcas: 140, approachKcas: 115, vneKcas: 250, glideKcas: 140 },
      tuning: { cd0: 0.028 },
      propThrustScale: 0.85,
    },
    opts: { cd0Class: 'turbopropTwin' },
    targets: { cruiseTasKt: 280, cruiseAltFt: 20_000, climbFpm: 2000 },
  },
  {
    spec: {
      designator: 'B190', label: 'Beechcraft 1900D',
      wingAreaM2: 28.8, spanM: 17.67, lengthM: 17.63,
      emptyKg: 4732, mtowKg: 7765, fuelKg: 2022,
      powerplant: { kind: 'turboprop', ratedPowerW: 954_000, count: 2, propDiameterM: 2.79, redlineRpm: 1700, thermoMargin: 1.9 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 17, 35], flapMaxDClMax: 0.65,
      stallCleanKcas: 99,
      vSpeeds: { vyKcas: 140, approachKcas: 110, vneKcas: 248, glideKcas: 135 },
      tuning: { cd0: 0.032 },
      propThrustScale: 0.85,
    },
    opts: { cd0Class: 'turbopropTwin' },
    targets: { cruiseTasKt: 280, cruiseAltFt: 25_000, climbFpm: 2500 },
  },
  {
    spec: {
      designator: 'DH8D', label: 'Bombardier Q400',
      wingAreaM2: 63.1, spanM: 28.42, lengthM: 32.84,
      emptyKg: 17_819, mtowKg: 29_574, fuelKg: 5318,
      powerplant: { kind: 'turboprop', ratedPowerW: 3_781_000, count: 2, propDiameterM: 4.11, redlineRpm: 1020, thermoMargin: 1.85 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 5, 10, 15, 35], flapMaxDClMax: 0.8,
      stallCleanKcas: 120,
      vSpeeds: { vyKcas: 160, approachKcas: 125, vneKcas: 286, glideKcas: 170 },
      propThrustScale: 0.82,
    },
    opts: { cd0Class: 'turbopropTwin' },
    targets: { cruiseTasKt: 350, cruiseAltFt: 25_000, climbFpm: 2400 },
  },
  {
    spec: {
      designator: 'C56X', label: 'Citation XLS+',
      wingAreaM2: 34.35, spanM: 17.17, lengthM: 15.79,
      emptyKg: 5579, mtowKg: 9163, fuelKg: 3057,
      powerplant: { kind: 'jet', staticThrustN: 18_300, count: 2 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 7, 15, 35], flapMaxDClMax: 0.7,
      stallCleanKcas: 95,
      vSpeeds: { vyKcas: 170, approachKcas: 108, vneKcas: 305, glideKcas: 170 },
    },
    opts: { cd0Class: 'bizjet' },
    targets: { jetCruise: { mach: 0.73, altFt: 38_000 }, climbFpm: 3000, climbIsMinimum: true },
  },
  {
    spec: {
      designator: 'GLF5', label: 'Gulfstream V',
      wingAreaM2: 105.6, spanM: 28.5, lengthM: 29.4,
      emptyKg: 21_228, mtowKg: 41_277, fuelKg: 18_733,
      powerplant: { kind: 'jet', staticThrustN: 65_600, count: 2 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 10, 20, 39], flapMaxDClMax: 0.75,
      stallCleanKcas: 110,
      vSpeeds: { vyKcas: 200, approachKcas: 130, vneKcas: 340, glideKcas: 200 },
      tuning: { machModel: { mdd: 0.85, dragRiseK: 20 } }, // long-range wing
    },
    opts: { cd0Class: 'bizjet', sweptJet: true },
    targets: { jetCruise: { mach: 0.8, altFt: 41_000 }, climbFpm: 3000, climbIsMinimum: true },
  },
  {
    spec: {
      designator: 'CL30', label: 'Challenger 300',
      wingAreaM2: 48.5, spanM: 19.46, lengthM: 20.92,
      emptyKg: 10_591, mtowKg: 17_622, fuelKg: 6350,
      powerplant: { kind: 'jet', staticThrustN: 30_400, count: 2 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 10, 20, 30], flapMaxDClMax: 0.72,
      stallCleanKcas: 105,
      vSpeeds: { vyKcas: 185, approachKcas: 125, vneKcas: 320, glideKcas: 190 },
      tuning: { machModel: { mdd: 0.84, dragRiseK: 20 } },
    },
    opts: { cd0Class: 'bizjet', sweptJet: true },
    targets: { jetCruise: { mach: 0.78, altFt: 37_000 }, climbFpm: 3500, climbIsMinimum: true },
  },
  {
    spec: {
      designator: 'E55P', label: 'Embraer Phenom 300',
      wingAreaM2: 28.5, spanM: 16.2, lengthM: 15.9,
      emptyKg: 5202, mtowKg: 8150, fuelKg: 2428,
      powerplant: { kind: 'jet', staticThrustN: 15_100, count: 2 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 10, 26, 36], flapMaxDClMax: 0.7,
      stallCleanKcas: 96,
      vSpeeds: { vyKcas: 170, approachKcas: 110, vneKcas: 320, glideKcas: 170 },
    },
    opts: { cd0Class: 'bizjet' },
    targets: { jetCruise: { mach: 0.74, altFt: 35_000 }, climbFpm: 3000, climbIsMinimum: true },
  },
  {
    spec: {
      designator: 'C750', label: 'Citation X',
      wingAreaM2: 48.96, spanM: 19.48, lengthM: 22.05,
      emptyKg: 9979, mtowKg: 16_375, fuelKg: 5910,
      powerplant: { kind: 'jet', staticThrustN: 31_300, count: 2 }, // AE3007C1 rating
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 5, 15, 35], flapMaxDClMax: 0.7,
      stallCleanKcas: 110,
      vSpeeds: { vyKcas: 200, approachKcas: 125, vneKcas: 350, glideKcas: 200 },
      // Tuning: the M0.92-Mmo wing — highest drag divergence in civil aviation.
      // + X-Plane tail audit: fighter-like travels (27/22 elev, 25 ail, 30
      // rud) vs inherited airliner values; fin volume ~0.7× the 737 anchor.
      tuning: { machModel: { mdd: 0.9, dragRiseK: 22 }, cnBeta: 0.119, elevatorMaxRad: 0.428, aileronMaxRad: 0.436, rudderMaxRad: 0.524 },
    },
    opts: { cd0Class: 'bizjet', sweptJet: true },
    targets: { jetCruise: { mach: 0.86, altFt: 37_000 }, climbFpm: 3500, climbIsMinimum: true },
  },
  {
    spec: {
      designator: 'CRJ9', label: 'Bombardier CRJ900',
      wingAreaM2: 70.6, spanM: 24.85, lengthM: 36.4,
      emptyKg: 21_433, mtowKg: 38_330, fuelKg: 8822,
      powerplant: { kind: 'jet', staticThrustN: 64_500, count: 2 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 8, 20, 30, 45], flapMaxDClMax: 0.8,
      stallCleanKcas: 115,
      vSpeeds: { vyKcas: 200, approachKcas: 135, vneKcas: 335, glideKcas: 210 },
    },
    opts: { cd0Class: 'airliner', sweptJet: true },
    targets: { jetCruise: { mach: 0.78, altFt: 35_000 }, climbFpm: 2000, climbIsMinimum: true },
  },
  {
    spec: {
      designator: 'B752', label: 'Boeing 757-200',
      wingAreaM2: 185.25, spanM: 38.05, lengthM: 47.3,
      emptyKg: 58_440, mtowKg: 115_680, fuelKg: 34_120,
      powerplant: { kind: 'jet', staticThrustN: 191_700, count: 2 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 1, 5, 15, 20, 25, 30], flapMaxDClMax: 0.85,
      stallCleanKcas: 130,
      vSpeeds: { vyKcas: 250, approachKcas: 135, vneKcas: 350, glideKcas: 240 },
      tuning: { machModel: { mdd: 0.84, dragRiseK: 20 } },
    },
    opts: { cd0Class: 'airliner', sweptJet: true },
    targets: { jetCruise: { mach: 0.8, altFt: 36_000 }, climbFpm: 2500, climbIsMinimum: true },
  },
  {
    spec: {
      designator: 'B788', label: 'Boeing 787-8',
      wingAreaM2: 377, spanM: 60.12, lengthM: 56.72,
      emptyKg: 119_950, mtowKg: 227_930, fuelKg: 101_456,
      powerplant: { kind: 'jet', staticThrustN: 284_700, count: 2 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 1, 5, 15, 20, 25, 30], flapMaxDClMax: 0.85,
      stallCleanKcas: 145,
      vSpeeds: { vyKcas: 250, approachKcas: 140, vneKcas: 360, glideKcas: 240 },
      tuning: { machModel: { mdd: 0.87, dragRiseK: 20 } },
    },
    opts: { cd0Class: 'airliner', sweptJet: true },
    targets: { jetCruise: { mach: 0.85, altFt: 40_000 }, climbFpm: 2000, climbIsMinimum: true },
  },
  {
    spec: {
      designator: 'A359', label: 'Airbus A350-900',
      wingAreaM2: 442, spanM: 64.75, lengthM: 66.8,
      emptyKg: 142_400, mtowKg: 280_000, fuelKg: 110_500,
      powerplant: { kind: 'jet', staticThrustN: 374_500, count: 2 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 1, 5, 15, 20, 25, 32], flapMaxDClMax: 0.85,
      stallCleanKcas: 145,
      vSpeeds: { vyKcas: 250, approachKcas: 140, vneKcas: 365, glideKcas: 245 },
      tuning: { machModel: { mdd: 0.88, dragRiseK: 20 } },
    },
    opts: { cd0Class: 'airliner', sweptJet: true },
    targets: { jetCruise: { mach: 0.85, altFt: 40_000 }, climbFpm: 2000, climbIsMinimum: true },
  },
  {
    spec: {
      designator: 'A332', label: 'Airbus A330-200',
      wingAreaM2: 361.6, spanM: 60.3, lengthM: 58.82,
      emptyKg: 120_600, mtowKg: 242_000, fuelKg: 109_000,
      powerplant: { kind: 'jet', staticThrustN: 316_000, count: 2 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 1, 8, 14, 22, 32], flapMaxDClMax: 0.85,
      stallCleanKcas: 145,
      vSpeeds: { vyKcas: 250, approachKcas: 137, vneKcas: 330 /* real A330 Vmo (X-Plane audit; was 365 carryover) */, glideKcas: 240 },
      // X-Plane tail audit: the A330 fin volume is ~0.45× the 737 anchor's
      // (the NG carries one of the largest relative fins in the fleet) —
      // inherited cnBeta/cnR made Dutch roll and decrab twice too stiff.
      // Travels: real A330 ail 25°, rudder ~31.6°. Trent 700: big fans
      // spool ~2× lazier than the CFM56 anchor (go-around gotcha).
      tuning: { machModel: { mdd: 0.85, dragRiseK: 20 }, cnBeta: 0.078, cnR: -0.123, aileronMaxRad: 0.436, rudderMaxRad: 0.552, jet: { spoolTauS: 4.5 } },
    },
    opts: { cd0Class: 'airliner', sweptJet: true },
    targets: { jetCruise: { mach: 0.82, altFt: 38_000 }, climbFpm: 2000, climbIsMinimum: true },
  },
  {
    spec: {
      designator: 'B77W', label: 'Boeing 777-300ER',
      wingAreaM2: 427.8, spanM: 64.8, lengthM: 73.86,
      emptyKg: 167_800, mtowKg: 351_533, fuelKg: 145_538,
      powerplant: { kind: 'jet', staticThrustN: 512_000, count: 2 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 1, 5, 15, 20, 25, 30], flapMaxDClMax: 0.85,
      stallCleanKcas: 155,
      vSpeeds: { vyKcas: 250, approachKcas: 149, vneKcas: 365, glideKcas: 250 },
      tuning: { machModel: { mdd: 0.87, dragRiseK: 20 } },
    },
    opts: { cd0Class: 'airliner', sweptJet: true },
    targets: { jetCruise: { mach: 0.84, altFt: 35_000 }, climbFpm: 2000, climbIsMinimum: true },
  },
  {
    spec: {
      designator: 'A388', label: 'Airbus A380-800',
      wingAreaM2: 845, spanM: 79.75, lengthM: 72.72,
      emptyKg: 277_000, mtowKg: 575_000, fuelKg: 253_983,
      powerplant: { kind: 'jet', staticThrustN: 348_000, count: 4 }, // Trent 972 rating
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 1, 8, 17, 26, 33], flapMaxDClMax: 0.85,
      stallCleanKcas: 145,
      vSpeeds: { vyKcas: 250, approachKcas: 142, vneKcas: 365, glideKcas: 240 },
      tuning: { machModel: { mdd: 0.87, dragRiseK: 20 } },
    },
    opts: { cd0Class: 'airliner', sweptJet: true },
    targets: { jetCruise: { mach: 0.85, altFt: 39_000 }, climbFpm: 1500, climbIsMinimum: true },
  },
  {
    spec: {
      designator: 'C130', label: 'C-130H Hercules',
      wingAreaM2: 162.1, spanM: 40.41, lengthM: 29.79,
      emptyKg: 34_400, mtowKg: 70_300, fuelKg: 20_000,
      powerplant: { kind: 'turboprop', ratedPowerW: 3_423_000, count: 4, propDiameterM: 4.11, redlineRpm: 1020, thermoMargin: 1.5 },
      gear: { layout: 'tricycle', retractable: true },
      flapDetentsDeg: [0, 20, 50], flapMaxDClMax: 0.8,
      stallCleanKcas: 100,
      vSpeeds: { vyKcas: 130, approachKcas: 120, vneKcas: 260, glideKcas: 150 },
      tuning: { cd0: 0.032 }, // boxcar fuselage + external blisters
    },
    opts: { cd0Class: 'turbopropTwin' },
    targets: { cruiseTasKt: 290, cruiseAltFt: 22_000, climbFpm: 1830 },
  },
]

// ---- Wave 3: B2 family variants (2-row sanity) ----
const b739 = core('B739')
const a320 = core('A320')
const b763 = core('B763')
const b744 = core('B744')
const c25a = core('C25A')
const e75l = core('E75L')
const as21 = core('AS21')
const p28a = core('P28A')
const be58 = core('BE58')
const b350 = core('B350')
const tbm9 = core('TBM9')
const c152 = WAVE2[0]!
const be36 = WAVE2[1]!
const c206 = WAVE2[3]!
const b77w = WAVE2.find((e) => e.spec.designator === 'B77W')!
const b788 = WAVE2.find((e) => e.spec.designator === 'B788')!
const a359 = WAVE2.find((e) => e.spec.designator === 'A359')!
const a332 = WAVE2.find((e) => e.spec.designator === 'A332')!
const b752 = WAVE2.find((e) => e.spec.designator === 'B752')!
const crj9 = WAVE2.find((e) => e.spec.designator === 'CRJ9')!
const c56x = WAVE2.find((e) => e.spec.designator === 'C56X')!
const cl30 = WAVE2.find((e) => e.spec.designator === 'CL30')!
const e55p = WAVE2.find((e) => e.spec.designator === 'E55P')!
const glf5 = WAVE2.find((e) => e.spec.designator === 'GLF5')!
const sf34 = WAVE2.find((e) => e.spec.designator === 'SF34')!
const at76 = WAVE2.find((e) => e.spec.designator === 'AT76')!
const dh8d = WAVE2.find((e) => e.spec.designator === 'DH8D')!
const pc12 = WAVE2.find((e) => e.spec.designator === 'PC12')!
const b190 = WAVE2.find((e) => e.spec.designator === 'B190')!

const WAVE3: RosterEntry[] = [
  // Piper family
  variant(p28a, { designator: 'P28R', label: 'Piper Arrow III', lengthM: 7.52, fuelKg: 196, vSpeeds: { vyKcas: 87, approachKcas: 66, vneKcas: 183, glideKcas: 79 }, emptyKg: 785, mtowKg: 1247, powerplant: { kind: 'piston', ratedPowerW: 149_140, count: 1, propDiameterM: 1.88, redlineRpm: 2700, governed: true }, gear: { layout: 'tricycle', retractable: true }, stallCleanKcas: 60, propThrustScale: undefined, tuning: undefined }, { cruiseTasKt: 137, cruiseAltFt: 8000 }, { cd0Class: 'retractPistonSingle' }),
  variant(p28a, { designator: 'P28B', label: 'Piper Dakota', fuelKg: 196, vSpeeds: { vyKcas: 85, approachKcas: 66, vneKcas: 173, glideKcas: 76 }, emptyKg: 794, mtowKg: 1361, powerplant: { kind: 'piston', ratedPowerW: 175_240, count: 1, propDiameterM: 1.93, redlineRpm: 2400, governed: true }, stallCleanKcas: 58, propThrustScale: undefined }, { cruiseTasKt: 144, cruiseAltFt: 8000 }),
  variant(p28a, { designator: 'PA32', label: 'Piper Saratoga', fuelKg: 278, vSpeeds: { vyKcas: 88, approachKcas: 75, vneKcas: 191, glideKcas: 79 }, wingAreaM2: 16.6, spanM: 11.02, lengthM: 8.44, emptyKg: 1003, mtowKg: 1633, powerplant: { kind: 'piston', ratedPowerW: 223_710, count: 1, propDiameterM: 2.03, redlineRpm: 2700, governed: true }, stallCleanKcas: 60, propThrustScale: undefined }, { cruiseTasKt: 147, cruiseAltFt: 8000 }),
  variant(p28a, { designator: 'PA44', label: 'Piper Seminole', fuelKg: 294, gear: { layout: 'tricycle', retractable: true }, vSpeeds: { vyKcas: 88, approachKcas: 75, vneKcas: 202, glideKcas: 85 }, wingAreaM2: 17.1, spanM: 11.75, lengthM: 8.41, emptyKg: 1210, mtowKg: 1724, powerplant: { kind: 'piston', ratedPowerW: 134_225, count: 2, propDiameterM: 1.88, redlineRpm: 2700, governed: true }, stallCleanKcas: 57, propThrustScale: 0.95 }, { cruiseTasKt: 155, cruiseAltFt: 8000 }, { cd0Class: 'pistonTwin' }),
  // Cessna family
  variant(c152, { designator: 'C150', label: 'Cessna 150', emptyKg: 505, mtowKg: 726, powerplant: { kind: 'piston', ratedPowerW: 74_570, count: 1, propDiameterM: 1.75, redlineRpm: 2550 }, stallCleanKcas: 42 }, { cruiseTasKt: 101, cruiseAltFt: 7000 }),
  variant(c206, { designator: 'C207', label: 'Cessna 207 Skywagon', lengthM: 9.68, emptyKg: 1090, mtowKg: 1724, stallCleanKcas: 59, tuning: { cd0: 0.037 } }, { cruiseTasKt: 130, cruiseAltFt: 8000 }),
  variant(c206, { designator: 'C210', label: 'Cessna 210 Centurion', lengthM: 8.59, emptyKg: 1045, mtowKg: 1814, gear: { layout: 'tricycle', retractable: true }, stallCleanKcas: 63 }, { cruiseTasKt: 167, cruiseAltFt: 10_000 }, { cd0Class: 'retractPistonSingle' }),
  variant(c152, { designator: 'C177', label: 'Cessna Cardinal', fuelKg: 134, vSpeeds: { vyKcas: 84, approachKcas: 65, vneKcas: 161, glideKcas: 70 }, propThrustScale: undefined, wingAreaM2: 16.2, spanM: 10.82, lengthM: 8.44, emptyKg: 682, mtowKg: 1134, powerplant: { kind: 'piston', ratedPowerW: 134_225, count: 1, propDiameterM: 1.93, redlineRpm: 2700 }, stallCleanKcas: 50 }, { cruiseTasKt: 124, cruiseAltFt: 8000 }),
  // Beech family
  variant(be36, { designator: 'BE35', label: 'Beechcraft Bonanza V35', emptyKg: 1093, mtowKg: 1542, powerplant: { kind: 'piston', ratedPowerW: 212_530, count: 1, propDiameterM: 2.03, redlineRpm: 2700, governed: true }, stallCleanKcas: 68 }, { cruiseTasKt: 165, cruiseAltFt: 8000 }),
  variant(be36, { designator: 'BE33', label: 'Beechcraft Debonair', emptyKg: 1088, mtowKg: 1542, stallCleanKcas: 68 }, { cruiseTasKt: 158, cruiseAltFt: 8000 }),
  variant(be58, { designator: 'BE55', label: 'Beechcraft Baron 55', lengthM: 8.53, emptyKg: 1526, mtowKg: 2313, powerplant: { kind: 'piston', ratedPowerW: 193_880, count: 2, propDiameterM: 1.96, redlineRpm: 2700, governed: true }, stallCleanKcas: 78 }, { cruiseTasKt: 185, cruiseAltFt: 7000 }),
  variant(be58, { designator: 'PA34', label: 'Piper Seneca V', fuelKg: 330, wingAreaM2: 19.4, spanM: 11.85, lengthM: 8.72, emptyKg: 1533, mtowKg: 2155, powerplant: { kind: 'piston', ratedPowerW: 164_054, count: 2, propDiameterM: 1.93, redlineRpm: 2600, governed: true }, stallCleanKcas: 66 }, { cruiseTasKt: 165, cruiseAltFt: 8000 }),
  variant(be58, { designator: 'C310', label: 'Cessna 310R', lengthM: 9.74, emptyKg: 1583, mtowKg: 2495, powerplant: { kind: 'piston', ratedPowerW: 193_880, count: 2, propDiameterM: 1.96, redlineRpm: 2700, governed: true }, stallCleanKcas: 79 }, { cruiseTasKt: 189, cruiseAltFt: 7500 }),
  variant(be58, { designator: 'DA42', label: 'Diamond DA42 Twin Star', fuelKg: 230, vSpeeds: { vyKcas: 85, approachKcas: 76, vneKcas: 188, glideKcas: 85 }, wingAreaM2: 16.29, spanM: 13.55, lengthM: 8.56, emptyKg: 1430, mtowKg: 1999, powerplant: { kind: 'piston', ratedPowerW: 125_275, count: 2, propDiameterM: 1.9, redlineRpm: 2300, governed: true }, stallCleanKcas: 64, tuning: { cd0: 0.024 } }, { cruiseTasKt: 160, cruiseAltFt: 10_000 }),
  // Turboprop families
  variant(tbm9, { designator: 'TBM7', label: 'TBM 700', emptyKg: 1826, mtowKg: 2984, powerplant: { kind: 'turboprop', ratedPowerW: 522_000, count: 1, propDiameterM: 2.31, redlineRpm: 2000, thermoMargin: 2.5 }, stallCleanKcas: 71, tuning: { cd0: 0.0215 } }, { cruiseTasKt: 300, cruiseAltFt: 26_000 }),
  variant(pc12, { designator: 'KODI', label: 'Quest Kodiak 100', wingAreaM2: 22.3, spanM: 13.7, lengthM: 10.32, emptyKg: 1710, mtowKg: 3290, gear: { layout: 'tricycle' }, powerplant: { kind: 'turboprop', ratedPowerW: 559_275, count: 1, propDiameterM: 2.44, redlineRpm: 2200, thermoMargin: 1.5 }, stallCleanKcas: 65, tuning: { cd0: 0.048 } }, { cruiseTasKt: 174, cruiseAltFt: 12_000 }),
  variant(b350, { designator: 'BE20', label: 'King Air B200', lengthM: 13.34, emptyKg: 3675, mtowKg: 5670, powerplant: { kind: 'turboprop', ratedPowerW: 634_000, count: 2, propDiameterM: 2.5, redlineRpm: 2000, thermoMargin: 2.0 }, stallCleanKcas: 92 }, { cruiseTasKt: 289, cruiseAltFt: 25_000 }),
  variant(b350, { designator: 'BE9L', label: 'King Air C90', fuelKg: 1_160, wingAreaM2: 27.3, spanM: 15.32, lengthM: 10.82, emptyKg: 3103, mtowKg: 4581, powerplant: { kind: 'turboprop', ratedPowerW: 410_135, count: 2, propDiameterM: 2.36, redlineRpm: 2200, thermoMargin: 1.8 }, stallCleanKcas: 83, propThrustScale: 0.9 }, { cruiseTasKt: 226, cruiseAltFt: 20_000 }),
  variant(b350, { designator: 'P180', label: 'Piaggio Avanti EVO', fuelKg: 1_270, wingAreaM2: 16.0, spanM: 14.03, lengthM: 14.41, emptyKg: 3799, mtowKg: 5488, powerplant: { kind: 'turboprop', ratedPowerW: 634_000, count: 2, propDiameterM: 2.16, redlineRpm: 2000, thermoMargin: 2.3 }, stallCleanKcas: 104, tuning: { cd0: 0.018 } }, { cruiseTasKt: 390, cruiseAltFt: 28_000 }),
  variant(b350, { designator: 'MU2', label: 'Mitsubishi MU-2', fuelKg: 1_250, wingAreaM2: 16.55, spanM: 11.94, lengthM: 12.01, emptyKg: 3433, mtowKg: 5250, powerplant: { kind: 'turboprop', ratedPowerW: 533_000, count: 2, propDiameterM: 2.28, redlineRpm: 2000, thermoMargin: 2.0 }, stallCleanKcas: 105, tuning: { cd0: 0.028 } }, { cruiseTasKt: 305, cruiseAltFt: 20_000 }),
  variant(sf34, { designator: 'E120', label: 'Embraer Brasilia', wingAreaM2: 39.4, spanM: 19.78, lengthM: 20.0, emptyKg: 7100, mtowKg: 11_500, powerplant: { kind: 'turboprop', ratedPowerW: 1_342_000, count: 2, propDiameterM: 3.2, redlineRpm: 1400, thermoMargin: 1.7 }, stallCleanKcas: 98 }, { cruiseTasKt: 300, cruiseAltFt: 20_000 }),
  variant(sf34, { designator: 'D328', label: 'Dornier 328', wingAreaM2: 40.0, spanM: 20.98, lengthM: 21.11, emptyKg: 8920, mtowKg: 13_990, powerplant: { kind: 'turboprop', ratedPowerW: 1_625_000, count: 2, propDiameterM: 3.6, redlineRpm: 1300, thermoMargin: 1.6 }, stallCleanKcas: 100 }, { cruiseTasKt: 330, cruiseAltFt: 20_000 }),
  variant(sf34, { designator: 'JS41', label: 'Jetstream 41', wingAreaM2: 32.6, spanM: 18.29, lengthM: 19.25, emptyKg: 6416, mtowKg: 10_886, powerplant: { kind: 'turboprop', ratedPowerW: 1_119_000, count: 2, propDiameterM: 2.9, redlineRpm: 1500, thermoMargin: 1.7 }, stallCleanKcas: 98 }, { cruiseTasKt: 295, cruiseAltFt: 20_000 }),
  variant(at76, { designator: 'AT45', label: 'ATR 42-500', wingAreaM2: 54.5, spanM: 24.57, lengthM: 22.67, emptyKg: 11_250, mtowKg: 18_600, powerplant: { kind: 'turboprop', ratedPowerW: 1_790_000, count: 2, propDiameterM: 3.93, redlineRpm: 1200, thermoMargin: 1.5 }, stallCleanKcas: 98 }, { cruiseTasKt: 290, cruiseAltFt: 20_000 }),
  variant(dh8d, { designator: 'DH8A', label: 'Dash 8-100', fuelKg: 3_160, wingAreaM2: 54.4, spanM: 25.91, lengthM: 22.25, emptyKg: 10_273, mtowKg: 15_650, powerplant: { kind: 'turboprop', ratedPowerW: 1_491_000, count: 2, propDiameterM: 3.96, redlineRpm: 1200, thermoMargin: 1.5 }, stallCleanKcas: 95, propThrustScale: 0.9 }, { cruiseTasKt: 265, cruiseAltFt: 15_000 }),
  variant(b190, { designator: 'SW4', label: 'Fairchild Metroliner', wingAreaM2: 28.7, spanM: 17.37, lengthM: 18.09, emptyKg: 4309, mtowKg: 7484, powerplant: { kind: 'turboprop', ratedPowerW: 745_700, count: 2, propDiameterM: 2.69, redlineRpm: 1600, thermoMargin: 1.8 }, stallCleanKcas: 100, propThrustScale: 0.82, tuning: { cd0: 0.032 } }, { cruiseTasKt: 246, cruiseAltFt: 20_000 }),
  variant(b190, { designator: 'D228', label: 'Dornier 228', wingAreaM2: 32.0, spanM: 16.97, lengthM: 16.56, emptyKg: 3739, mtowKg: 6400, gear: { layout: 'tricycle' }, powerplant: { kind: 'turboprop', ratedPowerW: 578_700, count: 2, propDiameterM: 2.7, redlineRpm: 1600, thermoMargin: 1.6 }, stallCleanKcas: 80, tuning: { cd0: 0.038 } }, { cruiseTasKt: 223, cruiseAltFt: 10_000 }),
  variant(core('DHC6'), { designator: 'L410', label: 'Let L-410 Turbolet', wingAreaM2: 34.86, spanM: 19.98, lengthM: 14.42, emptyKg: 4200, mtowKg: 6600, powerplant: { kind: 'turboprop', ratedPowerW: 559_275, count: 2, propDiameterM: 2.3, redlineRpm: 2080, thermoMargin: 1.6 }, stallCleanKcas: 78, tuning: { cd0: 0.045 }, propThrustScale: undefined }, { cruiseTasKt: 197, cruiseAltFt: 10_000 }),
  // Bizjet families
  variant(c25a, { designator: 'C525', label: 'CitationJet CJ1', fuelKg: 1_470, lengthM: 12.98, emptyKg: 3121, mtowKg: 4853, powerplant: { kind: 'jet', staticThrustN: 8740, count: 2 }, // Drag-ratio 0.943 vs the 0.92 envelope bound at the reshaped
      // (ram-recovery) lapse curve's minimum, which sits at the CJ1's
      // exact cruise Mach — the real CJ is a famously clean straight-wing
      // jet; cd0 nudged 0.021 → 0.0198 from the cruise anchor.
      tuning: { cd0: 0.0198 },
      stallCleanKcas: 88 }, { jetCruise: { mach: 0.68, altFt: 35_000 } }),
  variant(c25a, { designator: 'C25B', label: 'Citation CJ3', lengthM: 15.59, emptyKg: 3810, mtowKg: 6291, powerplant: { kind: 'jet', staticThrustN: 12_400, count: 2 }, stallCleanKcas: 95 }, { jetCruise: { mach: 0.72, altFt: 37_000 } }),
  variant(c25a, { designator: 'C25C', label: 'Citation CJ4', lengthM: 16.26, emptyKg: 4241, mtowKg: 7761, powerplant: { kind: 'jet', staticThrustN: 16_100, count: 2 }, stallCleanKcas: 98 }, { jetCruise: { mach: 0.74, altFt: 37_000 } }),
  variant(c56x, { designator: 'C680', label: 'Citation Sovereign', wingAreaM2: 47.7, spanM: 22.04, lengthM: 19.35, emptyKg: 8149, mtowKg: 13_744, powerplant: { kind: 'jet', staticThrustN: 25_300, count: 2 }, stallCleanKcas: 98 }, { jetCruise: { mach: 0.75, altFt: 39_000 } }),
  variant(c56x, { designator: 'C68A', label: 'Citation Latitude', wingAreaM2: 49.0, spanM: 22.05, lengthM: 18.97, emptyKg: 8801, mtowKg: 13_971, powerplant: { kind: 'jet', staticThrustN: 25_800, count: 2 }, stallCleanKcas: 98 }, { jetCruise: { mach: 0.76, altFt: 39_000 } }),
  variant(e55p, { designator: 'E50P', label: 'Embraer Phenom 100', fuelKg: 1_270, wingAreaM2: 19.4, spanM: 12.3, lengthM: 12.82, emptyKg: 3275, mtowKg: 4800, powerplant: { kind: 'jet', staticThrustN: 7800, count: 2 }, stallCleanKcas: 88 }, { jetCruise: { mach: 0.65, altFt: 35_000 } }),
  variant(e55p, { designator: 'HDJT', label: 'HondaJet', fuelKg: 1_290, wingAreaM2: 17.3, spanM: 12.12, lengthM: 12.99, emptyKg: 3267, mtowKg: 4854, powerplant: { kind: 'jet', staticThrustN: 9100, count: 2 }, stallCleanKcas: 90 }, { jetCruise: { mach: 0.7, altFt: 35_000 } }),
  variant(cl30, { designator: 'CL35', label: 'Challenger 350', emptyKg: 10_878, mtowKg: 18_416, powerplant: { kind: 'jet', staticThrustN: 32_700, count: 2 }, stallCleanKcas: 105 }, { jetCruise: { mach: 0.78, altFt: 37_000 } }),
  variant(cl30, { designator: 'F2TH', label: 'Falcon 2000', wingAreaM2: 49.0, spanM: 19.33, lengthM: 20.22, emptyKg: 9405, mtowKg: 16_556, powerplant: { kind: 'jet', staticThrustN: 26_300, count: 2 }, stallCleanKcas: 100 }, { jetCruise: { mach: 0.78, altFt: 39_000 } }),
  variant(cl30, { designator: 'FA7X', label: 'Falcon 7X', fuelKg: 14_400, wingAreaM2: 70.7, spanM: 26.21, lengthM: 23.38, emptyKg: 16_600, mtowKg: 31_751, powerplant: { kind: 'jet', staticThrustN: 28_480, count: 3 }, stallCleanKcas: 104 }, { jetCruise: { mach: 0.8, altFt: 41_000 } }),
  variant(glf5, { designator: 'GLF4', label: 'Gulfstream IV', fuelKg: 13_380, wingAreaM2: 88.3, spanM: 23.72, lengthM: 26.92, emptyKg: 19_278, mtowKg: 33_838, powerplant: { kind: 'jet', staticThrustN: 61_600, count: 2 }, stallCleanKcas: 108 }, { jetCruise: { mach: 0.77, altFt: 39_000 } }),
  variant(glf5, { designator: 'GLF6', label: 'Gulfstream G650', wingAreaM2: 119.2, spanM: 30.36, lengthM: 30.41, emptyKg: 24_494, mtowKg: 45_178, powerplant: { kind: 'jet', staticThrustN: 75_200, count: 2 }, stallCleanKcas: 110, tuning: { machModel: { mdd: 0.88, dragRiseK: 20 } } }, { jetCruise: { mach: 0.85, altFt: 41_000 } }),
  variant(glf5, { designator: 'GL5T', label: 'Global 5000', fuelKg: 17_600, wingAreaM2: 94.9, spanM: 28.65, lengthM: 29.5, emptyKg: 23_150, mtowKg: 41_957, powerplant: { kind: 'jet', staticThrustN: 65_500, count: 2 }, stallCleanKcas: 108, tuning: { machModel: { mdd: 0.85, dragRiseK: 20 } } }, { jetCruise: { mach: 0.8, altFt: 41_000 } }),
  variant(glf5, { designator: 'GLEX', label: 'Global Express', wingAreaM2: 94.9, spanM: 28.65, lengthM: 30.3, emptyKg: 22_800, mtowKg: 44_500, powerplant: { kind: 'jet', staticThrustN: 65_500, count: 2 }, stallCleanKcas: 108, tuning: { machModel: { mdd: 0.85, dragRiseK: 20 } } }, { jetCruise: { mach: 0.8, altFt: 41_000 } }),
  // Regional jet families
  variant(crj9, { designator: 'CRJ2', label: 'Bombardier CRJ200', fuelKg: 6_490, wingAreaM2: 48.35, spanM: 21.21, lengthM: 26.77, emptyKg: 13_835, mtowKg: 21_523, powerplant: { kind: 'jet', staticThrustN: 38_800, count: 2 }, stallCleanKcas: 108 }, { jetCruise: { mach: 0.74, altFt: 35_000 } }),
  variant(crj9, { designator: 'CRJ7', label: 'Bombardier CRJ700', lengthM: 32.3, emptyKg: 19_731, mtowKg: 32_999, powerplant: { kind: 'jet', staticThrustN: 56_400, count: 2 }, stallCleanKcas: 112 }, { jetCruise: { mach: 0.78, altFt: 35_000 } }),
  variant(crj9, { designator: 'CRJX', label: 'Bombardier CRJ1000', lengthM: 39.13, emptyKg: 23_179, mtowKg: 41_640, powerplant: { kind: 'jet', staticThrustN: 64_500, count: 2 }, stallCleanKcas: 118 }, { jetCruise: { mach: 0.78, altFt: 35_000 } }),
  variant(e75l, { designator: 'E170', label: 'Embraer E170', lengthM: 29.9, emptyKg: 21_141, mtowKg: 37_200, stallCleanKcas: 112 }, { jetCruise: { mach: 0.75, altFt: 35_000 } }),
  variant(e75l, { designator: 'E190', label: 'Embraer E190', wingAreaM2: 92.5, spanM: 28.72, lengthM: 36.24, emptyKg: 27_720, mtowKg: 47_790, powerplant: { kind: 'jet', staticThrustN: 82_300, count: 2 }, stallCleanKcas: 118 }, { jetCruise: { mach: 0.78, altFt: 35_000 } }),
  variant(e75l, { designator: 'E195', label: 'Embraer E195', wingAreaM2: 92.5, spanM: 28.72, lengthM: 38.65, emptyKg: 28_970, mtowKg: 48_790, powerplant: { kind: 'jet', staticThrustN: 82_300, count: 2 }, stallCleanKcas: 119 }, { jetCruise: { mach: 0.78, altFt: 35_000 } }),
  // Narrowbody families
  variant(b739, { designator: 'B737', label: 'Boeing 737-700', lengthM: 33.63, emptyKg: 38_147, mtowKg: 70_080, stallCleanKcas: 112 }, { jetCruise: { mach: 0.78, altFt: 37_000 } }),
  variant(b739, { designator: 'B736', label: 'Boeing 737-600', lengthM: 31.24, emptyKg: 36_378, mtowKg: 66_320, stallCleanKcas: 110 }, { jetCruise: { mach: 0.78, altFt: 37_000 } }),
  variant(b739, { designator: 'B38M', label: 'Boeing 737 MAX 8', lengthM: 39.52, emptyKg: 45_070, mtowKg: 82_190, powerplant: { kind: 'jet', staticThrustN: 130_000, count: 2 }, stallCleanKcas: 121 }, { jetCruise: { mach: 0.79, altFt: 37_000 } }),
  variant(b739, { designator: 'B39M', label: 'Boeing 737 MAX 9', lengthM: 42.16, emptyKg: 46_500, mtowKg: 88_300, powerplant: { kind: 'jet', staticThrustN: 130_000, count: 2 }, stallCleanKcas: 123 }, { jetCruise: { mach: 0.79, altFt: 37_000 } }),
  variant(a320, { designator: 'A319', label: 'Airbus A319', lengthM: 33.84, emptyKg: 40_800, mtowKg: 75_500, stallCleanKcas: 114 }, { jetCruise: { mach: 0.78, altFt: 37_000 } }),
  variant(a320, { designator: 'A321', label: 'Airbus A321', lengthM: 44.51, emptyKg: 48_500, mtowKg: 93_500, powerplant: { kind: 'jet', staticThrustN: 142_000, count: 2 }, stallCleanKcas: 125, vSpeeds: { vyKcas: 200, approachKcas: 145, vneKcas: 350, glideKcas: 210 } }, { jetCruise: { mach: 0.78, altFt: 36_000 } }),
  variant(a320, { designator: 'A20N', label: 'Airbus A320neo', emptyKg: 44_300, mtowKg: 79_000, powerplant: { kind: 'jet', staticThrustN: 120_600, count: 2 }, stallCleanKcas: 118 }, { jetCruise: { mach: 0.78, altFt: 37_000 } }),
  variant(a320, { designator: 'A21N', label: 'Airbus A321neo', lengthM: 44.51, emptyKg: 50_100, mtowKg: 97_000, powerplant: { kind: 'jet', staticThrustN: 147_300, count: 2 }, stallCleanKcas: 127, vSpeeds: { vyKcas: 200, approachKcas: 147, vneKcas: 350, glideKcas: 210 } }, { jetCruise: { mach: 0.78, altFt: 36_000 } }),
  variant(a320, { designator: 'A318', label: 'Airbus A318', lengthM: 31.44, emptyKg: 39_500, mtowKg: 68_000, stallCleanKcas: 111 }, { jetCruise: { mach: 0.78, altFt: 37_000 } }),
  variant(a320, { designator: 'BCS3', label: 'Airbus A220-300', wingAreaM2: 112.3, spanM: 35.1, lengthM: 38.71, emptyKg: 37_081, mtowKg: 69_900, powerplant: { kind: 'jet', staticThrustN: 103_600, count: 2 }, stallCleanKcas: 114 }, { jetCruise: { mach: 0.78, altFt: 38_000 } }),
  variant(b752, { designator: 'B753', label: 'Boeing 757-300', lengthM: 54.43, emptyKg: 64_580, mtowKg: 123_600, stallCleanKcas: 135 }, { jetCruise: { mach: 0.8, altFt: 35_000 } }),
  variant(b739, { designator: 'MD88', label: 'McDonnell Douglas MD-88', wingAreaM2: 112.3, spanM: 32.87, lengthM: 45.06, emptyKg: 35_369, mtowKg: 67_812, fuelKg: 17_740 /* X-Plane audit: was silently inheriting the 737-900ER's 20,894 kg; MD-80 tankage = 5,840 gal */, powerplant: { kind: 'jet', staticThrustN: 93_400, count: 2 }, stallCleanKcas: 118, tuning: { cnBeta: 0.085 /* small T-tail fin, long fuselage: ~0.5× the 737 fin volume (X-Plane tail audit) */, cmQ: -30 /* T-tail arm²: pitch damping was ~33% understated */, aileronMaxRad: 0.436, jet: { tsfcKgPerNs: 1.44e-5 /* JT8D low-bypass: 0.51 lb/lbf/hr static */, tsfcMachSlope: 0.6, n1IdlePct: 27, spoolTauS: 1.8 } } }, { jetCruise: { mach: 0.76, altFt: 33_000 } }),
  // Widebody families
  variant(b763, { designator: 'B762', label: 'Boeing 767-200ER', fuelKg: 73_000, lengthM: 48.51, emptyKg: 80_130, mtowKg: 156_500, stallCleanKcas: 140 }, { jetCruise: { mach: 0.8, altFt: 37_000 } }),
  variant(b763, { designator: 'B764', label: 'Boeing 767-400ER', lengthM: 61.37, emptyKg: 103_100, mtowKg: 204_120, stallCleanKcas: 148 }, { jetCruise: { mach: 0.8, altFt: 35_000 } }),
  variant(b77w, { designator: 'B772', label: 'Boeing 777-200ER', lengthM: 63.73, emptyKg: 138_100, mtowKg: 297_550, powerplant: { kind: 'jet', staticThrustN: 417_000, count: 2 }, stallCleanKcas: 148 }, { jetCruise: { mach: 0.84, altFt: 35_000 } }),
  variant(b77w, { designator: 'B77L', label: 'Boeing 777-200LR', lengthM: 63.73, emptyKg: 145_150, mtowKg: 347_450, stallCleanKcas: 152 }, { jetCruise: { mach: 0.84, altFt: 35_000 } }),
  variant(b788, { designator: 'B789', label: 'Boeing 787-9', lengthM: 62.81, emptyKg: 128_850, mtowKg: 254_010, stallCleanKcas: 148 }, { jetCruise: { mach: 0.85, altFt: 40_000 } }),
  variant(b788, { designator: 'B78X', label: 'Boeing 787-10', lengthM: 68.28, emptyKg: 135_500, mtowKg: 254_010, stallCleanKcas: 150 }, { jetCruise: { mach: 0.85, altFt: 39_000 } }),
  variant(a359, { designator: 'A35K', label: 'Airbus A350-1000', lengthM: 73.79, emptyKg: 155_000, mtowKg: 316_000, powerplant: { kind: 'jet', staticThrustN: 430_000, count: 2 }, stallCleanKcas: 150 }, { jetCruise: { mach: 0.85, altFt: 40_000 } }),
  variant(a332, { designator: 'A333', label: 'Airbus A330-300', lengthM: 63.67, emptyKg: 124_500, mtowKg: 242_000, fuelKg: 78_030 /* -300 standard tankage 97,530 L (X-Plane audit; was inheriting the -200's 109 t) */, stallCleanKcas: 147 }, { jetCruise: { mach: 0.82, altFt: 38_000 } }),
  variant(a332, { designator: 'A339', label: 'Airbus A330-900neo', lengthM: 63.67, emptyKg: 132_000, mtowKg: 251_000, powerplant: { kind: 'jet', staticThrustN: 324_000, count: 2 }, stallCleanKcas: 148 }, { jetCruise: { mach: 0.82, altFt: 39_000 } }),
  variant(b744, { designator: 'B742', label: 'Boeing 747-200', lengthM: 70.66, emptyKg: 174_000, mtowKg: 377_840, powerplant: { kind: 'jet', staticThrustN: 243_000, count: 4 }, stallCleanKcas: 160 }, { jetCruise: { mach: 0.84, altFt: 35_000 } }),
  variant(b744, { designator: 'B748', label: 'Boeing 747-8i', wingAreaM2: 554, spanM: 68.4, lengthM: 76.25, emptyKg: 220_128, mtowKg: 447_700, powerplant: { kind: 'jet', staticThrustN: 296_000, count: 4 }, stallCleanKcas: 160, tuning: { machModel: { mdd: 0.87, dragRiseK: 20 } } }, { jetCruise: { mach: 0.855, altFt: 35_000 } }),
  variant(b744, { designator: 'A343', label: 'Airbus A340-300', fuelKg: 110_000, wingAreaM2: 361.6, spanM: 60.3, lengthM: 63.69, emptyKg: 130_200, mtowKg: 276_500, powerplant: { kind: 'jet', staticThrustN: 151_000, count: 4 }, stallCleanKcas: 140, vSpeeds: { vyKcas: 250, approachKcas: 140, vneKcas: 330 /* A340 Vmo (X-Plane audit) */, glideKcas: 240 }, tuning: { machModel: { mdd: 0.85, dragRiseK: 20 } } }, { jetCruise: { mach: 0.82, altFt: 37_000 } }),
  variant(b744, { designator: 'MD11', label: 'McDonnell Douglas MD-11', fuelKg: 93_900, wingAreaM2: 338.9, spanM: 51.77, lengthM: 61.62, emptyKg: 130_165, mtowKg: 285_990, powerplant: { kind: 'jet', staticThrustN: 274_000, count: 3 }, stallCleanKcas: 150, tuning: { machModel: { mdd: 0.86, dragRiseK: 20 } } }, { jetCruise: { mach: 0.83, altFt: 35_000 } }),
  // Antiques & oddballs
  variant(WAVE2.find((e) => e.spec.designator === 'DHC2')!, { designator: 'AN2', label: 'Antonov An-2', fuelKg: 650, wingAreaM2: 71.5, spanM: 18.18, lengthM: 12.4, emptyKg: 3300, mtowKg: 5440, powerplant: { kind: 'piston', ratedPowerW: 745_700, count: 1, propDiameterM: 3.6, redlineRpm: 2200, governed: true }, stallCleanKcas: 49, tuning: { cd0: 0.058 } }, { cruiseTasKt: 100, cruiseAltFt: 5000 }),
  // Gliders
  variant(as21, { designator: 'DG80', label: 'DG-800', wingAreaM2: 11.8, spanM: 18.0, lengthM: 7.0, emptyKg: 305, mtowKg: 525, stallCleanKcas: 37, vSpeeds: { vyKcas: 51, approachKcas: 51, vneKcas: 146, glideKcas: 54 } }, { glideRatio: 48 }),
  variant(as21, { designator: 'LS8', label: 'Rolladen-Schneider LS8', wingAreaM2: 10.5, spanM: 15.0, lengthM: 6.66, emptyKg: 250, mtowKg: 525, stallCleanKcas: 36, vSpeeds: { vyKcas: 49, approachKcas: 49, vneKcas: 146, glideKcas: 51 } }, { glideRatio: 43 }),
  variant(as21, { designator: 'DISC', label: 'Schempp-Hirth Discus', wingAreaM2: 10.58, spanM: 15.0, lengthM: 6.58, emptyKg: 233, mtowKg: 525, stallCleanKcas: 35, vSpeeds: { vyKcas: 49, approachKcas: 49, vneKcas: 135, glideKcas: 51 } }, { glideRatio: 42 }),
]

export const ROSTER_EXT: RosterEntry[] = [...WAVE2, ...WAVE3]
