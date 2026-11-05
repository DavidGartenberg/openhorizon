/**
 * Ground controller (§12.2, Phase 6b): taxi clearances + readback tracking.
 * Pure and deliberately simple — taxi routing is "taxi to the active
 * runway" (named taxiway graphs are §28 territory; the phraseology and
 * readback discipline are what this phase owes).
 */
import type { RadioArgs, RadioKind, Transmission } from './comms'
import type { PilotRequestKind } from './tower'
import { taxiInstruction } from './phraseology'

/** Pick the taxiway idents a straight-line taxi would use (night-shift
 *  N7): from the real ident'd segments (OSM refs at their midpoints in
 *  airport-local meters), keep those within `corridorM` of the
 *  aircraft→runway line, ordered along it, first occurrence per ident,
 *  max three. A real routing graph is later work — but every NAME this
 *  produces is a real taxiway at a real position on that airport. */
export function routeIdents(
  segs: readonly { ref: string; x: number; z: number }[],
  from: { x: number; z: number },
  to: { x: number; z: number },
  corridorM = 160,
): string[] {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const len2 = dx * dx + dz * dz || 1
  const seen = new Set<string>()
  const picks: { t: number; ref: string }[] = []
  for (const s of segs) {
    if (!s.ref) continue
    const t = ((s.x - from.x) * dx + (s.z - from.z) * dz) / len2
    if (t < 0.02 || t > 0.98) continue
    const px = from.x + t * dx
    const pz = from.z + t * dz
    if (Math.hypot(s.x - px, s.z - pz) > corridorM) continue
    if (seen.has(s.ref)) continue
    seen.add(s.ref)
    picks.push({ t, ref: s.ref })
  }
  picks.sort((a, b) => a.t - b.t)
  return picks.slice(0, 3).map((p) => p.ref)
}

export class GroundController {
  private readonly pendingReadback = new Map<string, PilotRequestKind>()
  /** Callsigns already spoken to: the facility name goes on the first transmission only. */
  private readonly contacted = new Set<string>()

  constructor(
    private readonly cfg: { facility: string; freqMhz: number; activeRunway: string },
  ) {}

  private say(text: string, atSimS = 0, to?: string, kind?: RadioKind, args?: RadioArgs): Transmission {
    return { freqMhz: this.cfg.freqMhz, from: this.cfg.facility, text, atSimS, ...(to ? { to } : {}), ...(kind ? { kind } : {}), ...(args ? { args } : {}) }
  }

  request(callsign: string, kind: 'taxiOut', atSimS = 0, viaIdents?: readonly string[]): Transmission[] {
    if (kind === 'taxiOut') {
      this.pendingReadback.set(callsign, kind)
      const lead = this.contacted.has(callsign) ? `${callsign}, ` : `${callsign}, ${this.cfg.facility}, `
      this.contacted.add(callsign)
      const rwy = this.cfg.activeRunway
      // Without named taxiways the controller still says where to go; the runway is held short of by default.
      const body = viaIdents && viaIdents.length ? taxiInstruction(rwy, viaIdents) : `taxi to runway ${rwy}`
      return [this.say(lead + body, atSimS, callsign, 'taxi', { runway: rwy, ...(viaIdents && viaIdents.length ? { via: [...viaIdents] } : {}) })]
    }
    return []
  }

  awaitingReadback(callsign: string): boolean {
    return this.pendingReadback.has(callsign)
  }

  readback(callsign: string, kind: PilotRequestKind, atSimS = 0): Transmission[] {
    if (this.pendingReadback.get(callsign) === kind) {
      this.pendingReadback.delete(callsign)
      return [this.say(`${callsign}, readback correct`, atSimS, callsign)]
    }
    return [this.say(`${callsign}, negative, say again`, atSimS, callsign)]
  }
}
