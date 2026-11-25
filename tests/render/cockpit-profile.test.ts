import { describe, expect, it } from 'vitest'
import { cockpitProfile, PALETTES } from '../../src/render/cockpit-profile'
import { ROSTER, rosterParams } from '../../src/sim/aircraft/roster'
import { C172S } from '../../src/sim/aircraft/c172s'
import { J3CUB } from '../../src/sim/aircraft/j3cub'
import { B738 } from '../../src/sim/aircraft/b738'

const prof = (d: string) => {
  const e = ROSTER.find(r => r.spec.designator === d)!
  return cockpitProfile(d, rosterParams(d)!, { label: e.spec.label, powerplant: e.spec.powerplant as { kind: string; count?: number } })
}

describe('cockpit profiles tailor the deck to each airplane', () => {
  it('Airbus flies sidesticks behind an FCU; Boeing keeps yokes and the MCP', () => {
    for (const d of ['A320', 'A20N', 'A332', 'A359', 'A388', 'BCS3']) expect(prof(d).deck, d).toMatchObject({ maker: 'airbus', control: 'sidestick', fcu: 'airbus', reversers: false })
    for (const d of ['B739', 'B744', 'B77W', 'B788']) expect(prof(d).deck, d).toMatchObject({ maker: 'boeing', control: 'yoke', fcu: 'boeing' })
  })
  it('display layouts follow the real flight decks', () => {
    expect(prof('B739').deck!.du).toBe('six')
    expect(prof('B38M').deck!.du).toBe('fourWide') // 737 MAX: four large displays
    expect(prof('B788').deck!.du).toBe('fiveWide')
    expect(prof('E190').deck!.du).toBe('fiveWide')
    expect(prof('GLF6').deck!.du).toBe('fourWide')
    expect(prof('C25C').deck!.du).toBe('threeWide')
    expect(prof('HDJT').deck!.du).toBe('threeWide')
  })
  it('business jets get a smaller cabin, no trim wheels where trim is electric, and the Falcon 7X its sidestick', () => {
    expect(prof('C25A').deck!.scale).toBeLessThan(0.9)
    expect(prof('GLF5').deck!.scale).toBeLessThan(1)
    expect(prof('B744').deck!.scale).toBe(1)
    expect(prof('GLF6').deck!.trimWheels).toBe(false)
    expect(prof('B77W').deck!.trimWheels).toBe(false)
    expect(prof('B739').deck!.trimWheels).toBe(true)
    expect(prof('FA7X').deck).toMatchObject({ control: 'sidestick', maker: 'dassault' })
    expect(prof('GLF5').deck!.maker).toBe('gulfstream')
    expect(prof('GLEX').deck!.maker).toBe('bombardier')
  })
  it('airliner turboprops get the two-crew deck with power/condition levers and no autothrottle', () => {
    for (const d of ['AT76', 'DH8D', 'SF34', 'C130']) {
      const p = prof(d)
      expect(p.layout, d).toBe('boeingNG')
      expect(p.deck, d).toMatchObject({ turboprop: true, autothrottle: false, reversers: false, control: 'yoke' })
    }
    expect(prof('C130').deck!.engines).toBe(4)
    expect(prof('C130').deck!.maker).toBe('lockheed')
    expect(prof('AT76').deck!.maker).toBe('atr')
  })
  it('GA types keep the G1000 panel with their own controls and hardware', () => {
    expect(prof('PA18').ga).toMatchObject({ control: 'stick' })
    expect(prof('DA40').ga!.control).toBe('stick')
    expect(prof('SR22').ga!.control).toBe('sideyoke')
    expect(prof('C182').ga!.control).toBe('yoke')
    expect(prof('LS8').ga).toMatchObject({ control: 'stick', hasEngine: false })
    expect(prof('PC12').ga).toMatchObject({ turboprop: true, engines: 1 })
    expect(prof('BE58').ga!.engines).toBe(2)
    const cub = cockpitProfile('CUB', J3CUB, { label: 'Piper J-3 Cub', powerplant: { kind: 'piston', count: 1 } })
    expect(cub.ga).toMatchObject({ control: 'stick', hasElectrical: false, hasFlaps: false, hasEngine: true })
    expect(cub.placard).toBe('PIPER J-3 CUB')
    expect(cockpitProfile('172', C172S, { label: 'Cessna 172S', powerplant: { kind: 'piston', count: 1 } }).ga).toMatchObject({ control: 'yoke', hasFlaps: true, hasElectrical: true })
    expect(cockpitProfile('737', B738, { label: 'Boeing 737-800', powerplant: { kind: 'jet', count: 2 } }).deck).toMatchObject({ maker: 'boeing', du: 'fourWide', engines: 2 }) // the default 737 flies the MAX-style four-display deck (pilot's request)
  })
  it('every roster type resolves to a complete profile with a palette and its own name plate', () => {
    for (const e of ROSTER) {
      const p = prof(e.spec.designator)
      expect(p.placard, e.spec.designator).toBe(e.spec.label.toUpperCase())
      if (p.layout === 'boeingNG') {
        expect(PALETTES[p.deck!.maker], e.spec.designator).toBeDefined()
        expect(p.deck!.engines).toBeGreaterThanOrEqual(2)
        expect(p.deck!.engines).toBeLessThanOrEqual(4)
      } else expect(p.ga, e.spec.designator).toBeDefined()
    }
  })
})
