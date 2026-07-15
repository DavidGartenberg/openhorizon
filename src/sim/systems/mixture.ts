/**
 * EGT-vs-mixture model (Phase 3 §8): replaces Phase 1's simple pass/fail
 * `mixturePowerFactor` (propulsion.ts) with a real lean-technique curve for
 * the cockpit's lean-assist page. EGT rises as mixture leans from full
 * rich, peaks at a "best economy"-style point, then falls further as
 * mixture goes past peak toward idle cutoff — a genuine, findable local
 * maximum, not a monotonic curve. This module only produces the EGT
 * *indication*; it does not change engine power/thrust (that stays in
 * propulsion.ts's `mixturePowerFactor`, untouched by this task).
 *
 * Mixture convention matches `Controls.mixture` in aircraft.ts: 1 = full
 * rich, 0 = idle cutoff. `LEAN_CUTOFF` mirrors propulsion.ts's
 * `mixturePowerFactor` cutoff (0.12) — below that the engine can't sustain
 * combustion and EGT collapses toward ambient (engine effectively dying).
 *
 * NOTE ON SOURCING: exact peak-EGT temperature and the mixture fraction at
 * which peak occurs are not published in this repo's POH excerpt and vary
 * with altitude/power in a real IO-360. The constants below are
 * representative textbook lean-technique values for a normally-aspirated
 * Lycoming (peak EGT commonly cited ~1350°F/732°C at a mixture setting
 * partway between full rich and idle cutoff) and are flagged as
 * assumptions rather than POH-verified numbers.
 */

const LEAN_CUTOFF = 0.12 // matches propulsion.ts mixturePowerFactor's cutoff
const EGT_PEAK_MIXTURE = 0.35 // mixture fraction at which EGT peaks (flagged assumption)
const EGT_PEAK_C = 732 // ≈1350°F, representative peak EGT (flagged assumption)
const EGT_FULL_RICH_C = 620 // representative full-rich cruise EGT (flagged assumption)
const AMBIENT_EGT_C = 15 // engine not combusting / cold, reads ~OAT (flagged assumption)

// Curvature chosen so the parabola passes through (mixture=1, EGT_FULL_RICH_C).
const EGT_CURVATURE = (EGT_PEAK_C - EGT_FULL_RICH_C) / (1 - EGT_PEAK_MIXTURE) ** 2

/** EGT (°C) for a given mixture setting, full rich (1) → idle cutoff (0). */
export function egtC(mixture: number): number {
  const m = Math.min(Math.max(mixture, 0), 1)
  if (m <= LEAN_CUTOFF) return AMBIENT_EGT_C
  const d = m - EGT_PEAK_MIXTURE
  const modeled = EGT_PEAK_C - EGT_CURVATURE * d * d
  return Math.max(modeled, AMBIENT_EGT_C)
}
