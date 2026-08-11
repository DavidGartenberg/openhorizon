/**
 * Replay plot builder (16d) — pure. Consumes recorder samples (§18's
 * rule: the debrief layer reads ONLY recorded samples, never live
 * state) and produces the viewer's plots: plan-view track relative to
 * the final sample, cumulative-distance altitude profile, and the
 * touchdown index (last airborne→ground transition in the window).
 */
import type { FlightSample } from './recorder'

export interface ReplayPlots {
  /** Plan view, meters east/north of the FINAL sample. */
  plan: Array<{ e: number; n: number; aglFt: number }>
  /** Profile: cumulative distance flown (m) vs altitude. */
  profile: Array<{ distM: number; altFt: number; onGround: boolean }>
  touchdownIdx: number | null
  totalDistM: number
}

const M_PER_DEG_LAT = 111_320

/** A single inter-sample hop larger than this is a respawn teleport, not
 *  flight (10 Hz samples: 500 m/hop = 5,000 m/s — far beyond any aircraft
 *  here, far below any spawn jump). An EGLL acceptance flight's profile
 *  axis read 4,652.8 nm because a California→London respawn entered the
 *  cumulative-distance sum as one giant fake segment. */
const TELEPORT_HOP_M = 500

export function buildReplayPlots(samples: ReadonlyArray<FlightSample>, windowS = 240): ReplayPlots {
  if (samples.length === 0) return { plan: [], profile: [], touchdownIdx: null, totalDistM: 0 }
  const endT = samples[samples.length - 1]!.t
  const start = samples.findIndex((s) => s.t >= endT - windowS)
  let win = samples.slice(start < 0 ? 0 : start)
  const ref = win[win.length - 1]!
  const mLon = M_PER_DEG_LAT * Math.cos((ref.lat * Math.PI) / 180)
  // Keep only the trailing contiguous run: walk back from the end and cut
  // at the first teleport-sized hop.
  for (let i = win.length - 1; i > 0; i--) {
    const hop = Math.hypot(
      (win[i]!.lon - win[i - 1]!.lon) * mLon,
      (win[i]!.lat - win[i - 1]!.lat) * M_PER_DEG_LAT,
    )
    if (hop > TELEPORT_HOP_M) { win = win.slice(i); break }
  }

  const plan: ReplayPlots['plan'] = []
  const profile: ReplayPlots['profile'] = []
  let dist = 0
  let touchdownIdx: number | null = null
  for (let i = 0; i < win.length; i++) {
    const s = win[i]!
    const e = (s.lon - ref.lon) * mLon
    const n = (s.lat - ref.lat) * M_PER_DEG_LAT
    if (i > 0) {
      const p = win[i - 1]!
      dist += Math.hypot((s.lon - p.lon) * mLon, (s.lat - p.lat) * M_PER_DEG_LAT)
      if (s.onGround && !p.onGround) touchdownIdx = i
    }
    plan.push({ e, n, aglFt: s.aglFt })
    profile.push({ distM: dist, altFt: s.altFt, onGround: s.onGround })
  }
  return { plan, profile, touchdownIdx, totalDistM: dist }
}
