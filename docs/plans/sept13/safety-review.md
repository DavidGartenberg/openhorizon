# Stage 3 safety review

## Current verdict — revision 2

- **Spec compliance: compliant for the reviewed logic and lifecycle fixes.** Both prior important findings and the minor comment finding are resolved in `/tmp/openhorizon-stage3-review-v2.diff`.
- **Code quality: approved for these fixes.** No new static-review finding in the correction diff. This approval does not establish working OS speech or close the Stage 3 acceptance gate.
- **Runtime acceptance remains open:** root reports the live browser driver starts FIFTY but does not receive completion, blocking subsequent callouts. The current ownership release still relies on the driver completion callback (`src/audio/safety-speech.ts:29`, `tests/browser/safety-studio.ts:21`), and main similarly wires only end/error callbacks (`src/main.ts:1586`). Root is investigating that actual browser behavior separately. Successful deterministic-driver tests must not be represented as actual playback verification.

### Verified corrections

- **RA arithmetic closed:** the threat record now retains current separation and intruder absolute VS (`src/sim/tcas.ts:138`), and candidate scoring projects `(intruderVsFpm - candidateRate)` over the same horizon (`src/sim/tcas.ts:148`). This removes the duplicate current-ownship VS term. New mirrored climb/descent regressions exercise nonzero ownship VS (`tests/safety-regressions.test.ts:42`). Instantaneous target-rate response remains an explicitly documented approximation.
- **Restore lifecycle closed:** `resetFlightSafety` now owns safety computers, speech queue/ownership, takeoff and copilot state, HUD/debug state and pending ATC timers (`src/main.ts:441`). Both airport spawn (`src/main.ts:457`) and airborne saved-flight load (`src/main.ts:613`) invoke it. The new test extracts and executes the actual main restore/reset functions against real safety modules and asserts no retained clearance, false crossing or queued old radio (`tests/safety-snapshot.test.ts:10`, `tests/safety-snapshot.test.ts:28`). Terrain/render/trim dependencies are stubbed, which is appropriate to this focused lifecycle check.
- **Comment closed:** Mode-5 documentation now refers to an incoming runway corridor (`src/sim/taws.ts:114`).
- **Verification reviewed:** appended implementer report and root dispatch record seven files / 46 passing tests and TypeScript exit 0. No tests rerun during revision 2, since the diff and existing targeted evidence answer the prior doubts. No implementation edits or browser operations performed.

## Historical revision 1 assessment (superseded by verdict above)

## Spec compliance

- **Issues found.** Most requested mechanisms are present, but RA sense scoring does not calculate the stated candidate-rate separation correctly, and airborne saved-flight restores omit the required safety lifecycle reset (details below).
- **Cannot verify from diff:** actual OS/browser speech playback remains pending with root; deterministic driver tests establish controller behavior only. The final TypeScript result was pending at dispatch. The complete 123-aircraft functional check is outside this task diff; the mode policy itself uses shared aircraft parameters (`src/main.ts:1556`).

## Strengths

- Hazard state and utterance ownership are separated; a single owner applies GPWS priority, bounded repeats, bounded/expiring radio backlog, and generation-checked callbacks (`src/audio/safety-speech.ts:18`, `src/audio/safety-speech.ts:26`, `src/audio/safety-speech.ts:32`, `src/audio/safety-speech.ts:52`). Main computes both hazard outputs before speech arbitration and preserves inhibited TCAS HUD text (`src/main.ts:1696`, `src/main.ts:1705`).
- RA clearance is tied specifically to RA removal; order-independent threat rank and horizontal CPA miss filtering replace the prior range-only/order-sensitive behavior (`src/sim/tcas.ts:114`, `src/sim/tcas.ts:131`, `src/sim/tcas.ts:140`, `src/sim/tcas.ts:150`).
- TAWS callouts use actual descending crossings, mark all crossed gates while selecting the lowest, and remain separate from warning/caution level (`src/sim/taws.ts:129`). Runway inhibition now uses alignment and cross-track geometry (`src/sim/safety-approach.ts:9`).
- Focused tests cover key state and arbitration regressions, including stale completion callbacks, residual TA during clearance, reset/rearm and parked terrain (`tests/safety-speech.test.ts:4`, `tests/safety-speech.test.ts:18`, `tests/safety-regressions.test.ts:29`). No certified-equipment claim or proprietary asset addition appears in the reviewed implementation.

## Issues

### Critical

- None identified.

### Important

1. **RA candidate scoring double-counts current ownship vertical speed.** `src/sim/tcas.ts:119` predicts `dzAtCpa` using relative VS, already subtracting the current ownship VS. `src/sim/tcas.ts:138` stores that prediction, then `src/sim/tcas.ts:146` subtracts the full candidate ±1,500 fpm again. Consequently the advertised maximin target-rate comparison actually evaluates increments to the existing ownship rate. A focused real-module execution with ownship +3,000 fpm, a stationary intruder 100 ft above, 1,500 m ahead and closing at 100 m/s returns CLIMB. At the 15-second CPA, the stated +1,500 fpm target produces 275 ft separation, while -1,500 fpm produces 475 ft. Use each intruder's absolute VS with the candidate ownship target rate over a consistent prediction horizon, or subtract the candidate-minus-current-rate delta from the existing prediction. Add nonzero ownship VS cases; the current regression ownship fixtures all use zero (`tests/safety-regressions.test.ts:4`).

2. **Airborne saved-flight loading retains the previous flight's safety and speech state.** The new reset is confined to `spawnAtAirport` (`src/main.ts:443`). `loadSnapshot` calls it only for ground snapshots, while the airborne branch directly resets systems and applies trim (`src/main.ts:604`, `src/main.ts:619`); `resetSystemsState` does not reset safety (`src/main.ts:377`). Loading another airborne snapshot can therefore turn the teleport into an altitude-gate crossing, retain prior RA clearance/hysteresis and takeoff history, and leave existing or queued radio speech alive. Centralize the flight-discontinuity reset and invoke it for both spawn and airborne restore, including pending ATC callbacks where applicable. Add a restore transition test exercising an active RA/utterance and a change across callout gates.

### Minor

- `src/sim/taws.ts:114` still describes `nearRunwayFinal` as airport-center proximity, although the new contract is a runway corridor (`src/sim/safety-approach.ts:1`). Update the comment to avoid misleading future inhibition changes.

## Assessment

**Task quality: Needs fixes.** The new architecture and most behavioral tests are sound, but the candidate-rate arithmetic and omitted restore lifecycle path affect actual state correctness.

## Review evidence and scope

- Read `/tmp/openhorizon-stage3-review.diff` as the change source; recovered only the initially truncated TCAS/TAWS section. No git commands, suite reruns, implementation edits, browser actions, commits or external communications were performed.
- Focused outside-diff checks: checked `loadSnapshot`, `resetSystemsState` and spawn callers for the named flight-discontinuity reset risk; checked aircraft selection call sites for whether constructor-only mode selection can become stale (selection reloads the page, `src/main.ts:638`); checked the frame call site for safety updates (`src/main.ts:2500`). Read the cut-off sensitivity/Mode-3 function context to evaluate altitude and phase gates.
- Executed one focused numerical reproduction using Node and the installed TypeScript transpiler on the actual `TcasComputer` module. Result: RA/CLIMB for the +3,000 fpm example above; independently calculated candidate separations 275 ft / 475 ft. No test files were created.
- Root reports six focused files / 44 tests passing; not rerun here. Final typecheck and real playback remain controller-owned verification items.
