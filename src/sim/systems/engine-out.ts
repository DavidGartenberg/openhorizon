/**
 * Engine-out asymmetry for multi-engine aircraft.
 *
 * With an engine stopped, the live engine's thrust sits off the centreline,
 * and the dead one's windmilling drag adds yaw on the other side. Both turn
 * the nose toward the dead engine:
 *   N = −y_live·T_live + y_dead·D_dead   (body z down: + = nose right)
 * so it takes rudder (and a little bank toward the live engine) to fly
 * straight. Below Vmc the rudder runs out. Engines sit at ≈16% of the span
 * from the centreline (737-800 ±5.75 m on a 34.3 m span; light twins and
 * turboprops ≈ the same fraction).
 */
export const ENGINE_ARM_SPAN_FRACTION = 0.16
/** Four-engine types lose a side's pair: inboard + outboard average ≈25.5%
 *  of the span out (747-400 ±11.9 / ±20.9 m on 64.4 m; A380, A340 alike). */
export const QUAD_GROUP_ARM_SPAN_FRACTION = 0.255

/**
 * Yaw moment (N·m, + nose right) from an engine failure.
 * @param deadSide −1 left engine(s) out, +1 right, 0 none (or all)
 * @param liveThrustN the live thrust no longer balanced across the
 *   centreline (N): a twin's live engine; for more engines, the opposite
 *   side's share
 * @param deadDragN windmilling drag of the dead engine(s) (N, positive)
 * @param engines engine count (four or more: the pair's wider arm)
 */
export function engineOutYawNm(deadSide: -1 | 0 | 1, liveThrustN: number, deadDragN: number, spanM: number, engines = 2): number {
  if (deadSide === 0) return 0
  const arm = (engines >= 4 ? QUAD_GROUP_ARM_SPAN_FRACTION : ENGINE_ARM_SPAN_FRACTION) * spanM
  const yLive = -deadSide * arm, yDead = deadSide * arm
  return -yLive * liveThrustN + yDead * Math.max(deadDragN, 0)
}

/** Which side is dead from per-side running flags (left = engine 1). */
export function deadSideOf(leftRunning: boolean, rightRunning: boolean): -1 | 0 | 1 {
  if (leftRunning === rightRunning) return 0
  return leftRunning ? 1 : -1
}
