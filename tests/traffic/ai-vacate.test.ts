/**
 * 14e parked-forever fix: a landed AI must roll out, exit the runway,
 * report clear, and stop blocking the tower's one-clearance logic. The
 * old terminal 'landed' phase kept `runwayOccupied` true forever — every
 * later departure got "hold short, runway occupied" until the end of
 * time.
 */
import { describe, expect, it } from 'vitest'
import { AiPatternPilot } from '../../src/sim/traffic/ai-pilot'
import { TowerController } from '../../src/sim/atc/tower'
import { CommsBus } from '../../src/sim/atc/comms'

const RWY = { thrLat: 37.456, thrLon: -122.115, headingDeg: 313, elevFt: 5 } // KPAO 31
const M_LAT = 111_320

/** Cross-track distance (m) from the extended runway centerline. */
function crossTrackM(lat: number, lon: number): number {
  const mLon = M_LAT * Math.cos((lat * Math.PI) / 180)
  const dn = (lat - RWY.thrLat) * M_LAT
  const de = (lon - RWY.thrLon) * mLon
  const hdg = (RWY.headingDeg * Math.PI) / 180
  return Math.abs(-Math.sin(hdg) * dn + Math.cos(hdg) * de)
}

function world() {
  const bus = new CommsBus()
  const tower = new TowerController({ facility: 'Palo Alto Tower', freqMhz: 118.6, activeRunway: '31' })
  return { bus, tower }
}

describe('AI taxi-off (14e)', () => {
  it('vacates within 60 s of landing, ends up off the centerline, reports clear', () => {
    const { bus, tower } = world()
    const ai = new AiPatternPilot({ callsign: 'N77GA', runway: RWY, runwayIdent: '31', tower, bus, freqMhz: 118.6 })
    let simS = 0
    let landedAt = -1
    for (let i = 0; i < 1500 && ai.phase !== 'done'; i++) {
      simS += 1
      ai.step(1, simS)
      if (landedAt < 0 && (ai.phase === 'landed' || ai.phase === 'taxiOff')) landedAt = simS
      if (i % 5 === 0) for (const t of tower.tick(simS)) bus.transmit(t)
    }
    expect(ai.phase).toBe('done')
    expect(landedAt).toBeGreaterThan(0)
    expect(simS - landedAt).toBeLessThanOrEqual(60)
    expect(crossTrackM(ai.plane.lat, ai.plane.lon)).toBeGreaterThan(50)
    const texts = bus.log.map((t) => t.text.toLowerCase())
    expect(texts.some((t) => t.includes('clear of runway'))).toBe(true)
    expect(texts.some((t) => t.includes('taxi to parking'))).toBe(true)
  })

  it('frees the runway: a holder is refused while the lander rolls, cleared after it vacates', () => {
    const { bus, tower } = world()
    const lander = new AiPatternPilot({ callsign: 'N1AA', runway: RWY, runwayIdent: '31', tower, bus, freqMhz: 118.6 })
    let simS = 0
    for (let i = 0; i < 1200 && lander.phase !== 'landed'; i++) {
      simS += 1
      lander.step(1, simS)
      if (i % 5 === 0) for (const t of tower.tick(simS)) bus.transmit(t)
    }
    expect(lander.phase).toBe('landed')
    // A departure starts requesting the moment the lander is on the runway.
    const holder = new AiPatternPilot({ callsign: 'N2BB', runway: RWY, runwayIdent: '31', tower, bus, freqMhz: 118.6 })
    for (let i = 0; i < 200 && !(lander.phase === 'done' && holder.phase === 'pattern'); i++) {
      simS += 1
      lander.step(1, simS)
      holder.step(1, simS)
      if (i % 5 === 0) for (const t of tower.tick(simS)) bus.transmit(t)
    }
    expect(lander.phase).toBe('done')
    expect(holder.phase).toBe('pattern')
    const log = bus.log.map((t) => t.text.toLowerCase())
    // The refusal names either cause (occupied runway or the lander still
    // inside the final-conflict window) — both are "held".
    const heldIdx = log.findIndex((t) => t.includes('n2bb') && t.includes('hold short'))
    const clearIdx = log.findIndex((t) => t.includes('clear of runway'))
    const clearedIdx = log.findIndex((t) => t.includes('n2bb') && t.includes('cleared for takeoff'))
    expect(heldIdx).toBeGreaterThanOrEqual(0) // refused while occupied
    expect(clearedIdx).toBeGreaterThan(clearIdx) // cleared only after vacate
  })

  it('five staggered ships: takeoff clearances never issue with a ship on the runway', () => {
    const { bus, tower } = world()
    const ships = ['N1AA', 'N2BB', 'N3CC', 'N4DD', 'N5EE'].map(
      (cs, i) => new AiPatternPilot({ callsign: cs, runway: RWY, runwayIdent: '31', tower, bus, freqMhz: 118.6, startDelayS: i * 150 }),
    )
    const violations: string[] = []
    bus.subscribe((t) => {
      const m = t.text.toLowerCase().match(/^(\w+), runway 31, cleared for takeoff/)
      if (!m) return
      for (const s of ships) {
        if (s.callsign.toLowerCase() === m[1]) continue
        if (s.phase === 'landed' || s.phase === 'taxiOff') violations.push(`${t.text} while ${s.callsign} ${s.phase}`)
      }
    })
    let simS = 0
    for (let i = 0; i < 3000; i++) {
      simS += 1
      for (const s of ships) s.step(1, simS)
      if (i % 5 === 0) for (const t of tower.tick(simS)) bus.transmit(t)
    }
    const doneCount = ships.filter((s) => s.phase === 'done').length
    expect(doneCount).toBeGreaterThanOrEqual(3) // the cycle keeps flowing
    expect(violations).toEqual([])
  })
})
