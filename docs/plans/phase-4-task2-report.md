# Phase 4 Task 2 — GPS flight-plan logic (`gps.ts`)

## Files

- Created `src/sim/nav/gps.ts` — pure module (no three.js/DOM), mirrors
  `navaids.ts`'s data-holder + pure-function style.
- Created `tests/nav/gps.test.ts` — 25 new tests.
- Did not touch `src/sim/nav/navaids.ts`, `src/cockpit/`, `src/render/`,
  `src/main.ts`, `src/sim/aircraft.ts`, `src/sim/aircraft/c172s.ts`, or the
  autopilot/procedures modules (not built yet — out of scope for this task).

## What was built

1. **Flight-plan model**: `Waypoint` (ident + lat/lon — deliberately minimal,
   no navaid/fix database), `Leg` (great-circle course via `bearingDeg` +
   distance via `distanceM` between two waypoints), `FlightPlan` class
   (`setWaypoints`/`legs()`), `makeLeg()`.
2. **Direct-to**: `directTo(from, targetWaypoint)` — a standalone leg
   constructor independent of any `FlightPlan` state (a direct-to can target
   a waypoint not even in the loaded plan, matching real GPS behavior).
3. **Active-leg tracking**: `crossTrackDistanceM`, `alongTrackDistanceM`, and
   `activeLegProgress(legs, aircraft, startIndex)` — returns active leg
   index, distance remaining to the waypoint (great-circle), and
   cross-track error (m and nm). Cross-track/along-track use the standard
   spherical cross-track-error formulas from the Aviation Formulary (Ed
   Williams) — the same well-known formulas used across GA nav software:
   `xtd = asin(sin(dist13)·sin(brg13-brg12))·R`,
   `alongTrack = acos(cos(dist13)/cos(xtd/R))·R`.
4. **Turn anticipation**: `standardRateTurnRadiusM` and
   `turnAnticipationDistanceM(inboundCourse, outboundCourse, groundspeedKt)`.
   **Convention chosen: standard-rate turn, 3°/sec** (FAA Instrument Flying
   Handbook's "2-minute turn" — the convention most GA autopilots/flight
   directors and GPS turn-anticipation logic assume below ~250 KIAS),
   giving `r = V / ω` (ω in rad/s). The fixed-bank-angle formula
   `r = V²/(g·tanθ)` is equally legitimate but was *not* used — flagged in
   the code comment so a later task swapping conventions knows where to
   look. Anticipation distance uses the standard "lead distance" geometry
   for a circular arc tangent to both the inbound and outbound course
   lines: `leadDistance = r·tan(θ/2)`, where θ is the absolute course
   change. Verified in tests against independently hand-computed values at
   120 kt for 0°, 45°, 90°, and 180° (capped, finite) turns.
5. **CDI phase-of-flight scaling**: `CDI_FULL_SCALE_NM` = `{ENR: 2.0, TERM:
   1.0, APR: 0.3}` nm — cited directly from the phase-4 plan's §10.2
   reference to standard GPS CDI sensitivity figures (not invented).
   `determinePhase(ctx)` uses a **flagged design-choice heuristic**:
   within `TERMINAL_RADIUS_NM` (30 nm, chosen) of departure or destination
   → TERM; within `APPROACH_RADIUS_NM` (3 nm, chosen) of the destination
   *and* on the final-approach segment (a caller-supplied flag, since this
   task doesn't model procedures) → APR; otherwise ENR. Real terminal/
   approach boundaries depend on airspace/procedure design not modeled
   here — explicitly commented as such in the code, not presented as a
   sourced figure. `gpsCdiDeflection(crossTrackNm, phase)` scales
   cross-track error to a ±1.0 fraction of the phase's full-scale value,
   clamped (pegged) at ±1.0, matching real CDI needle behavior.

## Test results

- `npx tsc --noEmit`: clean, no errors.
- `npm test`: **191/191 tests passing** (166 existing + 25 new in
  `tests/nav/gps.test.ts`).
- `tests/sim-purity.test.ts`: green (gps.ts has no three.js/DOM imports).

Test coverage per the task's required list:
- Leg course/distance vs. hand-computable geometry (due-east 1° longitude
  leg at the equator, ~111,195 m).
- Multi-waypoint plans produce the correct consecutive-pair leg list.
- Direct-to produces the correct course/distance from an arbitrary current
  position to a target waypoint, verified independent of, and unaffected
  by, an unrelated loaded flight plan.
- Cross-track error: due-north leg displaced east/west by a known offset
  (5000 m / 3000 m) reproduces that offset (within ~50 m, the flat-earth-
  vs-great-circle discrepancy at that along-track distance) with the
  correct sign; on-course aircraft reads ~0.
- Active-leg selection advances from leg 0 to leg 1 once the aircraft
  passes the shared waypoint (along-track test), and reports the correct
  cross-track distance in nm.
- Turn anticipation: 90° turn at 120 kt verified against
  `r·tan(45°) = r` exactly; 45° verified against `r·tan(22.5°)`; 0° turn
  gives 0; 180° reversal is finite (capped) rather than diverging;
  anticipation distance increases with groundspeed for a fixed turn angle.
- CDI phase scaling: full-scale constants match the cited 2.0/1.0/0.3 nm
  figures; `determinePhase` correctly classifies ENR/TERM/APR cases; the
  same 0.5 nm cross-track error reads 0.25 (small) in ENR vs. pegged at
  1.0 in APR, with TERM in between at 0.5 — the core "phase sensitivity
  actually works" assertion.

## Flagged assumptions (not fabricated data — explicit engineering choices)

- Leg course is the *initial* great-circle bearing only (no continuously
  recomputed great-circle tracking along a leg) — standard simplification
  for GA-scale leg lengths, same simplification real GPS/FMS units make.
- Active-leg sequencing uses a simple "along-track distance exceeds leg
  length" test rather than the bisector-of-inbound/outbound-course test
  real GPS units use for waypoint sequencing near a fix — adequate for
  straight TF-style legs, which is all this task models.
- `TERMINAL_RADIUS_NM = 30` and `APPROACH_RADIUS_NM = 3` are chosen
  stand-ins, not sourced figures — real terminal/approach areas depend on
  specific airspace and procedure design (SIAPs, TAAs, feeder routes) that
  aren't modeled until the CIFP procedures task (Task 4).
- `onFinalApproachSegment` is a caller-supplied flag (not derived from a
  procedure model) since procedures don't exist yet — a later task wiring
  in CIFP-sourced approaches would set this from the FAF-anchored final
  leg.
- Turn-anticipation's 180°-reversal case is capped at a finite angle
  (179.9°) to avoid `tan(90°)` diverging to infinity — a real GPS would
  fly a course-reversal procedure instead, out of scope for this pure
  geometry helper.
