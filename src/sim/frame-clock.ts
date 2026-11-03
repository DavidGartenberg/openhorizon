/**
 * Who advances the sim, and by how much.
 *
 * requestAnimationFrame drives every frame of a visible page, however slow
 * the machine. The metronome worker (15e) exists for hidden tabs, whose rAF
 * stops and whose page timers are throttled to a wake a minute; it steps the
 * sim there instead, near real time.
 *
 * It used to step visible pages too, whenever rAF had not fired for 400 ms:
 * on any machine slower than that per frame, it rendered extra frames
 * between the rAF callbacks, so the main thread never went idle. Worse, a
 * rAF timestamp is taken when the frame is scheduled, which can be before a
 * metronome step's performance.now(), so rAF intervals came out tiny or
 * negative. The dynamic-resolution controller then threw them away (or
 * believed them) and stopped adapting exactly where it was needed most.
 */

/** Seconds to step from a metronome tick, or null to leave it to rAF. */
export function metronomeStepS(nowMs: number, lastRafAtMs: number, lastFrameMs: number, visible: boolean): number | null {
  if (visible) return null // rAF drives a visible page
  if (nowMs - lastRafAtMs < 400) return null
  const elapsed = Math.min((nowMs - lastFrameMs) / 1000, 1)
  return elapsed >= 0.2 ? elapsed : null
}

/** A rAF frame's interval (ms). Clocks can disagree by a little when the
 *  page has just come back from the metronome: never negative. */
export function rafIntervalMs(nowMs: number, lastFrameMs: number): number {
  return Math.max(nowMs - lastFrameMs, 0)
}
