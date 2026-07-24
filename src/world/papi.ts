/**
 * PAPI core (Phase 13d) — pure. Standard 4-box PAPI for a 3° path:
 * per-unit setting angles 2.5/2.83/3.17/3.5° (FAA AIM 2-1-2); a unit
 * shows WHITE when the observer sits above its setting angle, RED
 * below. On slope → 2W2R; each transition is exact at the unit angle.
 * The render layer colors real light points from these functions using
 * the camera's elevation angle to the array.
 */

export const PAPI_ANGLES_DEG: readonly number[] = [2.5, 2.83, 3.17, 3.5]

/** Elevation angle (deg) from the array to an observer. */
export function papiAngleDeg(horizDistM: number, heightM: number): number {
  return (Math.atan2(heightM, horizDistM) * 180) / Math.PI
}

/** How many units show white (0–4) at a given approach angle. */
export function papiWhiteCount(angleDeg: number): number {
  let n = 0
  for (const a of PAPI_ANGLES_DEG) if (angleDeg > a) n++
  return n
}
