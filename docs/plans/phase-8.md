# Phase 8 plan — Recorder, logbook, training, activities (§18–§21)

## Slices (one commit each)

- **8a. Flight recorder + landing debrief (pure, TDD).**
  `src/sim/recorder.ts`: 10 Hz sample ring (t/lat/lon/alt/ias/vs/hdg/
  pitch/roll/agl/onGround) + typed events; `analyzeLanding(samples,
  runwayRef)` → touchdown VS (fpm), G, distance past threshold, centerline
  offset, grade bands (POH-informed: ≤200 smooth / ≤400 firm / ≤600 hard /
  crash-guard beyond). Synthetic-flight tests.
- **8b. ACS maneuver graders (pure, TDD).** `src/sim/training/graders.ts`:
  steep-turn grader vs real ACS tolerances (±100 ft, ±10 kt, 45°±5 bank,
  rollout ±10°) over recorder samples; pattern/landing uses 8a. Full
  curriculum beyond these is a recorded deviation (roadmap).
- **8c. Wiring + persistence + UI.** Recorder always on (ring, ~20 min);
  touchdown auto-debrief (HUD line + transcript-style overlay via L key);
  logbook entries (date/route/duration/landings + best touchdown) persisted
  in localStorage with JSON export via hook (IndexedDB from §19 downgraded
  to localStorage — recorded deviation, entries are tiny); `__ohLogbook`/
  `__ohDebrief` hooks. Browser acceptance: scripted pattern → landing →
  debrief numbers real → entry persists across reload.
- **8d. Landing challenges (§21, compact).** Three real strips (KAVX
  Catalina cliff, KASE Aspen, KTVL Tahoe) launchable from the search box
  ("challenge catalina"), scored by the 8a analyzer; best scores persisted.
  Bush trips / discovery tours → recorded deviation (roadmap).

## Conventions

Recorder samples are the ONLY input graders see (no reaching into live
state) — what the debrief says is provably what was flown. Persistence
never blocks the frame loop; storage failures degrade to session-only.
