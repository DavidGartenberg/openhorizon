/**
 * Electrical system (Phase 3 §8): 28V alternator + 24V lead-acid battery,
 * feeding a main/avionics bus (G1000 PFD/MFD/GIA/audio panel-equivalent
 * load) and a standby bus (battery-backed standby attitude/airspeed/
 * altimeter). Pure state + step function, no three.js/DOM (§4.1).
 *
 * Behavior modeled:
 *  - Alternator running + master battery on → bus sits near 28V, battery
 *    charges toward full.
 *  - Alternator failed/off with battery switch on → bus voltage comes from
 *    the battery and sags as it depletes; the battery drains under the
 *    connected load over real time (amp-hour bookkeeping).
 *  - As the battery nears empty, an under-voltage load-shed drops the main/
 *    avionics bus (G1000-equivalent load) first — this mirrors why real
 *    G1000 singles carry a separate battery-backed standby instrument that
 *    outlives the avionics master during an alternator-failure drill.
 *    Standby stays powered until the battery itself is fully dead.
 *
 * NOTE ON SOURCING: the C172S POH (not available in this repo) does not
 * publish battery amp-hour capacity or individual bus load currents. The
 * constants below are representative values for a 24V G1000-equipped C172S
 * (Concorde RG-25XC-class battery, ~60A alternator) and are flagged as
 * assumptions rather than POH-verified numbers — a later task should swap
 * these for the real POH electrical-load table if/when it's sourced.
 */

// ---- flagged assumptions (see file header) ----
const BATTERY_CAPACITY_AH = 25.5 // Concorde RG-25XC-class 24V battery rating
const ALTERNATOR_VOLTAGE = 28.0 // volts, 28V ship's system
const ALTERNATOR_MAX_AMPS = 60 // 60A alternator
const BATTERY_FULL_VOLTAGE = 25.0 // battery-only bus voltage near full charge
const BATTERY_EMPTY_VOLTAGE = 20.0 // battery-only bus voltage near empty (still "up")
const MAIN_BUS_LOAD_AMPS = 12 // G1000 PFD+MFD+GIA/GEA+audio-panel-equivalent draw
const STANDBY_LOAD_AMPS = 1.2 // battery-backed standby attitude/ASI/altimeter draw
const CHARGE_CURRENT_AMPS = 10 // bulk charge current while alternator supplies the bus
const LOAD_SHED_SOC = 0.15 // under-voltage relay sheds main bus below this SOC fraction

export interface ElectricalInputs {
  masterBattery: boolean
  masterAlternator: boolean
  avionicsSwitch: boolean
  /** Alternator belt/regulator failure — true disables alternator output
   *  even if masterAlternator is on and the engine is running. */
  alternatorFailed: boolean
  /** Engine must be turning for the belt-driven alternator to produce. */
  engineRunning: boolean
}

export interface ElectricalState {
  batteryAh: number
  batteryPercent: number // 0..100
  busVoltage: number
  alternatorAmps: number
  batteryAmps: number // + charging, - discharging
  mainBusPowered: boolean // G1000-equivalent avionics/main load
  standbyBusPowered: boolean // battery-backed standby instruments
}

export function makeElectricalState(): ElectricalState {
  return {
    batteryAh: BATTERY_CAPACITY_AH,
    batteryPercent: 100,
    busVoltage: 0,
    alternatorAmps: 0,
    batteryAmps: 0,
    mainBusPowered: false,
    standbyBusPowered: false,
  }
}

export function stepElectrical(st: ElectricalState, dt: number, inp: ElectricalInputs): void {
  const soc = st.batteryAh / BATTERY_CAPACITY_AH

  if (!inp.masterBattery) {
    // Battery contactor open: nothing is powered, alternator can't feed
    // the bus without the battery contactor closed on this simplified bus.
    st.busVoltage = 0
    st.alternatorAmps = 0
    st.batteryAmps = 0
    st.mainBusPowered = false
    st.standbyBusPowered = false
    return
  }

  const alternatorUp = inp.masterAlternator && inp.engineRunning && !inp.alternatorFailed && st.batteryAh > 0
  st.standbyBusPowered = st.batteryAh > 0
  st.mainBusPowered = inp.avionicsSwitch && st.batteryAh > 0 && (alternatorUp || soc > LOAD_SHED_SOC)

  const loadAmps = (st.mainBusPowered ? MAIN_BUS_LOAD_AMPS : 0) + (st.standbyBusPowered ? STANDBY_LOAD_AMPS : 0)

  if (alternatorUp) {
    st.busVoltage = ALTERNATOR_VOLTAGE
    const chargeAmps = st.batteryAh < BATTERY_CAPACITY_AH ? CHARGE_CURRENT_AMPS : 0
    st.batteryAmps = chargeAmps
    st.alternatorAmps = Math.min(loadAmps + chargeAmps, ALTERNATOR_MAX_AMPS)
    st.batteryAh = Math.min(st.batteryAh + (chargeAmps * dt) / 3600, BATTERY_CAPACITY_AH)
  } else {
    // Battery alone: voltage sags with state of charge, and depletes under
    // whatever load is still connected.
    st.busVoltage = st.batteryAh > 0 ? BATTERY_EMPTY_VOLTAGE + (BATTERY_FULL_VOLTAGE - BATTERY_EMPTY_VOLTAGE) * soc : 0
    st.alternatorAmps = 0
    st.batteryAmps = -loadAmps
    st.batteryAh = Math.max(st.batteryAh - (loadAmps * dt) / 3600, 0)
  }

  // A battery that hit empty *this* step can no longer be credited with
  // having powered anything for the step — settle the flags/voltage to the
  // true post-depletion state rather than the pre-decrement snapshot.
  if (st.batteryAh <= 0) {
    st.mainBusPowered = false
    st.standbyBusPowered = false
    st.busVoltage = 0
  }

  st.batteryPercent = (st.batteryAh / BATTERY_CAPACITY_AH) * 100
}
