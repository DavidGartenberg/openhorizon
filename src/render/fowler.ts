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
  // Continuous handoff at exactly half travel (user: the dead band read
  // as the flap "switching angle"): extension completes as rotation
  // begins — no gap, no overlap.
  const ext = smoothstep(0, 0.5, f)
  const rot = smoothstep(0.5, 1, f)
  // Track slope: a little drop accompanies the extension, more with rotation.
  const drop = 0.25 * ext + 0.75 * rot
  return { ext, rot, drop }
}

/** Spoileron mixing (real flight-spoiler behavior): the down-going
 *  wing's panel rises with roll input on top of the speedbrake setting.
 *  side: 0 = left panel, 1 = right panel. Returns rise fraction [0,1];
 *  multiply by the deploy angle (≈60° full). */
export function spoileronRise(spoilerFrac: number, roll: number, side: 0 | 1): number {
  const boost = side === 0 ? Math.max(0, -roll) : Math.max(0, roll)
  return Math.min(1, Math.max(0, spoilerFrac) + boost * 0.35)
}
