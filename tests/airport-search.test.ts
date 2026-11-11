import { describe, expect, it } from 'vitest'
import { searchAirports } from '../src/world/airport-search'
import type { AirportData } from '../src/world/airports'

const ap = (i: string, n: string, t = 1): AirportData => ({ i, n, la: 0, lo: 0, e: 0, t, r: [] })
const ALL = [ap('KSFO', 'San Francisco International', 2), ap('KSQL', 'San Carlos'), ap('KOAK', 'Metro Oakland International', 2), ap('KHAF', 'Half Moon Bay', 0), ap('EGLL', 'London Heathrow', 2), ap('KSFB', 'Orlando Sanford', 1), ap('KSAN', 'San Diego International', 2)]

describe('departure airport search', () => {
  it('exact ident wins, and a 3-letter code finds its K-prefixed airport', () => {
    expect(searchAirports(ALL, 'ksfo')[0]!.i).toBe('KSFO')
    expect(searchAirports(ALL, 'SFO')[0]!.i).toBe('KSFO')
  })
  it('ident prefixes, then names, larger airports first', () => {
    expect(searchAirports(ALL, 'KSF').map(a => a.i)).toEqual(['KSFO', 'KSFB'])
    expect(searchAirports(ALL, 'san').map(a => a.i).slice(0, 2)).toEqual(['KSAN', 'KSFO'])
    expect(searchAirports(ALL, 'heathrow')[0]!.i).toBe('EGLL')
    expect(searchAirports(ALL, 'moon')[0]!.i).toBe('KHAF')
  })
  it('ignores one-letter queries and respects the limit', () => {
    expect(searchAirports(ALL, 'K')).toEqual([])
    expect(searchAirports(ALL, 'KS', 2)).toHaveLength(2)
  })
})
