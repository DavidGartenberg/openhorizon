# Independent DG800 signed simulation review

2026-09-21. Read-only review of production and test code; only this report was written. No Git or original-asset operations. Read both `dg800-simulation-brief.md` and `dg800-flaperon-design.md` completely, including the superseding maintenance-manual and stall-calibration corrections, plus `dg800-simulation-report.md` and the exact pre-edit baseline comparison `dg800-simulation-review.diff`. Checked actual source rather than relying on the report. Renderer geometry is being revised independently and is outside this verdict.

## Spec verdict: substantially implemented, changes required

The implementation supplies all seven signed detents, source-derived L and neutral-flap differential travel, shared aero/render decomposition, documented provisional linkage persistence, signed input and snapshot migration, corrected stall anchors, explicit final +13 selection, and glider-specific callout handling. The later +5 airbrake endpoint approximation correctly supersedes the earlier negative-only proposal. The report honestly distinguishes source measurements, geometric conversions, interpolation, estimated coefficients, and omitted spring force. No unsupported factory polar or full-fidelity claim was found.

Two behavior requirements remain unmet in observable transitions: the imposed physical flap floor is violated while airbrakes extend, and a fresh same-position hardware-button selection is not deliberate. Findings below block accepting the bounded mechanism/input contract.

A narrower metadata discrepancy also remains: the design requests separate neutral/default metadata and zero-angle validation, but only `flapDefaultIndex` is implemented (`src/sim/aircraft/params.ts:98`, `src/sim/aircraft/derive.ts:379`, `src/sim/flaperons.ts:3`). Current DG80 correctly uses index 2 for both; this does not break its present configuration. Either complete the specified separation/validation or explicitly narrow the contract to a neutral-only default before claiming every spec item passed.

## Code verdict: request changes

### [P2] Constrain physical flap state during airbrake deployment, not only its target

Location: `src/sim/aircraft.ts:287-291` (airbrake actuator advances at lines 279-283).

`heldFlapFloorDeg` constrains `flapTarget`, then the ordinary 8 degree/second flap rate limiter leaves the actual flap below the required linkage floor. The DG80 brake rate is 1/second, so the chosen -9 to +5 floor rises at 14 degrees/second. Aero and geometry agree with each other, but both display/use a mechanically impossible state under the implementation's own declared floor.

Reproduced through actual `Aircraft.step`, without replacing its mixer: create DG80, `resetFlaps(0)`, place it airborne with `applyTrimState(30, .03, 1000, 0, 0, 0, 0, 0)`, command `spoilerCmd=1`, and step at 120 Hz. Results:

| Elapsed seconds | Actual airbrake | Held minimum degrees | Actual/aero mean degrees at neutral roll |
| --- | --- | --- | --- |
| 0.25 | 0.25 | -5.5 | -7 |
| 0.50 | 0.50 | -2 | -5 |
| 0.75 | 0.75 | +1.5 | -3 |
| 1.00 | 1.00 | +5 | -1 |

At full airbrake travel the flap is six degrees below the chosen linkage endpoint; it reaches +5 only after another 0.75 seconds. Existing tests wait two seconds and therefore miss the violation.

Make the actual coupled actuator states obey the floor before aero evaluation. A floor applied after normal flap slew, or an explicitly coupled airbrake slew that cannot outrun the flap, can enforce this; document the selected actuator assumption. Add transient assertions at each physics tick, including partial deployment, rapid retract/redeploy, and dt subdivision, rather than only settled values.

### [P2] Treat a fresh press of a mapped flap position as a deliberate selection

Location: `src/main.ts:1091` and `src/sim/aircraft.ts:197-199`.

All five mapped flap-position buttons use `selectFlaps(index, false)` whenever latched. This correctly prevents steady polls from clearing held linkage, but it also ignores a genuine release/repress of the same position. With the brakes down and flap command -9, a displaced +5 flap remains held after the pilot deliberately reselects the -9 button. The specification explicitly distinguishes steady polling from new hardware-button events.

Reproduced using the actual main-function extraction harness in `tests/dg800-main.test.ts` with a real Aircraft: bind `flaps0` to button 0, press once (selecting index 0), set the modeled held displacement and actual flap to +5 with airbrakes down, release/poll, then press/poll again. Output remains `{ index: 0, heldFloor: 5, airbrake: 0 }`. Calling the actual deliberate API `selectFlaps(0)` immediately gives `heldFloor: -9`, isolating the missing event semantics in main rather than the mechanism API.

Use the existing button rising-edge result to mark a new selection as deliberate while retaining non-deliberate steady latched polling. Test same-position release/repress, held polling, and reconnect/focus behavior so a synthetic reconnection does not unexpectedly clear linkage.

## Checks and coherent behavior

Ran independently:

```text
npx vitest run tests/dg800-simulation.test.ts tests/dg800-main.test.ts --maxWorkers=1 --no-file-parallelism
Test Files 2 passed (2)
Tests 24 passed (24): main 14, simulation 10
```

The two additional executable probes above demonstrate actual failures that this green suite misses. The first attempt to load the extracted main harness outside Vitest needed TypeScript CommonJS `esModuleInterop`; after correcting that probe-only loader option the second reproduction ran successfully. No production/test file was edited for either probe.

Reviewed constructor and ground/default reset, final spawn, Keyboard F/G/R, hardware steps/axis/five-position mapping, saved aircraft identity and physical command, legacy DG80 neutral migration, invalid angle fallback, foreign-snapshot rejection before loading, common/differential aero and neutral-roll trim, bounded positive compatibility `flapFrac`, non-DG80 bypass, and callout capability gates. No further current-DG80 regression was established in these paths. The snapshot deliberately reconstructs trimmed state and resets held history; it does not promise maneuver restoration. The primary new schema blocks identified foreign aircraft; unidentified legacy saves inherently cannot identify their originating aircraft.

The metadata tables retain bounded estimation honestly. At full roll the mixed mean can extend below -9 while coefficient interpolation clamps to its calibrated endpoint; this is another limit of the stated whole-wing model, not factory data for that combined condition. A future refinement must not silently represent those coefficients as measured nonzero-flap mixer or section behavior.

The independently rerun quantitative tests reproduce neutral glide 43.436:1 at 54 kt TAS/1000 m/525 kg with solver residual 2.94e-7, and reported transient stall errors of approximately +3.26 to +3.79 kt. The stall probe still descends 269-303 fpm at detection; its 4.5 kt acceptance band is a model regression bound, not proof of manufacturer stall accuracy. The all-detent trim test proves solver convergence and a finite single Aircraft step, not long-duration stability. These qualifications are appropriately present in the implementation report and must survive the final handoff.

## Remaining acceptance

1. Correct both findings and add failing-then-passing transient/event regressions. Resolve or explicitly narrow the neutral/default metadata contract.
2. Repeat focused DG800/main plus glider/callout/fleet regressions after fixes; root owns full suite, validation and build. The report's earlier “main12 GREEN” is stale relative to the independently verified main14 result.
3. Integrate the final renderer geometry, then inspect actual signed moving skin, both drive stations, roll directions and combined extremes in browser screenshots. Static plumbing agreement alone does not close moving-mechanism acceptance.
4. Verify real quadrant identity/calibration, seven-detent axis/step access, the honest five-position subset, and deliberate-reselection behavior using physical hardware.
5. Retain measured linkage schedule/return behavior, nonzero-flap differential map and stops, spring-force modeling, IAS/CAS calibration, stabilized stall/trim and flap-dependent polar accuracy as explicit fidelity limits until supported by evidence.

This is a bounded code/spec review, not full aircraft or project acceptance.
