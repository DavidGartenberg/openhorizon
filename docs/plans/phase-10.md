# Phase 10 plan — Stretch fleet: J-3 Cub + 737-800 (§24 Phase 10, §28)

Gate: §27 met (PROGRESS 2026-07-21). Contract text: master prompt §24
"Phase 10 — Stretch aircraft".

## Honest scoping up front

The contract's full Phase-10 gate (gate-to-gate KSFO→KLAX IFR, CDU/FMC,
real 737 cockpit layout, TCAS II RA presentation, hand-prop interaction)
is more than one session. The plan below builds the *flight models and
their validation harnesses first* — the part with hard right/wrong
answers — then systems/UX in honest increments. Anything not reached is
recorded in PROGRESS as not-done, never stubbed to look done (§1).

## Slices (one commit each)

- **10a. Fleet architecture.** Thread `AircraftParams` (= `typeof C172S`
  shape) through aero/propulsion/gear/trim/aircraft as a constructor
  param defaulting to C172S. Gear grows `layout: 'tricycle'|'taildragger'`
  (third-wheel position/steering from params). **Regression gate: entire
  suite + POH validate green with zero numeric drift** — same objects,
  same numbers, C172 behavior is the fixture.
- **10b. J-3 Cub.** `aircraft/j3cub.ts` params: USA-35B high-lift wing,
  no flaps, A-65 65 hp piston (same parametric prop-table form, Cub-tuned
  points), taildragger gear (mains ahead of CG → ground-loop divergence
  is emergent), ~500 kg gross. No electrical: engine starts only via a
  hand-prop action. Carb-ice model (humidity+power → ice; carb heat
  clears) in the piston module, C172 unaffected (fuel injected — model
  keyed off params.carburetor flag). Validation table (published J-3
  numbers, honest tolerances): stall ~33 kt, cruise ~65-70 kt at 2150
  rpm, climb ~450 fpm at gross. Acceptance in-browser: three-pointer
  lands; fast wheel landing with no rudder input ground-loops.
- **10c. 737-800 flight model.** New `turbofan.ts` (CFM56-7B26: N1 spool
  first-order dynamics, thrust = f(N1, rho, Mach) with lapse, TSFC fuel
  flow); `aircraft/b738.ts` swept-wing aero (flaps 1/5/15/30/40 schedule
  as clMax/cd deltas, Mach drag rise ~M0.82+, no prop torque/P-factor),
  gear retraction, 41-79 t mass range. Aircraft gains a
  `powerplant: 'piston'|'jet'` branch. Validation rows: Vref30 vs weight
  (~140 kt at 60 t), FL350 M0.785 cruise fuel flow ≈ 2.4 t/h ±10%,
  250-kt climb ~2000+ fpm at FL100 at 65 t. GPWS "TOO LOW — GEAR" +
  "TWENTY, TEN" callouts armed for the jet.
- **10d. Fleet UX + acceptance.** Search-box `FLY CUB | FLY 737 | FLY
  172` swaps aircraft (respawn required); HUD/sound adapt (jet = filtered
  noise + spool whine, no firing fundamental; Cub = same synth, 65 hp
  levels). PFD stays G1000-style for all three with a PROGRESS deviation
  note (737 cockpit layout not reached). Acceptance flights in-browser:
  Cub pattern at a grass-adjacent field; 737 takeoff KSFO, climb, cruise
  segment at time-accel, ILS-coupled 28R landing (the tuned-ILS table
  covers it), GPWS gear callout demonstrated.

## What is explicitly NOT in this pass (recorded as deviations)

MCP/CDU/FMC-lite UI, LNAV/VNAV, autothrottle servo modeling beyond a
speed-hold shim, TCAS II RA vertical-guidance presentation, 737 cockpit
3D layout, hand-prop 3D interaction (hand-prop is a keyboard/menu action),
KSFO→KLAX full gate-to-gate. Roadmap items stay §28.
