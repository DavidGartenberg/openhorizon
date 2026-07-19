/**
 * Comms bus (§12.3, Phase 6a): every radio transmission in the sim flows
 * through here — ATC facilities, AI traffic, and the player alike. The bus
 * is frequency-agnostic; audibility is the RECEIVER's problem (`isAudible`
 * against whatever COM the listener has tuned — wrong frequency is honest
 * silence). Pure module: sim time only, no DOM/audio (the voice layer is a
 * subscriber, not part of the bus).
 */

export interface Transmission {
  freqMhz: number
  /** Speaker: facility name ("Palo Alto Tower") or callsign ("N123AB"). */
  from: string
  text: string
  atSimS: number
}

export type CommsListener = (t: Transmission) => void

/** Within 5 kHz counts as tuned (COM channel spacing is 25 kHz; this just
 *  absorbs float representation). */
export function isAudible(txFreqMhz: number, tunedMhz: number): boolean {
  return Math.abs(txFreqMhz - tunedMhz) < 0.005
}

export class CommsBus {
  readonly log: Transmission[] = []
  private readonly listeners: CommsListener[] = []

  transmit(t: Transmission): void {
    this.log.push(t)
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400)
    for (const l of this.listeners) l(t)
  }

  subscribe(listener: CommsListener): void {
    this.listeners.push(listener)
  }
}
