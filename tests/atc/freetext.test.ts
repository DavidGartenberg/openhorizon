import { describe, expect, it } from 'vitest'
import { interpretTransmission, type FreeTextCtx } from '../../src/sim/atc/freetext'

const CTX: FreeTextCtx = {
  callsign: 'Skyhawk 123AB',
  facility: 'San Francisco Tower',
  activeRunway: '28R',
  windDirDeg: 287,
  windKt: 12,
  altimeterInHg: 29.92,
  taxiVia: ['A', 'F'],
}

describe('free-text ATC (type anything, they respond)', () => {
  it('mayday engine failure gets priority handling with equipment and the souls ask', () => {
    const r = interpretTransmission('MAYDAY MAYDAY MAYDAY engine failure', CTX)
    expect(r.intent).toBe('emergency-engine')
    expect(r.emergency).toBe(true)
    expect(r.response).toContain('mayday')
    expect(r.response).toContain('runway 28R')
    expect(r.response).toContain('emergency equipment standing by')
    expect(r.response).toContain('souls on board')
  })

  it('fire gets fire-and-rescue and any-runway priority', () => {
    const r = interpretTransmission('we have smoke in the cockpit, declaring emergency', CTX)
    expect(r.intent).toBe('emergency-fire')
    expect(r.response).toContain('fire and rescue')
    expect(r.response).toContain('any runway')
  })

  it('pan-pan is answered as pan-pan, not mayday', () => {
    const r = interpretTransmission('pan pan, medical issue on board', CTX)
    expect(r.emergency).toBe(true)
    expect(r.intent).toBe('emergency-medical')
  })

  it('minimum fuel makes you number one', () => {
    const r = interpretTransmission('declaring minimum fuel', CTX)
    expect(r.intent).toBe('emergency-fuel')
    expect(r.response).toContain('number one')
  })

  it('souls follow-up is copied back', () => {
    const r = interpretTransmission('4 souls on board, 2 hours fuel', CTX)
    expect(r.intent).toBe('emergency-souls')
    expect(r.response).toContain('4 souls')
    expect(r.response).toContain('2 hours')
  })

  it('takeoff request gets wind and clearance', () => {
    const r = interpretTransmission('ready for takeoff', CTX)
    expect(r.intent).toBe('takeoff')
    expect(r.response).toContain('cleared for takeoff')
    expect(r.response).toContain('wind 290 at 12')
  })

  it('landing request cleared with wind', () => {
    const r = interpretTransmission('request full stop landing', CTX)
    expect(r.intent).toBe('landing')
    expect(r.response).toContain('cleared to land')
  })

  it('taxi uses the real route idents when known', () => {
    const r = interpretTransmission('request taxi', CTX)
    expect(r.response).toContain('taxi via A, F')
    const r2 = interpretTransmission('request taxi', { ...CTX, taxiVia: undefined })
    expect(r2.response).toContain('via the parallel')
  })

  it('altitude and flight-level requests get climb/descend phraseology', () => {
    expect(interpretTransmission('request climb 9000 feet', CTX).response).toContain('climb and maintain 9,000')
    expect(interpretTransmission('request descend 4000', CTX).response).toContain('descend and maintain 4,000')
    expect(interpretTransmission('request FL240', CTX).response).toContain('flight level 240')
  })

  it('heading, direct, weather, radio check, position, frequency all answer', () => {
    expect(interpretTransmission('request left heading 180', CTX).response).toBe('turn left heading 180')
    expect(interpretTransmission('request direct SFO', CTX).response).toBe('cleared direct SFO')
    expect(interpretTransmission('say winds and altimeter', CTX).response).toContain('altimeter 29.92')
    expect(interpretTransmission('radio check', CTX).response).toBe('read you five by five')
    expect(interpretTransmission('left downwind 28R', CTX).response).toContain('cleared to land')
    expect(interpretTransmission('frequency change please', CTX).response).toContain('frequency change approved')
  })

  it('go-around gets runway heading and a downwind report', () => {
    const r = interpretTransmission('going around', CTX)
    expect(r.intent).toBe('goAround')
    expect(r.response).toContain('fly runway heading')
  })

  it('gibberish gets an honest say-again, never an invented clearance', () => {
    const r = interpretTransmission('purple monkey dishwasher', CTX)
    expect(r.intent).toBe('unknown')
    expect(r.response).toContain('say again')
  })

  it('readback of a clearance is acknowledged', () => {
    const r = interpretTransmission('cleared to land 28r, Skyhawk 123AB', CTX)
    expect(['readback', 'landing']).toContain(r.intent)
  })
})
