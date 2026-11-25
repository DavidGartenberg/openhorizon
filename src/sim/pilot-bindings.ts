import { parseGamepadMap, type GamepadMap } from './gamepad-map'

/**
 * The pilot's own TCA Captain Pack bindings (Thrustmaster TCA Sidestick X Copilot + TCA Q-Eng 1&2), saved from the sim on
 * 2026-11-22 at the pilot's request ("remember the keybinds … also my gear right now"). They are what the sim starts with when
 * the browser has no saved bindings (a new address, cleared site data), and what "Restore my saved bindings" puts back.
 *
 *  - Thrust levers: axes 0 / 1, reversed (sign −1), calibrated at their detents (IDLE measured, so below IDLE is reverse).
 *  - Speed brake axis 5, flaps axis 2.
 *  - Gear lever: button 20, one switch: ON = gear UP, OFF = gear DOWN.
 *  - Autobrake selector 1 / 2 / 3 / MAX = buttons 22 / 23 / 24 / 25.
 *  - Parking brake 19, engine masters 2 / 3, engine mode CRANK 6 / NORM 7, rudder trim L 18 / R 17 / reset 16.
 *  - Sidestick: red autopilot disconnect = button 3; the stick's other buttons keep their key aliases.
 */
const SAVED = {
  btn: {
    reverse: { pad: 1, btn: 0, deviceId: 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)', source: 'preset' },
    reverse2: { pad: 1, btn: 1, deviceId: 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)', source: 'preset' },
    autobrakeLow: { pad: 1, btn: 22, deviceId: 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)', source: 'user' },
    autobrakeMedium: { pad: 1, btn: 23, deviceId: 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)', source: 'user' },
    autobrake3: { pad: 1, btn: 24, deviceId: 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)', source: 'user' },
    autobrakeMax: { pad: 1, btn: 25, deviceId: 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)', source: 'user' },
    gearLever: { pad: 1, btn: 20, deviceId: 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)', source: 'user' },
    parkingBrake: { pad: 1, btn: 19, deviceId: 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)', source: 'user' },
    engineMaster1: { pad: 1, btn: 2, deviceId: 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)', source: 'user' },
    engineMaster2: { pad: 1, btn: 3, deviceId: 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)', source: 'user' },
    ignitionCrank: { pad: 1, btn: 6, deviceId: 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)', source: 'user' },
    ignitionNorm: { pad: 1, btn: 7, deviceId: 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)', source: 'user' },
    rudderTrimLeft: { pad: 1, btn: 18, deviceId: 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)', source: 'user' },
    rudderTrimRight: { pad: 1, btn: 17, deviceId: 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)', source: 'user' },
    rudderTrimReset: { pad: 1, btn: 16, deviceId: 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)', source: 'user' },
    apDisconnect: { pad: 0, btn: 3, deviceId: 'TCA Sidestick X Copilot (Vendor: 044f Product: 040f)', source: 'user' },
  },
  btnKeys: { '0:0': 'KeyT', '0:2': 'KeyX', '0:4': 'KeyU', '0:5': 'KeyF', '0:6': 'KeyG', '0:7': 'KeyV', '0:8': 'KeyZ', '0:9': 'KeyB', '0:10': 'KeyM', '0:11': 'Space', '0:12': 'KeyO', '0:13': 'KeyP', '0:14': 'KeyR', '0:15': 'KeyQ' },
  unverifiedBtnKeys: {},
  devices: { 0: 'TCA Sidestick X Copilot (Vendor: 044f Product: 040f)', 1: 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)' },
  v: 10,
  pitch: { pad: 0, axis: 1, sign: 1, deviceId: 'TCA Sidestick X Copilot (Vendor: 044f Product: 040f)', source: 'preset' },
  roll: { pad: 0, axis: 0, sign: 1, deviceId: 'TCA Sidestick X Copilot (Vendor: 044f Product: 040f)', source: 'preset' },
  yaw: { pad: 0, axis: 5, sign: 1, deviceId: 'TCA Sidestick X Copilot (Vendor: 044f Product: 040f)', source: 'preset' },
  throttle: { pad: 1, axis: 0, sign: -1, calibration: { min: -1, max: 1, idle: -0.4910200834274292, cl: 0.019394218921661377, flex: 0.5261768102645874, measuredIdle: true }, source: 'user', deviceId: 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)' },
  throttle2: { pad: 1, axis: 1, sign: -1, calibration: { min: -1, max: 1, idle: -0.4888228178024292, cl: 0.014389276504516602, flex: 0.546379804611206, measuredIdle: true }, source: 'user', deviceId: 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)' },
  speedbrake: { pad: 1, axis: 5, sign: 1, deviceId: 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)', source: 'user', calibration: { min: -1, max: 1 } },
  flaps: { pad: 1, axis: 2, sign: 1, deviceId: 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)', source: 'user', calibration: { min: -1, max: 1 } },
}

/** A fresh copy of the pilot's saved bindings (validated like a map loaded from the browser). */
export function pilotBindings(): GamepadMap {
  const m = parseGamepadMap(JSON.stringify(SAVED))
  if (!m) throw new Error('the saved pilot bindings no longer validate')
  return m
}
