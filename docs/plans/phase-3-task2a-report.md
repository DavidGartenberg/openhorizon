# Phase 3, Task 2a — systems simulation (electrical, fuel, pitot-static, engine start)

Status: **DONE**

## Files created

- `src/sim/systems/electrical.ts` — 28V alternator + 24V battery, main
  (G1000-equivalent) bus and standby bus, amp-hour bookkeeping, alternator
  failure → battery drain → under-voltage load-shed of the main bus while
  standby stays powered until the battery itself is fully dead.
- `src/sim/systems/fuel.ts` — two 26.5 gal tanks, `L | R | BOTH | OFF`
  selector, boost pump flag, gravity-feed imbalance, starvation/restart.
- `src/sim/systems/pitot.ts` — `PitotStaticSystem` class: pitot heat,
  pitot-icing blockage (frozen-ram-pressure "behaves like an altimeter"
  pattern), independent static-port blockage (altimeter/VSI freeze, IAS
  stays correct). Pure function of true air data → indicated values; never
  touches `Aircraft.data`.
- `src/sim/systems/engine-start.ts` — cold/hot/flooded start state machine
  (`stopped → cranking → running`), magneto check RPM drop, distinct
  hot-start and flooded-start technique requirements.
- `src/sim/systems/mixture.ts` — `egtC(mixture)`: EGT curve with a genuine
  local peak between full rich and idle cutoff, for the later lean-assist
  page. Does not touch `propulsion.ts`'s power model.

## Files changed

- `src/sim/aircraft.ts` — added one new optional field, `engineRunning = true`
  (default preserves all existing behavior/tests), and ANDed it into the
  existing `fuelAvailable` condition passed to `stepPropulsion`:
  `this.fuelKg > 0.5 && this.engineRunning`. This is the same pattern as
  the existing `groundElevAt` field — additive, opt-in, zero effect on
  current callers. It's what lets `engine-start.ts`'s state machine (via a
  later main.ts wiring task) make "engine not running" a real state: zero
  fuel available → zero power → thrust decays through the existing
  windmilling-drag branch of `propulsion.ts`, already exercised by the
  fuel-starvation path. No aero/gear/propulsion math was touched.

## Tests added (`tests/systems/`)

- `electrical.test.ts` (4 tests): normal charge/28V, alternator-failure
  drain over 10 simulated minutes, G1000-load-dies-while-standby-survives
  at the load-shed SOC threshold then full depletion kills standby too,
  master-battery-off kills everything.
- `fuel.test.ts` (7 tests): independent L/R depletion, BOTH even split with
  exact burn-matches-demand check, starvation on tank-empty, restart on
  reselecting a fueled tank, OFF selector, low-fuel flag.
- `pitot.test.ts` (6 tests): normal reads true values, heat-off-but-no-icing
  is fine, pitot-blocked-climb shows rising IAS (altimeter-like), blocked
  descent shows falling IAS, static-blocked freezes alt/VSI while IAS stays
  correct, unblocking restores true readings.
- `engine-start.test.ts` (6 tests) + mixture/EGT sweep (1 test): full
  cold-and-dark start reaches running, magneto check drop asserted in the
  100-150 RPM range with ≤50 RPM L/R difference, engine dies on magneto-off
  and restarts, flooded-start fails with normal technique and succeeds with
  the POH flooded technique (throttle open, mixture not rich, no prime),
  hot-start succeeds normally but priming a hot engine floods it, EGT sweep
  finds a genuine interior local maximum (not monotonic, not at either
  boundary).

## Verification run

```
npx tsc --noEmit        → clean, no errors
npm test                → 11 files, 63 tests, all passed
                           (40 pre-existing + 23 new; 0 failures)
npx vitest run tests/sim-purity.test.ts → 2/2 passed
grep for `from 'three'` / `document.` / `window.` in src/sim/systems/
  and src/sim/aircraft.ts → none found
```

## Concerns / flagged assumptions (no POH source available in-repo)

Per the "no LLM-guessed magic numbers without a comment citing the source"
rule, every constant below is called out in its file's header comment as a
representative/assumed value rather than a POH-verified number, since this
repo does not carry the actual C172S electrical-load table, battery spec
sheet, or engine-start POH page text. A later task should replace these
with real POH numbers if/when sourced:

- **electrical.ts**: battery capacity (25.5 Ah, "Concorde RG-25XC-class"),
  alternator max current (60A), main/standby bus load currents (12A / 1.2A),
  charge current (10A), battery-only voltage range (20-25V), and the
  under-voltage load-shed threshold (15% SOC).
- **mixture.ts**: peak-EGT temperature (732°C / ~1350°F) and the mixture
  fraction at which it occurs (0.35 on the existing 0-1 `Controls.mixture`
  scale), full-rich EGT (620°C), and ambient/no-combustion EGT (15°C).
  These are representative textbook Lycoming lean-technique figures, not
  IO-360-L2A-specific published data.
- **engine-start.ts**: cranking RPM (180), minimum/maximum crank duration
  (1.5s / 10s), RPM decay rate when stopped (400 RPM/s), and the specific
  per-magneto drop split (110/125 RPM — chosen to fall inside the
  POH-standard 100-150 RPM/≤50 RPM-difference range that the test actually
  asserts, so the *range* is real POH doctrine even though the exact split
  is a representative pick).
- **fuel.ts**: the low-fuel annunciation threshold (25% of combined
  capacity) is a conservative pick, not a POH-published warning point;
  tank capacity (26.5 gal/tank) came directly from the task spec, not
  guessed.

Nothing in `src/sim/aero.ts`, `src/sim/gear.ts`, `src/sim/propulsion.ts`'s
existing tables, or `src/sim/aircraft/c172s.ts` was modified.
