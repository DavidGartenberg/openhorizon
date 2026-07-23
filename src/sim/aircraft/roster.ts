/**
 * Tier-B roster aggregator (12c/12d): the 15 curated proving types
 * (roster-core) plus the 12d expansion (roster-ext). One list, one API.
 */
import type { AircraftParams } from './params'
import { deriveParams } from './derive'
import { CORE_ROSTER } from './roster-core'
import { ROSTER_EXT } from './roster-ext'

export type { RosterTargets, RosterEntry } from './roster-core'
export { variant } from './roster-core'

export const ROSTER = [...CORE_ROSTER, ...ROSTER_EXT]

const paramsCache = new Map<string, AircraftParams>()

export function rosterParams(designator: string): AircraftParams | null {
  const cached = paramsCache.get(designator)
  if (cached) return cached
  const entry = ROSTER.find((r) => r.spec.designator === designator)
  if (!entry) return null
  const p = deriveParams(entry.spec, entry.opts)
  paramsCache.set(designator, p)
  return p
}

export function rosterDesignators(): string[] {
  return ROSTER.map((r) => r.spec.designator)
}
