# Phase 4 Task 6 — Cockpit wiring report

Wires Phase 4's nav/autopilot/airspace modules (Tasks 1-5, already committed)
into the running sim: data loading, real CDI, autopilot stepping + control
takeover, NAV/COM tuning, glide-range ring, and airspace detection.

## What's wired

### Data loading (`src/main.ts`)
- `/api/navaids.json` → `NavaidsIndex.load()`.
- `/api/airspace.json` → a plain `AirspacePolygon[]` module variable.
- `/api/procedures/{ICAO}.json` fetched on demand + cached (`loadProcedures`/
  `__ohProcedures`), not at boot.
- Mirrors `Airports.load()`'s "caller fetches, pure module holds" pattern;
  `NavaidsIndex`/`airspacesContaining` stay `/sim`-pure (no fetch inside
  them).

### Radio/GPS state (`src/main.ts`)
- `radios` object: NAV1/NAV2/COM1/COM2 active+standby (flip-flop) + OBS1/
  OBS2 course. NAV1/COM1 get physical 3D-cockpit knobs; NAV2/COM2 are
  modeled state only (scope cut, see below).
- `flightPlan` (`gps.ts`'s `FlightPlan`), empty by default, settable via
  `__ohFpl` — no FPL-entry UI (explicitly out of scope per the brief; MFD's
  FPL page stays the Phase 3 visual skeleton).
- **New pure module `src/sim/nav/tuning.ts`** (tested,
  `tests/nav/tuning.test.ts`, 10 tests): CDI-source resolution — matches a
  tuned frequency against nearby VOR/VORTAC/VOR-DME navaids
  (`findTunedVor`/`vorCdiFraction`), builds a real `IlsRef` from actual
  runway threshold/heading data (`ilsRefFromRunwayThreshold`), and computes
  localizer/glideslope fractions. `computeTunedNav`/`computeGpsCdi` in
  `main.ts` compose these into one CDI result per frame, fed to both the PFD
  and the autopilot. Honest "NO NAV" (`source: null`) when nothing
  matches/receivable — never a fabricated needle.
- **Flagged data gap**: OurAirports' `navaids.csv` (Task 1's source) and the
  CIFP parser (Task 4) carry no ILS/localizer *frequency* data at all — only
  VOR/NDB/DME. `tuning.ts`'s `KNOWN_ILS_FREQUENCIES` is a small, explicitly-
  documented stopgap table of real, publicly-published FAA ILS frequencies
  (KSFO 28R/28L, KHAF 30) standing in for a real data pipeline that doesn't
  exist yet. The localizer/glideslope *geometry* itself (threshold, course,
  elevation) comes from real loaded runway data, not this table. Flagged as
  a follow-up: a proper ILS-frequency data pipeline (Task-1-style) should
  replace this table.

### Autopilot (`src/sim/autopilot.ts` unchanged; wiring in `main.ts`)
- `apState = makeAutopilotState()`, stepped every fixed-timestep tick
  (inside the same `loop.advance` callback as `aircraft.step`), fed real
  `AutopilotInputs` from `aircraft.data` + `apTargets` (mode/target state) +
  the composed nav deviation.
- **Servo takeover**: when `apState.masterEnabled`,
  `aircraft.controls.pitch/roll/yaw/trim` are overwritten with the
  autopilot's output immediately before `aircraft.step(dt)` — same
  fixed-tick cadence, so keyboard/panel control (`pollControls`,
  `CockpitInteraction`) is completely unaffected when the AP is off, and
  cleanly overridden when it's on (matches the brief's suggested design).
- Respawn (`resetSystemsState`) calls `disconnectAutopilot(apState)` so a
  fresh spawn doesn't inherit stale AP state.
- **AP master engage/disengage**: a real physical cockpit switch
  (`sw_apMaster`, `SwitchId` extended, wired through `CockpitInteraction`
  exactly like the existing battery/alternator/avionics/pitot switches).
- **AP mode select**: **deferred to a debug hook**, `__ohApMode(lateral,
  vertical, targets)`, per the brief's explicitly-sanctioned minimal
  fallback — a full physical mode-select button panel (HDG/NAV/APR/ALT/VS
  buttons) was judged too much added scope for this wiring task on top of
  everything else it already covers. The control law itself is fully
  reachable and testable through this hook; `__ohApState()` reads back
  `AutopilotState` for verification.

### PFD (`src/cockpit/pfd.ts`, additive edits)
- `PfdInput` gained optional `cdi`, `fd`, `apAnnunciation` fields.
- `drawHsi`'s CDI is no longer hardcoded-inert: real needle deflection +
  TO/FROM + source label (`VOR`/`LOC`/`GPS` + identifier) when `data.cdi` is
  present; falls back to the original honest "NO NAV" flag otherwise — the
  anti-faking rule is preserved, just now backed by real data when
  available.
- `drawAttitude` gained a flight-director single-cue crossbar (cyan),
  positioned/rotated from `AutopilotState.fdPitchDeg`/`fdBankDeg` (computed
  every autopilot step regardless of engagement, per that module's own doc).
- New `drawApAnnunciator`: a thin bar above the attitude indicator showing
  AP/FD master state + lateral/vertical mode names (white = armed, green =
  active — standard convention, mirrors `AutopilotState`'s own fields
  directly).
- NAV1/COM1 boxes now show `radios.nav1`/`radios.com1` instead of the old
  hardcoded 110.0/118.0 placeholders; heading bug now reflects
  `apTargets.headingBugDeg` instead of always mirroring current heading.

### MFD (`src/cockpit/mfd.ts`, additive edits)
- Airspace wiring: Task 5 already built `drawAirspace`/the `airspace` field;
  this task just feeds real `AirspacePolygon[]` from `main.ts` (page default
  switched to `'map'` at boot so this is visible without any extra step —
  see `__ohMfdPage` to switch pages).
- **Glide-range ring**: new pure `glideRangeRadiusM(altAglFt, glideRatio =
  BEST_GLIDE_RATIO)` (tested, 4 cases in `tests/cockpit/mfd.test.ts`) —
  `BEST_GLIDE_RATIO = 9`, reused directly from the C172S's own POH-validated
  figure (`tests/validate/poh.test.ts`'s "glides ~9:1 ±0.8 at 68 KIAS",
  also in `PROGRESS.md`), not re-guessed. Drawn as a dashed green **circle**
  — an explicitly flagged simplification (wind-agnostic, not a wind-drifted
  ellipse); full wind-drift shaping was judged excessive scope for this
  task.

### 3D cockpit (`src/render/cockpit.ts`, additive edits)
- New `SwitchId` member `apMaster` + physical switch mesh, wired through
  `CockpitInteraction`.
- New NAV1/COM1 tuning: `nav1TuneUp/Down`, `nav1FlipFlop`, `com1TuneUp/Down`,
  `com1FlipFlop`, `obs1Up/Down` — small pushbutton meshes (click-only, no
  drag), per the brief's explicit "click-to-increment is fine, keep it
  simple" guidance rather than a fine analog drag knob. New pure
  `tuneFrequency(standbyMhz, deltaSteps, stepMhz, minMhz, maxMhz)` (tested,
  5 cases) does the clamped, float-drift-safe increment math.
  `CockpitInteraction.update` gained an optional `radios` param handling
  these new control IDs.
- **Deferred**: NAV2/COM2 physical knobs (state-only, no cockpit control);
  a full AP mode-select button panel (see autopilot section above).

### Airspace detection (`src/main.ts`)
- `airspacesContaining(ll, aircraft.data.altitudeFt, airspacePolygons)`
  computed once per rendered frame (not every physics tick — airspace
  shelves are large relative to per-frame motion, matching the brief's
  explicit "reasonable cadence" allowance) into `currentAirspace`, fed to
  the MFD map and exposed via `__ohAirspace()` for a later acceptance task.

## Debug hooks added
`__ohAirspace`, `__ohNav`, `__ohTune`, `__ohFpl`, `__ohProcedures`,
`__ohApMode`, `__ohApState`, `__ohMfdPage`, `__ohCam` (camera-mode switch —
added during browser verification because dispatching a real 'C' keypress
through the automated browser tool proved unreliable; useful for future
headless cockpit-camera checks regardless).

## Tests
- New: `tests/nav/tuning.test.ts` (10), `tests/cockpit/mfd.test.ts` +4
  (glide ring), `tests/render/cockpit.test.ts` +5 (`tuneFrequency`).
- Full suite: **294 passed** (275 baseline + 19 new), 23 files.
- `npx tsc --noEmit`: clean.
- `tests/sim-purity.test.ts`: green (`tuning.ts` added to `/sim/nav`, no
  three.js/DOM imports).

## Browser verification
Ran via `vite` dev server (serves `/api/*` through its own middleware, no
separate Express process needed) using the Browser pane.
- Boot: no console errors; `__ohData()` confirms `navaidsLoaded: true`,
  `airspaceLoaded: true`.
- Spawned at KSFO 28R: `__ohNav()` resolves a real `LOC` signal
  (`{source:"LOC", identifier:"KSFO 28R", ...}`) from the stopgap frequency
  table + real runway geometry.
- `__ohAirspace()` at KSFO correctly returns `SAN FRANCISCO CLASS B`
  (floor 0 / ceiling 10000) — confirms in-airspace detection is live.
- Cockpit camera screenshot at KSFO 28R: MFD map page renders the SF Class B
  shelf as a solid blue polygon around KSFO exactly per §6.5's styling,
  alongside real airport labels (KOAK/KHWD/KSFO/KHAF/KSQL/KPAO/KHMD); PFD
  HSI shows a real magenta CDI needle deflected off-center with a green
  "LOC KSFO 28R" source label (not the old inert "NO NAV"); AP annunciator
  bar renders (`FD OFF | ROL | PIT`).
- 20+ stepped frames with real nav/airspace/autopilot data flowing through
  the draw pipeline every frame (MFD's map page is the new default, so
  `drawMapPage`/`drawAirspace`/the glide ring all execute unconditionally,
  not just when the cockpit camera happens to be active): zero console
  errors throughout.
- **Not exhaustively confirmed**: pixel-precise 3D-raycast clicking of the
  *new* switch/knobs (AP master switch, NAV/COM tuning buttons) in the
  browser pane — a couple of click attempts at estimated mesh screen
  positions didn't land on the intended small meshes (they're tiny relative
  to the panel and precise 3D-to-screen aiming through this tool is fiddly).
  The interaction *code path* is verified by (a) type-checking, (b) unit
  tests of the pure math behind it (`tuneFrequency`), and (c) direct visual
  confirmation that the existing, structurally-identical switches/knobs
  (battery, alternator, fuel selector, throttle vernier) already work via
  this exact mechanism from Phase 3. Flagging this as residual risk for the
  acceptance task's own browser pass rather than claiming pixel-perfect
  confirmation I didn't actually get.

## Flagged assumptions / deviations
1. **`KNOWN_ILS_FREQUENCIES` stopgap table** (`tuning.ts`) — see above; not
   independently re-verified against a primary FAA source inside this repo
   (no such source exists in the data pipeline yet).
2. **Glide ring is a circle, not a wind-drifted ellipse** — explicitly
   flagged in `glideRangeRadiusM`'s doc comment as the chosen simplification.
3. **AP mode-select is debug-hook-only** (`__ohApMode`), not a physical
   panel — scope cut, noted above and in-line in `main.ts`.
4. **NAV2/COM2 have no physical cockpit knobs**, state-only.
5. **`navDeviation`/`glideslopeDeviation` feed 0 (not a distinct "invalid"
   value) when nothing is tuned/receivable** for whatever mode is currently
   selected — `AutopilotInputs` has no separate validity flag (by design,
   per `autopilot.ts`'s own doc: it's generic, doesn't know about signal
   validity). Practically: selecting APR/NAV mode without a receivable
   LOC/GPS source will fly toward a false "on course" reading of exactly 0.
   This mirrors a real avionics failure mode (a receiver reading a stale/
   centered CDI when a real GFC700 would instead flag the mode as
   unavailable and refuse to arm) — a real implementation would gate mode
   arming on signal validity; this wiring task didn't add that gate, since
   `autopilot.ts` (an already-reviewed, TDD'd file) wasn't meant to be
   restructured for it. Flagged for a follow-up rather than silently
   accepted.
6. **GPS phase-of-flight context is incomplete**: `computeGpsCdi` passes
   `distFromDepartureNm: Infinity` (no departure-airport tracking wired up),
   so phase determination relies only on distance-to-destination — adequate
   for a simple point-to-point or approach flight plan, not a full
   multi-leg cross-country's ENR/TERM transition on departure.
7. **Nav-source resolution is computed once per rendered frame**, not every
   fixed-timestep physics tick, and reused across that frame's sub-ticks —
   a documented approximation (aircraft position/nav geometry don't change
   meaningfully within one frame), not a full re-derivation each tick.

## Files touched
- New: `src/sim/nav/tuning.ts`, `tests/nav/tuning.test.ts`
- Edited: `src/main.ts` (bulk of the wiring), `src/cockpit/pfd.ts`,
  `src/cockpit/mfd.ts`, `src/render/cockpit.ts`, `tests/cockpit/mfd.test.ts`,
  `tests/render/cockpit.test.ts`
- Unchanged (used as-is): `src/sim/autopilot.ts`, `src/sim/nav/navaids.ts`,
  `src/sim/nav/gps.ts`, `src/sim/nav/airspace.ts`, `src/sim/nav/procedures.ts`
