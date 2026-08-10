import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs module without type declarations
import { buildFrequencies } from '../../server/parse.mjs'
import { CommsBus, isAudible } from '../../src/sim/atc/comms'

describe('buildFrequencies', () => {
  const csv =
    'id,airport_ref,airport_ident,type,description,frequency_mhz\n' +
    '1,100,KPAO,TWR,TOWER,118.6\n' +
    '2,100,KPAO,GND,GROUND,125.0\n' +
    '3,100,KPAO,ATIS,ATIS,120.6\n' +
    '4,200,KSQL,TWR,TOWER,119.0\n' +
    '5,300,EGLL,TWR,TOWER,118.5\n' +
    '6,400,KHAF,CTAF,CTAF/UNICOM,122.8\n' +
    '7,100,KPAO,MISC,ODDBALL,999.9\n'
  const us = new Set(['KPAO', 'KSQL', 'KHAF'])
  const out = buildFrequencies(csv, us)

  it('groups known types per US airport and drops non-US/unknown', () => {
    expect(out.KPAO).toEqual([
      { t: 'TWR', f: 118.6, d: 'TOWER' },
      { t: 'GND', f: 125.0, d: 'GROUND' },
      { t: 'ATIS', f: 120.6, d: 'ATIS' },
    ])
    expect(out.KSQL).toEqual([{ t: 'TWR', f: 119.0, d: 'TOWER' }])
    expect(out.KHAF).toEqual([{ t: 'CTAF', f: 122.8, d: 'CTAF/UNICOM' }])
    expect(out.EGLL).toBeUndefined()
  })
})

describe('CommsBus', () => {
  it('logs transmissions and gates audibility by tuned frequency', () => {
    const bus = new CommsBus()
    bus.transmit({ freqMhz: 118.6, from: 'Palo Alto Tower', text: 'Skyhawk 123AB, cleared for takeoff runway 31', atSimS: 10 })
    bus.transmit({ freqMhz: 121.5, from: 'N999XX', text: 'mayday', atSimS: 11 })
    expect(bus.log).toHaveLength(2)
    const heard = bus.log.filter((t) => isAudible(t.freqMhz, 118.6))
    expect(heard).toHaveLength(1)
    expect(heard[0]!.text).toContain('cleared for takeoff')
  })

  it('isAudible tolerates float representation within 5 kHz, not beyond', () => {
    expect(isAudible(118.6, 118.60000001)).toBe(true)
    expect(isAudible(118.6, 118.65)).toBe(false)
    expect(isAudible(122.8, 122.8)).toBe(true)
  })

  it('subscribers hear only their tuned frequency', () => {
    const bus = new CommsBus()
    const heard: string[] = []
    bus.subscribe((t) => {
      if (isAudible(t.freqMhz, 119.0)) heard.push(t.text)
    })
    bus.transmit({ freqMhz: 119.0, from: 'San Carlos Tower', text: 'roger', atSimS: 1 })
    bus.transmit({ freqMhz: 118.6, from: 'Palo Alto Tower', text: 'nope', atSimS: 2 })
    expect(heard).toEqual(['roger'])
  })
})
