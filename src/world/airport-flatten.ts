/**
 * How a whole airport sits on the terrain (pure). A real airport is level
 * ground: X-Plane flattens the terrain under its pavement. The runways already
 * carry their own corridor flattening (math/geo flattenForRunway); this adds
 * one level disk around the airport — expressed as a zero-length "runway" so the
 * terrain worker and the physics sampler need no new code — so the taxiways,
 * aprons and terminals beside the runways lie on the same ground as the runways
 * instead of sinking into (or hovering over) the bare elevation model.
 */
import type { AirportData } from './airports'

const FT = 0.3048
/** Inner flat radius = halfWidth + 40 m in flattenForRunway, so a disk of radius R uses halfWidth R − 40. */
export const FLAT_INNER_MARGIN_M = 40

/** The level the airport's pavement lies at: the mean of its runway end elevations (m). */
export function airportFieldElevationM(ap: Pick<AirportData, 'r' | 'e'>): number {
  const ends = ap.r.flatMap((r) => [r.e1, r.e2]).filter(Number.isFinite)
  if (!ends.length) return (Number.isFinite(ap.e) ? ap.e : 0) * FT
  return (ends.reduce((a, b) => a + b, 0) / ends.length) * FT
}

/** Radius (m) of the level area around the airport reference, from its size. */
export function airportFlatRadiusM(ap: Pick<AirportData, 'r' | 't'>): number {
  const longest = Math.max(0, ...ap.r.map((r) => (Number.isFinite(r.l) ? r.l : 0))) * FT
  if (longest < 400) return 0                                   // a strip or heli pad: runway corridor only
  const commercial = ap.t >= 1 && longest >= 2100
  return commercial ? Math.min(2600, Math.max(900, 0.4 * longest + 600)) : Math.min(700, Math.max(250, 0.2 * longest + 250))
}

export interface FlatDisk { lat: number; lon: number; elevM: number; halfWidthM: number }

/** The airport's level disk as a zero-length "runway" (null when it needs none). */
export function airportFlatDisk(ap: Pick<AirportData, 'r' | 't' | 'e' | 'la' | 'lo'>): FlatDisk | null {
  const radius = airportFlatRadiusM(ap)
  if (radius <= 0) return null
  return { lat: ap.la, lon: ap.lo, elevM: airportFieldElevationM(ap), halfWidthM: Math.max(1, radius - FLAT_INNER_MARGIN_M) }
}
