/**
 * Spawning without airport data (offline, or the airport list is blocked):
 * the aircraft used to stay where it was constructed, at sea level, under
 * the terrain, with the camera inside the ground, so the screen went black.
 * Instead: wait for the terrain under the default position to load and park
 * on it. If no terrain arrives within the wait budget either, park at sea
 * level, which is at least above the (empty) ground.
 */
export type FallbackSpawn =
  | { kind: 'wait' }
  | { kind: 'terrain'; elevM: number }
  | { kind: 'sea' }

export function chooseFallbackSpawn(hasTerrain: boolean, elevM: number, waitedMs: number, budgetMs = 20_000): FallbackSpawn {
  if (hasTerrain && Number.isFinite(elevM)) return { kind: 'terrain', elevM }
  return waitedMs >= budgetMs ? { kind: 'sea' } : { kind: 'wait' }
}
