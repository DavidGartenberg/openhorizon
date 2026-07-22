import { describe, expect, it } from 'vitest'
import { archetypeFor } from '../src/world/fleet-map'

describe('archetypeFor (12b — designator → silhouette family + scale)', () => {
  it('maps the spot-check list to the right families at real sizes', () => {
    expect(archetypeFor('C172', 'L1P', 'L')).toMatchObject({ archetype: 'ga-high-wing', spanM: 11.0 })
    expect(archetypeFor('P28A', 'L1P', 'L')).toMatchObject({ archetype: 'ga-low-wing', spanM: 10.7 })
    expect(archetypeFor('SR22', 'L1P', 'L')).toMatchObject({ archetype: 'ga-low-wing' })
    expect(archetypeFor('J3', 'L1P', 'L')).toMatchObject({ archetype: 'taildragger' })
    expect(archetypeFor('BE58', 'L2P', 'L')).toMatchObject({ archetype: 'twin-piston', engines: 2 })
    expect(archetypeFor('PC12', 'L1T', 'L')).toMatchObject({ archetype: 'single-turboprop' })
    expect(archetypeFor('DH8D', 'L2T', 'M')).toMatchObject({ archetype: 'twin-turboprop', spanM: 28.4 })
    expect(archetypeFor('C130', 'L4T', 'M')).toMatchObject({ archetype: 'twin-turboprop', engines: 4, quad: true })
    expect(archetypeFor('GLF5', 'L2J', 'M')).toMatchObject({ archetype: 'bizjet' })
    expect(archetypeFor('B738', 'L2J', 'M')).toMatchObject({ archetype: 'narrowbody', spanM: 35.8, lengthM: 39.5 })
    expect(archetypeFor('A320', 'L2J', 'M')).toMatchObject({ archetype: 'narrowbody' })
    expect(archetypeFor('B77W', 'L2J', 'H')).toMatchObject({ archetype: 'widebody', spanM: 64.8 })
    expect(archetypeFor('B744', 'L4J', 'H')).toMatchObject({ archetype: 'widebody', engines: 4, quad: true })
    expect(archetypeFor('A388', 'L4J', 'J')).toMatchObject({ archetype: 'widebody', quad: true })
    expect(archetypeFor('GLID', 'L0-', '-')).toMatchObject({ archetype: 'glider', engines: 0 })
    expect(archetypeFor('R44', 'H1P', 'L')).toMatchObject({ archetype: 'rotorcraft' })
  })

  it('family fallback works for designators WITHOUT overrides', () => {
    // Unlisted M-class twin jet → narrowbody at M scale.
    expect(archetypeFor('XJET', 'L2J', 'M')).toMatchObject({ archetype: 'narrowbody', spanM: 30 })
    // Unlisted light jet → bizjet.
    expect(archetypeFor('XBIZ', 'L2J', 'L')).toMatchObject({ archetype: 'bizjet' })
    // Unlisted heavy quad jet → widebody quad.
    expect(archetypeFor('XQUD', 'L4J', 'H')).toMatchObject({ archetype: 'widebody', quad: true })
    // Unlisted piston single → the most common GA silhouette.
    expect(archetypeFor('XGA1', 'L1P', 'L')).toMatchObject({ archetype: 'ga-high-wing' })
    // Unlisted helicopter → rotorcraft.
    expect(archetypeFor('XHEL', 'H2T', 'L')).toMatchObject({ archetype: 'rotorcraft' })
  })

  it('unknown designator + unknown desc → the honest generic placeholder', () => {
    expect(archetypeFor('ZZZZ', '-0-', '-')).toMatchObject({ archetype: 'generic' })
    expect(archetypeFor('', '', '')).toMatchObject({ archetype: 'generic' })
  })
})
