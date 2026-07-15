# Phase 3, Task 2c — G1000 MFD + EIS

## Files created / modified

Created:
- `src/cockpit/mfd.ts` — `drawMfd(ctx, width, height, data: MfdInput)`, mirroring
  `pfd.ts`'s pattern: pure layout-math functions (bar-gauge fractions, map
  projection/filtering, softkey geometry) separated from and used by the
  actual canvas draw calls.
- `src/sim/systems/engine-temps.ts` — oil temp / oil pressure / CHT thermal-lag
  model (see "Oil temp / CHT choice" below).
- `tests/cockpit/mfd.test.ts` — 27 tests covering the pure math.
- `tests/systems/engine-temps.test.ts` — 10 tests covering the thermal model.

Modified (small, additive):
- `src/sim/systems/fuel.ts` — exported `kgToGal()`, reusing the file's
  existing `LB_PER_GAL`/`KG_PER_LB` constants, so the MFD fuel-qty gauge
  doesn't reinvent the conversion.
- `src/sim/systems/mixture.ts` — exported `EGT_PEAK_MIXTURE` and `EGT_PEAK_C`
  (previously private), so the MFD lean-assist page can compute a
  delta-from-peak readout without re-deriving the curve's peak.

No changes to `src/main.ts`, `src/render/`, `aircraft.ts`, or `c172s.ts`.

## Oil temp / CHT: option (a) chosen (small thermal-lag model)

Went with option (a): `src/sim/systems/engine-temps.ts` adds `EngineTemps`
(`oilTempC`, `oilPressPsi`, `chtC`) + `stepEngineTemps()`, a first-order
exponential-approach-to-equilibrium model, same shape as `mixture.ts`'s EGT
curve and `electrical.ts`'s battery model. Oil temp and CHT approach an
RPM-dependent equilibrium over a time constant (oil: 180s, large sump; CHT:
45s, less thermal mass / more cooling airflow); oil pressure is
pump-driven and modeled with a short 2s lag so it responds quickly but not
as an instant step function. This kept the gauges honest and real rather
than adding a fake needle position, and reused the exact "exponential
approach with flagged constants" pattern already established in this
codebase, so it was a small, focused addition (~90 lines) rather than a
new subsystem.

Chose (a) over (b)/INOP because the task's own steer ("prefer (a) if you
can do it in a focused, small way") applied cleanly here — the model is a
single reusable `approachExp()` helper plus three equilibrium-lookup
functions, not a new thermodynamic simulation.

## Flagged assumptions (no POH source in this repo)

All flagged inline in `engine-temps.ts`'s header/constants, same caveat
status as `mixture.ts`'s EGT constants and `electrical.ts`'s battery specs:
- `OIL_TEMP_TAU_S = 180`, `CHT_TAU_S = 45`, `OIL_PRESS_TAU_S = 2` — representative
  time constants, not sourced.
- `OIL_TEMP_MAX_C = 118` (≈245°F redline), `OIL_TEMP_CRUISE_C = 90`,
  `CHT_MAX_C = 260` (≈500°F redline), `CHT_CRUISE_C = 190`,
  `OIL_PRESS_MIN_GREEN_PSI = 25`, `OIL_PRESS_CRUISE_PSI = 70`,
  `OIL_PRESS_MAX_PSI = 100` — representative Lycoming IO-360-class figures.
- In `mfd.ts`: `RPM_GAUGE_MAX = 3000` (gauge headroom above the real
  `C172S.redlineRpm`), `FF_GAUGE_MAX = 20` gph, `EGT_GAUGE_MAX = 900`°C
  (headroom above the already-flagged `EGT_PEAK_C ≈ 732`), the ±15°C
  "near peak" highlight band on the lean-assist page, and the
  `MFD_SOFTKEY_LABELS` set (functionally inert this task, same status as
  `PFD_SOFTKEY_LABELS`) — all layout/UI choices with no in-repo source.

## Map page design notes

`drawMfd`'s `MfdInput.map` (`MfdMapInput`) takes pre-queried results rather
than a `TileManager`/`Airports` instance directly, so the pure "which
airports are in range, what to draw where" logic (`filterAirportsInRange`,
`projectToMap`, `mapElevationGridOffsets`, `elevationColor`) has zero
three.js dependency and is unit-tested standalone. A later wiring task is
expected to call `Airports.near(...)` and `TileManager.elevationAt(...)`
and map the results onto `MapAirport`/`MapElevationSample`. Supports both
north-up and track-up. No airspace/traffic overlays (per phase-3 deviations).

## FPL page

Visual skeleton only: header, `WPT/DTK/DIS/ETE` column labels, and an
honest "NO ACTIVE FLIGHT PLAN" empty state — no waypoints invented, no
flight-plan logic (Phase 4).

## Page switching

`MfdInput.page: 'map' | 'lean' | 'fpl'` selects the body page; the EIS
strip (`drawEis`) always renders on the left regardless of page, per
§8.3. `mfdSoftkeyRegions(width, height)` exports click-target geometry
(same pattern as `pfdSoftkeyRegions`) for a later 3D-cockpit raycast task.

## Test results

```
npx tsc --noEmit   → clean, no errors
npm test           → 14 test files, 127 tests, all passing
                      (90 pre-existing + 27 in tests/cockpit/mfd.test.ts
                      + 10 in tests/systems/engine-temps.test.ts)
```

`tests/sim-purity.test.ts` still passes — `engine-temps.ts` imports nothing
beyond plain arithmetic, no three.js/DOM.

One test bug fixed during verification: an exponential-decay assertion
(`oilPressPsi` after engine shutdown) initially checked `toBe(0)`, which
floating-point decay asymptotes toward but never exactly reaches;
changed to `toBeCloseTo(0, 6)`.
