/**
 * Spawning without airport data (offline, or the airport list is blocked):
 * the aircraft used to stay where it was constructed, at sea level, under
 * the terrain, with the camera inside the ground, so the screen went black.
 * Instead: wait for the FINEST terrain under the default position (coarse
 * rings can sit metres below the surface actually drawn) and park on it.
 * After the wait budget, accept a coarser ring, or sea level if nothing has
 * loaded. The caller re-parks while finer tiles arrive (see `needsRepark`).
 */
export type FallbackSpawn =
  | { kind: 'wait' }
  | { kind: 'terrain'; elevM: number }
  | { kind: 'sea' }

export function chooseFallbackSpawn(fineTerrain: boolean, anyTerrain: boolean, elevM: number, waitedMs: number, budgetMs = 20_000): FallbackSpawn {
  if (fineTerrain && Number.isFinite(elevM)) return { kind: 'terrain', elevM }
  if (waitedMs < budgetMs) return { kind: 'wait' }
  return anyTerrain && Number.isFinite(elevM) ? { kind: 'terrain', elevM } : { kind: 'sea' }
}

/** Re-park a still-stationary fallback spawn when the ground under it moved
 *  (finer terrain arrived) by more than `toleranceM`. */
export function needsRepark(parkedElevM: number, groundElevM: number, groundSpeedKt: number, movedM: number, toleranceM = 0.3): boolean {
  return groundSpeedKt < 1 && movedM < 5 && Number.isFinite(groundElevM) && Math.abs(groundElevM - parkedElevM) > toleranceM
}
