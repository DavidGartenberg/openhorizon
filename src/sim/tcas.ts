/**
 * TCAS II-style traffic alerting (§14, Phase 7a). Tau-based range tests
 * with sensitivity levels by altitude, DMOD distance floors for slow
 * closures, and ZTHR vertical gating — the published TCAS II v7.1 table
 * values (cited inline). On the C172 this runs in `taOnly` mode, matching
 * the real G1000 TAS presentation (§14); full RAs are for the Phase-10
 * 737. Pure module: positions/velocities in, typed alerts out; the UI/audio
 * layer speaks `aural` when `newAural` is set.
 */

export interface TcasOwnship {
  altFt: number
  aglFt: number
  vsFpm: number
}

export interface TcasTrack {
  id: string
  relNorthM: number
  relEastM: number
  relVnMs: number // intruder velocity minus ownship velocity
  relVeMs: number
  altFt: number
  vsFpm: number
}

export type TcasLevel = 'NONE' | 'PROX' | 'TA' | 'RA' | 'CLEAR'

export interface TcasOutput {
  level: TcasLevel
  aural?: string
  newAural: boolean
  raSense?: 'CLIMB' | 'DESCEND'
  tracks: Array<{ id: string; level: TcasLevel; relAltFt: number; rangeM: number }>
}

/** Published TCAS II sensitivity-level table (TA tau / RA tau seconds).
 *  SL2 (below 1000 AGL) is TA-only — RAs are inhibited close to the
 *  ground in the real system too. */
export function sensitivityLevel(altFt: number, aglFt: number): { sl: number; taTauS: number; raTauS: number | null } {
  if (aglFt < 1000) return { sl: 2, taTauS: 20, raTauS: null }
  if (aglFt < 2350) return { sl: 3, taTauS: 25, raTauS: 15 }
  if (altFt < 5000) return { sl: 4, taTauS: 30, raTauS: 20 }
  if (altFt < 10000) return { sl: 5, taTauS: 40, raTauS: 25 }
  if (altFt < 20000) return { sl: 6, taTauS: 45, raTauS: 30 }
  return { sl: 7, taTauS: 48, raTauS: 35 }
}

/** DMOD floors (meters) by SL — published values in nm: TA 0.30/0.33/0.48/
 *  0.75/1.0/1.3, RA –/0.20/0.35/0.55/0.80/1.10 for SL2..SL7. */
function dmodM(sl: number): { ta: number; ra: number } {
  const NM = 1852
  switch (sl) {
    case 2: return { ta: 0.3 * NM, ra: 0 }
    case 3: return { ta: 0.33 * NM, ra: 0.2 * NM }
    case 4: return { ta: 0.48 * NM, ra: 0.35 * NM }
    case 5: return { ta: 0.75 * NM, ra: 0.55 * NM }
    case 6: return { ta: 1.0 * NM, ra: 0.8 * NM }
    default: return { ta: 1.3 * NM, ra: 1.1 * NM }
  }
}

/** Vertical thresholds, ft: TA 850 (1200 above FL200), RA 600. */
function zthrFt(sl: number): { ta: number; ra: number } {
  return { ta: sl >= 7 ? 1200 : 850, ra: 600 }
}

interface TrackState {
  level: TcasLevel
}

export class TcasComputer {
  private readonly states = new Map<string, TrackState>()
  private lastAural: string | undefined
  private clearPending = false

  constructor(private readonly cfg: { taOnly: boolean }) {}

  /** Tracked hysteresis states (14c testability). */
  get trackedCount(): number {
    return this.states.size
  }

  step(dt: number, own: TcasOwnship, tracks: TcasTrack[]): TcasOutput {
    void dt
    // Evict states for tracks no longer in the input (14c): a departed
    // intruder must not bequeath its widened hysteresis gate to a later
    // track reusing the id — live ADS-B ids churn every poll.
    if (this.states.size > 0) {
      const inputIds = new Set(tracks.map((t) => t.id))
      for (const id of this.states.keys()) {
        if (!inputIds.has(id)) this.states.delete(id)
      }
    }
    const { sl, taTauS, raTauS } = sensitivityLevel(own.altFt, own.aglFt)
    const dmod = dmodM(sl)
    const zthr = zthrFt(sl)
    let worst: TcasLevel = 'NONE'
    let raSense: 'CLIMB' | 'DESCEND' | undefined
    const outTracks: TcasOutput['tracks'] = []
    let anyActive = false

    for (const t of tracks) {
      const range = Math.hypot(t.relNorthM, t.relEastM)
      const closure = range > 1 ? -(t.relNorthM * t.relVnMs + t.relEastM * t.relVeMs) / range : 0
      const tau = closure > 0.5 ? range / closure : Infinity
      const dz = t.altFt - own.altFt
      const relVsFpm = t.vsFpm - own.vsFpm
      const tauForVert = Number.isFinite(tau) ? Math.min(tau, 60) : 0
      const dzAtCpa = dz + (relVsFpm / 60) * tauForVert
      const vertThreat = (limit: number) => Math.abs(dz) < limit || Math.abs(dzAtCpa) < limit

      const prev = this.states.get(t.id)?.level ?? 'NONE'
      // Hysteresis RETAINS the level already held — it must never promote
      // early (an active TA widening the RA gate fired RAs 5 s soon).
      const taHyst = prev === 'TA' || prev === 'RA' ? 1.2 : 1.0
      const raHyst = prev === 'RA' ? 1.2 : 1.0

      let level: TcasLevel = 'NONE'
      const raRangeHit = raTauS !== null && (tau < raTauS * raHyst || range < dmod.ra * raHyst)
      const taRangeHit = tau < taTauS * taHyst || range < dmod.ta * taHyst
      if (!this.cfg.taOnly && raRangeHit && vertThreat(zthr.ra)) level = 'RA'
      else if (taRangeHit && vertThreat(zthr.ta)) level = 'TA'
      else if (range < 6 * 1852 && Math.abs(dz) < 1200) level = 'PROX'

      this.states.set(t.id, { level })
      outTracks.push({ id: t.id, level, relAltFt: dz, rangeM: range })
      if (level === 'TA' || level === 'RA') anyActive = true
      if (level === 'RA' && worst !== 'RA') {
        worst = 'RA'
        // Sense: escape away from where the intruder will be at CPA.
        raSense = dzAtCpa < 0 && dz < 0 ? 'CLIMB' : dzAtCpa >= 0 ? 'DESCEND' : 'CLIMB'
      } else if (level === 'TA' && worst === 'NONE') worst = 'TA'
      else if (level === 'PROX' && worst === 'NONE') worst = 'PROX'
    }

    // CLEAR OF CONFLICT: one announcement when the last TA/RA ends.
    if (anyActive) this.clearPending = true
    let level: TcasLevel = worst
    if (!anyActive && this.clearPending) {
      this.clearPending = false
      level = 'CLEAR'
    }

    const aural =
      level === 'RA' ? (raSense === 'CLIMB' ? 'CLIMB, CLIMB' : 'DESCEND, DESCEND')
      : level === 'TA' ? 'TRAFFIC, TRAFFIC'
      : level === 'CLEAR' ? 'CLEAR OF CONFLICT'
      : undefined
    const newAural = aural !== undefined && aural !== this.lastAural
    this.lastAural = aural
    return { level, aural, newAural, raSense, tracks: outTracks }
  }
}
