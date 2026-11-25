import { describe, expect, it } from 'vitest'
import { AmbientRadio, type AmbientField } from '../../src/sim/atc/ambient'
import type { Transmission } from '../../src/sim/atc/comms'
import { readbackText, speakerRole } from '../../src/sim/atc/phraseology'

const FIELD: AmbientField = {
  field: 'Palo Alto', runway: '31', atis: 'Bravo', busy: 0.8, airlines: false,
  tower: { name: 'Palo Alto Tower', freqMhz: 118.6 },
  ground: { name: 'Palo Alto Ground', freqMhz: 121.7 },
  approach: { name: 'Norcal Approach', freqMhz: 124.0 },
  departure: { name: 'Norcal Departure', freqMhz: 120.5 },
  taxiways: () => ['A', 'B'],
}

/** Everything heard in `minutes` on one frequency, ticking every 5 s. */
function listen(field: AmbientField, tuned: number, minutes: number, opts: { seed?: number; busy?: (t: number) => boolean } = {}): Transmission[] {
  const radio = new AmbientRadio(field, { seed: opts.seed ?? 7 })
  const heard: Transmission[] = []
  for (let t = 0; t <= minutes * 60; t += 5) heard.push(...radio.tick(t, tuned, opts.busy?.(t) ?? false))
  return heard
}

describe('background radio traffic', () => {
  it('fills a ground frequency with complete taxi exchanges: call, clearance, readback', () => {
    const heard = listen(FIELD, 121.7, 8)
    expect(heard.length).toBeGreaterThan(5)
    expect(heard.every((t) => t.ambient === true && t.freqMhz === 121.7)).toBe(true)
    const first = heard.slice(0, 3)
    expect(first.map((t) => speakerRole(t.from))).toEqual(['pilot', 'atc', 'pilot'])
    expect(first[0]!.text).toMatch(/^Palo Alto Ground, .+, at the ramp with information Bravo, request taxi for departure$/)
    expect(first[1]!.text).toMatch(/^.+, Palo Alto Ground, runway 31, taxi via [AB](, B)?, hold short of runway 31$/)
    expect(first[1]!.kind).toBe('taxi')
    // The readback is exactly what was said, callsign last.
    expect(first[2]!.text).toBe(readbackText({ kind: first[1]!.kind, args: first[1]!.args }, first[0]!.from))
    expect(first[2]!.text.endsWith(`, ${first[0]!.from}`)).toBe(true)
    expect(first[0]!.atSimS).toBeLessThan(first[1]!.atSimS)
    expect(first[1]!.atSimS).toBeLessThan(first[2]!.atSimS)
  })

  it('runs arrivals on approach: check-in, descent, then the tower handoff, each read back', () => {
    const heard = listen(FIELD, 124.0, 12)
    const arrival = heard.filter((t) => t.kind === 'descend' || t.kind === 'contact')
    expect(arrival.length).toBeGreaterThan(0)
    const descend = heard.find((t) => t.kind === 'descend')!
    const idx = heard.indexOf(descend)
    expect(heard[idx - 1]!.text).toContain('inbound with information Bravo')
    expect(heard[idx + 1]!.text).toMatch(/^descend and maintain 2,500, /)
    const handoff = heard.find((t) => t.kind === 'contact')
    if (handoff) {
      expect(handoff.text).toContain('contact tower 118.60, good day')
      expect(heard[heard.indexOf(handoff) + 1]!.text).toMatch(/^contact tower 118\.60, /)
    }
  })

  it('checks departures in on the departure frequency with a squawk and altitude read back', () => {
    const heard = listen(FIELD, 120.5, 10)
    const answer = heard.find((t) => t.kind === 'climb')!
    expect(answer.text).toMatch(/^.+, Norcal Departure, radar contact, climb and maintain [\d,]+, squawk [1-6][0-7]{3}$/)
    const readback = heard[heard.indexOf(answer) + 1]!
    expect(readback.text).toMatch(/^climb and maintain [\d,]+, squawk [1-6][0-7]{3}, /)
  })

  it('leaves the tower frequency to the pattern pilots, and silent when nothing it knows is tuned', () => {
    expect(listen(FIELD, 118.6, 10)).toEqual([])
    expect(listen(FIELD, 122.8, 10)).toEqual([])
    expect(listen({ ...FIELD, busy: 0 }, 121.7, 10)).toEqual([])
  })

  it('is quiet while the player is in the middle of an exchange, and resumes after', () => {
    const heard = listen(FIELD, 121.7, 6, { busy: (t) => t < 180 })
    expect(heard.length).toBeGreaterThan(0)
    expect(Math.min(...heard.map((t) => t.atSimS))).toBeGreaterThanOrEqual(180)
  })

  it('is deterministic for a seed, different between seeds, and busier fields talk more', () => {
    const a = listen(FIELD, 121.7, 6, { seed: 3 }), b = listen(FIELD, 121.7, 6, { seed: 3 }), c = listen(FIELD, 121.7, 6, { seed: 4 })
    expect(a).toEqual(b)
    expect(a.map((t) => t.text)).not.toEqual(c.map((t) => t.text))
    const quiet = listen({ ...FIELD, busy: 0.1 }, 121.7, 20).length, busy = listen({ ...FIELD, busy: 1 }, 121.7, 20).length
    expect(busy).toBeGreaterThan(quiet)
  })

  it('uses airline callsigns at a large field and never an aircraft the sim is already flying', () => {
    const big = listen({ ...FIELD, airlines: true, busy: 1 }, 121.7, 20)
    expect(big.some((t) => /\b(UAL|AAL|DAL|SWA|JBU|ASA|SKW|FDX|UPS)\d+/.test(t.from))).toBe(true)
    const radio = new AmbientRadio({ ...FIELD, busy: 1 }, { seed: 9 })
    const taken = new Set(['Skyhawk 123AB'])
    const callers = new Set<string>()
    for (let t = 0; t < 3600; t += 5) for (const x of radio.tick(t, 121.7, false, taken)) if (speakerRole(x.from) === 'pilot') callers.add(x.from)
    expect(callers.has('Skyhawk 123AB')).toBe(false)
    expect(callers.size).toBeGreaterThan(3)
  })
})
