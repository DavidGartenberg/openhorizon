/**
 * METAR wind → sea state (13e), pure. Coarse Beaufort-flavored mapping:
 * light air leaves the surface glassy; wave slope grows ~linearly with
 * wind and saturates in storm winds; whitecaps appear around 15 kt and
 * are fully developed by ~25 kt. Feeds the ocean shader's slope scale
 * and foam mix — spec-coarseness visuals, not a wave-spectrum model.
 */

export interface SeaState {
  /** Multiplier on the analytic wave slope field (0.12 glassy … 1.7). */
  slopeScale: number
  /** Whitecap coverage 0–1 (0 below ~15 kt, 1 by ~25 kt). */
  whitecap: number
}

export function seaState(windMs: number): SeaState {
  const slopeScale = Math.min(Math.max(windMs / 10, 0.12), 1.7)
  const whitecap = Math.min(Math.max((windMs - 7.7) / 5.2, 0), 1)
  return { slopeScale, whitecap }
}
