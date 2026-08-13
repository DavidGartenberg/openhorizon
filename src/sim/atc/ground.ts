/**
 * Ground controller (§12.2, Phase 6b): taxi clearances + readback tracking.
 * Pure and deliberately simple — taxi routing is "taxi to the active
 * runway" (named taxiway graphs are §28 territory; the phraseology and
 * readback discipline are what this phase owes).
 */
import type { Transmission } from './comms'
import type { PilotRequestKind } from './tower'

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

  constructor(
    private readonly cfg: { facility: string; freqMhz: number; activeRunway: string },
  ) {}

  private say(text: string, atSimS = 0): Transmission {
    return { freqMhz: this.cfg.freqMhz, from: this.cfg.facility, text, atSimS }
  }

  request(callsign: string, kind: 'taxiOut', atSimS = 0, viaIdents?: readonly string[]): Transmission[] {
    if (kind === 'taxiOut') {
      this.pendingReadback.set(callsign, kind)
      const via = viaIdents && viaIdents.length ? `via ${viaIdents.join(', ')}` : 'via the parallel'
      return [this.say(`${callsign}, runway ${this.cfg.activeRunway}, taxi ${via}, hold short runway ${this.cfg.activeRunway}`, atSimS)]
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
