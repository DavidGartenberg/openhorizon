/**
 * Aircraft/airport light flash timing (Phase 13c) — pure, exact
 * transitions. Cadences follow the real conventions:
 *  - rotating red beacon ~45 cpm (FAR 23.1401 anticollision: 40–100)
 *  - white strobes: double-flash pair every 1.4 s (each pulse counts →
 *    ~86 fpm, inside 40–100)
 *  - civil land airport beacon: alternating white/green, 24–30 flashes
 *    per minute (AIM 2-1-9)
 */
import { describe, expect, it } from 'vitest'
import { beaconOn, strobeOn, airportBeacon, BEACON_PERIOD_S, STROBE_PERIOD_S, AIRPORT_BEACON_PERIOD_S } from '../src/sim/lights'

const countPerMinute = (fn: (t: number) => boolean): number => {
  let count = 0
  let prev = false
  for (let t = 0; t < 60; t += 0.005) {
    const on = fn(t)
    if (on && !prev) count++
    prev = on
  }
  return count
}

describe('beaconOn (rotating red, 45 cpm)', () => {
  it('is on at the start of the cycle and off past 35% duty', () => {
    expect(beaconOn(0)).toBe(true)
    expect(beaconOn(BEACON_PERIOD_S * 0.34)).toBe(true)
    expect(beaconOn(BEACON_PERIOD_S * 0.36)).toBe(false)
    expect(beaconOn(BEACON_PERIOD_S * 0.99)).toBe(false)
    expect(beaconOn(BEACON_PERIOD_S * 1.01)).toBe(true) // wraps
  })
  it('flashes 40–100 times per minute (FAR 23.1401)', () => {
    const cpm = countPerMinute(beaconOn)
    expect(cpm).toBeGreaterThanOrEqual(40)
    expect(cpm).toBeLessThanOrEqual(100)
  })
})

describe('strobeOn (double-flash white)', () => {
  it('fires the classic double pulse then stays dark for the rest of the period', () => {
    expect(strobeOn(0.01)).toBe(true) // first pulse [0, 0.08)
    expect(strobeOn(0.1)).toBe(false) // gap
    expect(strobeOn(0.25)).toBe(true) // second pulse [0.22, 0.30)
    expect(strobeOn(0.5)).toBe(false)
    expect(strobeOn(STROBE_PERIOD_S - 0.01)).toBe(false)
    expect(strobeOn(STROBE_PERIOD_S + 0.01)).toBe(true) // wraps
  })
  it('pulses 40–100 times per minute', () => {
    const ppm = countPerMinute(strobeOn)
    expect(ppm).toBeGreaterThanOrEqual(40)
    expect(ppm).toBeLessThanOrEqual(100)
  })
})

describe('airportBeacon (alternating white/green)', () => {
  it('flashes white then green half a period later, dark between', () => {
    expect(airportBeacon(0.05)).toBe('white')
    expect(airportBeacon(0.5)).toBeNull()
    expect(airportBeacon(AIRPORT_BEACON_PERIOD_S / 2 + 0.05)).toBe('green')
    expect(airportBeacon(AIRPORT_BEACON_PERIOD_S - 0.1)).toBeNull()
    expect(airportBeacon(AIRPORT_BEACON_PERIOD_S + 0.05)).toBe('white') // wraps
  })
  it('total flashes land inside AIM 2-1-9 24–30 per minute', () => {
    let count = 0
    let prev: string | null = null
    for (let t = 0; t < 60; t += 0.005) {
      const c = airportBeacon(t)
      if (c && c !== prev) count++
      prev = c
    }
    expect(count).toBeGreaterThanOrEqual(24)
    expect(count).toBeLessThanOrEqual(30)
  })
})
