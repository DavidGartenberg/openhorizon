/**
 * Showcase camera: a scripted cinematic cycle around the airplane — slow
 * orbits from different angles, heights and distances, cross-faded so the
 * camera never jumps. Pure (time in, orbit parameters out).
 */
export interface ShowcaseShot { azimuth: number; elevation: number; distanceScale: number }

/** Seconds each shot holds before blending to the next. */
export const SHOT_SECONDS = 14
const BLEND_SECONDS = 3

/** Start pose of each shot and how fast its azimuth drifts (rad/s). */
const SHOTS: ReadonlyArray<{ az: number; el: number; d: number; drift: number }> = [
  { az: 2.5, el: 0.16, d: 1.0, drift: 0.09 },   // classic three-quarter rear
  { az: 1.3, el: 0.07, d: 0.62, drift: -0.07 },  // low, close, nose-on
  { az: -1.2, el: 0.62, d: 1.35, drift: 0.06 },  // high overview
  { az: 3.4, el: 0.1, d: 0.55, drift: 0.11 },    // tail-low sweep
  { az: 2.6, el: 0.22, d: 0.85, drift: -0.08 },  // beam-on
]

const smooth = (x: number): number => x * x * (3 - 2 * x)

function pose(i: number, local: number): ShowcaseShot {
  const s = SHOTS[((i % SHOTS.length) + SHOTS.length) % SHOTS.length]!
  return { azimuth: s.az + s.drift * local, elevation: s.el + 0.03 * Math.sin(local * 0.5), distanceScale: s.d }
}

/** The camera pose `t` seconds into the cycle. */
export function showcaseShot(t: number): ShowcaseShot {
  const tt = Math.max(t, 0)
  const i = Math.floor(tt / SHOT_SECONDS)
  const local = tt - i * SHOT_SECONDS
  const here = pose(i, local)
  const toGo = SHOT_SECONDS - local
  if (toGo >= BLEND_SECONDS) return here
  // Blend into the next shot's opening pose over the last BLEND_SECONDS.
  const k = smooth(1 - toGo / BLEND_SECONDS)
  const next = pose(i + 1, 0) // the next shot's opening pose
  // Shortest way around the circle (adjacent shots are < π apart, so it never flips).
  let da = next.azimuth - here.azimuth
  da = ((da + Math.PI * 3) % (Math.PI * 2)) - Math.PI
  return {
    azimuth: here.azimuth + da * k,
    elevation: here.elevation + (next.elevation - here.elevation) * k,
    distanceScale: here.distanceScale + (next.distanceScale - here.distanceScale) * k,
  }
}
