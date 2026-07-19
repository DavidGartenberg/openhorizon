import { describe, expect, it } from 'vitest'
import { TrafficPlane } from '../../src/sim/traffic/pointmass'
import { makePatternLegs } from '../../src/sim/traffic/pattern'
import { AiPatternPilot } from '../../src/sim/traffic/ai-pilot'
import { TowerController } from '../../src/sim/atc/tower'
import { CommsBus } from '../../src/sim/atc/comms'

const RWY = { thrLat: 37.456, thrLon: -122.115, headingDeg: 313, elevFt: 5 } // KPAO 31

describe('TrafficPlane point-mass', () => {
  it('flies to a waypoint with limited turn rate and arrives', () => {
    const p = new TrafficPlane({ lat: 37.44, lon: -122.1, altFt: 1000, gsKt: 90, headingDeg: 0 })
    p.setLegs([{ lat: 37.47, lon: -122.13, altFt: 1500, gsKt: 90 }])
    let maxTurnPerS = 0
    let prevHdg = p.headingDeg
    for (let i = 0; i < 600 && p.currentLeg() !== null; i++) {
      p.step(1)
      const d = Math.abs(((p.headingDeg - prevHdg + 540) % 360) - 180)
      maxTurnPerS = Math.max(maxTurnPerS, d)
      prevHdg = p.headingDeg
    }
    expect(p.currentLeg()).toBeNull() // arrived, legs exhausted
    expect(maxTurnPerS).toBeLessThanOrEqual(3.6) // standard-rate-ish cap
    expect(p.altFt).toBeGreaterThan(1300) // climbed toward leg altitude
  })

  it('respects climb-rate limits', () => {
    const p = new TrafficPlane({ lat: 37.4, lon: -122.1, altFt: 0, gsKt: 70, headingDeg: 0 })
    p.setLegs([{ lat: 38.0, lon: -122.1, altFt: 5000, gsKt: 90 }])
    p.step(60) // one minute
    expect(p.altFt).toBeLessThanOrEqual(800 + 1) // ≤ ~800 fpm class limit
  })
})

describe('pattern generation', () => {
  it('builds a closed left pattern at +1000 AGL ending on the threshold', () => {
    const legs = makePatternLegs(RWY, 'left')
    expect(legs.length).toBeGreaterThanOrEqual(5)
    expect(Math.max(...legs.map((l) => l.altFt))).toBeCloseTo(1005, -1)
    const last = legs[legs.length - 1]!
    expect(last.lat).toBeCloseTo(RWY.thrLat, 3)
    expect(last.lon).toBeCloseTo(RWY.thrLon, 3)
    expect(last.altFt).toBe(RWY.elevFt)
  })
})

describe('AI pilot + tower integration', () => {
  it('requests takeoff, flies the pattern, calls positions, lands when cleared', () => {
    const bus = new CommsBus()
    const tower = new TowerController({ facility: 'Palo Alto Tower', freqMhz: 118.6, activeRunway: '31' })
    const ai = new AiPatternPilot({
      callsign: 'N77GA', runway: RWY, runwayIdent: '31', tower, bus, freqMhz: 118.6,
    })
    let simS = 0
    for (let i = 0; i < 900 && ai.phase !== 'landed'; i++) {
      simS += 1
      ai.step(1, simS)
      if (i % 5 === 0) for (const t of tower.tick(simS)) bus.transmit(t)
    }
    expect(ai.phase).toBe('landed')
    const texts = bus.log.map((t) => t.text.toLowerCase())
    expect(texts.some((t) => t.includes('ready for departure'))).toBe(true)
    expect(texts.some((t) => t.includes('cleared for takeoff'))).toBe(true)
    expect(texts.some((t) => t.includes('downwind'))).toBe(true)
    expect(texts.some((t) => t.includes('cleared to land'))).toBe(true)
    expect(bus.log.every((t) => t.freqMhz === 118.6)).toBe(true)
  })

  it('two aircraft get sequenced, not simultaneous clearances', () => {
    const bus = new CommsBus()
    const tower = new TowerController({ facility: 'Palo Alto Tower', freqMhz: 118.6, activeRunway: '31' })
    const a = new AiPatternPilot({ callsign: 'N1AA', runway: RWY, runwayIdent: '31', tower, bus, freqMhz: 118.6 })
    const b = new AiPatternPilot({ callsign: 'N2BB', runway: RWY, runwayIdent: '31', tower, bus, freqMhz: 118.6, startDelayS: 15 })
    let simS = 0
    for (let i = 0; i < 1400 && !(a.phase === 'landed' && b.phase === 'landed'); i++) {
      simS += 1
      a.step(1, simS)
      b.step(1, simS)
      if (i % 5 === 0) for (const t of tower.tick(simS)) bus.transmit(t)
    }
    expect(a.phase).toBe('landed')
    expect(b.phase).toBe('landed')
    // The sequencing guarantee: one landing clearance at a time. The
    // trailing aircraft's clearance must come well after the leader's —
    // only once the leader has landed and cleared (FIFO queue; the original
    // distance-sorted queue double-cleared the runway, caught by this
    // test's radio log).
    const clears = bus.log.filter((t) => t.text.toLowerCase().includes('cleared to land'))
    expect(clears.length).toBe(2)
    expect(clears[0]!.text).toContain('N1AA')
    expect(clears[1]!.text).toContain('N2BB')
    expect(clears[1]!.atSimS - clears[0]!.atSimS).toBeGreaterThan(60)
  })
})
