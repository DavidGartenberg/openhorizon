/**
 * IFR services (§12.2, Phase 6f): CRAFT clearance delivery and
 * center-handoff sequencing along a route. Pure module.
 *
 * Frequency honesty: ARTCC sector frequencies are NOT in the OurAirports
 * dataset (it's airport-scoped). Center names below are the real facilities
 * for a CA route; their frequencies are PLAUSIBLE representative values
 * flagged `approx: true` — never presented as chart-accurate (a real ARTCC
 * boundary/frequency source is §28 roadmap material). Departure/approach
 * frequencies DO come from real per-airport data when the caller has them.
 */
import type { Transmission } from './comms'

export interface CraftInput {
  callsign: string
  destIdent: string
  routeText: string // e.g. "radar vectors, then as filed"
  initialAltFt: number
  cruiseAltFt: number
  departureFreqMhz: number
  squawk: string
  facility: string
  freqMhz: number
}

export function buildCraftClearance(c: CraftInput): Transmission {
  const text =
    `${c.callsign}, cleared to ${c.destIdent} airport via ${c.routeText}. ` +
    `Climb and maintain ${c.initialAltFt}, expect ${c.cruiseAltFt} one zero minutes after departure. ` +
    `Departure frequency ${c.departureFreqMhz.toFixed(2)}, squawk ${c.squawk}.`
  return { freqMhz: c.freqMhz, from: c.facility, text, atSimS: 0 }
}

/** 4-digit discrete code avoiding reserved blocks (7500/7600/7700, 1200). */
export function assignSquawk(seed: number): string {
  const digits = []
  let s = Math.abs(seed) | 0
  for (let i = 0; i < 4; i++) {
    digits.push((s % 7) + (i === 0 ? 1 : 0)) // 0-6 per digit (octal-style), lead ≥1
    s = (s * 2654435761) >>> 3
  }
  const code = digits.join('')
  return ['7500', '7600', '7700', '1200'].includes(code) ? '4571' : code
}

export interface HandoffStop {
  name: string
  freqMhz: number
  /** Progress along the route (fraction 0..1) where the handoff happens. */
  atFraction: number
  /** True when the frequency is representative, not chart-sourced. */
  approx: boolean
}

/** Representative CA-corridor handoff ladder for a KSFO→KLAX style route. */
export function californiaHandoffPlan(departureFreqMhz: number, approachFreqMhz: number): HandoffStop[] {
  return [
    { name: 'Departure', freqMhz: departureFreqMhz, atFraction: 0.0, approx: false },
    { name: 'Oakland Center', freqMhz: 134.55, atFraction: 0.08, approx: true },
    { name: 'Oakland Center', freqMhz: 132.95, atFraction: 0.35, approx: true },
    { name: 'Los Angeles Center', freqMhz: 125.8, atFraction: 0.6, approx: true },
    { name: 'SoCal Approach', freqMhz: approachFreqMhz, atFraction: 0.88, approx: false },
  ]
}

export class IfrSession {
  private nextStopIdx = 0
  private approachCleared = false

  constructor(
    private readonly cfg: {
      callsign: string
      stops: HandoffStop[]
      destRunway: string
      approachName: string // e.g. "ILS runway 24R"
    },
  ) {}

  /** Handoffs due at this route progress (call with monotonic fraction). */
  tick(progressFraction: number, atSimS: number): Transmission[] {
    const out: Transmission[] = []
    while (
      this.nextStopIdx + 1 < this.cfg.stops.length &&
      progressFraction >= this.cfg.stops[this.nextStopIdx + 1]!.atFraction
    ) {
      const from = this.cfg.stops[this.nextStopIdx]!
      const to = this.cfg.stops[this.nextStopIdx + 1]!
      out.push({
        freqMhz: from.freqMhz,
        from: from.name,
        text: `${this.cfg.callsign}, contact ${to.name} on ${to.freqMhz.toFixed(2)}`,
        atSimS,
      })
      this.nextStopIdx++
    }
    return out
  }

  currentStop(): HandoffStop {
    return this.cfg.stops[this.nextStopIdx]!
  }

  /** Approach clearance from the final facility (once). */
  requestApproach(atSimS: number): Transmission[] {
    if (this.approachCleared) return []
    this.approachCleared = true
    const stop = this.cfg.stops[this.cfg.stops.length - 1]!
    return [
      {
        freqMhz: stop.freqMhz,
        from: stop.name,
        text: `${this.cfg.callsign}, maintain 3000 until established, cleared ${this.cfg.approachName} approach, contact tower on final`,
        atSimS,
      },
    ]
  }
}
