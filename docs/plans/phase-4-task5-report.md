# Phase 4 Task 5 — FAA airspace data + MFD rendering + in-airspace detection

Status: **complete, no escalation needed**. Real FAA airspace boundary data
(Class B/C/D/E-surface + Special Use Airspace) fetched end-to-end from the
FAA's ArcGIS open-data REST API, compacted server-side into a 2.24MB single
JSON blob, rendered as a new additive layer on the MFD map page, and a pure
point-in-polygon + altitude in-airspace detector built and TDD'd.

## 1. Real data source — confirmed, fetched, and verified this session

- **Class Airspace** (Class B/C/D/E-surface, and other classes/local types
  out of scope — see below):
  `https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0/query?where=1=1&outFields=*&f=geojson`
- **Special Use Airspace** (Restricted/Prohibited/MOA/Alert/Warning/Danger):
  `https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Special_Use_Airspace/FeatureServer/0/query?where=1=1&outFields=*&f=geojson`
  — real `TYPE_CODE` values observed: `A` (Alert), `D` (Danger), `MOA`, `P`
  (Prohibited), `R` (Restricted), `W` (Warning). `P` already appears in
  this feed (confirmed via a live query), so the separate
  `Prohibited_Areas` FeatureServer mentioned as a fallback in the task
  brief was not needed.

Both feeds paginate: server `maxRecordCount` is 2000, and total feature
counts (queried via `returnCountOnly=true`) are 6061 (Class Airspace) and
1542 (SUA) — both well within "low thousands", as expected. However, large
single-page requests (2000, or even 1000, features per page with
`outFields=*`) were observed to **intermittently truncate mid-transfer**
during this session — `fetch(...).json()` and even a raw `https.get`
streaming read both hit `Unexpected end of JSON input` on some large pages.
500-feature pages fetched reliably every time tested. `server/handlers.mjs`'s
`fetchArcgisFeatures` therefore pages in 500-feature chunks with up to 4
retries per page, stopping once a page returns fewer than 500 features (the
standard "last page" signal).

Real schema, confirmed against live data fetched this session (see full
field derivation in `server/parse.mjs`'s header comment for
`buildUsAirspace`):
- Class Airspace: `NAME`, `ICAO_ID`, `LOCAL_TYPE` (finer-grained than the
  plain `CLASS` field — e.g. real `CLASS_E2`/`CLASS_E3`/`CLASS_E5`/`CLASS_E6`
  records all report `CLASS: "E"`, but only `CLASS_E2` is the
  surface-based Class E this task scopes as "Class E-surface"; confirmed
  against real KSFO-area E2 records — `LOWER_CODE: "SFC"` — vs. real "SAN
  FRANCISCO CLASS E5" records, which start at 700/1200 ft, not the
  surface), `UPPER_VAL`/`UPPER_UOM`/`UPPER_CODE`,
  `LOWER_VAL`/`LOWER_UOM`/`LOWER_CODE`, `SECTOR` (shelf label — real SF
  Class B carries 17 shelves nationwide in the final dataset, `SECTOR`
  "AREA A".."AREA Q"-ish, each a separate feature sharing `NAME`/`ICAO_ID`
  "SAN FRANCISCO CLASS B"/"KSFO").
- SUA: `NAME`, `TYPE_CODE`, same `UPPER`/`LOWER` triad (no `ICAO_ID`/`SECTOR`
  fields — SUA isn't tied to an airport).
- Real example (SF Class B, "AREA K" shelf, verified in the final compacted
  output): floor 6000 ft MSL, ceiling 10000 ft MSL, first ring point
  `[-122.24696, 37.56473]` — matches the task brief's cited raw-GeoJSON
  example (`[-122.246957609221, 37.5647271612759]`) to 5 decimal places.

### Altitude-code edge cases actually observed (handled explicitly in `faaAltFt`)

| `LOWER_CODE`/`UPPER_CODE` | Meaning | Handling |
|---|---|---|
| `SFC` | Surface | 0 ft, `VAL` ignored |
| `UNLTD` | Unlimited | `CEILING_UNLIMITED_FT` (99999) sentinel |
| `null` + `VAL` a real feet/FL number | Un-coded but valid | Treated as plain MSL feet (or `VAL*100` if `UOM` is `FL`) |
| `null` + `VAL` = `-9998` | The FAA's own "no data" placeholder (observed on one real Class E2 record and one real SUA record with `UPPER_CODE: null`) | `CEILING_UNLIMITED_FT` sentinel — detected by `VAL <= -9000`, not "any negative", so a hypothetical genuine below-sea-level floor would never misfire this (no such record was actually observed; real Class/SUA floors always use `SFC` rather than a real negative number) |
| `STD` (e.g. `LOWER_UOM: "FL"`, real R-2306D: `UPPER_VAL: "230", UPPER_UOM: "FL", UPPER_CODE: "STD"`) | Standard-pressure-referenced (always ≥18000ft in this data) | Treated identically to `MSL` feet — a standard aviation simplification since the sim doesn't yet model altimeter-setting-dependent indicated altitude |

**Flagged assumption**: real Class E2 "surface area" records carry no
explicit ceiling (they extend up to wherever the overlying controlled-
airspace structure begins, which isn't in this feed) — rendered/detected
with the same unlimited sentinel as genuinely unlimited SUA. Conservative
for detection (never under-reports "you're in controlled airspace") but
technically overstates a real E2's vertical extent.

## 2. Compaction & serving scheme

**Problem**: `outFields=*` GeoJSON from this feed carries extreme,
survey-grade vertex density — one real Class Airspace polygon sampled had
**16904 ring points**; 500 real features (with only 10 needed fields
selected) totaled ~920k points and **34MB** of GeoJSON. The full raw fetch
for both feeds together is **474MB** (cached to `server/cache/airspace-
raw.json`, gitignored, never committed).

**Fix**: standard Douglas-Peucker ring simplification
(`simplifyRing` in `server/parse.mjs`, `AIRSPACE_SIMPLIFY_EPSILON_DEG =
0.0005°` ≈ 50m at mid-latitudes — comfortably below the MFD map page's
visual resolution) cuts point count by roughly 40x on the sampled data
before 5-decimal-place coordinate rounding. End-to-end on the **real, full
nationwide dataset**: 3340 airspace records (369 Class B, 340 Class C, 578
Class D, 511 Class E-surface, 555 Restricted, 13 Prohibited, 718 MOA, 39
Alert, 212 Warning, 5 Danger), average 30.1 ring points/record (down from
tens of thousands for the worst offenders), max 455 — total compacted
size **2.24MB**. That comfortably fits the "low single-digit MB, ship as
one blob" target from the task brief, so no regional split was built
(would be over-engineering for 2.24MB).

Served via a new `GET /api/airspace.json` route in `server/handlers.mjs`,
wired into the existing `route()` dispatcher (both the standalone Express
server and the Vite dev middleware share it, per the existing pattern) —
cache-forever-until-manually-refreshed on disk, matching
`airports.json`/`navaids.json`'s policy (airspace boundaries change on the
same slow multi-year cycle as sectional charts, not per-run).

**Note on fetch latency**: the full real fetch (both feeds, all pages,
retries) took ~883 seconds (~15 min) end-to-end this session — this is a
one-time server-side build step, cached to disk afterward exactly like
CIFP's ~53MB fetch/parse, not something that runs per-request or blocks
the dev server after the first successful build.

## 3. Point-in-polygon algorithm (`src/sim/nav/airspace.ts`)

Standard **even-odd (ray-casting) rule**: cast a ray from the test point
toward +longitude and count ring-edge crossings; an odd count means
inside. Implemented as `pointInRing` (single ring) and
`pointInPolygonRings` (exterior ring 0, minus any hole rings 1+ — no holes
were observed in the real data sampled, but the shape supports them
generically). A plain 2D test in degree-space (lon as x, lat as y) —
adequate at the scale of individual airspace polygons (at most a few
hundred nm), the same simplification `gps.ts` documents elsewhere in this
codebase for short-range geometry.

**Edge cases**:
- A point that falls exactly on a ring edge or vertex can resolve to
  either `true` or `false` depending on which edge it aligns with — a
  well-known, harmless property of the even-odd rule. Tests treat this as
  an "allowed either way" case (assert only that the function returns a
  boolean without throwing) rather than asserting one specific answer.
- Multiple overlapping airspaces at once: `airspacesContaining` returns
  **every** matching polygon, not just one — verified against real data
  (KSFO tower area at 3000ft matched exactly SF Class B "AREA A" 0-10000ft;
  the same position at 50000ft matched nothing, correctly excluding a
  10000ft-ceilinged shelf).
- Floor/ceiling altitude check (`altitudeInRange`) is inclusive of both
  bounds.

## 4. `mfd.ts` integration — additive, surgical

Per the task brief's constraint (already-reviewed Phase 3 code, add rather
than restructure):
- Added one import (`pointInPolygonRings`, `AirspaceKind`,
  `AirspacePolygon` from `../sim/nav/airspace`).
- Added two new pure functions, mirroring existing patterns exactly:
  `filterAirspaceInRange` (mirrors `filterAirportsInRange` — vertex-in-
  range OR aircraft-inside-polygon) and `projectToMapUnclipped` (identical
  math to the existing `projectToMap`, but never returns `null` for
  out-of-range targets, since a polygon edge partially in view should still
  draw the in-view portion rather than vanish).
- Added an optional `airspace?: readonly AirspacePolygon[]` field to the
  existing `MfdMapInput` interface (additive — every existing caller/test
  of `MfdMapInput` still compiles unchanged since the field is optional).
- Added `airspaceStrokeStyle`/`drawAirspacePolygon`/`drawAirspace` (pure
  drawing, exempt from unit tests per this codebase's canvas-in-node
  convention) and one new call site inside the existing `drawMapPage`,
  gated on `if (map.airspace)` so nothing changes for existing callers that
  don't supply it. Chart styling per §6.5: Class B solid blue, Class C
  solid magenta, Class D dashed blue with a small floor/ceiling label box
  (e.g. "100/00" for a 10000ft/surface shelf), SUA (Restricted/Prohibited/
  MOA/Alert/Warning/Danger) hatched with a diagonal-line clip fill (no
  offscreen pattern canvas needed) plus a solid yellow outline. Not a
  sourced sectional-chart color table (no in-repo spec) — a reasonable
  representative scheme, same caveat this file already carries for its
  other layout/color choices.

No existing `drawMapPage` logic was removed or restructured — only one
`if` block and one import were added to the function body.

## 5. Test results

- `npx tsc --noEmit`: clean.
- `npm test` (`vitest run`): **275/275 tests pass**, 22 test files (241
  baseline + 34 new: 14 in `airspace.test.ts`, 15 in
  `airspace-parse.test.ts`, 5 new in `mfd.test.ts` — `projectToMapUnclipped`
  ×2, `filterAirspaceInRange` ×3).
- `tests/sim-purity.test.ts`: still green (`airspace.ts` has zero three.js/
  DOM imports).
- `tests/nav/airspace.test.ts`: synthetic-fixture TDD (rectangle, diamond,
  a ring-with-hole) covering inside/outside/on-edge points, floor/ceiling
  filtering, and multiple-overlapping-airspace detection — mirrors Task 4's
  "fixtures independent of real data" convention.
- `tests/nav/airspace-parse.test.ts`: real GeoJSON fixtures (SF Class B
  "AREA K", a real Class E2, a real Class E5 correctly dropped, real P-51/
  R-2306D/Adirondack-MOA SUA records) exercising `faaAltFt`, `simplifyRing`,
  and `buildUsAirspace` end-to-end — mirrors `tests/geo.test.ts`'s
  `buildUsAirports`/`buildUsNavaids` pattern.
- **Real end-to-end spot check** (ad hoc, not part of the committed suite):
  ran the actual fetch→compact pipeline against the live FAA feeds, then
  ran `airspacesContaining` against the real compacted `server/cache/
  us-airspace.json` at the real KSFO tower position — correctly matched
  "SAN FRANCISCO CLASS B AREA A (0-10000)" at 3000ft MSL and correctly
  matched nothing at 50000ft MSL (above every SF Class B shelf's ceiling).

## 6. Flagged assumptions (all noted inline in code/comments too)

1. Class E2 ceiling treated as unlimited (see §1 table) — real data has no
   explicit ceiling for these records.
2. `STD`-referenced altitudes (always ≥18000ft in this data) treated
   identically to `MSL` feet — the sim doesn't yet model altimeter-setting-
   dependent indicated altitude.
3. Douglas-Peucker simplification uses plain-degree distance, not a
   geodesic distance — a documented simplification adequate at the small
   epsilon used (0.0005°).
4. `MultiPolygon` geometry (not observed in the real data sampled — every
   feature checked was a single `Polygon`) would have all its parts'
   rings flattened into one record if it ever occurs — a flagged
   simplification that would misrepresent a genuine multi-part airspace as
   one contiguous shape.
5. Airspace chart colors/hatching are a reasonable representative scheme,
   not a sourced sectional-chart color spec (no in-repo source), matching
   this file's existing policy for unsourced layout/color choices.

## Files touched

- `server/parse.mjs` — `buildUsAirspace`, `faaAltFt`, `simplifyRing`,
  `compactPolygonRings`, `CEILING_UNLIMITED_FT`, `AIRSPACE_KIND_NAMES`,
  `AIRSPACE_SIMPLIFY_EPSILON_DEG` (additive, appended after
  `buildCifpProcedures`).
- `server/handlers.mjs` — `fetchArcgisFeatures`, `airspaceData`, and the
  new `/api/airspace.json` route (additive).
- `src/sim/nav/airspace.ts` — new pure module: `AirspaceKind`,
  `AirspacePolygon`, `pointInPolygonRings`, `altitudeInRange`,
  `airspacesContaining`.
- `src/cockpit/mfd.ts` — additive: `filterAirspaceInRange`,
  `projectToMapUnclipped`, `MfdMapInput.airspace`, `airspaceStrokeStyle`,
  `drawAirspacePolygon`, `drawAirspace`, one new call site in
  `drawMapPage`.
- `tests/nav/airspace.test.ts`, `tests/nav/airspace-parse.test.ts` (new),
  `tests/cockpit/mfd.test.ts` (extended).
