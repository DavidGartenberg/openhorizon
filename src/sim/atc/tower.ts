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

export type PilotRequestKind = 'readyTakeoff' | 'inboundLanding' | 'taxiOut' | 'goAround' | 'clearRunway'

export type TowerPhase =
  | 'holdingShort'
  | 'clearedTakeoff'
  | 'departed'
  | 'inbound'
  | 'clearedLand'
  | 'landed'
  | 'vacated'

interface Strip {
  callsign: string
  phase: TowerPhase
  view: TrafficView
  /** Arrival-sequence number (FIFO). Distance-to-threshold is NOT sequence
   *  order — a downwind-abeam aircraft is closer to the threshold than one
   *  on base, which inverted the queue and double-cleared the runway (found
   *  by the two-plane integration test's radio log). */
  seq: number
  /** When the strip went 'landed' (14e assume-vacated fallback timer). */
  landedAtS?: number
  /** N7: departure handoff already transmitted for this strip. */
  handedOff?: boolean
  /** Slice 5: declared emergency — jumps the arrival queue, wide gate. */
  priority?: boolean
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
    case 'clearRunway':
      return `${callsign}, clear of runway ${runway}`
  }
}

const FINAL_CONFLICT_M = 5 * 1852 // arrival inside 5 nm blocks a departure

export class TowerController {
  private readonly strips = new Map<string, Strip>()
  private seqCounter = 0

  constructor(
    private readonly cfg: {
      facility: string
      freqMhz: number
      activeRunway: string
      /** N7: real DEP (or APP) frequency for this field, when published —
       *  drives the airborne handoff. Absent = "frequency change approved"
       *  (the honest phrase at fields with no departure facility). */
      departureFreqMhz?: number
      /** Runway length: a rolling departure occupies the runway until it
       *  is off the far end. Absent = the old 1500 m assumption (which
       *  cleared an arrival to land OVER a departure still rolling on a
       *  long runway). */
      runwayLengthM?: number
    },
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

  /** Arrivals still in the air: emergencies first, then FIFO. */
  private arrivalQueue(): Strip[] {
    return [...this.strips.values()]
      .filter((s) => (s.phase === 'inbound' || s.phase === 'clearedLand') && !s.view.onGround)
      .sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0) || a.seq - b.seq)
  }

  /** Slice 5: emergency escalation from the free-text controller. The
   *  flagged strip jumps the arrival queue and gets its clearance from
   *  the normal tick() (no double transmission — the free-text reply
   *  already acknowledged the mayday). */
  declareEmergency(callsign: string, view: TrafficView): void {
    let s = this.strips.get(callsign)
    if (!s || (s.phase !== 'inbound' && s.phase !== 'clearedLand')) {
      s = { callsign, phase: 'inbound', view, seq: ++this.seqCounter }
      this.strips.set(callsign, s)
    }
    s.view = view
    s.priority = true
  }

  /** Runway blocked by traffic other than `exceptCallsign` (a pilot's own
   *  fresh takeoff clearance must not block their repeat request — found
   *  live at KPAO: "hold short, runway occupied" to the aircraft that had
   *  just been cleared). */
  private runwayOccupied(exceptCallsign?: string): boolean {
    const occupyM = this.cfg.runwayLengthM ?? 1500
    return [...this.strips.values()].some(
      (s) =>
        s.callsign !== exceptCallsign &&
        (s.phase === 'landed' || s.phase === 'clearedTakeoff') &&
        s.view.onGround && s.view.distanceM < occupyM,
    )
  }

  request(callsign: string, kind: PilotRequestKind, view: TrafficView, atSimS = 0): Transmission[] {
    // Update-in-place: rebuilding the strip here used to DROP handedOff/
    // landedAtS/priority — a menu re-press restarted the vacate timer,
    // repeated "contact departure", and held the runway forever.
    let s = this.strips.get(callsign)
    if (!s) {
      s = { callsign, phase: 'holdingShort', view, seq: ++this.seqCounter }
      this.strips.set(callsign, s)
    }
    s.view = view
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
        // Re-pressing inbound used to revoke the pilot's OWN landing
        // clearance and re-queue them last; a clearance is confirmed,
        // an existing sequence position kept.
        if (s.phase === 'clearedLand') {
          return [this.say(`${callsign}, roger, runway ${rwy}, cleared to land`, atSimS)]
        }
        if (s.phase !== 'inbound') {
          s.phase = 'inbound'
          s.seq = ++this.seqCounter
        }
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
      case 'clearRunway': {
        // 14e: the vacated strip stops blocking `runwayOccupied` — the
        // parked-forever AI held every later clearance hostage.
        s.phase = 'vacated'
        return [this.say(`${callsign}, roger, taxi to parking`, atSimS)]
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
    // 14e: landed strips HOLD the runway until the pilot reports clear
    // (the old tick deleted them instantly — the tower pretended vacating
    // while the AI physically parked on the pavement forever; both halves
    // were fiction). Radio-silent traffic (the player) auto-vacates after
    // 90 s — a recorded assumption, not a position check.
    for (const [cs, s] of this.strips) {
      if (s.phase === 'vacated') this.strips.delete(cs)
      else if (s.phase === 'landed') {
        if (s.landedAtS === undefined) s.landedAtS = atSimS
        else if (atSimS - s.landedAtS > 90) this.strips.delete(cs)
      }
    }
    const out: Transmission[] = []
    // N7: hand departures off — once, when the strip goes 'departed'.
    for (const s of this.strips.values()) {
      if (s.phase === 'departed' && !s.handedOff) {
        s.handedOff = true
        const f = this.cfg.departureFreqMhz
        out.push(
          this.say(
            f
              ? `${s.callsign}, contact departure ${f.toFixed(2)}, so long`
              : `${s.callsign}, frequency change approved, so long`,
            atSimS,
          ),
        )
      }
    }
    const queue = this.arrivalQueue()
    const leader = queue[0]
    // Emergencies (priority) get their clearance from much further out.
    const gateM = leader?.priority ? 15 * 1852 : 4 * 1852
    if (leader && leader.phase === 'inbound' && !this.runwayOccupied() && leader.view.distanceM < gateM) {
      leader.phase = 'clearedLand'
      out.push(this.say(
        leader.priority
          ? `${leader.callsign}, runway ${this.cfg.activeRunway}, cleared to land, emergency equipment standing by`
          : `${leader.callsign}, runway ${this.cfg.activeRunway}, cleared to land`,
        atSimS,
      ))
    }
    return out
  }
}
