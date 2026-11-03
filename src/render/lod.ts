/**
 * Distance level-of-detail with hysteresis (plan step 17): detail that is a
 * few pixels across far away (airport buildings and service vehicles, AI
 * pattern aircraft) stops costing draw calls, without popping back and forth
 * at the boundary.
 */
export const LOD = {
  /** Airport facilities (terminals, hangars, services): hide beyond, show within. */
  facilities: { hideAboveM: 8500, showBelowM: 7500 },
  /** AI pattern aircraft. */
  aiShip: { hideAboveM: 12_500, showBelowM: 11_500 },
} as const

export function lodVisible(wasVisible: boolean, distanceM: number, band: { hideAboveM: number; showBelowM: number }): boolean {
  if (wasVisible) return !(distanceM > band.hideAboveM)
  return distanceM < band.showBelowM
}
