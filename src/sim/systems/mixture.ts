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

// Width (in mixture units) above LEAN_CUTOFF over which EGT is blended from
// AMBIENT_EGT_C up to the raw parabola, instead of jumping straight from the
// (still-hot, ~700°C) modeled value to ambient at the cutoff boundary. The
// raw parabola by itself never decays anywhere close to ambient (it's a
// broad curve centered on EGT_PEAK_MIXTURE), so without this taper band the
// engine-dies-below-cutoff transition reads as an instrument-breaking cliff.
// 0.15 is wide enough that the steepest single 0.01-mixture step through the
// band stays well under ~100°C (see engine-start.test.ts's continuity
// check), while staying well clear of EGT_PEAK_MIXTURE so the genuine peak
// is untouched.
const EGT_TAPER_BAND = 0.15

// Curvature chosen so the parabola passes through (mixture=1, EGT_FULL_RICH_C).
const EGT_CURVATURE = (EGT_PEAK_C - EGT_FULL_RICH_C) / (1 - EGT_PEAK_MIXTURE) ** 2

/** Smoothstep: 0 at t=0, 1 at t=1, zero slope at both ends. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

/** EGT (°C) for a given mixture setting, full rich (1) → idle cutoff (0). */
export function egtC(mixture: number): number {
  const m = Math.min(Math.max(mixture, 0), 1)
  if (m <= LEAN_CUTOFF) return AMBIENT_EGT_C

  const d = m - EGT_PEAK_MIXTURE
  const modeled = EGT_PEAK_C - EGT_CURVATURE * d * d

  const taperEnd = LEAN_CUTOFF + EGT_TAPER_BAND
  if (m >= taperEnd) return Math.max(modeled, AMBIENT_EGT_C)

  // Blend smoothly from ambient (at LEAN_CUTOFF) up to the raw parabola (at
  // taperEnd) so EGT falls gradually toward ambient as mixture approaches
  // the cutoff, rather than clamping straight to ambient.
  const t = (m - LEAN_CUTOFF) / EGT_TAPER_BAND
  return AMBIENT_EGT_C + (modeled - AMBIENT_EGT_C) * smoothstep(t)
}
