# Phase 3 plan — Cockpit & systems

Goal (§24, §8): full 3D cockpit, G1000 PFD/MFD + EIS, standby gauges,
electrical/fuel/pitot-static systems (all failable), cold & dark start,
real checklists. Acceptance: cold-and-dark → run-up via the real POH
checklist with every switch physical; alternator-failure drill behaves per
POH; lean-assist finds peak EGT.

## Architecture

- **`src/sim/systems/`** (pure, no three.js, TDD): `electrical.ts` (28V
  alternator + 24V battery, main/essential/avionics buses, load list,
  alternator-failure → battery drain → progressive equipment loss, standby
  instruments stay live off battery), `fuel.ts` (two 26.5 gal tanks,
  L/R/BOTH selector, gravity-feed imbalance on one tank, fuel pump,
  starvation stops the engine, restart works), `pitot.ts` (pitot heat;
  pitot icing misreads airspeed; static blockage misreads alt/VSI),
  `engine-start.ts` (cold/hot/flooded start state machine — battery → fuel
  pump → mixture rich → throttle ¼ → ignition/starter → magneto check drop
  100–150 RPM max 50 diff — → alternator/avionics on), `mixture.ts` or fold
  into propulsion.ts (EGT curve vs. mixture with a peak-EGT point, replaces
  Phase 1's simple `mixturePowerFactor`). One `SystemsState` object wires
  into `Aircraft.step` (new optional field, mirrors how `groundElevAt`
  hangs off `Aircraft` today) — systems affect available power/EGT/gauge
  truth but never the aero/gear/6-DOF math itself.
- **`src/cockpit/`**: canvas-2D draw functions, pure functions of
  `(ctx, FlightData, SystemsState) => void`, ≥2048px wide, redrawn at
  display refresh (20–30 fps target, not 120 Hz). `pfd.ts` (airspeed tape
  w/ V-speed arcs + trend vector, attitude w/ slip-skid, altitude tape +
  baro, VSI, HSI w/ heading bug/CDI stub — full nav is Phase 4 so CDI reads
  a fixed/inactive state — wind box, NAV/COM freq boxes w/ flip-flop,
  transponder box, OAT, TAS/GS, annunciator window, softkey bezel row).
  `mfd.ts` (EIS strip always visible: RPM/FF/oil temp-press/EGT+CHT bars
  w/ lean-assist page, fuel qty L/R, volts/amps; map page reuses Phase 2's
  `TileManager`/`Airports` for terrain shading + airport symbols, no
  airspace/traffic yet — those are Phase 4/5/6; FPL page is a visual
  skeleton only, no real flight-plan logic until Phase 4). `standby.ts`
  (analog ASI/attitude/altimeter, same pitot-static truth as the PFD).
- **`src/render/cockpit.ts`**: 3D panel per §8 photo-match layout (PFD
  left, MFD center, audio panel between, standby cluster left of PFD,
  switch row bottom-left, ignition key, throttle/mixture vernier, flap
  lever w/ detents, trim wheel, floor fuel selector, breaker panel, yoke).
  G1000/standby canvases as textures on panel meshes. Raycast-based
  click/drag routed to `aircraft.controls` + the new systems controls
  (switches are boolean/enum state on `SystemsState`, not `Aircraft`).
  New camera mode added to the existing `C`-key cycle (chase/orbit/free →
  + cockpit).
- **Controls surface growth**: `Aircraft.controls` gets no new fields
  (mixture already exists); a parallel `SystemsControls` (master
  bat/alt, avionics bus 1/2, pitot heat, lights, mags/starter key position,
  fuel selector L/R/BOTH, fuel pump) lives with `SystemsState` and is read
  by `src/main.ts` the same way `aircraft.controls` is today.

## Cuts recorded as deviations (in-phase, honest)

- Full nav (VOR/ILS/GPS, real CDI behavior, procedures) → Phase 4; PFD/MFD
  nav elements render but are visually inert/placeholder this phase.
- Airspace + traffic overlays on the MFD map → Phase 4/6.
- Failures-menu UI (instructor arm/trigger panel) → build the systems
  failure *modes* now (TDD), but the menu chrome to trigger them in-sim
  is a debug hook (`__ohFail(name)`) this phase; a real UI panel folds
  into Phase 9 polish.
- Walkaround preflight → explicitly Phase 9 (§8.6) per the master prompt.
- Standby instruments are canvas gauges reading the same pitot-static
  model as the PFD — no separate vacuum/gyro failure modes yet (§28 roadmap
  item, not required this phase).

## Tests

`tests/systems/electrical.test.ts`, `fuel.test.ts`, `pitot.test.ts`,
`engine-start.test.ts` — cold-and-dark start sequence per POH order,
alternator failure drains battery until G1000-equivalent load dies while
standby stays live, fuel imbalance/starvation/restart, pitot/static
blockage misread signs, magneto check RPM drop range, peak-EGT detection
against a scripted mixture sweep. Existing `tests/validate/poh.test.ts`
and `tests/sim-purity.test.ts` must stay green throughout (systems must
not import three.js/DOM).
