# Stage 5 loading report

## Result

Implemented an editable Fuel & payload panel backed by one pure loading model and the existing authoritative two-tank fuel ledger. The panel edits pilot/passenger/bag payload and left/right fuel in kg or lb, and displays total fuel, empty weight, gross MTOW, actual gross weight, validation errors, and a clear aircraft-specific overweight warning.

Applying is allowed only while the aircraft is on the ground and below 1 kt. Draft typing never changes aircraft mass. A successful apply changes payload, both tanks, and the aircraft fuel mirror together. Deliberate overweight loading remains valid and is reported rather than clipped.

Per-aircraft loading preferences are stored independently and used for the next boot or respawn. Reset no longer fills tanks unconditionally. New snapshots save left/right tanks; old total-only snapshots split the total evenly. Snapshot loading is applied after respawn defaults, so it has priority over preferences.

The compatibility `WEIGHT <lb>` command now uses the same validation, ground guard, MTOW warning, live tank quantities, and preference path. The C172-only W&B envelope remains limited to the C172 display path.

Aircraft constructor payload now uses 250 kg where that remains within MTOW with full fuel, and otherwise bounds payload to available useful load. This prevents small aircraft and gliders from booting overweight while preserving established GA and airliner defaults where valid.

## Tests and decisions

Added `tests/loading.test.ts` covering kg/lb conversion, NaN, negative and tank-capacity rejection, overweight acceptance/warning, ground guard, transactional application, actual mass, burn persistence and imbalance, GA/airliner/small-aircraft defaults, independent per-type preferences, corrupt preference handling, and old/new snapshots.

TDD red evidence included the pre-change J3 default at 627.7 kg versus 553.4 kg MTOW and a malformed stored preference throwing while reading a missing selection. Both now have passing regression coverage. The existing snapshot extraction harness was extended with the new loading dependencies and current voice-reset locals; no voice behavior was changed.

Focused final verification commands:

```text
npx vitest run tests/loading.test.ts tests/systems/fuel.test.ts tests/safety-snapshot.test.ts tests/fleet-params.test.ts tests/validate/roster.test.ts tests/validate/poh.test.ts tests/validate/j3cub.test.ts tests/validate/b738.test.ts --maxWorkers=1 --fileParallelism=false
npx tsc --noEmit
```

Results: 8 test files passed, 450 tests passed, 4 skipped; TypeScript exited 0 with no diagnostics.

## Limits

Browser layout, focus transitions, and real interaction remain for root-owned browser QA. No browser, microphone, Whisper child, hardware process, commit, or deployment was started here.

## Root source-QA follow-up

Moved the panel from bottom-left to a responsive top-right position, separating it from the existing bottom-left ATC voice/status stack. Width is constrained to the viewport up to 290 px, and the expanded controls scroll within the available height on short viewports.

The panel now retains authoritative kilograms for every untouched field. Display rounding in pounds therefore cannot turn a full tank into an over-capacity draft, and repeated unit switches do not change canonical mass. A field becomes display-derived only after the user edits it. Blank or whitespace-only edited fields are rejected rather than converted to zero.

Focus restoration remains queued to allow the destination focus event to fire, and main checks the current active element before enabling flight input. Moving directly into the ATC input, another input, textarea, select, or contenteditable element therefore preserves the disabled flight-control state.

Follow-up verification was deliberately narrow per root direction:

```text
npx vitest run tests/loading.test.ts --maxWorkers=1 --fileParallelism=false
# 1 file passed, 12 tests passed

npx tsc --noEmit
# exit 0, no diagnostics
```

## Independent review fixes

Resolved all three findings in `loading-review.md` with regressions against the actual `main.ts` function bodies:

- `resetSystemsState` now reconstructs `FuelState` from the selected left/right quantities before applying payload and the fuel mirror. Selector transition history, flow/low flags, and boost state reset cleanly; the first BOTH tick after a previous L selection supplies fuel and the reset engine remains running. Ordinary panel/WEIGHT Apply still changes quantities only and preserves selector metadata.
- Airborne snapshot loading is applied in full immediately after systems reset and before trim. The trim solve now receives the same snapshot payload and imbalanced tank total retained in final aircraft state.
- Removed the duplicate `LoadingPanel` construction. An AST regression asserts exactly one constructor call in current main integration.

Fresh focused verification:

```text
npx vitest run tests/loading-main.test.ts tests/loading.test.ts tests/systems/fuel.test.ts tests/safety-snapshot.test.ts --maxWorkers=1 --fileParallelism=false
# 4 files passed, 27 tests passed

npx tsc --noEmit
# exit 0, no diagnostics
```

## Sept18 root browser acceptance
Full main simulator, Boeing737: exactly one live `#loading-panel`; visible top-right
editor separate from bottom-left voice panel. Payload250→800 applied, then restored
to250. A blank field cleared by real keyboard input displayed finite-number error
and Apply left it invalid. kg→lb→kg retained250kg and original tank quantities.
ATC editor accepted typing after focus transfer without triggering flight keys.
Test input cleared and preview reloaded; loaded terrain185tiles and voice readiness.
Still verify alternative aircraft/airborne rejection and hardware held-actions
in whole-project/control integration checks. Original test payload restored.

## Sept18 root browser follow-up (22:58 EDT; Sept19 UTC)

The main simulator passed the remaining cross-aircraft and airborne checks through
its normal controls. A temporary B738 selection of 1250 kg payload and 10000 kg in
each tank was applied on the ground. `FLY 172` showed its independent 250 kg payload
and approximately 72.1 kg per tank. Returning with `FLY 737` restored 1250 kg and
9999.8 kg per tank after brief idle fuel burn. The B738 was then restored to its
previous displayed selection: 250 kg payload, 10440.2 kg left, 10440.2 kg right.

`KHAF 30 FINAL` followed by simulation advancement and pause showed 146 KIAS,
1490 ft AGL, without the ground flag. Changing payload to 800 kg and pressing
Apply returned `Land and stop before applying loading changes.` Closing and
reopening the panel showed the authoritative 250 kg payload and fuel reduced only
by the short approach run. Thus the rejection did not apply the draft or persist
it as the aircraft preference. Returned to KHAF 30 on the ground, paused, thrust
zero, parking brake ON, with the controller panel open. No hardware calibration
was saved. Physical held-control interaction remains a separate acceptance item.
