import { expect, it } from 'vitest'
import { drawAirbusEwd, drawAirbusPfd, drawAirbusSystems } from '../../src/cockpit/airbus-displays'
import { makeRecordingCtx } from './canvas-stub'

it('shows live Airbus flight modes and current flight data without Boeing annunciations', () => {
  const c = makeRecordingCtx()
  drawAirbusPfd(c, 502, {
    iasKt: 138, trendKt10s: 5, mach: .22, selSpeedKt: 150, vmoKt: 330, stallKt: 117,
    pitchDeg: 4, rollDeg: -3, slipDeg: .2, altFt: 2460, selAltFt: 3000, baroInHg: 29.92,
    vsFpm: -530, hdgDeg: 282, selHdgDeg: 284, trackDeg: 280, radioAltFt: 2350, onGround: false,
    gs: .2, loc: -.25, fma: { at: 'MCP SPD', pitch: 'G/S', pitchArmed: '', roll: 'VOR/LOC', rollArmed: '', ap: 'CMD' },
  })
  const shown = c.texts.map(x => x.text)
  for (const expected of ['SPEED', 'G/S', 'LOC', 'AP1', '138', '2460', '282', '2350']) expect(shown).toContain(expected)
  expect(shown).not.toContain('CMD'); expect(shown).not.toContain('MCP SPD')
  const gps = makeRecordingCtx()
  drawAirbusPfd(gps, 502, {
    iasKt: 150, trendKt10s: 0, mach: .25, selSpeedKt: 150, vmoKt: 330, stallKt: 117,
    pitchDeg: 0, rollDeg: 0, slipDeg: 0, altFt: 4000, selAltFt: 4000, baroInHg: 29.92,
    vsFpm: 0, hdgDeg: 282, selHdgDeg: 284, trackDeg: 280, radioAltFt: null, onGround: false,
    fma: { at: '', pitch: 'ALT HOLD', pitchArmed: '', roll: 'VOR/LOC', rollArmed: '', ap: 'CMD' },
  }, 'gps')
  expect(gps.texts.map(t => t.text)).toContain('NAV'); expect(gps.texts.map(t => t.text)).not.toContain('LOC')
})

it('draws each actual engine and uses live systems data for fuel, gear and speedbrake', () => {
  const ewd = makeRecordingCtx(), sd = makeRecordingCtx()
  drawAirbusEwd(ewd, 502, { n1Pct: [76.1, 77.4, 78.1, 75.9], n1RedlinePct: 104, n1CommandPct: 84, egtC: [543, 546, 548, 540], ffKgH: [2800, 2900, 3100, 2700], fuelKg: [12004, 11916], tatC: 4, reverse: true })
  drawAirbusSystems(sd, 502, { fuelKg: [12004, 11916], gearPosition: 1, flapDegrees: 15, speedbrake: .62, tatC: 4 })
  expect(ewd.texts.map(x => x.text)).toEqual(expect.arrayContaining(['76.1', '77.4', '78.1', '75.9', 'REV', '23920']))
  expect(sd.texts.map(x => x.text)).toEqual(expect.arrayContaining(['12004', '11916', 'DOWN', '15°', '62%']))
})
