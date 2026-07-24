/**
 * Light flash timing (Phase 13c) — pure functions of sim time so the
 * render layer stays dumb and the cadences are testable exactly.
 *
 * Cadences (documented sources):
 *  - Rotating red beacon: ~45 cycles/min with a broad sweep (modeled as
 *    35% duty) — inside FAR 23.1401's 40–100 anticollision band.
 *  - White strobes: the classic capacitor double-flash — two 80 ms
 *    pulses 220 ms apart, repeating every 1.4 s (~86 pulses/min).
 *  - Civil land airport beacon: alternating white/green flashes,
 *    ~26/min total (AIM 2-1-9: 24–30), 180 ms perceived sweep.
 */

export const BEACON_PERIOD_S = 60 / 45
export const STROBE_PERIOD_S = 1.4
export const AIRPORT_BEACON_PERIOD_S = 60 / 13 // white+green pair

/** Rotating red beacon: on during the first 35% of each cycle. */
export function beaconOn(t: number): boolean {
  const ph = ((t % BEACON_PERIOD_S) + BEACON_PERIOD_S) % BEACON_PERIOD_S
  return ph < BEACON_PERIOD_S * 0.35
}

/** Wingtip strobes: double pulse at [0, 0.08) and [0.22, 0.30) each period. */
export function strobeOn(t: number): boolean {
  const ph = ((t % STROBE_PERIOD_S) + STROBE_PERIOD_S) % STROBE_PERIOD_S
  return ph < 0.08 || (ph >= 0.22 && ph < 0.3)
}

/** Civil airport beacon: 'white' then 'green' half a period later. */
export function airportBeacon(t: number): 'white' | 'green' | null {
  const T = AIRPORT_BEACON_PERIOD_S
  const ph = ((t % T) + T) % T
  if (ph < 0.18) return 'white'
  if (ph >= T / 2 && ph < T / 2 + 0.18) return 'green'
  return null
}
