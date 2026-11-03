/**
 * Typed commands (the "/" search box): usage and what each does. HELP
 * shows this list in the sim; a test keeps it in step with the commands
 * main.ts actually handles.
 */
export const COMMANDS: ReadonlyArray<{ word: string; usage: string; does: string }> = [
  { word: 'HELP', usage: 'HELP', does: 'show or hide this list' },
  { word: 'FLY', usage: 'FLY <type>', does: 'switch aircraft (e.g. FLY 737, FLY C172, FLY LS8)' },
  { word: 'AI', usage: 'AI OFF|LIGHT|REAL', does: 'pattern traffic density' },
  { word: 'LIVE', usage: 'LIVE TRAFFIC ON|OFF', does: 'real ADS-B traffic (display + TCAS)' },
  { word: 'IMAGERY', usage: 'IMAGERY ON|OFF|USGS|GOOGLE|HYBRID|MAP', does: 'terrain photo/map layer (Google needs a server key)' },
  { word: 'JOY', usage: 'JOY CLEAR', does: 'joystick bindings' },
  { word: 'FAIL', usage: 'FAIL ALTERNATOR|ICING|STATIC|NONE', does: 'system failures' },
  { word: 'WB', usage: 'WB', does: 'weight & balance page on the MFD' },
  { word: 'WEIGHT', usage: 'WEIGHT <lb>', does: 'set payload' },
  { word: 'CHALLENGE', usage: 'CHALLENGE <name>', does: 'start a landing challenge' },
  { word: 'REPLAY', usage: 'REPLAY', does: 'open / close the flight replay' },
  { word: 'MICROBURST', usage: 'MICROBURST [nm]', does: 'spawn a microburst ahead (default 1.6 nm)' },
  { word: 'THERMALS', usage: 'THERMALS ON|OFF', does: 'thermals and ridge lift' },
  { word: 'WAKE', usage: 'WAKE ON|OFF', does: 'wake turbulence from traffic' },
  { word: 'ICING', usage: 'ICING ON|OFF', does: 'airframe icing' },
  { word: 'DAMAGE', usage: 'DAMAGE ON|OFF', does: 'structural failures beyond ultimate load' },
  { word: 'CONTAMINATION', usage: 'CONTAMINATION ON|OFF', does: 'runway contamination (wet / snow / ice)' },
  { word: 'ANTI-ICE', usage: 'ANTI-ICE ON|OFF|AUTO', does: 'wing/engine anti-ice (jets, turboprops)' },
  { word: 'ENV', usage: 'ENV', does: 'convection, lift, ice, runway state, max g' },
  { word: 'PERF', usage: 'PERF', does: 'per-section frame timing overlay' },
]

export function helpText(): string {
  const w = Math.max(...COMMANDS.map((c) => c.usage.length))
  return ['COMMANDS (type after /; an airport ident flies you there)', ...COMMANDS.map((c) => `${c.usage.padEnd(w + 2)}${c.does}`)].join('\n')
}
