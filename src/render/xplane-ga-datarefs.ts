/**
 * What an X-Plane light-aircraft cockpit (the C172, SR22, Baron, Super Cub, ASK 21 or King Air) is told, as
 * X-Plane datarefs (pure).
 *
 * These cockpits are steam gauges and levers built as OBJ animations: every needle, drum, knob and lever turns on
 * a named dataref in X-Plane's own units (knots, feet, inHg, rpm, kg, °C …). This maps this simulator's state onto
 * those names. A dataref the simulator has no state for reads its resting value (0, "closed", "off") unless a
 * powered airplane would show something else, in which case GA_RESTING says what and why.
 */

export interface XpGaNav {
  /** Needle deflection −1…1 of full scale (+ = course to the right), as the PFD's CDI has it. */
  deflection: number
  /** 0 = OFF flag, 1 = TO, 2 = FROM. */
  toFrom: 0 | 1 | 2
  /** Glideslope needle −1…1 of full scale (+ = fly up), when a glideslope is received. */
  glideslope: number | null
  obsDeg: number
}

export interface XpGaInputs {
  // flight controls, −1…1 (pitch + = pull, roll + = right, yaw + = right pedal)
  pitch: number
  roll: number
  yaw: number
  brakeLeft: number
  brakeRight: number
  parkingBrake: boolean
  /** Elevator trim −1…1 (+ = nose up) and rudder trim −1…1. */
  trim: number
  rudderTrim: number
  // levers, per engine 0…1
  throttle: number[]
  mixture: number[]
  prop: number[]
  carbHeat: number
  /** Where the flap handle is set and where the flaps are, 0…1 of their travel. */
  flapHandle: number
  flaps: number
  gearHandleDown: boolean
  /** Gear position 0 (up) … 1 (down and locked). */
  gear: number
  /** Airbrakes / spoilers deployed 0…1 (gliders). */
  speedbrake: number
  // flight instruments
  iasKt: number
  altitudeFt: number
  baroInHg: number
  pitchDeg: number
  rollDeg: number
  headingDeg: number
  vsiFpm: number
  /** Rate of turn, °/s (+ = right): a standard-rate turn is 3. */
  turnRateDegS: number
  /** Ball deflection, degrees (+ = ball right). */
  slipDeg: number
  gLoad: number
  nav: XpGaNav | null
  /** ADF needle relative to the nose, degrees; null = no station received (the needle parks at 90°). */
  adfBearingDeg: number | null
  // engines (one entry per engine)
  engineRunning: boolean[]
  rpm: number[]
  propRpm: number[]
  manifoldInHg: number[]
  fuelFlowKgS: number[]
  egtC: number[]
  chtC: number[]
  oilTempC: number[]
  oilPressPsi: number[]
  ittC: number[]
  n1Pct: number[]
  torqueNm: number[]
  /** Fuel in each tank, kg. */
  fuelKg: number[]
  // electrics and switches
  busVolts: number
  battery: boolean
  alternator: boolean
  avionics: boolean
  pitotHeat: boolean
  fuelPump: boolean
  landingLights: boolean
  taxiLight: boolean
  navLights: boolean
  strobes: boolean
  beacon: boolean
  /** Panel backlighting 0 (daylight) … 1. */
  panelLight: number
  /** Annunciators. */
  lowOilPressure: boolean
  lowVacuum: boolean
  lowVolts: boolean
  lowFuel: boolean
  /** UTC and local clock time in hours (fractional), the date, and the engine (Hobbs) hours. */
  zuluHours: number
  localHours: number
  day: number
  month: number
  hobbsHours: number
}

export function defaultXpGaInputs(): XpGaInputs {
  return {
    pitch: 0, roll: 0, yaw: 0, brakeLeft: 0, brakeRight: 0, parkingBrake: false, trim: 0, rudderTrim: 0,
    throttle: [0], mixture: [1], prop: [1], carbHeat: 0, flapHandle: 0, flaps: 0, gearHandleDown: true, gear: 1, speedbrake: 0,
    iasKt: 0, altitudeFt: 0, baroInHg: 29.92, pitchDeg: 0, rollDeg: 0, headingDeg: 0, vsiFpm: 0, turnRateDegS: 0, slipDeg: 0, gLoad: 1,
    nav: null, adfBearingDeg: null,
    engineRunning: [false], rpm: [0], propRpm: [0], manifoldInHg: [29.92], fuelFlowKgS: [0], egtC: [0], chtC: [0], oilTempC: [0],
    oilPressPsi: [0], ittC: [0], n1Pct: [0], torqueNm: [0], fuelKg: [0, 0],
    busVolts: 0, battery: false, alternator: false, avionics: false, pitotHeat: false, fuelPump: false,
    landingLights: false, taxiLight: false, navLights: false, strobes: false, beacon: false, panelLight: 0,
    lowOilPressure: false, lowVacuum: false, lowVolts: false, lowFuel: false,
    zuluHours: 0, localHours: 0, day: 1, month: 1, hobbsHours: 0,
  }
}

/** Turn coordinator scale: X-Plane's `turn_rate_roll_deg` puts a standard-rate (3 °/s) turn on the 20° marks. */
export const STANDARD_RATE_MARK_DEG = 20
/** A CDI or glideslope needle's full scale, dots. */
const FULL_SCALE_DOTS = 2.5
/** Normal vacuum-pump suction with an engine turning, inHg (the gauge's green arc is 4.5…5.5). */
const VACUUM_INHG = 5

const clamp = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0)
const finite = (v: number): number => (Number.isFinite(v) ? v : 0)
const bit = (v: boolean): number => (v ? 1 : 0)
const wrap360 = (deg: number): number => ((finite(deg) % 360) + 360) % 360

/**
 * Switches and settings with no system behind them in this simulator rest where a pilot has them in flight: NOT
 * live state. The doors are shut and the yoke is drawn.
 */
export const GA_RESTING: Readonly<Record<string, number>> = {
  'sim/graphics/view/hide_yoke': 1, // the yoke hides when this reads 0
  'sim/cockpit2/switches/instrument_brightness_ratio[0]': 0.85,
  'sim/cockpit2/electrical/cross_tie': 0,
  'sim/cockpit2/clock_timer/timer_mode': 0,
}

/**
 * `overrides` is for verification only (look at a gauge at an extreme, or prove a sign): any name in it wins over the
 * sim-derived value.
 */
export function makeXpGaDatarefReader(s: XpGaInputs, overrides: Record<string, number> = {}): (dataref: string) => number {
  const at = (list: readonly number[], i: number): number => finite(list[i] ?? list[0] ?? 0)
  const running = (i: number): boolean => s.engineRunning[i] ?? s.engineRunning[0] ?? false
  return (ref: string): number => {
    if (Object.prototype.hasOwnProperty.call(overrides, ref)) return overrides[ref]!
    const m = /^(.*)\[(\d+)\]$/.exec(ref)
    const name = m ? m[1]! : ref, i = m ? Number(m[2]) : 0
    switch (name) {
      // ---- yoke, pedals, brakes, trim
      case 'sim/cockpit2/controls/total_pitch_ratio':
      case 'sim/cockpit2/controls/yoke_pitch_ratio': return clamp(s.pitch, -1, 1)
      case 'sim/cockpit2/controls/total_roll_ratio':
      case 'sim/cockpit2/controls/yoke_roll_ratio': return clamp(s.roll, -1, 1)
      case 'sim/cockpit2/controls/total_heading_ratio':
      case 'sim/cockpit2/controls/yoke_heading_ratio': return clamp(s.yaw, -1, 1)
      case 'sim/cockpit2/controls/left_brake_ratio': return clamp(s.brakeLeft, 0, 1)
      case 'sim/cockpit2/controls/right_brake_ratio': return clamp(s.brakeRight, 0, 1)
      case 'sim/cockpit2/controls/parking_brake_ratio': return bit(s.parkingBrake)
      case 'sim/cockpit2/controls/elevator_trim': return clamp(s.trim, -1, 1)
      case 'sim/cockpit2/controls/rudder_trim': return clamp(s.rudderTrim, -1, 1)
      case 'sim/cockpit2/controls/flap_ratio': return clamp(s.flapHandle, 0, 1)
      case 'sim/cockpit2/controls/flap_handle_deploy_ratio':
      case 'sim/flightmodel2/controls/flap1_deploy_ratio':
      case 'sim/flightmodel2/controls/flap2_deploy_ratio': return clamp(s.flaps, 0, 1)
      case 'sim/cockpit2/controls/speedbrake_ratio': return clamp(s.speedbrake, 0, 1)
      case 'sim/cockpit2/controls/gear_handle_down': return bit(s.gearHandleDown)
      case 'sim/flightmodel2/gear/deploy_ratio': return clamp(s.gear, 0, 1)
      // ---- engine levers
      case 'sim/cockpit2/engine/actuators/throttle_ratio':
      case 'sim/cockpit2/engine/actuators/throttle_beta_rev_ratio': return clamp(at(s.throttle, i), 0, 1)
      case 'sim/cockpit2/engine/actuators/throttle_ratio_all':
      case 'sim/cockpit2/engine/actuators/throttle_beta_rev_ratio_all': return clamp(at(s.throttle, 0), 0, 1)
      case 'sim/cockpit2/engine/actuators/mixture_ratio': return clamp(at(s.mixture, i), 0, 1)
      case 'sim/cockpit2/engine/actuators/mixture_ratio_all': return clamp(at(s.mixture, 0), 0, 1)
      case 'sim/cockpit2/engine/actuators/prop_ratio': return clamp(at(s.prop, i), 0, 1)
      case 'sim/cockpit2/engine/actuators/prop_ratio_all': return clamp(at(s.prop, 0), 0, 1)
      // The propeller levers of the twins are keyed on the governed speed they set (rad/s).
      case 'sim/cockpit2/engine/actuators/prop_rotation_speed_rad_sec': return at(s.propRpm, i) * Math.PI / 30
      case 'sim/cockpit2/engine/actuators/carb_heat_ratio': return clamp(s.carbHeat, 0, 1)
      // Magnetos on BOTH (3) while the engine runs, OFF (0) when it is shut down.
      case 'sim/cockpit2/engine/actuators/ignition_key':
      case 'sim/cockpit2/engine/actuators/ignition_on': return running(i) ? 3 : 0
      case 'sim/cockpit2/engine/actuators/fuel_pump_on': return bit(s.fuelPump)
      // ---- engine instruments
      case 'sim/cockpit2/engine/indicators/engine_speed_rpm': return at(s.rpm, i)
      case 'sim/cockpit2/engine/indicators/prop_speed_rpm': return at(s.propRpm, i)
      case 'sim/cockpit2/engine/indicators/MPR_in_hg': return at(s.manifoldInHg, i)
      case 'sim/cockpit2/engine/indicators/fuel_flow_kg_sec': return Math.max(0, at(s.fuelFlowKgS, i))
      case 'sim/cockpit2/engine/indicators/EGT_deg_C': return at(s.egtC, i)
      case 'sim/cockpit2/engine/indicators/CHT_deg_C': return at(s.chtC, i)
      case 'sim/cockpit2/engine/indicators/oil_temperature_deg_C': return at(s.oilTempC, i)
      case 'sim/cockpit2/engine/indicators/oil_pressure_psi': return at(s.oilPressPsi, i)
      case 'sim/cockpit2/engine/indicators/ITT_deg_C': return at(s.ittC, i)
      case 'sim/cockpit2/engine/indicators/N1_percent': return at(s.n1Pct, i)
      case 'sim/cockpit2/engine/indicators/torque_n_mtr': return at(s.torqueNm, i)
      case 'sim/cockpit2/fuel/fuel_quantity': return Math.max(0, finite(s.fuelKg[i] ?? 0))
      // ---- flight instruments (pilot and copilot read the same sensors)
      case 'sim/cockpit2/gauges/indicators/airspeed_kts_pilot':
      case 'sim/cockpit2/gauges/indicators/airspeed_kts_copilot': return Math.max(0, finite(s.iasKt))
      case 'sim/cockpit2/gauges/indicators/altitude_ft_pilot':
      case 'sim/cockpit2/gauges/indicators/altitude_ft_copilot': return finite(s.altitudeFt)
      case 'sim/cockpit2/gauges/actuators/barometer_setting_in_hg_pilot':
      case 'sim/cockpit2/gauges/actuators/barometer_setting_in_hg_copilot': return finite(s.baroInHg)
      case 'sim/cockpit2/gauges/indicators/pitch_vacuum_deg_pilot':
      case 'sim/cockpit2/gauges/indicators/pitch_vacuum_deg_copilot':
      case 'sim/cockpit2/gauges/indicators/pitch_electric_deg_pilot':
      case 'sim/cockpit2/gauges/indicators/pitch_AHARS_deg_pilot': return finite(s.pitchDeg)
      case 'sim/cockpit2/gauges/indicators/roll_vacuum_deg_pilot':
      case 'sim/cockpit2/gauges/indicators/roll_vacuum_deg_copilot':
      case 'sim/cockpit2/gauges/indicators/roll_electric_deg_pilot':
      case 'sim/cockpit2/gauges/indicators/roll_AHARS_deg_pilot': return finite(s.rollDeg)
      case 'sim/cockpit2/gauges/indicators/heading_vacuum_deg_mag_pilot':
      case 'sim/cockpit2/gauges/indicators/heading_electric_deg_mag_pilot':
      case 'sim/cockpit2/gauges/indicators/heading_electric_deg_mag_copilot':
      case 'sim/cockpit2/gauges/indicators/heading_AHARS_deg_mag_pilot':
      case 'sim/cockpit2/gauges/indicators/compass_heading_deg_mag': return wrap360(s.headingDeg)
      case 'sim/cockpit2/gauges/indicators/vvi_fpm_pilot':
      case 'sim/cockpit2/gauges/indicators/vvi_fpm_copilot':
      case 'sim/cockpit2/gauges/indicators/total_energy_fpm': return finite(s.vsiFpm)
      case 'sim/cockpit2/gauges/indicators/turn_rate_roll_deg_pilot':
      case 'sim/cockpit2/gauges/indicators/turn_rate_roll_deg_copilot':
      case 'sim/cockpit2/gauges/indicators/turn_rate_heading_deg_pilot':
      case 'sim/cockpit2/gauges/indicators/turn_rate_heading_deg_copilot': return finite(s.turnRateDegS) * (STANDARD_RATE_MARK_DEG / 3)
      case 'sim/cockpit2/gauges/indicators/slip_deg': return finite(s.slipDeg)
      case 'sim/flightmodel/forces/g_nrml': return finite(s.gLoad)
      case 'sim/flightmodel/forces/g_side':
      case 'sim/flightmodel/forces/g_axil': return 0
      case 'sim/cockpit2/gauges/indicators/suction_1_ratio':
      case 'sim/cockpit2/gauges/indicators/suction_2_ratio': return s.engineRunning.some(Boolean) ? VACUUM_INHG : 0
      // ---- navigation: NAV 1 drives both CDIs and the HSI; NAV 2 shows its OFF flag
      case 'sim/cockpit2/radios/indicators/nav1_hdef_dots_pilot':
      case 'sim/cockpit2/radios/indicators/hsi_hdef_dots_pilot': return s.nav ? clamp(s.nav.deflection, -1, 1) * FULL_SCALE_DOTS : 0
      case 'sim/cockpit2/radios/indicators/nav1_vdef_dots_pilot':
      case 'sim/cockpit2/radios/indicators/hsi_vdef_dots_pilot': return s.nav?.glideslope != null ? clamp(s.nav.glideslope, -1, 1) * FULL_SCALE_DOTS : 0
      case 'sim/cockpit2/radios/indicators/nav1_flag_from_to_pilot':
      case 'sim/cockpit2/radios/indicators/hsi_flag_from_to_pilot': return s.nav?.toFrom ?? 0
      // The glideslope flag shows (1) unless a glideslope is received.
      case 'sim/cockpit2/radios/indicators/nav1_flag_glideslope':
      case 'sim/cockpit2/radios/indicators/nav1_flag_glideslope_mech':
      case 'sim/cockpit2/radios/indicators/hsi_flag_glideslope_pilot_mech': return bit(s.nav?.glideslope == null)
      case 'sim/cockpit2/radios/indicators/hsi_display_horizontal_pilot': return bit(!!s.nav)
      case 'sim/cockpit2/radios/indicators/hsi_display_vertical_pilot': return bit(s.nav?.glideslope != null)
      case 'sim/cockpit2/radios/actuators/nav1_obs_deg_mag_pilot':
      case 'sim/cockpit2/radios/actuators/hsi_obs_deg_mag_pilot': return wrap360(s.nav?.obsDeg ?? 0)
      case 'sim/cockpit2/radios/indicators/adf1_relative_bearing_deg': return s.adfBearingDeg === null ? 90 : finite(s.adfBearingDeg)
      // ---- electrics, switches, lights
      case 'sim/cockpit2/electrical/battery_on': return bit(s.battery)
      case 'sim/cockpit2/electrical/generator_on': return bit(s.alternator)
      case 'sim/cockpit2/electrical/bus_volts':
      case 'sim/cockpit2/electrical/battery_voltage_indicated_volts': return Math.max(0, finite(s.busVolts))
      case 'sim/cockpit2/switches/avionics_power_on': return bit(s.avionics)
      case 'sim/cockpit2/ice/ice_pitot_heat_on_pilot': return bit(s.pitotHeat)
      case 'sim/cockpit2/switches/landing_lights_on': return bit(s.landingLights)
      case 'sim/cockpit2/switches/taxi_light_on': return bit(s.taxiLight)
      case 'sim/cockpit2/switches/navigation_lights_on': return bit(s.navLights)
      case 'sim/cockpit2/switches/strobe_lights_on': return bit(s.strobes)
      case 'sim/cockpit2/switches/beacon_on': return bit(s.beacon)
      case 'sim/cockpit2/electrical/panel_brightness_ratio':
      case 'sim/cockpit2/switches/panel_brightness_ratio': return clamp(s.panelLight, 0, 1)
      // ---- annunciators (1 = lit)
      case 'sim/cockpit2/annunciators/oil_pressure':
      case 'sim/cockpit2/annunciators/oil_pressure_low': return bit(s.lowOilPressure)
      case 'sim/cockpit2/annunciators/low_vacuum': return bit(s.lowVacuum)
      case 'sim/cockpit2/annunciators/low_voltage': return bit(s.lowVolts)
      case 'sim/cockpit2/annunciators/fuel_quantity': return bit(s.lowFuel)
      // ---- clocks
      case 'sim/cockpit2/clock_timer/zulu_time_hours': return Math.floor(wrapHours(s.zuluHours))
      case 'sim/cockpit2/clock_timer/zulu_time_minutes': return Math.floor((wrapHours(s.zuluHours) % 1) * 60)
      case 'sim/cockpit2/clock_timer/zulu_time_seconds': return Math.floor((wrapHours(s.zuluHours) * 3600) % 60)
      case 'sim/cockpit2/clock_timer/local_time_hours': return Math.floor(wrapHours(s.localHours))
      case 'sim/cockpit2/clock_timer/local_time_minutes': return Math.floor((wrapHours(s.localHours) % 1) * 60)
      case 'sim/cockpit2/clock_timer/local_time_seconds': return Math.floor((wrapHours(s.localHours) * 3600) % 60)
      case 'sim/cockpit2/clock_timer/current_day': return s.day
      case 'sim/cockpit2/clock_timer/current_month': return s.month
      case 'sim/cockpit2/clock_timer/hobbs_time_hours': return Math.floor(Math.max(0, finite(s.hobbsHours)))
      case 'sim/cockpit2/clock_timer/hobbs_time_minutes': return Math.floor((Math.max(0, finite(s.hobbsHours)) % 1) * 60)
      // ---- doors shut
      case 'sim/flightmodel2/misc/door_open_ratio': return 0
    }
    if (Object.prototype.hasOwnProperty.call(GA_RESTING, ref)) return GA_RESTING[ref]!
    return 0
  }
}

const wrapHours = (h: number): number => ((finite(h) % 24) + 24) % 24
