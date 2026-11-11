/**
 * The 737's secondary engine page (lower display): N2, fuel flow, oil pressure / temperature / quantity, vibration.
 *
 * HONESTY NOTE (recorded in PROGRESS.md): the simulator has no jet-engine core, oil or vibration state. Fuel flow is
 * the simulator's own. N2, oil pressure, oil temperature, oil quantity and vibration are MODELED readouts — smooth
 * functions of N1 and outside air temperature using CFM56-7B-class figures (idle N1 ≈ 22 % ↔ N2 ≈ 62 %, takeoff
 * N1 100 % ↔ N2 ≈ 98 %; oil 45–55 psi, 70–95 °C running) — so the page shows a healthy engine; they never fail or
 * respond to anything but thrust. An engine that is not running reads zero (oil temperature follows the air).
 */
export interface JetSecondary { n2Pct: number; oilPressPsi: number; oilTempC: number; oilQtyPct: number; vibN1: number; vibN2: number }

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
export const OIL_QTY_SERVICED_PCT = 80

export function jetSecondary(n1Pct: number, running: boolean, oatC: number): JetSecondary {
  const air = Number.isFinite(oatC) ? oatC : 15
  if (!running || !(n1Pct > 5)) return { n2Pct: 0, oilPressPsi: 0, oilTempC: air, oilQtyPct: OIL_QTY_SERVICED_PCT, vibN1: 0, vibN2: 0 }
  const n1 = clamp(n1Pct, 0, 110)
  const n2 = clamp(62 + ((n1 - 22) * (98 - 62)) / (100 - 22), 55, 106)
  return {
    n2Pct: n2,
    oilPressPsi: clamp(45 + 0.2 * (n2 - 62), 0, 60),
    oilTempC: clamp(70 + 0.7 * (n2 - 62) + 0.2 * (air - 15), air, 140),
    oilQtyPct: OIL_QTY_SERVICED_PCT,
    vibN1: Math.round((0.1 + 0.004 * n1) * 10) / 10,
    vibN2: Math.round((0.1 + 0.003 * n2) * 10) / 10,
  }
}
