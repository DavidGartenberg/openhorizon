/**
 * Fowler-flap track schedule (user goal: "flaps extend out, THEN down").
 *
 * Real trailing-edge flaps ride hooked tracks: the forward run is nearly
 * straight and slopes only slightly down, so the first half of the lever
 * travel is mostly AFT TRANSLATION (chord/area growth — the slot opens);
 * the aft end of the track hooks down and delivers the large rotation
 * for landing settings. (Boeing 737 triple-slotted Fowler: straight
 * early track, hooked aft section — see the patent/track literature
 * cited in PROGRESS.) This pure function is that schedule, shared by
 * every animated builder so all fleet flaps move the same honest way.
 *
 * frac ∈ [0,1] = lever travel fraction (flapsDeg / max).
 *   ext  — aft translation fraction: ≈90% complete by half travel.
 *   rot  — rotation fraction: starts late (~35% travel), full at 1.
 *   drop — small downward offset that follows the track's slope.
 */
export interface FowlerPose {
  ext: number
  rot: number
  drop: number
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

export function fowlerPose(frac: number): FowlerPose {
  const f = Math.min(1, Math.max(0, frac))
  const ext = smoothstep(0, 0.55, f)
  const rot = smoothstep(0.35, 1, f)
  // Track slope: a little drop accompanies the extension, more with rotation.
  const drop = 0.25 * ext + 0.75 * rot
  return { ext, rot, drop }
}
