import { describe, expect, it } from 'vitest'
import { TowerController, pilotPhrase } from '../../src/sim/atc/tower'
import { ApproachController } from '../../src/sim/atc/approach'
import { readbackText } from '../../src/sim/atc/phraseology'

const HOLD = { distanceM: 40, aglFt: 0, onGround: true }

describe('tower phraseology', () => {
  const mk = () => new TowerController({ facility: 'Palo Alto Tower', freqMhz: 118.6, activeRunway: '31', departureFreqMhz: 120.5, groundFreqMhz: 121.7, windText: () => 'wind 290 at 8' })

  it('gives the wind with each takeoff and landing clearance, and tags it for the readback', () => {
    const t = mk()
    const dep = t.request('Skyhawk 123AB', 'readyTakeoff', HOLD, 1)[0]!
    expect(dep.text).toBe('Skyhawk 123AB, wind 290 at 8, runway 31, cleared for takeoff')
    expect(dep).toMatchObject({ to: 'Skyhawk 123AB', kind: 'takeoff', args: { runway: '31' } })
    expect(readbackText(dep, 'Skyhawk 123AB')).toBe('runway 31, cleared for takeoff, Skyhawk 123AB')
    const land = mk().request('N77GA', 'inboundLanding', { distanceM: 3000, aglFt: 700, onGround: false }, 1)[0]!
    expect(land.text).toBe('N77GA, wind 290 at 8, runway 31, cleared to land')
    expect(land.kind).toBe('land')
  })

  it('says why a departure holds, with the runway, and numbers followers', () => {
    const t = mk()
    t.registerInbound('N1', { distanceM: 3000, aglFt: 600, onGround: false })
    const hold = t.request('N2', 'readyTakeoff', HOLD, 2)[0]!
    expect(hold.text).toBe('N2, hold short of runway 31, traffic on final')
    expect(hold.kind).toBe('holdShort')
    const seq = t.request('N3', 'inboundLanding', { distanceM: 9000, aglFt: 1200, onGround: false }, 3)[0]!
    expect(seq).toMatchObject({ kind: 'sequence', args: { number: 2, report: 'final', runway: '31' } })
  })

  it('hands a departure to departure, and an arrival that has vacated to ground, by frequency', () => {
    const t = mk()
    t.request('N5', 'readyTakeoff', HOLD, 1)
    t.update('N5', { distanceM: 900, aglFt: 400, onGround: false })
    const out = t.tick(5)
    expect(out[0]!.text).toBe('N5, contact departure 120.50, good day')
    expect(out[0]).toMatchObject({ kind: 'contact', args: { facility: 'departure', freqMhz: 120.5 } })
    const clear = t.request('N6', 'clearRunway', { distanceM: 300, aglFt: 0, onGround: true }, 9)[0]!
    expect(clear.text).toBe('N6, contact ground 121.70')
    expect(clear.kind).toBe('contact')
    expect(new TowerController({ facility: 'X Tower', freqMhz: 1, activeRunway: '9' }).request('N7', 'clearRunway', HOLD, 1)[0]!.text).toBe('N7, roger, taxi to parking')
  })

  it('has the pilot call the controller first, by name, with the information letter', () => {
    expect(pilotPhrase('Skyhawk 123AB', 'readyTakeoff', '31', { facility: 'Palo Alto Tower' })).toBe('Palo Alto Tower, Skyhawk 123AB, holding short runway 31, ready for departure')
    expect(pilotPhrase('Skyhawk 123AB', 'taxiOut', '31', { facility: 'Palo Alto Ground', atis: 'Bravo' })).toBe('Palo Alto Ground, Skyhawk 123AB, at the ramp with information Bravo, request taxi for departure')
    expect(pilotPhrase('N1', 'inboundLanding', '31', { facility: 'Palo Alto Tower', atis: 'Bravo', milesOut: 7 })).toBe('Palo Alto Tower, N1, 7 miles out, inbound full stop with information Bravo')
    expect(pilotPhrase('N1', 'goAround', '31', { facility: 'Palo Alto Tower' })).toBe('N1, going around')
    expect(pilotPhrase('N1', 'readyTakeoff', '31')).toBe('N1, holding short runway 31, ready for departure')
  })
})

describe('approach phraseology', () => {
  it('names the facility on radar contact and tags each step for the readback', () => {
    const a = new ApproachController({ facility: 'Norcal Approach', freqMhz: 124.0, activeRunway: '28R', towerFreqMhz: 120.5 })
    const first = a.checkIn('N1', { distanceM: 22 * 1852, aglFt: 5000 }, 1)[0]!
    expect(first.text).toBe('N1, Norcal Approach, radar contact 22 miles from the field, expect ILS runway 28R, descend and maintain 3,000')
    expect(first).toMatchObject({ kind: 'descend', args: { altitudeFt: 3000 } })
    const cleared = a.tick(5, [{ callsign: 'N1', view: { distanceM: 12 * 1852, aglFt: 3000 } }])[0]!
    expect(cleared).toMatchObject({ kind: 'approach', args: { runway: '28R', altitudeFt: 3000 } })
    expect(readbackText(cleared, 'N1')).toBe('cleared ILS runway 28R approach, maintain 3,000 until established, N1')
    const hand = a.tick(9, [{ callsign: 'N1', view: { distanceM: 6 * 1852, aglFt: 2000 } }])[0]!
    expect(hand.text).toBe('N1, contact tower 120.50, good day')
    expect(readbackText(hand, 'N1')).toBe('contact tower 120.50, N1')
  })
})
