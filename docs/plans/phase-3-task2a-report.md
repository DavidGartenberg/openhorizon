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

---

## Task-review fix pass (2026-07-15)

Two Important findings from task review of `bcec3c3` were addressed.

### Finding 1 — EGT cliff at lean-cutoff boundary

**File:** `src/sim/systems/mixture.ts`

The old code returned a hard-clamped `AMBIENT_EGT_C` (15°C) for any
`mixture <= LEAN_CUTOFF` (0.12), while mixtures just above 0.12 sat on the
still-hot side of the parabola (~719°C at m=0.13). That's a ~700°C jump
over a 0.01 mixture step — an instrument-breaking cliff, and it contradicted
both the file's own "EGT falls gradually" doc comment and the smooth,
linear `mixturePowerFactor` in `propulsion.ts` this file claims to mirror.

Fix: added a smoothstep-blended taper band (`EGT_TAPER_BAND = 0.15`, i.e.
mixture ∈ [0.12, 0.27]) that blends EGT from `AMBIENT_EGT_C` (at the cutoff,
matching the flat region below it in both value and zero slope) up to the
raw parabola value (at the top of the band, matching the parabola's value
there). Below 0.12, behavior is unchanged (flat ambient — the engine is
modeled as not sustaining combustion there, which is a real state
transition, just no longer combined with a value-cliff at the boundary).
The band (0.15 wide) sits well clear of `EGT_PEAK_MIXTURE` (0.35), so the
genuine local peak used by the sweep test is untouched.

Verified by hand-computing the blended curve at 0.01 steps through the
band: the steepest single-step change is ~71°C (well under the ~150°C
threshold), versus ~700°C in a single step under the old code.

Added a new test in `tests/systems/engine-start.test.ts`
(`'falls gradually toward ambient near lean cutoff — no
instrument-breaking cliff'`) that sweeps mixture 0.4 → 0.05 in 0.005 steps
and asserts every consecutive-step EGT delta is `< 150°C`. The pre-existing
peak-sweep test (`'has a genuine local peak somewhere...'`) was left
untouched and still passes.

### Finding 2 — Fuel boost pump was UI-inert

**File:** `src/sim/systems/fuel.ts`

`boostPumpOn` was accepted, stored, and passed through, but nothing in
`stepFuel` read it — flipping the switch had zero effect on simulated fuel
delivery, and this gap wasn't disclosed in the original report.

**Chose option (a):** gave the boost pump a real, testable effect, without
inventing an unrelated turbulence/unporting model. Real POH guidance for
light singles with an electric boost pump is to switch it on during
tank-selector changes, because the engine-driven pump can momentarily lose
prime while the selector valve is mid-transition. That maps directly onto
the file's existing selector-based flow model:

- `FuelState` gained an internal field, `_lastSelector`, to detect
  selector transitions across steps.
- `stepFuel` now treats a switch between two fuel-supplying selector
  positions (L/R/BOTH → a *different* one of those) as causing a one-step
  flow interruption (`fuelFlowing = false`, no fuel consumed that step)
  *unless* the boost pump is on, in which case flow continues
  uninterrupted through the switch. Transitions into/out of `OFF` are not
  treated as a "switch" (there's no flow on the OFF side to interrupt).
- This is documented in the file's header comment and inline in
  `stepFuel`, including an explicit note that no turbulence/unporting model
  exists yet in this file — the pump only backstops the modeled
  selector-transition hiccup, nothing else.

Updated the pre-existing test `'switching to a tank with fuel restores flow
after starvation'` (it now expects the one-step interruption on the switch
step, then flow restored the following step — this is the new, more
realistic behavior, not a loosened assertion) and added a `'boost pump'`
describe block with 4 new tests covering: interruption without the pump,
no interruption with the pump on, no interruption when the selector is
unchanged, and `boostPumpOn` being reflected on state.

**Disclosed limitation:** this does not model turbulence, unusual
attitudes, or tank unporting — there is no such model in this file to
backstop. If one is added later, the boost pump's effect should likely be
extended to cover it too.

### Test results

```
npx vitest run tests/systems/fuel.test.ts tests/systems/engine-start.test.ts
✓ tests/systems/fuel.test.ts (11 tests)
✓ tests/systems/engine-start.test.ts (7 tests)
Test Files  2 passed (2)
     Tests  18 passed (18)

npm test
✓ tests/systems/electrical.test.ts (4 tests)
✓ tests/loop.test.ts (7 tests)
✓ tests/nan-ground.test.ts (2 tests)
✓ tests/handling.test.ts (5 tests)
✓ tests/validate/poh.test.ts (10 tests)
✓ tests/sim-purity.test.ts (2 tests)
✓ tests/systems/engine-start.test.ts (7 tests)
✓ tests/geo.test.ts (9 tests)
✓ tests/systems/fuel.test.ts (11 tests)
✓ tests/solar.test.ts (5 tests)
✓ tests/systems/pitot.test.ts (6 tests)
Test Files  11 passed (11)
     Tests  68 passed (68)
```

68 = 63 previous + 5 new (1 EGT continuity test + 4 boost-pump tests).

`npx tsc --noEmit` — clean, no output.

`tests/sim-purity.test.ts` — passing (included in the full-suite run above),
confirming no three.js/DOM imports were introduced.

### Files touched in this pass

- `src/sim/systems/mixture.ts`
- `src/sim/systems/fuel.ts`
- `tests/systems/engine-start.test.ts`
- `tests/systems/fuel.test.ts`
- `docs/plans/phase-3-task2a-report.md` (this section)
