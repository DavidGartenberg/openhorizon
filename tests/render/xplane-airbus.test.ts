import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ROSTER } from '../../src/sim/aircraft/roster'
import { jetProfileFor } from '../../src/render/jet-profiles'
import { airbusCockpitFit, airbusCockpitFor, XP_A333_DISPLAYS, XP_COCKPIT_A333, makeAirbusDatarefReader } from '../../src/render/xplane-airbus'
import { defaultXpInputs } from '../../src/render/xplane-datarefs'
import { parseObj8 } from '../../src/render/xplane-obj8'
import { xpActionFor } from '../../src/render/xplane-interact'
import { makeApPanel, pressLoc } from '../../src/sim/ap-panel'

describe('fitted X-Plane Airbus decks', () => {
  it('the native LOC button selects localizer-only guidance and leaves altitude hold intact', () => {
    const manip = { type: 'command', cursor: 'button', commands: ['sim/autopilot/NAV'], datarefs: [], tooltip: 'Localizer' }
    expect(xpActionFor(manip, { right: false, upper: true }, 'airbus')).toEqual({ kind: 'localizer' })
    const panel = { ...makeApPanel(), master: true, vertical: 'ALT' as const, altHoldFt: 4000 }
    const result = pressLoc(panel, { headingDeg: 282, altitudeFt: 4000, verticalSpeedFpm: 0, iasKt: 150, rollDeg: 0 }, { gps: true, nav: true, loc: true, gs: true })
    expect(result.panel.lateral).toBe('APR')
    expect(result.panel.vertical).toBe('ALT'); expect(result.panel.altHoldFt).toBe(4000)
    const state = defaultXpInputs()
    state.mcp.master = true; state.mcp.lateral = result.panel.lateral; state.mcp.vertical = result.panel.vertical
    const read = makeAirbusDatarefReader(state, { flapIndex: 0, flapCount: 5, headingDeg: 282 }, {})
    expect(read('laminar/A333/annun/autopilot/loc_mode')).toBe(1)
    expect(read('laminar/A333/annun/autopilot/appr_mode')).toBe(0)
  })

  it('keeps tracking the localizer when LOC is selected during a coupled descent', () => {
    const panel = { ...makeApPanel(), master: true, lateral: 'APR' as const, vertical: 'GS' as const, autoland: true }
    const snapshot = { headingDeg: 282, altitudeFt: 2500, verticalSpeedFpm: -580, iasKt: 150, rollDeg: 0 }
    const available = { gps: true, nav: true, loc: true, gs: true }

    const result = pressLoc(panel, snapshot, available)

    expect(result.panel.lateral).toBe('APR')
    expect(result.panel.vertical).toBe('VS')
    expect(result.panel.sel.vsFpm).toBe(-600)
    expect(result.panel.autoland).toBe(false)
    expect(pressLoc(result.panel, snapshot, available).panel.lateral).toBe('ROL')
  })

  it('routes every selectable Airbus and no other manufacturer to the Airbus donor', () => {
    const airbuses = ROSTER.filter(r => r.spec.label.startsWith('Airbus '))
    expect(airbuses.length).toBeGreaterThan(10)
    for (const { spec } of ROSTER) {
      expect(airbusCockpitFor(spec.designator)).toBe(spec.label.startsWith('Airbus ') ? XP_COCKPIT_A333 : undefined)
    }
  })

  it('uses native A330 placement and fits variants to their own nose and cabin width', () => {
    expect(airbusCockpitFit('A333', 63.67)).toBeUndefined()
    const narrow = airbusCockpitFit('A320', 37.57)!
    const stretch = airbusCockpitFit('A321', 44.51)!
    expect(narrow.scale).toBeCloseTo(jetProfileFor('A320').diameter / jetProfileFor('A333').diameter)
    expect(stretch.scale).toBe(narrow.scale)
    expect(stretch.eye.x - narrow.eye.x).toBeCloseTo((44.51 - 37.57) / 2)
    expect(narrow.eye.x).toBeLessThan(37.57 / 2)
    expect(narrow.eye.y).toBeLessThan(0)
    expect(narrow.eye.up).toBeGreaterThan(0)
  })

  it('drives native sidesticks, handle detents, speedbrake and AP lamps from simulator state', () => {
    const s = defaultXpInputs()
    s.pitch = 0.3; s.roll = -0.6; s.parkingBrake = true
    s.speedbrake = 0.45; s.mcp.master = true; s.mcp.atArm = true
    const read = makeAirbusDatarefReader(s, { flapIndex: 2, flapCount: 5, headingDeg: 142 }, {})
    expect(read('sim/cockpit2/controls/yoke_pitch_ratio')).toBe(0.3)
    expect(read('sim/cockpit2/controls/yoke_roll_ratio_copilot')).toBe(-0.6)
    expect(read('sim/cockpit2/controls/flap_handle_request_ratio')).toBe(0.5)
    expect(read('sim/cockpit2/controls/speedbrake_ratio')).toBe(0.45)
    expect(read('laminar/A333/switches/park_brake_pos')).toBe(1)
    expect(read('laminar/A333/annun/autopilot/ap1_mode')).toBe(1)
    expect(read('laminar/A333/annun/autopilot/ap2_mode')).toBe(0)
    expect(read('laminar/A333/annun/autopilot/a_thr_mode')).toBe(1)
    expect(read('sim/cockpit2/gauges/indicators/compass_heading_deg_mag')).toBe(142)
    s.panelLight = .7
    expect(read('sim/cockpit2/electrical/instrument_brightness_ratio_manual[13]')).toBe(.7)
    expect(read('sim/cockpit2/electrical/instrument_brightness_ratio[15]')).toBe(.7)
  })
})

const root = process.env.XPLANE_DIR ?? '/Users/davidgartenberg/X-Plane 12/Aircraft/Laminar Research'
const folder = `${root}/Airbus A330-300`
it.skipIf(!existsSync(`${folder}/A330.acf`))('native Airbus assets supply all six authored display rectangles and the ACF design eye', () => {
  const model = XP_COCKPIT_A333
  for (const part of model.objs) expect(existsSync(`${folder}/${typeof part === 'string' ? part : part.path}`)).toBe(true)
  const acf = readFileSync(`${folder}/A330.acf`, 'utf8')
  for (let i = 0; i < 3; i++) {
    expect(model.eyeObj[i]).toBeCloseTo(Number(new RegExp(`^P acf/_pe_xyz/${i} ([-.\\d]+)`, 'm').exec(acf)?.[1]) * 0.3048, 5)
  }
  const p = parseObj8(readFileSync(`${folder}/${model.panelObj}`, 'utf8'))
  const vertices = p.draws.filter(d => d.cockpit && !d.hidden).flatMap(d => Array.from(p.indices.slice(d.start, d.start + d.count)))
  for (const [name, { x, y, w, h }] of Object.entries(XP_A333_DISPLAYS)) {
    // Unlike the six primary displays, the standby face has rounded corners.
    if (name === 'standby') {
      const points = vertices.map(i => [p.uvs[i * 2]! * 2048, (1 - p.uvs[i * 2 + 1]!) * 1024])
        .filter(([u, v]) => u! >= x - 1 && u! <= x + w + 1 && v! >= y - 1 && v! <= y + h + 1)
      for (const [axis, min, max] of [[0, x, x + w], [1, y, y + h]] as const) {
        expect(Math.abs(Math.min(...points.map(pt => pt[axis]!)) - min)).toBeLessThan(1)
        expect(Math.abs(Math.max(...points.map(pt => pt[axis]!)) - max)).toBeLessThan(1)
      }
      continue
    }
    for (const [u, v] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
      expect(vertices.some(i => Math.abs(p.uvs[i * 2]! * 2048 - u!) < 1 && Math.abs((1 - p.uvs[i * 2 + 1]!) * 1024 - v!) < 1), `${name}: ${u}, ${v}`).toBe(true)
    }
  }
})
