import { describe, expect, it } from 'vitest'
import { abbreviatedTail, callsignKey, findCallsigns, parseCallsign, radioCallsign } from '../../src/sim/atc/callsign'

describe('callsigns as written', () => {
  it('parses a type word with a tail, an N-number, and an airline designator', () => {
    expect(parseCallsign('Skyhawk 123AB')).toMatchObject({ kind: 'ga', type: 'Skyhawk', tail: '123AB', november: false })
    expect(parseCallsign('King Air 77GA')).toMatchObject({ kind: 'ga', type: 'King Air', tail: '77GA' })
    expect(parseCallsign('N42PK')).toMatchObject({ kind: 'ga', tail: '42PK', november: true })
    expect(parseCallsign('UAL2262')).toMatchObject({ kind: 'airline', airline: 'United', flight: '2262' })
    expect(parseCallsign('BAW2KP')).toMatchObject({ kind: 'airline', airline: 'Speedbird', flight: '2', suffix: 'KP' })
  })
  it('does not mistake ordinary words, runways or unknown designators for callsigns', () => {
    expect(parseCallsign('runway 28L')).toBeNull()
    expect(parseCallsign('ZZZ123')).toBeNull()
    expect(findCallsigns('descend and maintain 3,000, ILS runway 28R').length).toBe(0)
  })
  it('finds every callsign in a transmission, with positions', () => {
    const found = findCallsigns('Skyhawk 123AB, follow the Cherokee 42PK, and N77GA hold short')
    expect(found.map((f) => f.callsign.raw)).toEqual(['Skyhawk 123AB', 'Cherokee 42PK', 'N77GA'])
    expect('Skyhawk 123AB, follow the Cherokee 42PK, and N77GA hold short'.slice(found[1]!.start, found[1]!.end)).toBe('Cherokee 42PK')
  })
  it('keys the same aircraft the same whichever way it is written', () => {
    expect(callsignKey(parseCallsign('Skyhawk 123AB')!)).toBe(callsignKey(parseCallsign('N123AB')!))
    expect(callsignKey(parseCallsign('UAL2262')!)).not.toBe(callsignKey(parseCallsign('UAL2263')!))
  })
})

describe('short forms and type callsigns', () => {
  it('shortens to the last three characters, one more when that would begin with a zero', () => {
    expect(abbreviatedTail('123AB')).toBe('3AB')
    expect(abbreviatedTail('42PK')).toBe('2PK')
    expect(abbreviatedTail('590NN')).toBe('90NN')
    expect(abbreviatedTail('7GA')).toBe('7GA')
  })
  it('names a crew by its aircraft type, falling back to the tail', () => {
    expect(radioCallsign('N77GA', 'C172')).toBe('Skyhawk 77GA')
    expect(radioCallsign('N631SP', 'C182')).toBe('Skylane 631SP')
    expect(radioCallsign('N905TB', 'BE36')).toBe('Bonanza 905TB')
    expect(radioCallsign('N12XY', 'ZZZZ')).toBe('N12XY')
    expect(radioCallsign('UAL12', 'C172')).toBe('UAL12')
  })
})
