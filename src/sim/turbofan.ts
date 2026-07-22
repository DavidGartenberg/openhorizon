/**
 * High-bypass turbofan (Phase 11d) — CFM56-7B26 class, N1-based per the
 * contract's 737 spec. Published anchors: 26,300 lbf (117 kN) static
 * takeoff thrust, idle→takeoff spool ~5–8 s, static TSFC ~0.38 lb/lbf/hr
 * rising to ~0.63 at M0.785 cruise (→ ~2.4 t/h total at a 737-800's
 * ~37.5 kN cruise thrust). Simplifications, recorded: no N2/EGT/bleed
 * model; thrust ∝ (N1 fraction)²; lapse σ^0.85 with a quadratic Mach
 * factor — an envelope model tuned to the published anchor points, same
 * policy as the piston prop tables.
 */
import { RHO0 } from './atmosphere'

export interface JetParams {
  engines: number
  /** Per-engine static SL takeoff thrust, N. */
  staticThrustN: number
  n1IdlePct: number
  n1MaxPct: number
  /** First-order spool time constant, s. */
  spoolTauS: number
  /** Static TSFC, kg/(N·s) — ~0.38 lb/lbf/hr class. */
  tsfcKgPerNs: number
  /** TSFC multiplier slope with Mach: tsfc·(1 + k·M). */
  tsfcMachSlope: number
  /** Density-ratio lapse exponent: σ^e. */
  lapseExp: number
  /** Thrust Mach factor: (1 − a·M + b·M²). */
  machA: number
  machB: number
  /** Windmilling drag: CD·A (m²) of the dead fan disc. */
  windmillCdA: number
}

export const CFM56_7B26: JetParams = {
  engines: 2,
  staticThrustN: 117_000,
  n1IdlePct: 20,
  n1MaxPct: 100,
  spoolTauS: 2.2,
  tsfcKgPerNs: 1.07e-5, // 0.38 lb/lbf/hr
  tsfcMachSlope: 0.72,
  lapseExp: 0.85,
  machA: 0.45,
  machB: 0.11,
  windmillCdA: 0.47, // ~0.25 · 1.89 m² fan disc
}

export interface TurbofanState {
  /** Actual N1, % (all engines assumed matched). */
  n1Pct: number
  /** Total thrust, N (all engines). */
  thrustN: number
  /** Total fuel flow, kg/s (all engines). */
  fuelFlowKgS: number
}

export function makeTurbofanState(jet: JetParams): TurbofanState {
  return { n1Pct: jet.n1IdlePct, thrustN: 0, fuelFlowKgS: 0 }
}

/** Max available TOTAL thrust at a flight condition (all engines). */
export function thrustAvailableN(rho: number, mach: number, jet: JetParams): number {
  const sigma = rho / RHO0
  const machFactor = Math.max(1 - jet.machA * mach + jet.machB * mach * mach, 0.2)
  return jet.engines * jet.staticThrustN * Math.pow(sigma, jet.lapseExp) * machFactor
}

/** Total fuel flow for a given TOTAL thrust at Mach (TSFC model). */
export function fuelFlowKgS(thrustN: number, mach: number, jet: JetParams): number {
  const tsfc = jet.tsfcKgPerNs * (1 + jet.tsfcMachSlope * mach)
  return Math.max(thrustN, 0) * tsfc
}

/** Windmilling drag of dead engines (per whole aircraft), N. */
export function windmillDragN(rho: number, tasMs: number, jet: JetParams): number {
  return 0.5 * rho * tasMs * tasMs * jet.windmillCdA * jet.engines
}

export function stepTurbofan(
  st: TurbofanState,
  dt: number,
  throttle01: number,
  rho: number,
  mach: number,
  running: boolean,
  jet: JetParams,
): void {
  const thr = Math.min(Math.max(throttle01, 0), 1)
  const n1Cmd = running ? jet.n1IdlePct + thr * (jet.n1MaxPct - jet.n1IdlePct) : 0
  // First-order spool (same τ both ways — honest simplification; real
  // engines accelerate slower near idle and decelerate faster).
  st.n1Pct += ((n1Cmd - st.n1Pct) / jet.spoolTauS) * dt
  st.n1Pct = Math.min(Math.max(st.n1Pct, 0), jet.n1MaxPct)

  if (!running) {
    st.thrustN = 0
    st.fuelFlowKgS = 0
    return
  }
  const frac = Math.max((st.n1Pct - jet.n1IdlePct) / (jet.n1MaxPct - jet.n1IdlePct), 0)
  const tMax = thrustAvailableN(rho, mach, jet)
  // N1²-shaped thrust with a small real idle-thrust floor (~2.5%).
  st.thrustN = tMax * Math.max(frac * frac, 0.025)
  st.fuelFlowKgS = fuelFlowKgS(st.thrustN, mach, jet)
}
