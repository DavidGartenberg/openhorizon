import type { GaProfile } from './cockpit-profile'
import type { XpCockpitModel } from './xplane-cockpit'
import { XP_PLACEMENT } from './xplane-manifest'

/**
 * The light-aircraft cockpits of the user's X-Plane 12 install (Laminar Research's Cessna 172 SP, Cirrus SR22,
 * Beechcraft Baron 58, Piper PA-18 Super Cub, Schleicher ASK 21 and King Air C90B), loaded at run time through the
 * same read-only `/xp/` route as the 737's flight deck. Nothing is copied into this repository: these are only the
 * file names and placements, read from each airplane's `.acf` (its interior objects — the ones drawn in the cockpit
 * view — minus the pilot figures, pre-fill and wreck objects, and the King Air's C90B_lights.obj, which holds light
 * points only and no geometry) on 2026-11-08.
 *
 * Every light airplane of the fleet flies one of these six, its own when X-Plane has it and otherwise the closest
 * (gaCockpitFor). Their instruments are 3D gauges animated on X-Plane datarefs (xplane-ga-datarefs.ts); the avionics
 * screens (G1000, GNS 530/430) show this simulator's own PFD and moving map.
 */

interface GaEntry {
  folder: string
  /** The airplane's click map (its `<name>_cockpit.obj`, relative to the folder): every manipulator, plus panel geometry. */
  panelObj: string
  /** X-Plane's 2D panel art, shown where the cockpit samples the panel texture; null when the cockpit never does. */
  panelBackground: string | null
  /** Where the interior objects are attached, feet from the datum (the SR22 alone moves them). */
  offsetFt?: [number, number, number]
  /** The pilot's eye, feet from the datum (the .acf's `_pe_xyz`). */
  eyeFt: [number, number, number]
  /** Interior objects, opaque first and glass last (draw order). */
  objs: Array<{ path: string; glass?: true }>
}

const FT = 0.3048

const ENTRIES: Record<string, GaEntry> = {
  C172: {
    folder: 'Cessna 172 SP',
    panelObj: 'Cessna_172SP_cockpit.obj',
    panelBackground: 'cockpit_3d/-PANELS-/Panel.png',
    eyeFt: [-0.8, 1.51, 3.5],
    objs: [
      { path: 'objects/cockpit_1.obj' },
      { path: 'objects/cockpit_2.obj' },
      { path: 'objects/cockpit_seats_front.obj' },
      { path: 'objects/cockpit_seats_rear.obj' },
      { path: 'objects/cockpit_panel.obj' },
      { path: 'objects/instruments/compass/compass_mag_glrshld.obj' },
      { path: 'objects/instruments/audiopanel/audiopanel.obj' },
      { path: 'objects/instruments/garmin530/garmin530_n1.obj' },
      { path: 'objects/instruments/garmin430/garmin430_n2.obj' },
      { path: 'objects/instruments/garmin_xpndr/transponder.obj' },
      { path: 'objects/instruments/clock/clock_davtron.obj' },
      { path: 'objects/instruments/fuel_egt_ff_oil_vac_amp/fuel_egt_ff_oil_vac_amp.obj' },
      { path: 'objects/instruments/airspeed/airspeed_ga_tas.obj' },
      { path: 'objects/instruments/horizon/horizon_ga_vac.obj' },
      { path: 'objects/instruments/altimeter/altimeter_ag.obj' },
      { path: 'objects/instruments/turn_slip/turn_slip_ga.obj' },
      { path: 'objects/instruments/directional_gyro/dir_gyro_ga.obj' },
      { path: 'objects/instruments/variometer/variometer_ag.obj' },
      { path: 'objects/instruments/vor_glideslope_adf/vor1_gs_ag.obj' },
      { path: 'objects/instruments/vor_glideslope_adf/vor2_ag.obj' },
      { path: 'objects/instruments/vor_glideslope_adf/adf1_ag.obj' },
      { path: 'objects/instruments/adf_receiver_bking/adf_receiver_bking.obj' },
      { path: 'objects/instruments/engine_RPM/engine_RPM_ag.obj' },
      { path: 'objects/instruments/hobbs_meter/hobbs_meter.obj' },
      { path: 'objects/bobblehead/austin_bobblehead.obj' },
      { path: 'objects/instruments/garmin430/garmin430_screen.obj' },
      { path: 'objects/instruments/garmin530/garmin530_screen.obj' },
      { path: 'objects/glass_inn.obj', glass: true },
    ],
  },
  SR22: {
    folder: 'Cirrus SR22',
    panelObj: 'SR22_cockpit.obj',
    panelBackground: 'cockpit_3d/-PANELS-/PANEL.png',
    offsetFt: [0, -3.93701, 1.14829],
    eyeFt: [-0.82, 2.05, 0.82],
    objs: [
      { path: 'objects/SR22_int1.obj' },
      { path: 'objects/SR22_int2.obj' },
      { path: 'objects/Indicator_Lights.obj' },
      { path: 'objects/garmins.obj' },
      { path: 'objects/SR22_glass_int.obj', glass: true },
      { path: 'objects/SR22_sunvisors.obj', glass: true },
    ],
  },
  BE58: {
    folder: 'Beechcraft Baron 58',
    panelObj: 'Baron_58_cockpit.obj',
    panelBackground: 'cockpit_3d/-PANELS-/Panel_General.png',
    eyeFt: [-0.8202, 1.12, 10.4987],
    objs: [
      { path: 'objects/B58_seats.obj' },
      { path: 'objects/B58_panelback.obj' },
      { path: 'objects/Instruments/Garmin/garmin530.obj' },
      { path: 'objects/Instruments/KA_51B/KA_51B.obj' },
      { path: 'objects/Instruments/compass/compass.obj' },
      { path: 'objects/Instruments/devices_screen/devices_screen.obj' },
      { path: 'objects/Instruments/audiopanel/audiopanel.obj' },
      { path: 'objects/Instruments/com_nav_bking/com_nav_bking.obj' },
      { path: 'objects/Instruments/transponder_bking/transponder_bking.obj' },
      { path: 'objects/Instruments/adf_receiver_bking/adf_receiver_bking.obj' },
      { path: 'objects/Instruments/dme_bking/dme_bking.obj' },
      { path: 'objects/Instruments/KA_285_annunciators/KA_285.obj' },
      { path: 'objects/Instruments/KI_256_horizon/KI_256_horizon.obj' },
      { path: 'objects/Instruments/KI_525A_HSI/KI_525A_HSI.obj' },
      { path: 'objects/Instruments/VOR_ADF/VOR_ADF.obj' },
      { path: 'objects/Instruments/horizon/horizon_ga_vac.obj' },
      { path: 'objects/Instruments/ASI_turn_VVI/ASI_turn_VVI.obj' },
      { path: 'objects/Instruments/altimeter/altimeter.obj' },
      { path: 'objects/Instruments/RDR2000_bking/RDR2000_bking.obj' },
      { path: 'objects/Instruments/engines/engines.obj' },
      { path: 'objects/B58_cabin.obj' },
      { path: 'objects/B58_Glass_inn.obj', glass: true },
      { path: 'objects/B58_Cockpit_Glass.obj', glass: true },
    ],
  },
  PA18: {
    folder: 'Piper PA-18 Super Cub',
    panelObj: 'PA-18-150_cockpit.obj',
    panelBackground: null,
    eyeFt: [0, 1.8045, 1.2139],
    objs: [
      { path: 'objects/cabin.obj' },
      { path: 'objects/seat.obj' },
      { path: 'objects/panel.obj' },
      { path: 'objects/instruments/compass/compass_mag.obj' },
      { path: 'objects/instruments/airspeed/airspeed.obj' },
      { path: 'objects/instruments/altimeter/altimeter_ag.obj' },
      { path: 'objects/instruments/horizon/horizon_ga_vac.obj' },
      { path: 'objects/instruments/directional_gyro/dir_gyro_ga.obj' },
      { path: 'objects/instruments/turn_slip/turn_slip_ga.obj' },
      { path: 'objects/instruments/variometer/variometer_ag.obj' },
      { path: 'objects/instruments/vor_glideslope_adf/vor1_gs_ag.obj' },
      { path: 'objects/instruments/engine_RPM/engine_RPM_ag.obj' },
      { path: 'objects/instruments/oil_suction_cht/oil_suction_cht.obj' },
      { path: 'objects/instruments/com_nav_bking/com_nav_bking.obj' },
      { path: 'objects/instruments/transponder_bking/transponder_bking.obj' },
      { path: 'objects/glass_inn.obj', glass: true },
    ],
  },
  AS21: {
    folder: 'Schleicher ASK 21',
    panelObj: 'ASK21_cockpit.obj',
    panelBackground: null,
    eyeFt: [0, 1.21, 5.25],
    objs: [
      { path: 'objects/internal1.obj' },
      { path: 'objects/internal2.obj' },
      { path: 'objects/instruments/compass/compass_mag.obj' },
      { path: 'objects/instruments/airspeed/airspeed.obj' },
      { path: 'objects/instruments/altimeter/altimeter_ag.obj' },
      { path: 'objects/instruments/variometer/variometer.obj' },
      { path: 'objects/instruments/totalenergy/totalenergy.obj' },
      { path: 'objects/instruments/g_meter/g_meter.obj' },
      { path: 'objects/instruments/sideslip/sideslip.obj' },
      { path: 'objects/instruments/radio/radio.obj' },
      { path: 'objects/glass_inn.obj', glass: true },
    ],
  },
  BE9L: {
    folder: 'Beechcraft King Air C90B',
    panelObj: 'C90B_cockpit.obj',
    panelBackground: 'cockpit_3D/-PANELS-/panel.png',
    eyeFt: [-1.15, 2.97, 10.01],
    objs: [
      { path: 'objects/C90B_interior/C90B_cabin.obj' },
      { path: 'objects/C90B_interior/C90B_seats.obj' },
      { path: 'objects/C90B_cockpit/C90B_panel2.obj' },
      { path: 'objects/C90B_cockpit/C90B_panel.obj' },
      { path: 'objects/C90B_cockpit/C90B_cockpit2.obj' },
      { path: 'objects/C90B_instruments/C90B_EFIS84_1.obj' },
      { path: 'objects/C90B_instruments/C90B_EFIS84_2.obj' },
      { path: 'objects/C90B_instruments/C90B_CCU65.obj' },
      { path: 'objects/C90B_instruments/C90B_CTL22.obj' },
      { path: 'objects/C90B_instruments/C90B_CTL32.obj' },
      { path: 'objects/C90B_instruments/C90B_CTL62.obj' },
      { path: 'objects/C90B_instruments/C90B_CTL92.obj' },
      { path: 'objects/C90B_instruments/C90B_IND42.obj' },
      { path: 'objects/C90B_instruments/C90B_PRE80.obj' },
      { path: 'objects/C90B_instruments/C90B_TnS.obj' },
      { path: 'objects/C90B_cockpit/C90B_pedestal.obj' },
      { path: 'objects/C90B_interior/C90B_int_decals.obj' },
      { path: 'objects/C90B_cockpit/C90B_gauge_glass.obj', glass: true },
      { path: 'objects/C90B_cockpit/C90B_gauge_glass2.obj', glass: true },
      { path: 'objects/C90B_interior/C90B_int_glass.obj', glass: true },
    ],
  },
}

export const XP_GA_COCKPITS: Readonly<Record<string, XpCockpitModel>> = Object.fromEntries(Object.entries(ENTRIES).map(([key, e]) => [key, {
  folder: e.folder,
  objs: e.objs,
  panelObj: e.panelObj,
  // The same CG the exterior model is placed by.
  cgFt: XP_PLACEMENT[key]!.cgFt,
  eyeObj: e.eyeFt.map((v) => v * FT) as [number, number, number],
  ga: { panelBackground: e.panelBackground, offsetFt: e.offsetFt ?? [0, 0, 0] },
} satisfies XpCockpitModel]))

/** Fleet keys that are one of the six airplanes themselves. */
const OWN: Readonly<Record<string, string>> = { '172': 'C172', C172: 'C172', SR22: 'SR22', BE58: 'BE58', PA18: 'PA18', AS21: 'AS21', BE9L: 'BE9L' }

/**
 * Which X-Plane cockpit a light airplane flies: its own when X-Plane has it, else the closest by how it is flown —
 * gliders the ASK 21, side-yoke Cirruses the SR22, turboprops the King Air, piston twins the Baron, stick singles the
 * Super Cub and every other single the 172.
 */
export function gaCockpitFor(designator: string, ga: Pick<GaProfile, 'control' | 'hasEngine' | 'turboprop' | 'engines'>): string {
  const own = OWN[designator.toUpperCase()]
  if (own) return own
  if (!ga.hasEngine) return 'AS21'
  if (ga.control === 'sideyoke') return 'SR22'
  if (ga.turboprop) return 'BE9L'
  if (ga.engines >= 2) return 'BE58'
  if (ga.control === 'stick') return 'PA18'
  return 'C172'
}
