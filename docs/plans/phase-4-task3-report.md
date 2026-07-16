# Phase 4 Task 3 — GFC700-style autopilot

## Files

- Created `src/sim/autopilot.ts` — pure control-law module (no three.js/DOM;
  `tests/sim-purity.test.ts` stays green).
- Created `tests/autopilot.test.ts` — 24 step-response/capture/gain/trim/
  disconnect tests.
- Did not touch `navaids.ts`, `gps.ts`, `aircraft.ts`, `c172s.ts`, cockpit,
  render, or `main.ts`, per scope.

## Interface shape (for the later wiring task)

Convention mirrors `src/sim/systems/electrical.ts`/`engine-start.ts`:
`makeAutopilotState()` + `stepAutopilot(state, dt, inputs)` mutating state
in place, plus a standalone `disconnect(state)`.

```ts
type LateralMode = 'ROL' | 'HDG' | 'NAV' | 'APR' | 'BC'
type VerticalMode = 'PIT' | 'ALT' | 'ALTS' | 'VS' | 'FLC' | 'GS'
type UnderlyingVerticalMode = 'PIT' | 'VS' | 'FLC'
```

`AutopilotInputs`: primitive aircraft state (`iasKt`, `altitudeFt`,
`verticalSpeedFpm`, `headingDeg`, `pitchDeg`, `rollDeg`), engagement +
mode-selects (`masterEnabled`, `lateralMode`, `verticalMode`,
`underlyingVerticalMode?`), targets/bugs (`headingBugDeg`, `altitudeBugFt`,
`vsTargetFpm`, `iasTargetKt`, `bankCommandDeg`, `pitchCommandDeg`), and two
plain nav-deviation numbers (`navDeviation`, `glideslopeDeviation`, both
fractions of full-scale, sign convention documented in the file header —
caller normalizes from `gpsCdiDeflection().deflectionFraction`,
`localizerDeflection() / LOC_FULL_SCALE_DEG`, or
`glideslopeDeflection() / GS_FULL_SCALE_DEG`).

`AutopilotState` (the output contract a later task reads): `masterEnabled`,
`justDisconnected` (one-shot), `lateralMode`/`lateralArmed`,
`verticalMode`/`verticalArmed`, `rollCmd`/`pitchCmd`/`yawCmd` ([-1,1],
`Controls`-compatible), `trimCommand` ([-1,1], `Controls.trim`-compatible),
`fdBankDeg`/`fdPitchDeg` (flight-director attitude targets, degrees, always
computed regardless of `masterEnabled` — a v-bar can show them hand-flown).
Internal PID memories are plain fields on the state object too (no hidden
closures), inspectable for debugging.

**Design decision flagged**: I added a `GS` vertical mode (glideslope
tracking), not explicitly listed in the task's vertical-mode enumeration.
APR's glideslope tracking needs its own capture/track identity distinct
from PIT/ALT/VS/FLC — exactly matching the real GFC700's own "GS"
annunciation — so a later wiring task should set `verticalMode: 'GS'` (with
`underlyingVerticalMode` set to whatever mode is flying the intercept) once
lateral APR has captured the localizer, mirroring how real avionics arm GS
alongside APR. This keeps `autopilot.ts` decoupled from that cross-mode
business logic per the task's own instruction to keep mode-selects as
plain caller-supplied inputs.

**ALTS/GS armed-phase design decision**: both are "overlay" captures that
fly an *underlying* mode (`PIT`/`VS`/`FLC`) until their trigger condition
fires, then take over fully (`ALTS` → `ALT` renames itself in
`state.verticalMode`; `GS` keeps its name but `verticalArmed` flips to
`false`). `inputs.underlyingVerticalMode` (default `'VS'`) tells the module
which mode to fly meanwhile — a clean, testable way to express "arm ALT/GS
while climbing/descending under VS/FLC/PIT" without over-fitting a
single-selector illusion onto what's really a two-mode overlay in real
avionics.

## Gain-scheduling / servo-rate / capture-threshold choices (flagged engineering choices, not sourced GFC700 specs — those are proprietary)

- `gainScale(iasKt)`: `clamp(90 / iasKt, 0.5, 1.8)`, applied to the inner
  attitude→control-surface loops. 90 kt is chosen near the C172S's Va
  (105 KIAS per `c172s.ts`); scaling gain inversely with IAS is standard
  autopilot practice since aerodynamic moment authority grows with
  q ~ V², so less deflection is needed per unit attitude error at higher
  speed. Verified by test: same bank-command error produces a
  larger-magnitude `rollCmd` at 60 kt than at 150 kt.
- `SERVO_RATE_PER_S = 0.5` (fraction of [-1,1] travel/sec, ~4 s
  center-to-full) — makes captures visibly roll/pitch in rather than
  snap. Verified by test (one 0.1 s step can't exceed `0.05`).
- `MAX_BANK_DEG = 25`, `MAX_PITCH_CMD_DEG = 10` — representative GA
  autopilot caps, not sourced GFC700 numbers.
- `CAPTURE_FRACTION = 0.5` (half-scale) — NAV/APR/BC/GS transition
  armed→active once deviation is within half-scale. While armed, the
  module flies the heading bug (lateral) or the underlying vertical mode
  to intercept, rather than reacting to deviation directly — this is what
  makes the armed→active tests meaningful (stays armed at large deviation,
  captures promptly once inside the window).
- `ALTS_DECEL_FPM_PER_S = 200`: assumed achievable VS deceleration, feeding
  a kinematic stopping-distance formula `leadFt = v²/(2a)` (v, a converted
  to ft/s, ft/s²) for the ALTS capture lead point — the vertical-axis
  analog of Task 2's turn-anticipation lead distance (`gps.ts`'s
  `turnAnticipationDistanceM`), so the aircraft starts leveling off before
  reaching the bugged altitude instead of overshooting. Verified: a faster
  descent predicts a proportionally larger (earlier) capture window, and
  the module doesn't capture prematurely far from the bug.
- Individual PID gains (`kp`/`ki`/`kd`/integrator-clamp per loop) were
  tuned empirically against the test-only closed-loop plant purely to get
  stable, convergent step responses — explicitly not claimed as sourced
  GFC700 tuning. Two rounds of retuning were needed: the initial VS/ALT
  outer-loop integrator clamp (`iMax`) was too tight to let the pitch
  target reach the authority actually needed for a sustained climb, and
  the initial NAV/APR/BC bank-loop derivative gain was too aggressive on a
  raw (non-attitude) deviation signal, injecting a destabilizing "kick" —
  both fixed by direct trace debugging against the test plant (see git
  history if useful) rather than guessing.

## Applying the pitch-for-airspeed / trim-follow-up lesson

- **FLC** is implemented as genuine pitch-FOR-airspeed: error =
  `iasKt - iasTargetKt` (too fast → pitch up, bleeding energy into climb;
  too slow → pitch down, trading altitude for airspeed), output is a pitch
  *attitude* target, not an attitude hold with an airspeed label. Verified
  distinct from VS by a same-starting-condition test asserting the two
  produce different pitch targets.
- **VS** targets vertical speed directly (`vsTargetFpm - verticalSpeedFpm`)
  — a different, independently legitimate setpoint from FLC, per the task
  instruction not to implement them as "the same PID with different
  labels."
- **Trim follow-up**: `trimCommand` bleeds toward relieving a sustained
  primary pitch command at `TRIM_FOLLOWUP_RATE_PER_S = 0.04` units/sec per
  unit of post-rate-limit `pitchCmd`, gated on `trimEligible` — true for
  `ALT`/`VS`/`FLC`/`GS` (all sustained autonomous vertical modes,
  including `GS` as a considered extension since ILS tracking is exactly
  the kind of long-duration hands-off operation the lesson was about), and
  explicitly *false* for `PIT` (documented in the task text as a
  short-term/manual-adjustment mode, not meant to run hands-off for a long
  duration — so it doesn't need load relief). Verified: 40 s of sustained
  `ALT` hold moves `trimCommand` in the same sign as the sustained
  `pitchCmd`; 40 s of `PIT` leaves `trimCommand` at exactly 0.
- Considered but not built: trim follow-up decaying the *primary* loop's
  own commanded authority as trim absorbs load (i.e., feeding trim back
  into the plant so `pitchCmd` itself relaxes over time). That coupling
  belongs in `aircraft.ts`'s actual elevator/trim aerodynamics (already
  wired there per `ai.elevatorRad = -c.pitch*maxRad - c.trim*trimMaxRad`),
  not in this pure control-law module — `autopilot.ts` only needs to
  produce the trim signal; the real load relief happens once a later
  wiring task feeds `trimCommand` into `aircraft.controls.trim` each frame.

## AP disconnect

`disconnect(state)`: instant — zeroes `rollCmd`/`pitchCmd`/`yawCmd`, resets
both modes to `ROL`/`PIT` with no armed captures, sets a one-shot
`justDisconnected` flag a later audio task (Phase 9) can poll for the
disconnect tone. `trimCommand` is deliberately left alone (a real trim
wheel doesn't snap to neutral when the servos disengage).
`stepAutopilot` also treats `inputs.masterEnabled` flipping to `false`
(without an explicit `disconnect()` call) the same way, so a cockpit AP
disconnect button (later task) can either call `disconnect()` directly or
simply stop passing `masterEnabled: true`.

## Tests (`tests/autopilot.test.ts`, 24 tests, all passing)

Uses a small first-order-lag test-only plant (`TestPlant`), explicitly
*not* `Aircraft`, per the task's instruction to avoid coupling to the real
flight-dynamics stack. Covers:
- ROL: step bank convergence + servo-rate-limit (one-step output bounded).
- HDG: correct-direction bank for +30°/-30° heading-bug steps, and
  heading converges within 5° over simulated time.
- NAV: arms at large deviation, activates within the capture window, stays
  armed across many steps at large deviation (no early capture), and
  drives a crude cross-track plant to <0.1 residual in closed loop.
- APR vs. BC: same raw deviation → opposite-signed bank once both are
  active (reversed CDI sense verified directly).
- ALT: correct-direction pitch for a +500 ft step, converges to
  3400-3600 ft in closed loop.
- VS: converges vertical speed to 400-600 fpm against a 500 fpm target.
- FLC: pitches down when slow, converges IAS to 90-110 kt against a
  100 kt target; asserted distinct from VS at an identical starting
  condition.
- ALTS: stays armed far from the bug, captures to `ALT` inside the
  VS-predicted lead window, doesn't capture early; lead window scales with
  descent rate.
- GS: arms on selection, captures within threshold, pitches down when
  above the glidepath.
- Gain scheduling: same bank-command error produces a larger `rollCmd` at
  60 kt than 150 kt after several steps (single-step comparisons saturate
  identically against the servo rate limit, so the test runs 20 steps);
  `gainScale` is monotonically decreasing in IAS.
- Trim follow-up: moves under sustained `ALT`, stays exactly 0 under `PIT`.
- Disconnect: instant zeroing + no active modes + one-shot signal consumed
  by the next step call; also verified via the implicit
  `masterEnabled: false` path.

## Verification

- `npx tsc --noEmit`: clean.
- `npm test` (`npx vitest run`): **217/217 passing** (193 baseline + 24
  new `tests/autopilot.test.ts`).
- `tests/sim-purity.test.ts`: green (one false-positive catch during
  development — the purity checker's DOM regex flagged a comment
  containing the literal substring "window." with no code meaning;
  reworded the comment, not a real purity issue).

## Flagged assumptions / simplifications (full list)

1. Gain-schedule curve, servo rate limit, bank/pitch attitude caps, and
   capture-window thresholds are engineering choices tuned for stable
   convergence against a test-only plant — not sourced GFC700 figures
   (those are proprietary and not publicly documented).
2. `GS` vertical mode added beyond the task's literal enum, justified
   above.
3. `underlyingVerticalMode` input added to express the ALTS/GS
   armed-phase "what's actually flying it" state — a design choice for a
   clean interface, not part of the literal spec text.
4. Yaw output (`yawCmd`) is a minimal turn-coordination feed-forward
   (`rollCmd * 0.2`), not a full yaw damper — flagged as a basic addition
   since the interface requires a yaw axis output but the task didn't
   specify a yaw control law.
5. NAV/APR/BC capture logic is a simple deviation-threshold check (no
   closure-rate prediction), consistent with the task's explicit
   permission to use simple, flagged capture-threshold heuristics.

## Fix: ALTS capture not durable under a plausible caller usage pattern (Critical, post-review)

### Root cause

`stepAutopilot`'s vertical mode-change detector (`if (inputs.verticalMode
!== state.lastCommandedVerticalMode)`) re-arms whenever the caller's
`verticalMode` input differs from the module's *own last internally-set*
mode. ALTS capture renamed `state.verticalMode` (and
`lastCommandedVerticalMode`) to `'ALT'` at the capture point, but nothing
required the caller to also switch its input to `'ALT'`. A real GFC700
mode-select button's state doesn't revert itself just because the AP
captured, so a caller that (reasonably) kept feeding the pilot's
persisted selection — `verticalMode: 'ALTS'` — plus the original
`vsTargetFpm`, saw a mismatch (`'ALTS' !== 'ALT'`) on every subsequent
frame. That mismatch re-armed ALTS, recomputed `targetPitchDeg` from the
stale underlying VS/FLC/PIT law (winding up the VS PID integrator
against a now-irrelevant descent target every step), and then
immediately re-captured back to `'ALT'` within the same step — so
`state.verticalMode` still read `'ALT'` to anything checking afterward,
masking a steadily worsening dive command. `GS` doesn't have this
problem because it never renames `state.verticalMode` — it only flips
`verticalArmed`, so the caller's input and the module's internal name
always agree.

### Fix chosen

Option 1 from the review (persistent captured-state flag), implemented
as a new `altsCaptured: boolean` field on `AutopilotState` (added to
`makeAutopilotState()` and reset in `disconnect()`, mirroring how
`verticalArmed` already works for `GS`):

- Set `true` at the exact point ALTS captures (alongside the existing
  `state.verticalMode = 'ALT'` / `verticalArmed = false` assignment).
- The vertical mode-change detector now computes
  `isReassertingCapturedAlts = inputs.verticalMode === 'ALTS' &&
  state.altsCaptured` before acting on a mismatch. When true, the block
  updates `lastCommandedVerticalMode` (so it doesn't re-trigger every
  frame) but skips reassigning `state.verticalMode` / `verticalArmed` /
  `altsCaptured` — i.e. a repeated `'ALTS'` input after capture is
  recognized as the selector holding steady, not a new arm request.
- Any other mismatch (a genuinely different mode, including a fresh
  ALTS re-arm at a new target altitude) still runs the normal
  reassignment path and clears `altsCaptured` back to `false`.

Chose option 1 over option 2 (generalizing GS's never-rename approach to
ALTS) because it's the smaller, more surgical change given the module is
already committed with a wiring task waiting on it: `state.verticalMode
=== 'ALT'` after capture is exactly the caller-visible contract the rest
of the codebase (and this task's own tests) already depend on, so a
one-field addition that preserves that output while fixing the internal
re-arm bug seemed lower-risk than restructuring how captured state is
exposed. Added a comment block above the vertical-mode section of
`stepAutopilot` explaining the overlay-capture pattern (how ALTS/GS
relate to their underlying modes and how "captured" state is tracked)
per the related readability finding.

### Reproduction (before / after)

Reproduced the reviewer's exact scenario: correct ALTS→ALT capture at
3000 ft (descending at -2000 fpm, captured within the predicted lead
window), then fed `verticalMode: 'ALTS'` + the original `vsTargetFpm:
-2000` every subsequent frame at level flight (0 fpm, 0 pitch, altitude
pinned at the 3000 ft bug) for 300 more steps.

- **Before fix** (checked out the pre-fix `007f610` version of
  `src/sim/autopilot.ts` and ran the same scenario): `state.verticalMode`
  read `'ALT'` every frame (looked captured), but `fdPitchDeg` pinned at
  `-10.00°` (the `MAX_PITCH_CMD_DEG` dive cap) and `pitchCmd` railed to
  `-1.0000` (full nose-down) within ~5 seconds — silently commanding a
  continuous dive while reporting captured altitude-hold.
- **After fix**: `state.verticalMode` stays `'ALT'`, `fdPitchDeg` settles
  to `0.12°` (near level, the real ALT-hold steady state at zero
  altitude error), and `pitchCmd` stays in the `0.37`–`0.44` range
  (elevator load consistent with holding pitch, not a runaway dive
  command), consistent across the full 300-step run.

### Tests

Added `tests/autopilot.test.ts` → `describe('ALTS armed -> ALT
capture')` → new test `'stays durably captured on ALT-hold even if the
caller keeps sending the original ALTS selection + target every frame
(regression: capture must not depend on the caller switching its
mode-select input to ALT)'`. It captures ALTS→ALT, then for 300 steps
feeds the original `'ALTS'` selection + original `vsTargetFpm: -2000` at
level flight, asserting every step that `fdPitchDeg` never drops toward
the stale dive command, and that the final state is still `verticalMode
=== 'ALT'`, `verticalArmed === false`, `fdPitchDeg` within 2° of level,
and `pitchCmd` nowhere near the dive-command floor.

- `npx tsc --noEmit`: clean.
- `npm test` (`npx vitest run`): **218/218 passing** (217 baseline + 1
  new regression test in `tests/autopilot.test.ts`, now 25 tests in that
  file). No existing ALTS/GS/mode-transition tests regressed.
