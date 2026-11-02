import { describe, expect, it } from 'vitest'
import { contactInstruction, fieldName, isAddressedTo, readbackFor, readbackText, speakerRole, taxiInstruction, windPhrase } from '../../src/sim/atc/phraseology'

describe('who is talking', () => {
  it('tells facilities, ATIS broadcasts and aircraft apart', () => {
    expect(speakerRole('Palo Alto Tower')).toBe('atc')
    expect(speakerRole('Norcal Approach')).toBe('atc')
    expect(speakerRole('Oakland Center')).toBe('atc')
    expect(speakerRole('Palo Alto Ground')).toBe('atc')
    expect(speakerRole('KPAO ATIS')).toBe('atis')
    expect(speakerRole('Skyhawk 123AB')).toBe('pilot')
    expect(speakerRole('N77GA')).toBe('pilot')
    expect(speakerRole('UAL2262')).toBe('pilot')
  })
})

describe('phrases', () => {
  it('names the field the way a controller does', () => {
    expect(fieldName('San Francisco International Airport')).toBe('San Francisco')
    expect(fieldName('Palo Alto Airport')).toBe('Palo Alto')
    expect(fieldName('Hayward Executive Airport')).toBe('Hayward Executive')
    expect(fieldName('Half Moon Bay')).toBe('Half Moon Bay')
  })
  it('states the wind to the nearest ten degrees, with gusts only when they matter', () => {
    expect(windPhrase(287, 8)).toBe('wind 290 at 8')
    expect(windPhrase(5, 12)).toBe('wind 010 at 12')
    expect(windPhrase(358, 6)).toBe('wind 360 at 6')
    expect(windPhrase(0, 10)).toBe('wind 360 at 10')
    expect(windPhrase(270, 12, 18)).toBe('wind 270 at 12 gusting 18')
    expect(windPhrase(270, 12, 14)).toBe('wind 270 at 12')
    expect(windPhrase(270, 0)).toBe('wind calm')
  })
  it('builds the taxi and contact instructions once, for the controller and the readback alike', () => {
    expect(taxiInstruction('31', ['A', 'B'])).toBe('runway 31, taxi via A, B, hold short of runway 31')
    expect(taxiInstruction('31')).toBe('runway 31, taxi, hold short of runway 31')
    expect(contactInstruction('tower', 118.7)).toBe('contact tower 118.70')
  })
})

describe('readbacks', () => {
  it('read back what was instructed, in the same words', () => {
    expect(readbackFor({ kind: 'taxi', args: { runway: '31', via: ['A', 'B'] } })).toBe(taxiInstruction('31', ['A', 'B']))
    expect(readbackFor({ kind: 'takeoff', args: { runway: '31' } })).toBe('runway 31, cleared for takeoff')
    expect(readbackFor({ kind: 'land', args: { runway: '28R' } })).toBe('runway 28R, cleared to land')
    expect(readbackFor({ kind: 'holdShort', args: { runway: '28R' } })).toBe('hold short of runway 28R')
    expect(readbackFor({ kind: 'contact', args: { facility: 'departure', freqMhz: 120.5 } })).toBe('contact departure 120.50')
    expect(readbackFor({ kind: 'sequence', args: { number: 2, report: 'final' } })).toBe('number 2, will report final')
    expect(readbackFor({ kind: 'descend', args: { altitudeFt: 3000 } })).toBe('descend and maintain 3,000')
    expect(readbackFor({ kind: 'climb', args: { altitudeFt: 4000, squawk: '4521' } })).toBe('climb and maintain 4,000, squawk 4521')
    expect(readbackFor({ kind: 'approach', args: { runway: '28R', altitudeFt: 3000 } })).toBe('cleared ILS runway 28R approach, maintain 3,000 until established')
    expect(readbackFor({ kind: 'turn', args: { headingDeg: 90, direction: 'left' } })).toBe('turn left heading 090')
  })
  it('end with the callsign, and are not made up for an instruction without content', () => {
    expect(readbackText({ kind: 'takeoff', args: { runway: '31' } }, 'Skyhawk 77GA')).toBe('runway 31, cleared for takeoff, Skyhawk 77GA')
    expect(readbackText({ kind: 'contact', args: {} }, 'N1')).toBeNull()
    expect(readbackText({}, 'N1')).toBeNull()
  })
  it('knows who an instruction was for', () => {
    expect(isAddressedTo({ to: 'N77GA', text: 'anything' }, 'N77GA')).toBe(true)
    expect(isAddressedTo({ to: 'N42PK', text: 'N77GA, hello' }, 'N77GA')).toBe(false)
    expect(isAddressedTo({ text: 'N77GA, hello' }, 'N77GA')).toBe(true)
  })
})
