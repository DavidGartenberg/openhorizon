import { describe, expect, it } from 'vitest'
// Server-side pure parse logic, imported directly (precedent: cifp-parse).
// @ts-expect-error untyped .mjs module
import { buildAircraftTypes } from '../server/parse.mjs'

const TYPES_JSON = JSON.stringify({
  A320: { desc: 'L2J', wtc: 'M' },
  C172: { desc: 'L1P', wtc: 'L' },
  B77W: { desc: 'L2J', wtc: 'H' },
  R44: { desc: 'H1P', wtc: 'L' },
  GLID: { desc: 'L0-', wtc: '-' },
  ' c172 ': { desc: 'L1P', wtc: 'L' }, // dupe after trim/uppercase — first wins
  BAD1: { nope: true }, // malformed: no desc
  '': { desc: 'L1P', wtc: 'L' }, // empty designator dropped
})

const NAMES_CSV = [
  'Aircraft TypeDesignator,Class,Number+Engine Type,"MANUFACTURER, Model"',
  'A320,LandPlane,2/Jet,"AIRBUS, A-320"',
  'C172,LandPlane,1/Piston,"CESSNA, 172 Skyhawk"',
  'A320,LandPlane,2/Jet,"AIRBUS, A-320neo dupe row"', // dupe name row — first wins
  'ONLY,LandPlane,1/Piston,"NAME, Without Type Entry"', // no types entry — no output row
].join('\n')

describe('buildAircraftTypes (12a — Doc-8643 mirror merge)', () => {
  it('merges desc/wtc with names, keyed by designator', () => {
    const t = buildAircraftTypes(TYPES_JSON, NAMES_CSV) as Record<string, [string, string, string]>
    expect(t['A320']).toEqual(['L2J', 'M', 'AIRBUS, A-320'])
    expect(t['C172']).toEqual(['L1P', 'L', 'CESSNA, 172 Skyhawk'])
    expect(t['B77W']).toEqual(['L2J', 'H', '']) // no name row → empty name, never invented
    expect(t['R44']).toEqual(['H1P', 'L', ''])
  })

  it('drops malformed and empty designators; dedupes case/whitespace variants', () => {
    const t = buildAircraftTypes(TYPES_JSON, NAMES_CSV) as Record<string, [string, string, string]>
    expect(t['BAD1']).toBeUndefined()
    expect(t['']).toBeUndefined()
    expect(Object.keys(t).filter((k) => k === 'C172')).toHaveLength(1)
    expect(t['ONLY']).toBeUndefined() // names alone don't create types
  })

  it('survives a missing names CSV (names optional, types required)', () => {
    const t = buildAircraftTypes(TYPES_JSON, null) as Record<string, [string, string, string]>
    expect(t['A320']).toEqual(['L2J', 'M', ''])
    expect(Object.keys(t).length).toBeGreaterThanOrEqual(5)
  })

  it('throws on unparseable types JSON (the endpoint 502s rather than serving junk)', () => {
    expect(() => buildAircraftTypes('not json', null)).toThrow()
  })
})

// Client-side desc decoder (pure).
import { parseDesc } from '../src/world/aircraft-types'

describe('parseDesc (Doc-8643 description codes)', () => {
  it('decodes the common families', () => {
    expect(parseDesc('L2J')).toEqual({ kind: 'landplane', engines: 2, engineType: 'jet' })
    expect(parseDesc('L1P')).toEqual({ kind: 'landplane', engines: 1, engineType: 'piston' })
    expect(parseDesc('L4T')).toEqual({ kind: 'landplane', engines: 4, engineType: 'turboprop' })
    expect(parseDesc('H1T')).toEqual({ kind: 'helicopter', engines: 1, engineType: 'turboprop' })
    expect(parseDesc('G1P')).toEqual({ kind: 'gyrocopter', engines: 1, engineType: 'piston' })
    expect(parseDesc('A2P')).toEqual({ kind: 'amphibian', engines: 2, engineType: 'piston' })
  })

  it('gliders emerge from zero engines; junk decodes to unknown, never a guess', () => {
    expect(parseDesc('L0-')).toEqual({ kind: 'glider', engines: 0, engineType: 'none' })
    expect(parseDesc('-0-')).toEqual({ kind: 'unknown', engines: 0, engineType: 'none' })
    expect(parseDesc('')).toEqual({ kind: 'unknown', engines: 0, engineType: 'none' })
  })
})
