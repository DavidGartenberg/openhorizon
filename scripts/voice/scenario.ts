/**
 * The short radio scenario the voice tools run (rehearse.ts reads it back with whisper.cpp, the listening reel
 * plays it): a ground exchange with the player, an AI pilot's pattern work with the tower, an approach check-in,
 * then seeded background traffic. Everything is produced by the real controllers, AI pilots and ambient radio.
 */
import { CommsBus, type Transmission } from '../../src/sim/atc/comms'
import { TowerController } from '../../src/sim/atc/tower'
import { GroundController } from '../../src/sim/atc/ground'
import { ApproachController } from '../../src/sim/atc/approach'
import { AiPatternPilot } from '../../src/sim/traffic/ai-pilot'
import { AmbientRadio } from '../../src/sim/atc/ambient'

/** The first `maxLines` transmissions: the exchange with the player, then background traffic. */
export function radioScenario(maxLines: number): Transmission[] {
  // ---- the scenario: a ground exchange with the player, the AI pilot's pattern work, then background traffic ----
  const bus = new CommsBus()
  const tower = new TowerController({ facility: 'Palo Alto Tower', freqMhz: 118.6, activeRunway: '31', departureFreqMhz: 120.5, groundFreqMhz: 121.7, windText: () => 'wind 290 at 8' })
  const ground = new GroundController({ facility: 'Palo Alto Ground', freqMhz: 121.7, activeRunway: '31' })
  const approach = new ApproachController({ facility: 'Norcal Approach', freqMhz: 124.0, activeRunway: '31', towerFreqMhz: 118.6 })
  const ME = 'Skyhawk 123AB'
  const log: Transmission[] = []
  bus.subscribe((t) => log.push(t))
  bus.transmit({ freqMhz: 118.6, from: 'KPAO ATIS', text: 'Palo Alto information Bravo, 1805 zulu. wind 290 at 8. visibility 10. few clouds at 4500. altimeter 30.12. landing and departing runway 31. advise on initial contact you have information Bravo.', atSimS: 0 })
  bus.transmit({ freqMhz: 121.7, from: ME, text: 'Palo Alto Ground, Skyhawk 123AB, at the ramp with information Bravo, request taxi for departure', atSimS: 1 })
  for (const t of ground.request(ME, 'taxiOut', 2, ['A', 'B'])) bus.transmit(t)
  bus.transmit({ freqMhz: 121.7, from: ME, text: 'runway 31, taxi via A, B, hold short of runway 31, Skyhawk 123AB', atSimS: 6 })
  for (const t of approach.checkIn('Cherokee 42PK', { distanceM: 22 * 1852, aglFt: 5000 }, 30)) bus.transmit({ ...t, freqMhz: 124.0 })
  const ai = new AiPatternPilot({
    callsign: 'Skylane 631SP', runway: { thrLat: 37.456, thrLon: -122.115, headingDeg: 313, elevFt: 5 }, runwayIdent: '31',
    tower, bus, freqMhz: 118.6, facility: 'Palo Alto Tower', atis: 'Bravo',
  })
  for (let s = 40; s < 400 && log.length < 40; s += 1) { ai.step(1, s); if (s % 5 === 0) for (const t of tower.tick(s)) bus.transmit(t) }
  const ambient = new AmbientRadio({
    field: 'Palo Alto', runway: '31', atis: 'Bravo', busy: 1, airlines: true,
    tower: { name: 'Palo Alto Tower', freqMhz: 118.6 }, ground: { name: 'Palo Alto Ground', freqMhz: 121.7 },
    approach: { name: 'Norcal Approach', freqMhz: 124.0 }, taxiways: () => ['A', 'B'],
  }, { seed: 5 })
  for (let s = 0; s < 600; s += 2) for (const t of ambient.tick(s, s < 300 ? 121.7 : 124.0, false)) bus.transmit(t)
  return [...log.slice(0, 9), ...log.filter((t) => t.ambient).slice(0, maxLines)].slice(0, maxLines)
}
