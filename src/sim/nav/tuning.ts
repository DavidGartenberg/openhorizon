/**
 * Radio-tuning + CDI-source selection (Phase 4 Task 6, §24/§9/§10): given a
 * NAV radio's active frequency, the aircraft's position, and the navaids
 * loaded near it, decide whether there's a real signal to track at all, and
 * if so compute a normalized deflection fraction the autopilot/PFD can
 * consume. Pure module — no three.js/DOM (§4.1) — mirrors `navaids.ts`'s
 * data-in/data-out style; this is the wiring glue between `navaids.ts`'s
 * physics and a tuned frequency, kept as pure logic (not stuffed into
 * `main.ts`) so it's unit-testable like the rest of `/sim/nav`.
 *
 * ILS gap: `navaids.ts`'s `NavaidType` enum (built from OurAirports'
 * `navaids.csv` in Task 1) only covers the VOR/NDB/DME family — that CSV
 * carries no ILS/localizer records at all, and the CIFP parser
 * (`server/parse.mjs`) doesn't extract ILS frequencies either (its own
 * header comment notes the vertical-angle/runway fields it *does* read, but
 * frequency isn't one of the parsed columns). So there is no real,
 * data-pipeline-sourced ILS-frequency table anywhere in this repo. Rather
 * than fabricate one, `KNOWN_ILS_FREQUENCIES` below is a small, explicitly
 * flagged stopgap: a handful of real, publicly-published FAA ILS
 * frequencies (not invented numbers) for the specific airports this phase's
 * acceptance scenario needs, clearly called out as a gap a future Task-1-
 * style data pipeline should close properly (see phase-4-task6-report.md).
 * Localizer/glideslope *geometry* itself (threshold, course, elevation)
 * comes from real loaded runway data, not this table.
 */
import { bearingDeg, distanceM, type LatLon } from '../../math/geo'
import {
  NavaidType,
  vorCdi,
  VOR_FULL_SCALE_DEG,
  localizerDeflection,
  glideslopeDeflection,
  angDiff,
  LOC_FULL_SCALE_DEG,
  GS_FULL_SCALE_DEG,
  type NavaidData,
  type IlsRef,
  type ToFrom,
} from './navaids'

// ---- VOR tuning ----

/** Default match tolerance between a radio's MHz-scale active frequency
 *  (×1000 → kHz) and `NavaidData.f`'s stored kHz value — a few kHz of slop
 *  absorbs float rounding in the ×1000 conversion, not a real ambiguity
 *  window (real VOR channels are spaced 50-100 kHz apart). */
export const FREQ_MATCH_TOLERANCE_KHZ = 5

const VOR_LIKE = new Set<NavaidType>([NavaidType.VOR, NavaidType.VOR_DME, NavaidType.VORTAC])

/** Find a VOR/VORTAC/VOR-DME among `candidates` whose frequency matches the
 *  radio's tuned `activeMhz` (within `FREQ_MATCH_TOLERANCE_KHZ`). NDBs are
 *  deliberately excluded here — this module's CDI math (`vorCdi`) is VOR-
 *  specific; an ADF/NDB bearing pointer is a different instrument, out of
 *  this task's scope. Returns undefined (honest "nothing tuned") if no
 *  candidate matches. */
export function findTunedVor(candidates: readonly NavaidData[], activeMhz: number, toleranceKhz = FREQ_MATCH_TOLERANCE_KHZ): NavaidData | undefined {
  const freqKhz = Math.round(activeMhz * 1000)
  return candidates.find((n) => VOR_LIKE.has(n.t) && Math.abs(n.f - freqKhz) <= toleranceKhz)
}

export interface CdiFraction {
  deflectionFraction: number // -1..1, +1 = full-scale right/fly-right
  toFrom: ToFrom
}

/** VOR CDI deflection, expressed as a fraction of full scale (matches
 *  `AutopilotInputs.navDeviation`'s convention). */
export function vorCdiFraction(station: NavaidData, obsDeg: number, aircraft: LatLon): CdiFraction {
  const r = vorCdi({ lat: station.la, lon: station.lo }, obsDeg, aircraft)
  return { deflectionFraction: r.deflectionDeg / VOR_FULL_SCALE_DEG, toFrom: r.toFrom }
}

// ---- ILS geometry from real runway data ----

/** Minimal runway-threshold shape this module needs to build an `IlsRef` —
 *  deliberately independent of `world/airports.ts`'s `RunwayData` (which
 *  carries three.js-adjacent rendering fields and lives in a module this
 *  pure `/sim` file must not import, per §4.1). Callers map their loaded
 *  runway data onto this shape. */
export interface RunwayThresholdRef {
  thresholdLat: number
  thresholdLon: number
  thresholdElevFt: number
  oppositeLat: number
  oppositeLon: number
}

/** Real GS antennas sit ~750-1,250 ft down the runway; 300 m anchors the
 *  standard 3° beam through ~52 ft over the threshold and puts the aiming
 *  point where the PAPI (13d, also 300 m in) reads 3.0° — the two systems
 *  agree by construction, as they do in the real world. */
const GS_ANTENNA_SETBACK_M = 300

/** Build an `IlsRef` from real runway threshold/heading data. The
 *  glideslope antenna sits `GS_ANTENNA_SETBACK_M` down the runway from
 *  the threshold (13d fix — anchored AT the threshold it crossed at 0 ft
 *  TCH and read ~0.2° below the correctly-sited PAPI) and the glidepath
 *  angle defaults to the standard 3.0°. */
export function ilsRefFromRunwayThreshold(t: RunwayThresholdRef, gsAngleDeg?: number): IlsRef {
  // Front course = the direction FLOWN: from the approach threshold toward
  // the far end. (Was inverted — bearing(opposite→threshold) — producing a
  // reciprocal course datum; caught by the Phase-5 opening browser
  // verification, which is the only path that exercises this builder.)
  const courseDeg = bearingDeg({ lat: t.thresholdLat, lon: t.thresholdLon }, { lat: t.oppositeLat, lon: t.oppositeLon })
  const lenM = distanceM(
    { lat: t.thresholdLat, lon: t.thresholdLon },
    { lat: t.oppositeLat, lon: t.oppositeLon },
  )
  const f = Math.min(GS_ANTENNA_SETBACK_M / Math.max(lenM, 1), 0.45)
  return {
    threshold: { lat: t.thresholdLat, lon: t.thresholdLon },
    courseDeg,
    thresholdElevFt: t.thresholdElevFt,
    gsAntenna: {
      lat: t.thresholdLat + (t.oppositeLat - t.thresholdLat) * f,
      lon: t.thresholdLon + (t.oppositeLon - t.thresholdLon) * f,
    },
    gsAntennaElevFt: t.thresholdElevFt,
    ...(gsAngleDeg !== undefined ? { gsAngleDeg } : {}),
  }
}

export interface LocFraction {
  deflectionFraction: number
}

export function localizerFraction(ils: IlsRef, aircraft: LatLon): LocFraction {
  return { deflectionFraction: localizerDeflection(ils, aircraft) / LOC_FULL_SCALE_DEG }
}

export function glideslopeFraction(ils: IlsRef, aircraft: LatLon, aircraftAltFt: number): number {
  return glideslopeDeflection(ils, aircraft, aircraftAltFt) / GS_FULL_SCALE_DEG
}

/** 15a Mode-5 gate: the tuned ILS counts as "on final" only inside the
 *  localizer's full-scale AND roughly aligned with its course. A stale
 *  tuned ILS from another field pegs the localizer — at KPAO this fired
 *  spurious GLIDESLOPE cautions from KSFO's beam. */
export function ilsOnFinal(locDeflectionFraction: number, headingDeg: number, courseDeg: number): boolean {
  return Math.abs(locDeflectionFraction) < 1 && Math.abs(angDiff(headingDeg, courseDeg)) < 45
}

// ---- known ILS frequency stopgap (see module header) ----

export interface KnownIlsEntry {
  icao: string
  runway: string
  freqMhz: number
}

/** Real, publicly-published FAA ILS frequencies — a scoped stopgap, see
 *  module header. KSFO ILS RWY 28R (109.55 MHz) is this phase's acceptance
 *  scenario. Flagged: not independently re-verified against a primary FAA
 *  source inside this repo (no such source is in the data pipeline — that's
 *  the whole gap this table stands in for) — treat as best-effort-accurate
 *  pending a real data pipeline.
 *
 *  A prior revision of this table included a `KHAF` runway 30 entry. Review
 *  research found no evidence KHAF (Half Moon Bay, a small non-towered
 *  single-runway field) has a real ground-based ILS at all — every real
 *  procedure reference found for it is an RNAV (GPS) approach, not an ILS.
 *  Removed rather than left in as an unverified/likely-fictional entry,
 *  per this project's binding "no fabricated data" rule; only re-add if
 *  confirmed against a primary FAA source. */
export const KNOWN_ILS_FREQUENCIES: readonly KnownIlsEntry[] = [
  // Published FAA frequencies: ILS 28R = 111.7 (IGWQ), ILS 28L = 109.55
  // (IBRG). A prior revision had these two swapped.
  { icao: 'KSFO', runway: '28R', freqMhz: 111.7 },
  { icao: 'KSFO', runway: '28L', freqMhz: 109.55 },
]

/** Which runway (if any) a tuned NAV frequency at `icao` corresponds to,
 *  per the stopgap table above. */
export function findKnownIls(icao: string, activeMhz: number, entries: readonly KnownIlsEntry[] = KNOWN_ILS_FREQUENCIES): KnownIlsEntry | undefined {
  return entries.find((e) => e.icao === icao && Math.abs(e.freqMhz - activeMhz) < 0.005)
}

// ---- combined "what is NAV1 actually receiving" result ----

export type NavSource = 'VOR' | 'LOC' | null

export interface TunedNavResult {
  source: NavSource
  identifier?: string
  deflectionFraction: number // 0 if source is null (honest "no signal", not faked)
  toFrom?: ToFrom
  /** Only present when source is 'LOC' and a glideslope is being tracked. */
  glideslopeFraction?: number
  hasGlideslope: boolean
  /** Distance to the tracked station (LOC: runway threshold), meters — feeds
   *  `AutopilotInputs.navRangeM` for range-normalized angular tracking. */
  stationRangeM?: number
  /** Localizer front course, degrees true — the AP's course datum once APR
   *  captures (the heading bug is slewed to it, standing in for a real
   *  GFC700's CDI-course input). */
  courseDeg?: number
}

/** The "no signal" result — used whenever nothing is tuned/receivable, so
 *  callers never have to fabricate a deflection. */
export const NO_NAV_RESULT: TunedNavResult = { source: null, deflectionFraction: 0, hasGlideslope: false }
