# Phase 4 plan — Nav, autopilot & airspace

Goal (§24, §9, §10): VOR/ILS/DME/GPS navigation, FAA CIFP procedures
(SID/STAR/approach), GFC700-style autopilot, airspace data + MFD rendering
+ in-airspace detection, glide range ring. Acceptance: coupled ILS 28R KSFO
from a PROC-loaded approach in a 15 kt crosswind stays within half-scale to
200 AGL; the SF Bravo shelf renders correctly on the MFD and the sim knows
when the aircraft is inside it.

## Architecture

- **`src/sim/nav/`** (pure, TDD, no three.js — mirrors `src/sim/systems/`'s
  purity convention):
  - `navaids.ts`: VOR/NDB data model + signal service-volume/range-vs-
    terrain-line-of-sight degradation, CDI deflection (OBS-relative) +
    TO/FROM flag, ILS localizer + glideslope beam geometry (angular
    deviation from the true centerline/glidepath), DME slant-range, marker
    beacon over/under detection. Morse-code ident sequencing (a pure
    on/off keying timeline the audio layer plays later — audio synthesis
    itself is Phase 9, this phase only needs the correct dit/dah timeline
    per station).
  - `gps.ts`: flight-plan legs (waypoint list), great-circle course/
    distance, turn-anticipation lead distance vs. bank/groundspeed,
    direct-to, CDI full-scale deflection by phase (ENR 2.0 nm / TERM 1.0
    nm / APR 0.3 nm per §10.2).
  - `procedures.ts`: typed leg model (IF/TF/CF/DF, FA/CA, simplified
    HM/HA/HF holds) consumed by both CIFP-sourced procedures and hand-
    built test fixtures — the leg *interpreter* is TDD'd against fixtures
    regardless of whether the CIFP parser (below) lands cleanly.
- **`src/sim/autopilot.ts`** (pure, TDD): GFC700-style cascaded PID,
  gain-scheduled by IAS. Lateral: ROL, HDG, NAV (GPS/VLOC capture+track),
  APR (LOC+GS capture), BC. Vertical: PIT, ALT hold, ALTS armed→capture,
  VS, FLC. Mode state machine (armed→active transitions), servo rate
  limits (no snapping to capture), auto-trim. Flight-director v-bar
  targets are exposed as pure output (pitch/roll command) for the PFD to
  draw — the PFD draws them, this module only computes them.
- **`server/`**: navaid data (VOR/NDB) fetched from the same
  `davidmegginson/ourairports-data` mirror Phase 2 already uses for
  airports (`navaids.csv` — confirmed reachable), compacted into a JSON
  chunk the same way `airports.json` is built. **CIFP** (SID/STAR/
  approach procedures) and **FAA airspace boundaries** are a second,
  separate data-pipeline task each — both are real, fetchable public data
  (network access confirmed working this session) but the exact current
  FAA distribution URLs and file formats (ARINC 424 fixed-width records
  for CIFP; shapefiles for airspace) need discovery and a real parser,
  which is inherently exploratory. Per the original handoff plan's own
  guidance: **escalate rather than guess** if the ARINC 424 leg-type
  subset or shapefile parsing stalls after real attempts — do not
  fabricate procedure/airspace data to make progress.
- **Cockpit wiring**: PFD's CDI (currently an honest "NO NAV" inert state
  per Phase 3) becomes real once `navaids.ts`/`gps.ts` exist. NAV/COM
  frequency boxes gain real tuning (flip-flop swap + a knob control in the
  3D cockpit). MFD map page gains airspace polygons (Bravo solid blue,
  Charlie solid magenta, Delta dashed blue, SUA hatched per §6.5) and a
  glide-range ring. Autopilot gets a mode-annunciation bar on the PFD and
  a control-panel row in the 3D cockpit (mode buttons, AP disconnect).

## Task breakdown

1. Radio nav data + physics (`navaids.ts`) — real VOR/NDB data fetched
   and compacted server-side, CDI/OBS/TO-FROM, ILS beam geometry, DME,
   markers, Morse timeline. TDD.
2. GPS/flight-plan (`gps.ts`) — legs, great-circle tracking, turn
   anticipation, direct-to, phase-scaled CDI. TDD.
3. GFC700 autopilot (`autopilot.ts`) — cascaded PID, all modes, gain
   scheduling, servo limits, auto-trim. TDD with step-response tests.
4. CIFP procedures — server-side fetch + ARINC 424 parse (scoped to the
   common leg-type subset) → JSON, `procedures.ts` leg interpreter (TDD'd
   against fixtures independent of parser success). Escalate if the real
   parse stalls rather than fabricating procedure data.
5. Airspace data — FAA boundary fetch + compaction → JSON, MFD chart-
   style rendering, in-airspace detection logic. Escalate if source
   discovery stalls.
6. Cockpit wiring + acceptance — NAV/COM tuning knobs in the 3D cockpit,
   real CDI/FD/mode-annunciation on the PFD, AP control panel, glide-range
   ring. Acceptance: coupled ILS 28R KSFO in a 15 kt crosswind stays
   within half-scale to 200 AGL (headless scenario test + browser flight);
   Bravo shelf renders correctly and in-airspace detection is correct.

## Cuts recorded as deviations (in-phase, honest)

- Full ATC/traffic integration with airspace (contact requirements,
  deviation handling) → Phase 6, per the master build order. This phase
  only builds the airspace *data* + detection + rendering.
- Airway (Victor) routing in flight plans → §28 roadmap, out of scope.
- DME arcs, computed hold entries → §28 roadmap.
- Audio (Morse ident playback, voice) → Phase 9; this phase produces the
  correct *data* (ident timeline) an audio layer will consume later.

## Tests

`tests/nav/navaids.test.ts`, `gps.test.ts`, `procedures.test.ts`,
`tests/autopilot.test.ts` (step-response + capture scenarios per mode).
Existing suite (141 tests through Phase 3) must stay green throughout;
`tests/sim-purity.test.ts` must stay green (nav/autopilot are `/sim`).
