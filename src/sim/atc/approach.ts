/**
 * Approach controller (night-shift N7, arrival side): the radar facility
 * between the en-route world and the tower. Same design rules as
 * tower.ts — a small, legible strip machine, sim-time only, pure. The
 * player checks in inbound, gets the expected approach and an initial
 * descent, is cleared for the approach once established inbound of the
 * gate, and is handed to the tower — once — inside the handoff range.
 *
 * Honest scope (recorded): no vector sequencing between multiple
 * arrivals (the tower's arrival queue already orders the final), no
 * speed assignments, and altitudes are the standard 3,000 ft platform
 * rather than per-airport published values.
 */
import type { Transmission } from './comms'

export interface ApproachView {
  distanceM: number // from the airport reference point
  aglFt: number
}

type ApproachPhase = 'checkedIn' | 'clearedApproach' | 'handedOff'

const CLEARANCE_GATE_M = 14 * 1852 // cleared for the approach inside 14 nm
/** Tower handoff inside 8 nm — exported so the UI's check-in gate can sit
 *  OUTSIDE it (a check-in between the gates used to fire the whole
 *  ladder, clearance + handoff, in a single tick). */
export const HANDOFF_GATE_M = 8 * 1852

export class ApproachController {
  private readonly strips = new Map<string, { phase: ApproachPhase }>()

  constructor(
    private readonly cfg: {
      facility: string
      freqMhz: number
      activeRunway: string
      towerFreqMhz: number
    },
  ) {}

  private say(text: string, atSimS: number): Transmission {
    return { freqMhz: this.cfg.freqMhz, from: this.cfg.facility, text, atSimS }
  }

  /** Inbound check-in: radar contact + expected approach + platform
   *  altitude. Idempotent — re-checking in repeats the expectation
   *  WITHOUT resetting an already-progressed strip back to the start of
   *  the ladder (that re-ran clearance + handoff). */
  checkIn(callsign: string, view: ApproachView, atSimS = 0): Transmission[] {
    if (!this.strips.has(callsign)) this.strips.set(callsign, { phase: 'checkedIn' })
    const miles = Math.max(1, Math.round(view.distanceM / 1852))
    return [
      this.say(
        `${callsign}, radar contact ${miles} miles from the field, expect ILS runway ${this.cfg.activeRunway}, descend and maintain 3,000`,
        atSimS,
      ),
    ]
  }

  /** Range-driven progression. Call with fresh views each poll. */
  tick(atSimS: number, updates: Array<{ callsign: string; view: ApproachView }>): Transmission[] {
    const out: Transmission[] = []
    for (const { callsign, view } of updates) {
      const s = this.strips.get(callsign)
      if (!s) continue
      // At most ONE transition per tick: a late check-in inside both
      // gates used to fire clearance AND handoff in the same breath.
      if (s.phase === 'checkedIn' && view.distanceM < CLEARANCE_GATE_M) {
        s.phase = 'clearedApproach'
        out.push(
          this.say(
            `${callsign}, ${Math.max(1, Math.round(view.distanceM / 1852))} miles from the field, cleared ILS runway ${this.cfg.activeRunway} approach, maintain 3,000 until established`,
            atSimS,
          ),
        )
      } else if (s.phase === 'clearedApproach' && view.distanceM < HANDOFF_GATE_M) {
        s.phase = 'handedOff'
        out.push(this.say(`${callsign}, contact tower ${this.cfg.towerFreqMhz.toFixed(2)}, good day`, atSimS))
      }
    }
    return out
  }

  /** Whether this callsign has been handed to the tower (UI gating). */
  handedOff(callsign: string): boolean {
    return this.strips.get(callsign)?.phase === 'handedOff'
  }
}
