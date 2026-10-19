# Glider airbrake linkage stow repair — 2026-09-21

## Scope and source status

The bounded repair changes only `src/render/prop-aircraft.ts`, `tests/render/prop-surfaces-repair.test.ts`, and this report. Production source is frozen for root's independent browser/code review. No simulation/main/controller, shared surface helper, native adapter, original asset, or Git operation was changed or used.

The prior second-tier board repair is preserved: its geometry, 10% section depth, 12% neutral offset, span/chord outline and deployment schedule are unchanged. DG80 and LS8 retain two tiers and two physical support stations per wing.

## Root cause and repair

The generic `skinDrive` chose the closest indexed vertex and always projected both horns downward. Actual indexed actuator and support cylinders consequently escaped below the original lower wing. The same main-actuator defect was reproduced on AS21 and Discus, so all four sailplane profiles use the corrected internal mechanism.

A local `brakeDrive` helper now finds the closest point on actual indexed skin triangles, allowing attachment inside a triangle rather than snapping to a distant perimeter vertex. Each rendered horn terminates on that surface; its other endpoint is the real mount joined by the existing live cylinder. The main actuator's fixed horn attaches to the well floor and projects upward into the opening, while its moving horn attaches to the lid underside. The two tier-support stations use opposed compact horns. The rods and horns remain opaque, visible meshes; no visibility suppression or disconnected mount is used. Mesh geometry is built only at construction; existing transforms and live rods update during surface animation.

The compact radius is `max(2 mm, 3% of parent section thickness)`, with horn radius 1.4 times the rod radius. Main horn length is 10% of parent thickness; tier-support horn length is 7%. These are visual proportions, not manufacturer-certified component dimensions. The existing interpolated/telescoping rod mechanism is still a visual kinematic approximation, not a constrained rigid-link mechanism.

The retained lower pocket mesh now uses two material batches: original exterior wing paint on its downward-facing lower skin, dark well material on the interior floor and cut walls. This removes the erroneous dark exterior strip while retaining the actual lower-wing triangles and interior shading. The MU2 roll-spoiler material/mechanism is unchanged.

## RED evidence before production edits

Command:

```text
npx vitest run tests/render/prop-surfaces-repair.test.ts --maxWorkers=1 --no-file-parallelism -t 'stows every indexed|remain finite and physically|wells keep'
```

Raw result excerpt:

```text
Test Files  1 failed (1)
Tests  5 failed | 1 passed | 17 skipped (23)
Duration  1.87s
DG80 airbrake-left-actuator-fixed-horn: expected 0.03721499328582867 to be less than 0.00002
LS8 airbrake-left-actuator-fixed-horn: expected 0.03722076955123066 to be less than 0.00002
AS21 airbrake-left-actuator-fixed-horn: expected 0.04375794423187773 to be less than 0.00002
DISC airbrake-left-actuator-fixed-horn: expected 0.03722090678988477 to be less than 0.00002
DG80 left: lower exterior: expected MeshPhysicalMaterial to be MeshPhysicalMaterial // Object.is equality
```

The containment assertion was then changed to collect all escaping parts, before any production edit, rather than stopping at the first horn. Command:

```text
npx vitest run tests/render/prop-surfaces-repair.test.ts --maxWorkers=1 --no-file-parallelism -t 'stows every indexed'
```

Result: exit 1, four failed tests, 19 skipped, 2.90 seconds. These are actual indexed mesh surface measurements, not pivot or cylinder-center measurements. Raw numerical diagnostics retained from that run:

| Model | Part | Left escape (m) | Right escape (m) |
| --- | --- | ---: | ---: |
| DG80 | actuator | 0.04201025278737591 | 0.04201111766009491 |
| DG80 | actuator fixed horn | 0.03721499328582867 | 0.03721499328582867 |
| DG80 | actuator moving horn | 0.013451389911321887 | 0.013451293338166637 |
| DG80 | tier support 0.2 | 0.006286629182222114 | 0.006423886263179357 |
| DG80 | tier support 0.2 moving horn | 0.0018723194234261387 | 0.0018755789440901838 |
| DG80 | tier support 0.8 | 0.0017249491589606536 | 0.0017287190950953102 |
| LS8 | actuator | 0.04189512348072344 | 0.04213067157640671 |
| LS8 | actuator fixed horn | 0.03722076955123066 | 0.03722076955123066 |
| LS8 | actuator moving horn | 0.007830166323476329 | 0.011837604955894254 |
| LS8 | tier support 0.2 | 0.006674908722159478 | 0.006527109608608028 |
| LS8 | tier support 0.2 moving horn | 0.0019133493691634307 | 0.0019390148885106706 |
| LS8 | tier support 0.8 | 0.00032419503754599344 | 0.00031019893792239017 |
| AS21 | actuator | 0.04861965691332393 | 0.04859545104546553 |
| AS21 | actuator fixed horn | 0.04375794423187773 | 0.04375794423187773 |
| AS21 | actuator moving horn | 0.0039894090845626895 | 0.003714415546763883 |
| DISC | actuator | 0.04190007097686088 | 0.04213484379533028 |
| DISC | actuator fixed horn | 0.03722090678988477 | 0.03722090678988477 |
| DISC | actuator moving horn | 0.0076048199761643565 | 0.011642363060390126 |

## GREEN and verification

The new containment checks reconstruct the original wing envelope from indexed fixed wing, retained well, and neutral lid triangles. Every referenced rod/horn vertex on both sides must have footprint coverage and remain between lower and upper boundaries within 20 micrometers. They inspect 18 hardware meshes per two-tier model and six per single-tier model. A mutation moves the real left actuator 100 mm downward and must detect more than 40 mm escape.

The existing indexed second-tier containment test remains unchanged. Added continuity checks independently compare actual cylinder ends, mount positions, and horn ends against skin triangles at fractions 0, .01, .25, .5, .75, 1, return travel, reset, NaN, Infinity, -1 and 2. Rendered rod/horn vertices must be finite and visible. The original broad signed-travel/floating-assembly tests remain in the focused file. A separate triangle/material check covers both sides of all four sailplanes, requiring painted exterior lower skin and dark interior floor.

Targeted command:

```text
npx vitest run tests/render/prop-surfaces-repair.test.ts --maxWorkers=1 --no-file-parallelism -t 'stows every indexed|remain finite and physically|wells keep|stowed double-tier'
```

Result: exit 0, seven passed, 16 skipped, 3.87 seconds. This run preceded the final change pointing the main fixed horn upward from the floor, so the final full-file verification below is authoritative.

Final-source full-file command:

```text
npx vitest run tests/render/prop-surfaces-repair.test.ts --maxWorkers=1 --no-file-parallelism
```

First run output:

```text
Test Files  1 passed (1)
Tests  23 passed (23)
Errors  1 error
Duration  79.84s
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
```

The first run exited 1 despite all assertions passing. It is recorded as inconclusive because of the runner communication error, not a clean pass. Inspection of the installed Vitest RPC path confirms this is a communication timeout; host contention is a hypothesis, not an established cause.

The same command was rerun serially without source changes and passed cleanly, exit 0:

```text
Test Files  1 passed (1)
Tests  23 passed (23)
Start at  18:31:46
Duration  49.69s (transform 2.29s, setup 0ms, collect 3.19s, tests 46.08s, environment 0ms, prepare 110ms)
```

`npx tsc --noEmit`: exit 0, no diagnostics, after source freeze.

## Acceptance limits

Root owns independent browser close-ups and final code review. The tests establish sampled indexed-geometry containment and attachment, not visual polish or exhaustive collision-free motion. Exact aircraft linkage geometry remains approximate. Separate DG80 flaperon drives, simulation behavior, native models, hardware, whole-fleet/full-suite/validation/build acceptance are outside this bounded repair. This does not complete Stage 8 or the broader goal.
