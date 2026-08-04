import { describe, expect, it } from 'vitest'
import { buildAtis, chooseActiveRunway } from '../../src/sim/atc/atis'
import { GroundController } from '../../src/sim/atc/ground'
import { TowerController, pilotPhrase } from '../../src/sim/atc/tower'
import type { BlendedWeather } from '../../src/sim/weather/weather'

const WX: BlendedWeather = {
  windDirDeg: 310, windKt: 9, gustKt: 9, visibilitySm: 10, weather: [],
  clouds: [{ cover: 'FEW', baseFt: 4000 }], qnhInHg: 30.01, isaTempOffsetC: 4,
  nearestStation: 'KPAO', nearestDistanceM: 500, stationElevFt: 5,
}
const KPAO_RUNWAYS = [
  { ident: '13', headingDeg: 133 },
  { ident: '31', headingDeg: 313 },
]

describe('ATIS + active runway', () => {
  it('picks the runway with the best headwind component', () => {
    expect(chooseActiveRunway(KPAO_RUNWAYS, 310)).toBe('31')
    expect(chooseActiveRunway(KPAO_RUNWAYS, 140)).toBe('13')
  })

  it('builds a complete ATIS broadcast from live weather', () => {
    const atis = buildAtis('Palo Alto', WX, KPAO_RUNWAYS, 0)
    expect(atis.letter).toBe('Alpha')
    expect(atis.activeRunway).toBe('31')
    expect(atis.text).toContain('Palo Alto')
    expect(atis.text).toContain('information Alpha')
    expect(atis.text).toContain('wind 310 at 9')
    expect(atis.text).toContain('visibility 10')
    expect(atis.text).toContain('few clouds at 4000')
    expect(atis.text).toContain('altimeter 30.01')
    expect(atis.text).toContain('runway 31 in use')
    expect(atis.text.toLowerCase()).toContain('advise on initial contact')
  })

  it('is honest with no weather: ATIS reports wind/altimeter unavailable', () => {
    const atis = buildAtis('Palo Alto', null, KPAO_RUNWAYS, 2)
    expect(atis.letter).toBe('Charlie')
    expect(atis.text.toLowerCase()).toContain('weather unavailable')
  })
})

describe('Ground + Tower: full towered VFR departure and arrival', () => {
  const mk = () => {
    const tower = new TowerController({ facility: 'Palo Alto Tower', freqMhz: 118.6, activeRunway: '31' })
    const ground = new GroundController({ facility: 'Palo Alto Ground', freqMhz: 125.0, activeRunway: '31' })
    return { tower, ground }
  }

  it('ground issues a taxi clearance and expects the readback', () => {
    const { ground } = mk()
    const replies = ground.request('N123AB', 'taxiOut')
    expect(replies[0]!.text).toContain('runway 31, taxi')
    expect(ground.awaitingReadback('N123AB')).toBe(true)
    const ack = ground.readback('N123AB', 'taxiOut')
    expect(ack[0]!.text.toLowerCase()).toContain('readback correct')
    expect(ground.awaitingReadback('N123AB')).toBe(false)
  })

  it('holds a departure short while traffic is on final, then clears', () => {
    const { tower } = mk()
    // AI traffic 2 nm final.
    tower.registerInbound('N77GA', { distanceM: 3704, aglFt: 600, onGround: false })
    const holdReplies = tower.request('N123AB', 'readyTakeoff', { distanceM: 0, aglFt: 0, onGround: true })
    expect(holdReplies[0]!.text.toLowerCase()).toContain('hold short')
    // The AI lands — and now really HOLDS the runway (14e) until it
    // reports clear of the runway.
    tower.update('N77GA', { distanceM: 300, aglFt: 0, onGround: true })
    tower.tick(60)
    const stillHeld = tower.request('N123AB', 'readyTakeoff', { distanceM: 0, aglFt: 0, onGround: true })
    expect(stillHeld[0]!.text.toLowerCase()).toContain('hold short')
    tower.request('N77GA', 'clearRunway', { distanceM: 350, aglFt: 0, onGround: true }, 70)
    tower.tick(75)
    const clearance = tower.request('N123AB', 'readyTakeoff', { distanceM: 0, aglFt: 0, onGround: true })
    expect(clearance[0]!.text.toLowerCase()).toContain('cleared for takeoff')
    expect(clearance[0]!.text).toContain('runway 31')
  })

  it('auto-vacates a radio-silent lander after 90 s (recorded fallback)', () => {
    const { tower } = mk()
    tower.registerInbound('N77GA', { distanceM: 3704, aglFt: 600, onGround: false })
    tower.update('N77GA', { distanceM: 300, aglFt: 0, onGround: true })
    tower.tick(60) // starts the landed timer
    expect(tower.request('N123AB', 'readyTakeoff', { distanceM: 0, aglFt: 0, onGround: true })[0]!.text.toLowerCase()).toContain('hold short')
    tower.tick(155) // > 90 s later: assumed clear
    const clearance = tower.request('N123AB', 'readyTakeoff', { distanceM: 0, aglFt: 0, onGround: true })
    expect(clearance[0]!.text.toLowerCase()).toContain('cleared for takeoff')
  })

  it('sequences an arrival behind existing traffic and clears when #1', () => {
    const { tower } = mk()
    tower.registerInbound('N55XY', { distanceM: 2500, aglFt: 500, onGround: false })
    const joinReplies = tower.request('N123AB', 'inboundLanding', { distanceM: 9260, aglFt: 1200, onGround: false })
    expect(joinReplies[0]!.text.toLowerCase()).toMatch(/number 2|follow/)
    // Leader lands and reports clear; we close in — tick clears us.
    tower.update('N55XY', { distanceM: 200, aglFt: 0, onGround: true })
    tower.request('N55XY', 'clearRunway', { distanceM: 350, aglFt: 0, onGround: true }, 61)
    const advisories = [...tower.tick(62), ...tower.tick(120, [{ callsign: 'N123AB', view: { distanceM: 2800, aglFt: 700, onGround: false } }])]
    const clear = advisories.find((t) => t.text.toLowerCase().includes('cleared to land'))
    expect(clear).toBeDefined()
    expect(clear!.text).toContain('N123AB')
    expect(clear!.text).toContain('runway 31')
  })

  it('pilot phrases exist for every request kind', () => {
    expect(pilotPhrase('N123AB', 'readyTakeoff', '31')).toContain('ready for departure')
    expect(pilotPhrase('N123AB', 'inboundLanding', '31').toLowerCase()).toContain('inbound')
    expect(pilotPhrase('N123AB', 'taxiOut', '31').toLowerCase()).toContain('taxi')
  })
})
