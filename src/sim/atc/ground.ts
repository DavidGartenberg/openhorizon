/**
 * Ground controller (§12.2, Phase 6b): taxi clearances + readback tracking.
 * Pure and deliberately simple — taxi routing is "taxi to the active
 * runway" (named taxiway graphs are §28 territory; the phraseology and
 * readback discipline are what this phase owes).
 */
import type { Transmission } from './comms'
import type { PilotRequestKind } from './tower'

export class GroundController {
  private readonly pendingReadback = new Map<string, PilotRequestKind>()

  constructor(
    private readonly cfg: { facility: string; freqMhz: number; activeRunway: string },
  ) {}

  private say(text: string, atSimS = 0): Transmission {
    return { freqMhz: this.cfg.freqMhz, from: this.cfg.facility, text, atSimS }
  }

  request(callsign: string, kind: 'taxiOut', atSimS = 0): Transmission[] {
    if (kind === 'taxiOut') {
      this.pendingReadback.set(callsign, kind)
      return [this.say(`${callsign}, runway ${this.cfg.activeRunway}, taxi via the parallel, hold short runway ${this.cfg.activeRunway}`, atSimS)]
    }
    return []
  }

  awaitingReadback(callsign: string): boolean {
    return this.pendingReadback.has(callsign)
  }

  readback(callsign: string, kind: PilotRequestKind, atSimS = 0): Transmission[] {
    if (this.pendingReadback.get(callsign) === kind) {
      this.pendingReadback.delete(callsign)
      return [this.say(`${callsign}, readback correct`, atSimS)]
    }
    return [this.say(`${callsign}, negative, say again`, atSimS)]
  }
}
