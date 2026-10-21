import { describe, expect, it } from 'vitest'
import { toSpokenAviation } from '../src/audio/spoken-aviation'

const say = toSpokenAviation

describe('runways', () => {
  it('speaks digits one at a time with niner and left/right/center', () => {
    expect(say('runway 28L, cleared for takeoff')).toBe('runway two eight left, cleared for takeoff')
    expect(say('Runway 9R')).toBe('Runway niner right')
    expect(say('hold short runway 10C')).toBe('hold short runway one zero center')
    expect(say('runway 36')).toBe('runway three six')
    expect(say('RWY 04')).toBe('runway zero four')
  })
  it('does not touch ordinary numbers', () => {
    expect(say('number 2 for the runway')).toBe('number 2 for the runway')
  })
})

describe('frequencies, altimeter, squawk, flight level, headings, wind', () => {
  it('reads frequencies digit by digit with "point"', () => {
    expect(say('contact tower 118.70')).toBe('contact tower one one eight point seven')
    expect(say('contact departure 121.5')).toBe('contact departure one two one point five')
    expect(say('ground 121.90')).toBe('ground one two one point niner')
    expect(say('on 118.725')).toBe('on one one eight point seven two five')
    expect(say('guard 121.00')).toBe('guard one two one point zero')
  })
  it('reads the altimeter setting as four digits, no point', () => {
    expect(say('altimeter 29.92.')).toBe('altimeter two niner niner two.')
    expect(say('altimeter 30.12')).toBe('altimeter three zero one two')
  })
  it('squawk codes digit by digit', () => {
    expect(say('squawk 4521')).toBe('squawk four five two one')
    expect(say('Departure frequency 124.35, squawk 1200.')).toBe('Departure frequency one two four point three five, squawk one two zero zero.')
  })
  it('flight levels', () => {
    expect(say('climb to FL350')).toBe('climb to flight level three five zero')
    expect(say('descend FL 240')).toBe('descend flight level two four zero')
  })
  it('headings, courses and wind direction digit by digit', () => {
    expect(say('turn left heading 270')).toBe('turn left heading two seven zero')
    expect(say('fly heading 090')).toBe('fly heading zero niner zero')
    expect(say('wind 280 at 12')).toBe('wind two eight zero at one two')
    expect(say('wind 280 at 22 gusting 31')).toBe('wind two eight zero at two two gusting three one')
  })
})

describe('altitudes', () => {
  it('thousands with commas', () => {
    expect(say('descend and maintain 3,000')).toBe('descend and maintain three thousand')
    expect(say('climb and maintain 12,000')).toBe('climb and maintain one two thousand')
    expect(say('maintain 2,500')).toBe('maintain two thousand five hundred')
    expect(say('expect 10,000')).toBe('expect one zero thousand')
  })
  it('plain numbers after an altitude word, or before feet', () => {
    expect(say('climb and maintain 5000')).toBe('climb and maintain five thousand')
    expect(say('maintain 1500')).toBe('maintain one thousand five hundred')
    expect(say('you are at 800 feet')).toBe('you are at eight hundred feet')
    expect(say('cleared to 8000 ft')).toBe('cleared to eight thousand feet')
  })
})

describe('callsigns', () => {
  it('N-numbers phonetically', () => {
    expect(say('N172SP, cleared to land')).toBe('November one seven two Sierra Papa, cleared to land')
    expect(say('N9XY')).toBe('November niner X-ray Yankee')
  })
  it('airline callsigns with grouped numbers', () => {
    expect(say('UAL2262, contact tower')).toBe('United twenty two sixty two, contact tower')
    expect(say('DAL987')).toBe('Delta niner eighty seven')
    expect(say('SWA45')).toBe('Southwest forty five')
    expect(say('AAL1200')).toBe('American twelve hundred')
  })
})

describe('abbreviations, units, taxiways, information letters', () => {
  it('units become words', () => {
    expect(say('reduce speed to 180 kt')).toBe('reduce speed to one eight zero knots')
    expect(say('maintain 250 knots')).toBe('maintain two five zero knots')
    expect(say('2 nm from the field')).toBe('2 nautical miles from the field')
    expect(say('descending 700 fpm')).toBe('descending 700 feet per minute')
  })
  it('acronyms are spelled out or given their spoken form', () => {
    expect(say('expect ILS runway 28L')).toBe('expect I L S runway two eight left')
    expect(say('V F R flight following')).toBe('V F R flight following')
    expect(say('VFR and IFR')).toBe('V F R and I F R')
    expect(say('ATIS information B')).toBe('Ay-tiss information Bravo')
    expect(say('TCAS')).toBe('Tee-cas')
    expect(say('GPS approach')).toBe('G P S approach')
  })
  it('taxiway lists use the phonetic alphabet', () => {
    expect(say('taxi via A, B2, hold short runway 28L')).toBe('taxi via Alpha, Bravo two, hold short runway two eight left')
  })
  it('information letters', () => {
    expect(say('you have information C')).toBe('you have information Charlie')
  })
})

describe('airports and airways', () => {
  it('K-idents are spelled without the K; airways use the phonetic letter', () => {
    expect(say('KSFO tower, N172SP')).toBe('S F O tower, November one seven two Sierra Papa')
    expect(say('cleared to KLAX via V25 then J80')).toBe('cleared to L A X via Victor twenty five then Juliet eighty')
  })
  it('does not mangle V-speed style words', () => {
    expect(say('V1')).toBe('V1')
    expect(say('vee one')).toBe('vee one')
  })
})

describe('robustness', () => {
  it('leaves already-spoken text alone', () => {
    expect(say('airspeed alive')).toBe('airspeed alive')
    expect(say('vee one')).toBe('vee one')
    expect(say('TRAFFIC, TRAFFIC')).toBe('TRAFFIC, TRAFFIC')
  })
  it('is stable when applied twice', () => {
    const once = say('N172SP, runway 28L, wind 280 at 12, altimeter 29.92, contact tower 118.70, squawk 4521')
    expect(say(once)).toBe(once)
  })
  it('handles empty and odd input without throwing', () => {
    expect(say('')).toBe('')
    expect(say('   ')).toBe('   ')
    expect(say('100%')).toBe('100%')
  })
})

describe('a full ATC transmission', () => {
  it('reads like a controller', () => {
    expect(say('N172SP, runway 28L, wind 280 at 12, cleared for takeoff')).toBe(
      'November one seven two Sierra Papa, runway two eight left, wind two eight zero at one two, cleared for takeoff')
  })
})
