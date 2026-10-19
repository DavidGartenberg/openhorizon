# DG80 signed simulation integration report

2026-09-21. Bounded code integration; not full-fidelity or physical-hardware acceptance. Binding sources are `dg800-simulation-brief.md` and the complete `dg800-flaperon-design.md`, including the later maintenance-manual and stall calibration corrections. Root created the pre-edit source/test baseline at `/tmp/openhorizon-dg800-sim-baseline-sept21`.

## Changes

Production files:

- `src/sim/flaperons.ts`: pure finite detent normalization, airbrake floor and asymmetric physical mixer; no DOM/Three dependency. Positive roll lowers left and raises right. Effective mean drives aerodynamic flap, half-difference drives aerodynamic aileron; combined travel is not clipped to pure-flap endpoints.
- `src/sim/aircraft/params.ts`: optional default detent, signed labels and flaperon mechanism metadata.
- `src/sim/aircraft/c172s.ts`: shared interpolation clamps against first signed detent; nonfinite angle uses neutral zero, singleton behavior retained.
- `src/sim/aircraft/roster-ext.ts`: DG-800S (18 m) identity, seven signed detents, neutral index 2, source-based stall anchors and explicit estimated aerodynamic increments.
- `src/sim/aircraft/derive.ts`: validate final merged detents/coefficient tables/default/labels; capable aircraft vs0 derives from final CLmax table rather than ignored scalar.
- `src/sim/aircraft.ts`: coherent constructor/ground reset, `selectFlaps(index, deliberate=true)`, `resetFlaps(index=default)`, held airbrake floor, actual actuator-before-aero coupling, and effective physical surface capture. Repeated polling of the same detent does not release the linkage; fresh selection does, subject to the current actual airbrake position.
- `src/sim/trim.ts`: shared neutral-roll decomposition before force evaluation.
- `src/main.ts`: F/G, hardware step/axis/five-position controls use selection API; ground/KeyR reset to aircraft default. DG80 final explicitly selects +13, not an inferred L. Renderer receives signed mean and explicit left/right physical angles; compatibility flapFrac remains bounded 0..1. Diagnostics identify signed selection, actual common actuator angle, five-position subset and UNPOWERED capability. Copilot receives physical angle/capability. DG80 final and trimmed restore clear actual airbrake position.
- `src/sim/copilot.ts`: physical positive angle cleanup criterion; suppress powered takeoff/climb calls for gliders. Main avoids generating invented glider takeoff speeds.
- `src/sim/taws.ts`: optional capability inhibits inapplicable landing-flap warning while leaving other terrain warnings active.
- `src/input/speedbrake-control.ts`: non-auto V cycle returns AIRBRAKES FULL/DOWN; jet ARM cycle preserved.

Tests: new `tests/dg800-simulation.test.ts`; root-authored `tests/dg800-main.test.ts` executes extracted actual main functions with a real Aircraft. Existing controller harness adjustments belong to root.

No renderer geometry/native asset, global hardware polarity/calibration, dependencies, publication, Git or Xcode operations were performed.

## Mechanical and aerodynamic provenance

Manufacturer DG-800S maintenance-manual scan, December 2009, printed 1.6–1.8: neutral-flap root travels at radius122mm are up42±3mm/down21±3mm, landing38±3mm. Thus nominal L=asin(38/122)=18.1481680501°, with source tolerance corresponding to about16.672–19.637°. Display label is L, not spurious precision. Detents are -9,-5,0,+5,+10,+13,L. The sourced roll increments are asin(42/122) up and asin(21/122) down at flap zero. Constant differential increments at other flap settings are an explicit approximation; the manual did not establish combined stops.

Actual airbrake position imposes a nominal floor `-9+14*s` degrees. The greatest imposed floor remains held after retraction until a deliberate flap selection. Both the linear schedule and held-return behavior are explicit simulation assumptions. Full extension reaches +5 nominal; the actual source says handle about10mm behind +5, which is NOT converted to a claimed exact flap angle. Higher positive detents remain unaffected. Existing8°/s actuator rate remains estimated. Negative-flap spring control-force bias is omitted; no invented trim tab, moving stabilizer or duplicated spring pitching moment.

FM printed5.4, 18m/525kg, retracted-airbrake stall row:88/84/77/76km/h at -9/0/+13/L. Neutral input is84/1.852kt, correcting prior37kt (37 appears at440kg/L). The table does not explicitly identify IAS/CAS and its separate calibration curves were not digitized: IAS≈CAS is a disclosed approximation. With repository11.8m² wing and SI constants, CLmax increments are [-.116241553,-.064578640,0,.095654945,.191309890,.248702857,.289948651]. Intermediate detents interpolate measured endpoints; they are not measurements. Final vs0 rounds to41kt.

CL0 increments [-.09,-.05,0,.05,.10,.13,.18], drag increments [.0008,.0003,0,.0004,.0016,.003,.006], and Cm increments [.018,.010,0,-.010,-.020,-.026,-.036] are bounded estimates, not inferred factory polars. Neutral values remain zero. Existing whole-wing aero, elevator lift, poststall shape and glider brake coefficients remain unchanged. No extended-airbrake stall rows were force-fitted because actual configuration/linkage interpretation remains unresolved.

## Lifecycle and input contract

Snapshot v1 gains aircraftId, flapSchema1 and physical flapCommandDeg. New foreign-aircraft snapshots are rejected before loading changes. Legacy DG80 index0 means former neutral and restores neutral2. New valid physical angles override stale indices; invalid/unknown values fall back to neutral. Invalid position/time/speed fields reject restore. Legacy other-aircraft indices retain normalization. Trimmed restore intentionally resets mechanism/actuator history, including actual DG80 airbrake position, rather than pretending to restore a maneuver. Fuel/payload transaction logic remains in its existing path.

Five physical lever positions select indices[0,2,3,5,6], labels[-9°,0°,+5°,+13°,L]. `flaps0` explicitly means first physical lever position (-9° on DG80). Step controls and continuous analog axis reach all seven. Actual measured TCA polarity/calibration remains pending and unchanged.

## RED/GREEN evidence

Focused tests were authored and run before their corresponding production behavior:

1. `npx vitest run tests/dg800-simulation.test.ts --maxWorkers=1 --no-file-parallelism`: initial2 RED (negative interpolation returned0; DG80 had one detent), then2 GREEN.
2. Added actual step/mixer/linkage tests:2 new RED (effective output undefined; deployed base stayed-9), then4 GREEN.
3. Metadata test RED (malformed coefficient length did not throw); GREEN after final-table validation and vs0 derivation.
4. Glider toast RED (SPEEDBRAKE FLIGHT DETENT), then copilot RED (positive rate/flaps up), then corrected isolated TAWS RED (TOO LOW, FLAPS) before capability changes; all GREEN. Initial TAWS probe was masked by higher-priority terrain alert; terrain elevation was corrected to isolate the intended warning before production edit.
5. Root main tests had7 expected RED before wiring; later unpowered diagnostic RED before its fix. Latest main12 GREEN.

Final focused command:

```
npx vitest run tests/dg800-simulation.test.ts tests/dg800-main.test.ts tests/glider-airbrakes.test.ts tests/copilot.test.ts tests/taws.test.ts tests/fleet-params.test.ts tests/validate/roster.test.ts --maxWorkers=1 --no-file-parallelism
```

Result:7 files passed,455 tests passed,4 skipped. Output at `/tmp/dg800-focused-green.txt`. `npx tsc --noEmit` completed with exit0 and no diagnostics after that run. Root owns final full suite/build/browser/hardware acceptance.

Coverage includes all21 detent/roll-sign combinations and exact actual aeroIn decomposition, combined extremes beyond pure flap stops, partial airbrake floor, positive-setting behavior, deploy/retract/hold/reselection, invalid index sanitation, reset, subdivision at120/240Hz, all-detent finite attained trim, signed interpolation bounds/midpoints/nonfinite/singleton, and representative C172/B738/J3/AS21/LS8/DISC unchanged bypass behavior. Main harness covers keyboard/hardware steps, analog seven detents, honest five subset, legacy/foreign/current/invalid snapshots, loading isolation, actual constrained diagnostics and restored actuator reset.

## Quantitative limits and remaining acceptance

At525kg/1000m/54kt TAS, neutral trimmed glide is43.436:1, solver residual2.94e-7. Every signed detent trims at30m/s and1000m with residual<.01. This is not a factory laminar-polar validation.

Analytic clean-brake stall anchors reproduce88/84/77/76km/h. Actual Aircraft.step deceleration, starting from a trimmed glide and using pitch feedback toward level flight, detects stallFraction>.5 at the following KIAS (model treats IAS=CAS):

| Mass | -9 | 0 | +13 | L |
| --- | --- | --- | --- | --- |
| 525kg simulated | 50.993 | 48.855 | 44.872 | 44.297 |
| 525kg manual km/h converted to kt | 47.516 | 45.356 | 41.577 | 41.037 |
| 440kg simulated | 46.781 | 44.826 | 41.181 | 40.663 |
| 440kg manual holdout converted to kt | 43.197 | 41.037 | 37.797 | 37.257 |

440kg original row is80/76/70/69km/h, verified visually by root from the FM. Residuals are+3.26..3.79kt. Tests bound these approximate dynamical results within4.5kt; they do NOT prove certified stall calibration. At detection the controller still has roughly269–303fpm sink, so this is not an exact stabilized1g certification maneuver. Existing elevator lift/whole-wing model and transient controller remain limitations; coefficients were not secretly adjusted to erase residuals.

Pending: root independent review, complete suite/validation/build, signed geometry browser closeups, physical hardware, measured linkage map/nonzero-flap mixer, calibrated IAS/CAS and factory flap polar. Existing glider HUD inherited RPM display is not corrected by the signed-control contract; controller diagnostics now explicitly say UNPOWERED. No claim of DG80 full fidelity or whole project completion is made.

## Root integration coverage Sept21

Root added tests/dg800-main.test.ts executing actual main functions against real Aircraft. Initial8 had7 RED failures, subsequently GREEN. Expanded14 nowPASS1.95s covering keyboard7 settings/reset, five-position subset, analog7, hardware step7, steady-vs-deliberate linkage release, legacy/current/foreign/nonfinite snapshots, actual spoiler-position reset followed by physics step, signed/unpowered diagnostics, ground/final spawn, invalid-flight transaction rejection. Final spawn effective angle comparison uses floating-point tolerance1e-10. Old controller/loading/safety harness stubs updated only for new selection/reset API; combined21 tests4filesPASS before final2 added. Baseline review diff contains root harness changes. Independent review pending; this does not replace browser/physical hardware acceptance.
