# Stage 5 loading review — 2026-09-14

## Re-review — 2026-09-18

**Verdict: all three source findings resolved.** This re-review inspected the current `src/main.ts` implementations and `tests/loading-main.test.ts` against the Stage 5 brief and the fix report. It made no simulator source changes and did not rerun the already reported focused suite or type check.

- **P1 reset fuel metadata and running engine — resolved.** `resetSystemsState()` copies a fresh `makeFuelState(selectedLoading.leftKg, selectedLoading.rightKg)` onto the existing fuel state before applying the selected loading. This clears `_lastSelector`, `fuelFlowing`, `lowFuelFlag`, and `boostPumpOn` while retaining the chosen tank quantities. It also restores `ENGINE_START_BOOT_RUNNING` and the default BOTH selector. The actual-function regression starts with L selected, invokes reset, then steps BOTH and `stepEngineStart`; it checks fuel flow and a running engine after that first tick. Ordinary `applyLoading` still leaves fuel metadata alone.
- **P2 airborne snapshot trim mass — resolved.** `loadSnapshot()` calls `resetSystemsState()`, then applies the complete `snapshotLoading` before invoking `trim()` with `aircraft.massKg`. The regression uses preference payload 250 kg and snapshot payload 80 kg with 10/40 kg tanks; it checks the mass supplied to trim and the final payload and tank ledgers. The later common-path application is redundant for airborne loads but does not change this ordering or result.
- **P2 duplicate panel — resolved.** Current `main.ts` has one `new LoadingPanel(...)`, wired to `restoreSimInputIfNoEditorFocused`. An AST regression counts one constructor call. The single live DOM panel and focus behavior remain part of root-owned browser acceptance.

The prior findings below describe the state at the original review and are retained as the historical record.

Scope: loading-brief.md, loading-report.md, /tmp/openhorizon-stage5-review.diff, and corresponding current source integration. No simulator source edits, commits, browser sessions, or speech jobs were performed. Existing dirty work was preserved.

## Verdict

Spec: **with fixes**. Quality: **with fixes**. The pure loading model and panel substantially implement the requested behavior, but reset and snapshot integration have material lifecycle regressions. Resolve the three findings below before accepting Stage 5; browser focus/layout acceptance remains root-owned.

## Strengths

- Kilograms remain canonical; untouched rounded fields retain their exact underlying mass across unit changes. Blank, nonfinite, negative, and over-capacity values are rejected.
- Apply writes payload, both authoritative tanks, and the aircraft fuel mirror synchronously. The existing burn/selector model remains authoritative, and overweight payload is accepted with an aircraft-specific warning.
- The shared main apply path guards ground speed below 1 kt and ground contact. WEIGHT uses the same path. Per-aircraft preferences are separate, snapshots retain tank imbalance, and old total-only snapshots still split evenly.
- Defaults bound payload to useful load rather than giving every glider 250 kg. The new panel uses live quantities when opened, and queued blur restoration respects destination editors.

## Findings by severity

### P1 / Important — respawn retains the old fuel selector transition state

`src/main.ts:395` replaces full FuelState reconstruction with `applyLoading`, which only changes tank quantities. `_lastSelector`, `fuelFlowing`, low-fuel state, and boost-pump state survive. The same reset restores selector controls to BOTH and the engine to running. If the previous selector was L or R, the first `stepFuel` sees a tank transition with the default boost pump off, reports no fuel, and `stepEngineStart` stops the newly reset engine. Fuel flow recovers on the next tick, but engine start stays stopped without starter input. This affects ordinary respawn and snapshot loading after single-tank operation.

Targeted actual-module experiment: select L, apply the reset selection (30 kg per tank), then step BOTH at 1/60 s. Result: tanks remain 30/30 kg, `_lastSelector` becomes BOTH, `fuelFlowing` is false. The engine-start `!canRun` branch at `src/sim/systems/engine-start.ts:110` stops the engine.

Fix: recreate/reset FuelState metadata at respawn using the selected left/right quantities, while retaining ordinary Apply semantics. Add a lifecycle regression for L/R → respawn → first/second ticks with the engine still running.

### P2 / Important — airborne snapshot trim uses preference payload

`src/main.ts:625` assigns snapshot payload, but `resetSystemsState()` at line 635 immediately restores preference payload. Only snapshot fuel is restored before the trim solve at line 646. The final `applyLoading` restores snapshot payload after trim was calculated, leaving trim inconsistent with the restored actual mass.

Targeted experiment executed the actual extracted `loadSnapshot` function and actual loading helpers with a reset that reproduces the current selected-loading application. With empty mass 700 kg, preference payload 250 kg, snapshot payload 80 kg, and snapshot fuel 50 kg, the trim callback received **1,000 kg**, while final aircraft mass correctly became **830 kg**. This violates snapshot priority during initialization even though the final ledgers look correct.

Fix: after reset, apply the entire validated snapshot loading before the airborne trim solve. Cover the ordering with an integration test whose preference differs from snapshot payload, and assert the mass passed to trim as well as final tank values. The current safety snapshot test stubs reset to a no-op, so cannot detect this regression.

### P2 / Important — current main integration constructs the loading panel twice

At review time `src/main.ts:3355` and `src/main.ts:3363` both construct `LoadingPanel` with the same current/apply actions and slightly different focus-restoration callbacks. Both append a fixed-position details element with `id="loading-panel"` and a stylesheet. They overlap, duplicate IDs, and retain independent drafts/event handlers; DOM lookup and focus behavior can target a different instance from the visible one.

Evidence: current source contains two `new LoadingPanel(` expressions. This appears to be current integration drift beyond the supplied stage diff, but must be removed before acceptance.

Fix: keep one construction using the shared restoration callback. Assert a single live panel during root browser QA.

## Verification and limits

Accepted the reported focused results (450 passing tests, four skipped, then 12 loading tests and TypeScript success) without rerunning passing suites. Two narrow Node/TypeScript extraction experiments above were run solely to resolve concrete new concerns. No broader suite, browser, microphone, or hardware test was launched.

After fixes, run targeted reset/snapshot lifecycle regressions plus the appropriate type check. Root should verify a single panel, loading edits and unit switches, focus transfer to ATC, close/blur restoration, hardware-held-action behavior, and fresh mid-flight fuel on open. No additional independent blocker was found in the reviewed pure validation, normal application, preference isolation, or constructor changes.
