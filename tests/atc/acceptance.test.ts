/**
 * Phase 6 §24 acceptance, headless halves:
 *  1. Full VFR flight KPAO→KSQL with correct phraseology end-to-end.
 *  2. IFR CRAFT clearance + center handoffs KSFO→KLAX.
 * (The live-browser KPAO half — real freqs, live-weather ATIS, voices,
 * COM gating — is evidenced in PROGRESS.md with screenshots.)
 */
import { describe, expect, it } from 'vitest'
import { CommsBus, isAudible } from '../../src/sim/atc/comms'
import { TowerController, pilotPhrase } from '../../src/sim/atc/tower'
import { GroundController } from '../../src/sim/atc/ground'
import { buildCraftClearance, assignSquawk, californiaHandoffPlan, IfrSession } from '../../src/sim/atc/ifr'

const CS = 'Skyhawk 123AB'

describe('§24 VFR acceptance: KPAO → KSQL, full phraseology', () => {
  it('taxi → readback → takeoff at KPAO; inbound → sequence → land at KSQL', () => {
    const bus = new CommsBus()
    const paoGnd = new GroundController({ facility: 'Palo Alto Ground', freqMhz: 125.0, activeRunway: '31' })
    const paoTwr = new TowerController({ facility: 'Palo Alto Tower', freqMhz: 118.6, activeRunway: '31' })
    const sqlTwr = new TowerController({ facility: 'San Carlos Tower', freqMhz: 119.0, activeRunway: '30' })
    const send = (txs: ReturnType<TowerController['request']>) => txs.forEach((t) => bus.transmit(t))
    let com1 = 125.0

    // KPAO ground.
    bus.transmit({ freqMhz: com1, from: CS, text: pilotPhrase(CS, 'taxiOut', '31'), atSimS: 0 })
    send(paoGnd.request(CS, 'taxiOut', 1))
    send(paoGnd.readback(CS, 'taxiOut', 8))
    // KPAO tower.
    com1 = 118.6
    bus.transmit({ freqMhz: com1, from: CS, text: pilotPhrase(CS, 'readyTakeoff', '31'), atSimS: 20 })
    send(paoTwr.request(CS, 'readyTakeoff', { distanceM: 50, aglFt: 0, onGround: true }, 21))
    paoTwr.update(CS, { distanceM: 900, aglFt: 400, onGround: false }) // departed
    // Enroute — 4 nm hop; contact KSQL tower inbound.
    com1 = 119.0
    bus.transmit({ freqMhz: com1, from: CS, text: pilotPhrase(CS, 'inboundLanding', '30'), atSimS: 240 })
    sqlTwr.registerInbound('N9AI', { distanceM: 2600, aglFt: 600, onGround: false }) // one ahead
    send(sqlTwr.request(CS, 'inboundLanding', { distanceM: 8500, aglFt: 1100, onGround: false }, 241))
    // Leader lands and clears; we close in; tower clears us on tick.
    sqlTwr.update('N9AI', { distanceM: 150, aglFt: 0, onGround: true })
    send(sqlTwr.tick(300, [{ callsign: CS, view: { distanceM: 3000, aglFt: 700, onGround: false } }]))
    send(sqlTwr.tick(360, [{ callsign: CS, view: { distanceM: 2400, aglFt: 500, onGround: false } }]))

    const log = bus.log.map((t) => `${t.from}: ${t.text}`)
    const seq = [
      'request taxi runway 31',
      'runway 31, taxi via the parallel',
      'readback correct',
      'ready for departure',
      'runway 31, cleared for takeoff',
      'inbound full stop',
      'number 2',
      'cleared to land',
    ]
    let cursor = 0
    for (const want of seq) {
      const found = log.findIndex((l, i) => i >= cursor && l.toLowerCase().includes(want))
      expect(found, `phrase in order: "${want}"`).toBeGreaterThanOrEqual(0)
      cursor = found + 1
    }
    // Frequency discipline: KSQL clearance only audible on 119.0.
    const landClr = bus.log.find((t) => t.text.includes('cleared to land'))!
    expect(isAudible(landClr.freqMhz, 119.0)).toBe(true)
    expect(isAudible(landClr.freqMhz, 118.6)).toBe(false)
  })
})

describe('§24 IFR acceptance: KSFO → KLAX CRAFT + handoffs', () => {
  it('delivers a complete CRAFT clearance', () => {
    const clr = buildCraftClearance({
      callsign: CS, destIdent: 'KLAX', routeText: 'radar vectors, then as filed',
      initialAltFt: 5000, cruiseAltFt: 11000, departureFreqMhz: 135.1,
      squawk: assignSquawk(42), facility: 'San Francisco Clearance', freqMhz: 118.2,
    })
    for (const piece of ['cleared to KLAX', 'radar vectors', 'Climb and maintain 5000', 'expect 11000', 'Departure frequency 135.10', 'squawk']) {
      expect(clr.text).toContain(piece)
    }
    expect(assignSquawk(7)).toMatch(/^\d{4}$/)
    expect(['7500', '7600', '7700', '1200']).not.toContain(assignSquawk(7))
  })

  it('hands off in order along the route and clears the approach', () => {
    const stops = californiaHandoffPlan(135.1, 124.5)
    const s = new IfrSession({ callsign: CS, stops, destRunway: '24R', approachName: 'ILS runway 24R' })
    const heard: string[] = []
    for (let f = 0; f <= 100; f++) {
      for (const t of s.tick(f / 100, f)) heard.push(`${t.from} → ${t.text}`)
    }
    expect(heard).toHaveLength(4) // dep→ctr, ctr→ctr, ctr→LA ctr, LA ctr→SoCal
    expect(heard[0]).toContain('contact Oakland Center')
    expect(heard[3]).toContain('contact SoCal Approach')
    expect(s.currentStop().name).toBe('SoCal Approach')
    const app = s.requestApproach(101)
    expect(app[0]!.text).toContain('cleared ILS runway 24R approach')
    expect(app[0]!.text).toContain('maintain 3000 until established')
    expect(s.requestApproach(102)).toHaveLength(0) // once only
    // Honesty flag: center freqs are representative, not chart-sourced.
    expect(stops.filter((x) => x.approx).length).toBeGreaterThan(0)
  })
})
