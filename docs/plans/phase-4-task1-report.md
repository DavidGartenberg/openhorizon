# Phase 4 Task 1 — Radio nav data + physics: report

## Files created

- `src/sim/nav/navaids.ts` — pure nav module: `NavaidsIndex` data holder,
  VOR CDI (`vorCdi`), ILS beam geometry (`localizerDeflection`,
  `glideslopeDeflection`), DME slant range (`dmeSlantRangeNm`), service
  volume + radio-line-of-sight (`vorServiceVolumeNm`, `ndbServiceVolumeNm`,
  `radioLineOfSightNm`, `signalReceivable`), marker beacons
  (`makeMarkerBeacons`, `markerBeaconActive`), and Morse ident timelines
  (`morseTimeline`).
- `tests/nav/navaids.test.ts` — 24 tests covering all of the above.

## Files changed

- `server/parse.mjs` — added `buildUsNavaids(navaidsCsv)`, mirroring
  `buildUsAirports`'s style (reuses `parseCsv`/`splitCsvLine`).
- `server/handlers.mjs` — added `navaidsData()` (fetch+disk-cache, same
  pattern as `airportsData()`) and wired `GET /api/navaids.json` into
  `route()`.
- `tests/geo.test.ts` — added one `buildUsNavaids` test (parser tests for
  this pipeline live alongside the airports parser tests, following the
  existing convention — there's no separate `tests/parse.test.ts`).
- `server/cache/navaids.csv` / `server/cache/us-navaids.json` — disk cache
  populated by an actual fetch+build run during verification (same as the
  existing `us-airports.json` cache artifact already checked into that dir).

## Real navaid CSV schema (confirmed against the live file this session)

`https://davidmegginson.github.io/ourairports-data/navaids.csv`, ~1.5 MB,
header:

```
id,filename,ident,name,type,frequency_khz,latitude_deg,longitude_deg,
elevation_ft,iso_country,dme_frequency_khz,dme_channel,dme_latitude_deg,
dme_longitude_deg,dme_elevation_ft,slaved_variation_deg,
magnetic_variation_deg,usageType,power,associated_airport
```

Key findings that shaped the parser:

- `type` (US rows observed): `VOR` (55), `VOR-DME` (423), `VORTAC` (572),
  `TACAN` (105), `DME` (3), `NDB` (1618), `NDB-DME` (28). 2,804 US rows
  total.
- `frequency_khz` is genuinely kHz for **every** type, including VOR/TACAN —
  a VOR at 115.800 MHz is stored as `115800`; an NDB at 373 kHz is stored as
  `373`. No unit correction needed in the parser; only display formatting
  differs (VOR/TACAN: divide by 1000 for MHz).
- `dme_latitude_deg`/`dme_longitude_deg` are blank for the vast majority of
  DME-carrying stations (VOR-DME/VORTAC/TACAN/NDB-DME) — blank means
  **co-located** with the primary station, not missing data. Only ~29 of
  2,804 US rows carry a genuinely distinct DME antenna position (verified:
  e.g. `ADK` NDB-DME, DME antenna ~130 m from the NDB). The parser falls
  back to the primary lat/lon/elevation when DME fields are blank.
- `usageType` (TERMINAL/LO/HI/BOTH/RNAV) and `power` (LOW/MEDIUM/HIGH) map
  to the FAA service-volume classes used by `vorServiceVolumeNm`/
  `ndbServiceVolumeNm` — that mapping is left to the caller (a later task),
  this task only carries the raw fields through where relevant (elevation,
  frequency, position).
- Verified real SFO VOR-DME row: ident `SFO`, freq `115800` (115.800 MHz —
  matches the real-world published SFO VOR-DME frequency), position
  37.6195/-122.374 (matches KSFO's actual VOR location), DME co-located.

## Compact JSON schema produced by `buildUsNavaids`

```
{ i: ident, n: name, t: type-code, la, lo, e: elevFt, f: frequency_khz,
  mv?: magnetic variation deg, dla?, dlo?, de?: DME antenna lat/lon/elevFt
  (present only when the station type carries a DME/TACAN component) }
```
Type codes: `0` VOR, `1` VOR-DME, `2` VORTAC, `3` TACAN, `4` DME, `5` NDB,
`6` NDB-DME.

## Test results

- `npx tsc --noEmit`: clean.
- `npm test`: **166/166 passing** (141 baseline + 24 new `tests/nav/navaids.test.ts`
  + 1 new `buildUsNavaids` test in `tests/geo.test.ts`).
- `tests/sim-purity.test.ts`: still green — `src/sim/nav/navaids.ts` has no
  three.js import and no `document.`/`window.` references.
- Server sanity check (no committed test harness for `server/`, per task
  scope): called `route('/api/navaids.json', res)` directly against the
  real fetched CSV — returned HTTP 200, 2,804 US navaids, and the SFO
  VOR-DME record matches the raw CSV inspection above. Disk cache
  (`server/cache/us-navaids.json`) populated correctly, mirroring
  `us-airports.json`'s existing behavior.

## Flagged assumptions (no LLM-guessed numbers presented as fact)

- **VOR CDI full scale ±10°** — standard avionics convention (5-dot scale,
  2°/dot), not station-specific data. Documented in `VOR_FULL_SCALE_DEG`.
- **VOR CDI TO/FROM boundary behavior**: at exactly ±90° off the selected
  course the needle sign flips discontinuously between the FROM and TO
  sides (both clamped to full scale). This matches the real "cone of
  ambiguity" edge behavior of VOR receivers abeam the station, not a bug —
  flagged in the `vorCdi` doc comment.
- **ILS localizer full scale ±2.5°** (`LOC_FULL_SCALE_DEG`) — real
  localizer course width varies with runway length/antenna siting (FAA AIM
  1-1-9, full-scale ~700 ft at threshold); this module does not model that
  runway-length dependency and uses one representative figure instead.
  Flagged as a simplification.
- **ILS glideslope full scale ±0.7°** (`GS_FULL_SCALE_DEG`) — commonly-cited
  public figure (FAA AIM 1-1-9), used directly, not derived per-installation.
- **Standard glidepath angle 3.0°** (`GS_STANDARD_ANGLE_DEG`) — textbook
  default; real installations vary (2.5°-3.5°), a later task supplying real
  ILS data can override via `IlsRef.gsAngleDeg`.
- **Glideslope antenna offset from threshold** — real GS antennas sit
  ~1,000-1,500 ft down the runway, offset to one side; this module lets the
  caller supply `gsAntenna`/`gsAntennaElevFt` explicitly but defaults
  examples/tests to the threshold itself for simplicity. Not a hidden
  assumption — it's a caller-supplied field.
- **VOR/VORTAC/TACAN service volumes** (`vorServiceVolumeNm`) — real FAA
  AIM 1-1-8 published table (Terminal 25 nm/12,000 ft AGL, Low 40 nm/18,000
  ft AGL, High 40/100/130/100 nm by altitude band). Applied here treating
  altitude as AGL at the station for simplicity — flagged as a
  simplification, not a sourcing gap.
- **NDB service volumes** (`ndbServiceVolumeNm`) — no authoritative FAA
  table exists in this repo for NDB service volumes (they're far less
  standardized than VOR's in practice); a flat 25 nm (LOW/MEDIUM power) /
  50 nm (HIGH power) placeholder is used, explicitly flagged as an
  engineering choice, not a sourced figure.
- **Radio line-of-sight** (`radioLineOfSightNm`) — standard VHF/UHF
  radio-horizon approximation d = 1.23·√(h_ft) per end (4/3 effective-earth-
  radius model), summed for aircraft + station height. This is a simplified
  stand-in for genuine terrain occlusion; per the task's scope, reusing
  Phase 2's terrain heightfield for radio propagation was judged
  unnecessary coupling for this task. Flagged as a design choice in the
  file header.
- **Marker beacon positions** (`OUTER_MARKER_DIST_NM = 5`,
  `MIDDLE_MARKER_DIST_FT = 3500`, `INNER_MARKER_DIST_FT = 1000`) — the real
  navaids.csv has no OM/MM/IM position data (`type` column has no such
  values), so representative distances within the commonly-cited real-world
  ranges (OM 4-7 nm, MM ~3,500 ft) are used, flagged as assumptions rather
  than sourced per-approach data.
- **Marker beacon cone half-angle 40°** (`MARKER_CONE_HALF_ANGLE_DEG`) — no
  single authoritative antenna-pattern figure found in this repo; a
  representative half-angle is used as a flagged assumption for the
  radius-vs-height cone check.
- **Morse unit duration 150ms** (`DEFAULT_MORSE_UNIT_MS`) — real navaid
  keying speed varies by equipment; ~150ms/unit (~8 wpm by the standard
  PARIS timing formula) was picked as a representative, easily-readable
  cadence, flagged as an assumption rather than a sourced spec figure.
  Morse timing ratios themselves (dit=1u, dah=3u, intra-char gap=1u,
  inter-char gap=3u) are the actual International Morse Code standard, not
  invented.

## Scope notes

- Did not touch `src/cockpit/`, `src/render/`, `src/main.ts`,
  `src/sim/aircraft.ts`, `src/sim/aircraft/c172s.ts`, or the autopilot, per
  task constraints.
- No GPS flight-plan logic, no autopilot, no cockpit wiring — reserved for
  later tasks per the phase-4 plan.
- Left `server/index.mjs` untouched; it already only wires the terrain
  proxy stub directly and doesn't mount `handlers.mjs#route()` (that's done
  via the Vite dev-middleware in `vite.config.ts`) — this predates this
  task and wasn't part of its scope.
