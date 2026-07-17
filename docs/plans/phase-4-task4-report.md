# Phase 4 Task 4 — FAA CIFP procedures (SID/STAR/approach)

Status: **complete, no escalation needed**. Reverse-engineered the full
ARINC 424 fixed-width record layout directly from real fetched CIFP data
(no external spec document consulted), built a working server-side
fetch→parse→cache pipeline, and TDD'd a pure leg interpreter against both
hand-built fixtures and real KSFO ILS 28R data.

## 1. Real CIFP URL discovery

The FAA CIFP zip filename is date-stamped per 28-day cycle
(`CIFP_YYMMDD.zip`) and isn't guessable from the current date alone (the
index page lists both the current cycle *and* the upcoming one). The
download index page (`https://www.faa.gov/air_traffic/flight_info/aeronav/
digital_products/cifp/download/`) has an HTML table with one row per cycle:
a zip link plus "Effective"/"Ending" dates. `pickCurrentCifpUrl` in
`server/handlers.mjs`:

1. Scans the page for `<tr>...</tr>` rows containing a
   `CIFP_\d+\.zip` link.
2. Extracts the two `<td>` dates from each row.
3. Picks the row whose `[effective, ending)` window contains "now",
   falling back to the first row (or a bare first-zip-link regex) if the
   table structure doesn't match — defensive against a future page
   redesign.

Verified live: as of this session (2026-07-17) the index page listed
`CIFP_260709.zip` (effective Jul 9 – Aug 6, 2026) and `CIFP_260806.zip`
(effective Aug 6 – Sep 3, 2026); the picker correctly returns the former
for a "now" of 2026-07-17 and the latter for 2026-08-10 (unit-testable
logic, though not currently covered by an automated test since it needs a
real HTML fixture — exercised manually against the live page during this
task).

The zip (~9MB) contains `FAACIFP18` (~53MB, the actual ARINC 424 data) plus
three PDFs (readme, disclaimer, ATS/enroute coverage) — the PDFs are never
touched, per the task's explicit instruction to avoid the PDF-extraction
dead end the previous attempt hit. `FAACIFP18` is extracted from the zip
with the system `unzip -p` binary (no new npm dependency) and disk-cached
alongside the existing `airports.csv`/`navaids.csv` cache convention.

## 2. ARINC 424 record format — reverse-engineered from real data

No machine-readable spec ships with the CIFP; the field layout below was
derived by character-counting real lines from the live `FAACIFP18`
(cycle 2607) — starting from the task's provided KSFO "H28RY" (ILS 28R)
sample lines, then confirmed/extended against real SID (`KSFOK2D...`), STAR
(`KSFOK2E...`), terminal-waypoint (`KSFOK2C...`), and runway
(`KSFOK2G...`) records fetched directly from the file. Full derivation
detail and the exact column indices live in the header comment of
`server/parse.mjs` (search for `buildCifpProcedures`); summary:

| Cols (0-based) | Field | Notes |
|---|---|---|
| `[0,5)` | `"SUSAP"` | record type S + customer/area USA + section P (airport) |
| `[6,10)` | airport ICAO ident | e.g. `KSFO` |
| `[12,13)` | subsection | `D`=SID, `E`=STAR, `F`=Approach, `C`=terminal waypoint, `G`=runway (empirically confirmed by counting how many of each letter appear under `KSFOK2`) |
| `[13,19)` | procedure ident | e.g. `H28RY `, `CIITY3` |
| `[19,20)` | route type | not decoded semantically; only used indirectly |
| `[20,25)` | transition ident | blank = the shared "common"/final segment |
| `[26,29)` | leg sequence number | `010`, `020`, ... |
| `[29,34)` | fix ident | this leg's referenced/terminating waypoint |
| `[43,44)` | turn direction | `L`/`R`/blank |
| `[47,49)` | **leg type** (Path & Termination) | `IF`,`TF`,`CF`,`DF`,`CA`,`RF`,`HM`,`VA`,`FM`,... — the single most load-bearing field, verified against dozens of real lines at this exact position |
| `[70,74)` | magnetic course, tenths of a degree | e.g. `2837` = 283.7° |
| `[74,78)`/`[78,79)` | route distance/holding length (tenths) + D/T flag | see §4 below (ambiguity flagged) |
| `[82,83)` | altitude description | `+` at-or-above, `-` at-or-below, `B` between, blank = at |
| `[84,89)`/`[89,94)` | Altitude 1 / Altitude 2 | raw feet (`07000`) or flight level (`FL270`=27000ft); confirmed the `B` (between) case has Altitude1=upper, Altitude2=lower from real STAR data (`ALWYS` "B FL260FL220") |
| `[99,102)` | speed limit, kt | |
| `[102,106)` | vertical angle, hundredths of a degree | e.g. `-300` = -3.00°, matches the real ILS 28R's standard 3° glidepath |
| `[106,111)` | runway reference | when it starts `RW` (e.g. `RW28R`), resolved via the subsection-G runway table |

Waypoint (`C`) / runway (`G`) support records share:
`[13,18)` ident, `[32,41)` latitude (`N/S` + `DDMMSSss`), `[41,51)`
longitude (`E/W` + `DDDMMSSss`, 3-digit degrees). Verified against KSFO's
real `ARCHI` fix (`N37292687W121523195` → 37.4908, -121.8755, matching
ARCHI's real charted position on the ILS 28R approach) and the real
`RW28R` threshold record.

Parsing the *entire* nationwide `FAACIFP18` (400k+ lines) with this layout
takes **~300ms** and resolves fix coordinates for 100% of the legs checked
in the KSFO ILS 28R validation (see §5).

## 3. Leg types — implemented vs. scoped out

Per the phase plan's explicit authorization to scope down on this task:

**Implemented** (`src/sim/nav/procedures.ts`, `evaluateLeg`/`evaluateHoldLeg`):
`IF`, `TF`, `CF`, `DF`, `CA`, `FA`, `HM`, `HA`, `HF`.

**Explicitly NOT implemented** — real, observed in the live KSFO data
(counted nationwide: `VA` 16, `HM` 15, `FM` 13, `RF` 2 for KSFO alone; `VM`,
`VI` also present), but outside this task's required subset:
- `VA`/`VM`/`VI` (heading-vector legs, SID initial-climb vectors)
- `FM` (heading from a fix, no fixed course)
- `RF` (radius-to-fix, constant-radius arc — used in KSFO ILS 28R's own
  missed approach, `JOSUF`/`FABLA`)
- `PI` (procedure turn) and any other unrecognized path-terminator

These are still captured as raw leg records (type string + whatever
fix/course/altitude/turn-direction fields are present) by the parser, so
callers can see they exist — but `procedures.ts`'s `evaluateLeg` **throws**
a descriptive error for them rather than silently mis-flying them, per the
task's "no fabricated data" requirement. `SUPPORTED_LEG_TYPES` in
`procedures.ts` is the authoritative list; callers should check it before
attempting to fly a leg pulled from real data.

## 4. Assumptions flagged as best-guesses (time-boxed, not spec-verified)

- **RNP field** (`[44,47)`, e.g. `"010"`, `"031"`) — doesn't map cleanly to
  standard published RNP figures (0.3/1.0/2.0) under an obvious
  scale/decimal reading; left **opaque/unparsed** rather than guessing a
  wrong decode.
- **Holding leg length units** (`[74,78)` + `[78,79)` D/T flag) — the real
  KSFO hold sampled (`VIKYU`) has this flag **blank**, not `D` or `T`. `nm`
  was chosen as the more physically plausible reading (a 4.0-*minute* hold
  leg would be unusually long; 4.0 nm holds are common) — flagged in code
  comments as a best guess, not a confirmed spec fact.
- **Cols `[94,99)`** consistently show `18000` (the real, well-known US
  standard transition altitude) on the *first* leg of every named
  transition, and never elsewhere — read as a per-procedure constant
  "Transition Altitude" header field rather than a genuine per-leg second
  altitude ceiling (which would contradict the `B`-descriptor evidence
  showing Altitude1/Altitude2 living at `[84,89)`/`[89,94)` instead).
  **Not modeled** as a leg constraint, to avoid misrepresenting it as
  per-leg data.
- The 4-character "Waypoint Description Code" sub-flags (values like
  `E  A`, `E  I`, `E  F` on IF/TF legs, which plausibly correspond to
  IAF/Intermediate-Fix/FAF designations) were **not decoded** — captured
  nowhere in the output. Time-boxed: pattern-matches real-world IAF/IF/FAF
  designations suggestively but wasn't confirmed to my satisfaction against
  enough independent samples to ship confidently.

None of these required an external spec lookup or stalled the task — each
was resolved (or explicitly scoped out) from real sample data within a few
attempts, per the time-boxing instruction.

## 5. Server-side pipeline

- `server/parse.mjs`: `parseCifpCoord`, `buildCifpWaypoints` (subsection
  C/G → `{airport}|{ident} → {la,lo}` lookup), `buildCifpProcedures` (the
  main parser — pure, no I/O).
- `server/handlers.mjs`: `pickCurrentCifpUrl` (index-page scraper),
  `loadCifpData` (fetch zip → disk cache → `unzip -p` → parse → disk-cache
  the parsed JSON, mirroring `airportsData()`/`navaidsData()`'s
  fetch-then-cache shape), `proceduresData(icao)`, wired into `route()` as
  **`GET /api/procedures/{ICAO}.json`**.
- **Served per-airport, not as one nationwide blob**: the full parsed
  dataset is ~13.8MB (vs. 1.3MB for `us-airports.json`) — impractical to
  ship to every client for one airport's worth of procedures. The
  nationwide parse+cache happens once server-side; each request slices out
  just the requested airport (e.g. `KJFK` → 27.6KB, served in ~90ms from
  the disk-cached parse on a warm cache).
- Verified end-to-end against the real, live-fetched `CIFP_260709.zip`:
  2887 US airports with procedures, KSFO alone has 39 procedures including
  `H28RY` (ILS 28R) with all fix coordinates resolved.

## 6. `src/sim/nav/procedures.ts` — pure leg interpreter

Mirrors `gps.ts`'s pure, load-then-query style; reuses `gps.ts`'s
`crossTrackDistanceM`/`alongTrackDistanceM`/`directTo` wherever a leg type
maps onto "fly to this fix" semantics (IF, TF, DF all reduce to a direct-to
in this model; CF projects a synthetic course-line anchor point 100nm
behind the fix so the same cross-track/along-track math applies to a
*specified* course rather than a derived one). New geometry was built only
for genuinely different leg types: `evaluateAltitudeTerminatedLeg`
(CA/FA — course-terminated-by-altitude, direction-of-termination inferred
from the altitude-constraint kind) and `evaluateHoldLeg` (simplified
two-leg racetrack with instantaneous course reversals — "shape/timing only,
no wind-corrected entry", per the phase plan).

`fromCifpLeg`/`assembleProcedureLegs` adapt the CIFP-parser's wire JSON
into this module's typed model and concatenate a named transition with the
shared common segment. Full multi-segment assembly (SID
runway-transition→common→enroute-transition chaining) is **not** built —
flagged as a Task 6 (cockpit wiring) follow-up, since assembling a
specific runway/transition combination for flying is a flight-plan
concern, not a leg-geometry one.

## 7. Test results

- `npx tsc --noEmit`: clean.
- `npm test` (`vitest run`): **241/241 passing** (218 pre-existing + 4 in
  `tests/nav/cifp-parse.test.ts` + 19 in `tests/nav/procedures.test.ts`).
- `tests/sim-purity.test.ts`: green (`procedures.ts` imports only
  `math/geo`, `math/vec`, and `nav/gps` — no three.js/DOM).
- `tests/nav/cifp-parse.test.ts`: parses the exact real KSFO ILS 28R lines
  given in the task (plus the real waypoint/runway records needed to
  resolve their fixes) and asserts leg idents/types/altitudes/order and
  the resolved runway coordinate match ground truth.
- `tests/nav/procedures.test.ts`: TDD fixtures (synthetic, clearly
  test-only geometry) for every supported leg type, independent of parser
  success — includes a "throws rather than mis-flies" test for the
  scoped-out leg types (RF/VA/VM/VI/FM/PI).

## Escalation

None required. All ambiguities encountered were resolved (or explicitly
scoped out and documented above) from real sample data within a few
attempts each, well inside the time-box.
