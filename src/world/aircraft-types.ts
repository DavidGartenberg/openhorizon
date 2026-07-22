/**
 * ICAO Doc-8643 type-designator registry, client side (Phase 12a).
 * Loads `/api/aircraft-types.json` once (same pattern as airports):
 * { DES: [desc, wtc, name] } — desc like "L2J" (kind letter, engine
 * count, engine-type letter), wtc L/M/H/J.
 *
 * Unknown designators resolve to an honest generic ("-0-"/"?"), never a
 * guessed specific type — consumers (archetype mapping, traffic labels)
 * decide how to render "unknown".
 */

export interface AircraftTypeInfo {
  designator: string
  /** Raw Doc-8643 description code, e.g. "L2J", "H1T", "L0-". */
  desc: string
  /** Wake turbulence category: L, M, H, J (super), or '-'. */
  wtc: string
  /** "MANUFACTURER, Model" — empty when the mirror has no name row. */
  name: string
  known: boolean
}

export type AircraftKind =
  | 'landplane' | 'seaplane' | 'amphibian' | 'helicopter' | 'gyrocopter'
  | 'tiltrotor' | 'glider' | 'airship' | 'balloon' | 'unknown'

export interface ParsedDesc {
  kind: AircraftKind
  engines: number
  engineType: 'jet' | 'turboprop' | 'piston' | 'electric' | 'rocket' | 'none' | 'unknown'
}

const KIND_BY_LETTER: Record<string, AircraftKind> = {
  L: 'landplane', S: 'seaplane', A: 'amphibian', H: 'helicopter',
  G: 'gyrocopter', T: 'tiltrotor', D: 'airship', B: 'balloon',
  // 'P' (powered lift) and 'V' (VTOL) appear rarely in mirrors — treat as
  // tiltrotor-ish vertical machines for silhouette purposes.
  P: 'tiltrotor', V: 'tiltrotor',
}

const ENGINE_BY_LETTER: Record<string, ParsedDesc['engineType']> = {
  J: 'jet', T: 'turboprop', P: 'piston', E: 'electric', R: 'rocket',
}

/** Decode a Doc-8643 description code ("L2J") into structured facts. */
export function parseDesc(desc: string): ParsedDesc {
  const kindLetter = desc[0] ?? '-'
  const engines = /^[0-9]$/.test(desc[1] ?? '') ? Number(desc[1]) : 0
  const engineLetter = desc[2] ?? '-'
  let kind = KIND_BY_LETTER[kindLetter] ?? 'unknown'
  // Gliders are encoded as landplanes with zero engines in this mirror
  // (e.g. GLID = "L0-"); the zero-engine fact is the honest discriminator.
  if (kind === 'landplane' && engines === 0) kind = 'glider'
  const engineType = engines === 0 ? 'none' : ENGINE_BY_LETTER[engineLetter] ?? 'unknown'
  return { kind, engines, engineType }
}

let table: Map<string, [string, string, string]> | null = null
let loadStarted = false

export function loadAircraftTypes(): void {
  if (loadStarted) return
  loadStarted = true
  fetch('/api/aircraft-types.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((data: Record<string, [string, string, string]>) => {
      table = new Map(Object.entries(data))
    })
    .catch((err) => console.warn('aircraft types unavailable:', err))
}

export function aircraftTypesLoaded(): boolean {
  return table !== null
}

export function aircraftTypeCount(): number {
  return table ? table.size : 0
}

const UNKNOWN: Omit<AircraftTypeInfo, 'designator'> = { desc: '-0-', wtc: '-', name: '', known: false }

export function typeInfo(designator: string): AircraftTypeInfo {
  const d = (designator || '').trim().toUpperCase()
  const row = table?.get(d)
  if (!row) return { designator: d || 'ZZZZ', ...UNKNOWN }
  return { designator: d, desc: row[0], wtc: row[1], name: row[2], known: true }
}
