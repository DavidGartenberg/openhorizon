/**
 * Tower controller (§12.2, Phase 6b): a strip-based state machine for one
 * towered runway. Pilots (player UI and AI alike) talk through the SAME
 * structured-request API; the transmitted text is generated here so
 * phraseology stays in one place. Pure: sim-time only, no DOM.
 *
 * Deliberately small-N and legible (see phase-6 plan: sequencing bugs are
 * the expected escalation zone) — one active runway, one arrival string.
 */
import type { Transmission } from './comms'

export interface TrafficView {
  distanceM: number // from the runway threshold
  aglFt: number
  onGround: boolean
}

export type PilotRequestKind = 'readyTakeoff' | 'inboundLanding' | 'taxiOut' | 'goAround'

export type TowerPhase =
  | 'holdingShort'
  | 'clearedTakeoff'
  | 'departed'
  | 'inbound'
  | 'clearedLand'
  | 'landed'

interface Strip {
  callsign: string
  phase: TowerPhase
  view: TrafficView
  /** Arrival-sequence number (FIFO). Distance-to-threshold is NOT sequence
   *  order — a downwind-abeam aircraft is closer to the threshold than one
   *  on base, which inverted the queue and double-cleared the runway (found
   *  by the two-plane integration test's radio log). */
  seq: number
}

export function pilotPhrase(callsign: string, kind: PilotRequestKind, runway: string): string {
  switch (kind) {
    case 'readyTakeoff':
      return `${callsign}, holding short runway ${runway}, ready for departure`
    case 'inboundLanding':
      return `${callsign}, 5 miles out, inbound full stop with the numbers`
    case 'taxiOut':
      return `${callsign}, at parking with information, request taxi runway ${runway}`
    case 'goAround':
      return `${callsign}, going around`
  }
}

const FINAL_CONFLICT_M = 5 * 1852 // arrival inside 5 nm blocks a departure

export class TowerController {
  private readonly strips = new Map<string, Strip>()
  private seqCounter = 0

  constructor(
    private readonly cfg: { facility: string; freqMhz: number; activeRunway: string },
  ) {}

  private say(text: string, atSimS = 0): Transmission {
    return { freqMhz: this.cfg.freqMhz, from: this.cfg.facility, text, atSimS }
  }

  /** Register/refresh AI or player position knowledge. */
  registerInbound(callsign: string, view: TrafficView): void {
    this.strips.set(callsign, { callsign, phase: 'inbound', view, seq: ++this.seqCounter })
  }

  update(callsign: string, view: TrafficView): void {
    const s = this.strips.get(callsign)
    if (!s) return
    s.view = view
    if (s.phase === 'clearedLand' && view.onGround) s.phase = 'landed'
    if ((s.phase === 'inbound' || s.phase === 'clearedLand') && view.onGround && view.distanceM < 1000) s.phase = 'landed'
    if (s.phase === 'clearedTakeoff' && !view.onGround && view.aglFt > 100) s.phase = 'departed'
  }

  /** Arrivals still in the air, nearest first. */
  private arrivalQueue(): Strip[] {
    return [...this.strips.values()]
      .filter((s) => (s.phase === 'inbound' || s.phase === 'clearedLand') && !s.view.onGround)
      .sort((a, b) => a.seq - b.seq)
  }

  /** Runway blocked by traffic other than `exceptCallsign` (a pilot's own
   *  fresh takeoff clearance must not block their repeat request — found
   *  live at KPAO: "hold short, runway occupied" to the aircraft that had
   *  just been cleared). */
  private runwayOccupied(exceptCallsign?: string): boolean {
    return [...this.strips.values()].some(
      (s) =>
        s.callsign !== exceptCallsign &&
        (s.phase === 'landed' || s.phase === 'clearedTakeoff') &&
        s.view.onGround && s.view.distanceM < 1500,
    )
  }

  request(callsign: string, kind: PilotRequestKind, view: TrafficView, atSimS = 0): Transmission[] {
    const prev = this.strips.get(callsign)
    this.strips.set(callsign, {
      callsign, phase: prev?.phase ?? 'holdingShort', view, seq: prev?.seq ?? ++this.seqCounter,
    })
    const s = this.strips.get(callsign)!
    const rwy = this.cfg.activeRunway
    switch (kind) {
      case 'readyTakeoff': {
        const final = this.arrivalQueue().find((a) => a.callsign !== callsign && a.view.distanceM < FINAL_CONFLICT_M)
        if (final || this.runwayOccupied(callsign)) {
          s.phase = 'holdingShort'
          return [this.say(`${callsign}, hold short runway ${rwy}, ${final ? 'traffic on final' : 'runway occupied'}`, atSimS)]
        }
        s.phase = 'clearedTakeoff'
        return [this.say(`${callsign}, runway ${rwy}, cleared for takeoff`, atSimS)]
      }
      case 'inboundLanding': {
        s.phase = 'inbound'
        s.seq = ++this.seqCounter
        const ahead = this.arrivalQueue().filter((a) => a.callsign !== callsign && a.seq < s.seq)
        if (ahead.length === 0) {
          s.phase = 'clearedLand'
          return [this.say(`${callsign}, runway ${rwy}, cleared to land`, atSimS)]
        }
        return [
          this.say(
            `${callsign}, number ${ahead.length + 1}, follow the traffic ahead, report ${ahead.length > 1 ? 'base' : 'final'} runway ${rwy}`,
            atSimS,
          ),
        ]
      }
      case 'goAround': {
        s.phase = 'inbound'
        s.seq = ++this.seqCounter // rejoin at the back of the sequence
        return [this.say(`${callsign}, roger, fly runway heading, report downwind runway ${rwy}`, atSimS)]
      }
      case 'taxiOut':
        // Tower doesn't handle taxi — ground's job; polite redirect.
        return [this.say(`${callsign}, contact ground for taxi`, atSimS)]
    }
  }

  /** Periodic sequencing: clear the #1 arrival when the runway is free. */
  tick(atSimS: number, updates: Array<{ callsign: string; view: TrafficView }> = []): Transmission[] {
    for (const u of updates) this.update(u.callsign, u.view)
    // Landed traffic exits the runway between scans — retire the strip.
    for (const [cs, s] of this.strips) if (s.phase === 'landed') this.strips.delete(cs)
    const out: Transmission[] = []
    const queue = this.arrivalQueue()
    const leader = queue[0]
    if (leader && leader.phase === 'inbound' && !this.runwayOccupied() && leader.view.distanceM < 4 * 1852) {
      leader.phase = 'clearedLand'
      out.push(this.say(`${leader.callsign}, runway ${this.cfg.activeRunway}, cleared to land`, atSimS))
    }
    return out
  }
}
