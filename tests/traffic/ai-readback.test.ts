/**
 * The other airplanes talk like pilots: they call the tower by name with the
 * ATIS letter, and read back every instruction they are given, callsign last,
 * a moment after the controller finishes.
 */
import { describe, expect, it } from 'vitest'
import { AiPatternPilot } from '../../src/sim/traffic/ai-pilot'
import { TowerController } from '../../src/sim/atc/tower'
import { CommsBus } from '../../src/sim/atc/comms'

const RWY = { thrLat: 37.456, thrLon: -122.115, headingDeg: 313, elevFt: 5 }

function fly(cfg: { windText?: () => string; groundFreqMhz?: number } = {}) {
  const bus = new CommsBus()
  const tower = new TowerController({ facility: 'Palo Alto Tower', freqMhz: 118.6, activeRunway: '31', ...cfg })
  const ai = new AiPatternPilot({ callsign: 'Skyhawk 77GA', runway: RWY, runwayIdent: '31', tower, bus, freqMhz: 118.6, facility: 'Palo Alto Tower', atis: 'Bravo' })
  let simS = 0
  for (let i = 0; i < 1500 && ai.phase !== 'done'; i++) {
    simS += 1
    ai.step(1, simS)
    if (i % 5 === 0) for (const t of tower.tick(simS)) bus.transmit(t)
  }
  ai.step(1, simS + 10)
  return bus.log
}

describe('AI pilots on the radio', () => {
  const log = fly({ windText: () => 'wind 290 at 8', groundFreqMhz: 121.8 })
  const said = (from: string): string[] => log.filter((t) => t.from === from).map((t) => t.text)

  it('call the tower by name, callsign second', () => {
    expect(said('Skyhawk 77GA')[0]).toBe('Palo Alto Tower, Skyhawk 77GA, holding short runway 31, ready for departure')
    expect(said('Skyhawk 77GA').some((t) => t.startsWith('Palo Alto Tower, Skyhawk 77GA, left downwind runway 31'))).toBe(true)
  })

  it('are cleared with the wind, and read the clearance back with the callsign last', () => {
    expect(said('Palo Alto Tower')[0]).toBe('Skyhawk 77GA, wind 290 at 8, runway 31, cleared for takeoff')
    expect(said('Skyhawk 77GA')).toContain('runway 31, cleared for takeoff, Skyhawk 77GA')
    expect(said('Skyhawk 77GA')).toContain('runway 31, cleared to land, Skyhawk 77GA')
  })

  it('read back the handoff to ground after landing', () => {
    expect(said('Palo Alto Tower').some((t) => t.includes('contact ground 121.80'))).toBe(true)
    expect(said('Skyhawk 77GA')).toContain('contact ground 121.80, Skyhawk 77GA')
  })

  it('answer after the instruction, never before it', () => {
    const at = (text: string): number => log.findIndex((t) => t.text === text)
    expect(at('runway 31, cleared for takeoff, Skyhawk 77GA')).toBeGreaterThan(at('Skyhawk 77GA, wind 290 at 8, runway 31, cleared for takeoff'))
    const readback = log.find((t) => t.text === 'runway 31, cleared for takeoff, Skyhawk 77GA')!
    const clearance = log.find((t) => t.text === 'Skyhawk 77GA, wind 290 at 8, runway 31, cleared for takeoff')!
    expect(readback.atSimS).toBeGreaterThanOrEqual(clearance.atSimS + 1.2)
  })

  it('stay silent about instructions meant for someone else', () => {
    const bus = new CommsBus()
    const tower = new TowerController({ facility: 'Palo Alto Tower', freqMhz: 118.6, activeRunway: '31' })
    const ai = new AiPatternPilot({ callsign: 'N77GA', runway: RWY, runwayIdent: '31', tower, bus, freqMhz: 118.6 })
    bus.transmit({ freqMhz: 118.6, from: 'Palo Alto Tower', text: 'N42PK, runway 31, cleared for takeoff', atSimS: 1, to: 'N42PK', kind: 'takeoff', args: { runway: '31' } })
    ai.step(1, 20)
    expect(bus.log.filter((t) => t.from === 'N77GA')).toHaveLength(0)
  })
})
