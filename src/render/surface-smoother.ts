/**
 * Visual control-surface actuator. The sim publishes pedal/stick demand that
 * can step between frames (keyboard, gamepad dead-zone edges, SAS nudges);
 * a real surface is driven by hydraulics or cables with finite speed. The
 * follower below is first-order lag with a hard slew limit, so a rudder
 * sweeps cleanly instead of snapping or chattering. Visual only: it never
 * feeds back into the flight model.
 */
export function stepSurface(current: number, target: number, dt: number, rateRadS = 1.1, tauS = 0.08): number {
  if (!(dt > 0)) return current
  const lag = 1 - Math.exp(-dt / tauS)
  const wanted = (target - current) * lag
  const limit = rateRadS * dt
  return current + Math.max(-limit, Math.min(limit, wanted))
}

/** Stateful follower driven by wall-clock time. A long gap (tab hidden,
 *  aircraft swap, respawn) snaps rather than sweeping through the pause. */
export function makeSurfaceSmoother(rateRadS = 1.1, tauS = 0.08, now: () => number = () => performance.now()): (target: number) => number {
  let value = 0
  let last = NaN
  return (target: number): number => {
    const t = now()
    const goal = Number.isFinite(target) ? target : 0
    const dt = (t - last) / 1000
    value = !(dt >= 0 && dt <= 0.5) ? goal : stepSurface(value, goal, Math.min(dt, 0.1), rateRadS, tauS)
    last = t
    return value
  }
}
