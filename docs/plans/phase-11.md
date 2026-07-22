# Phase 11 plan — Fleet core (absorbs contract Phase 10)

Supersedes `phase-10.md` (10a's refactor is finished here as 11a; the Cub
and 737 land as 11c/11f). Part of the approved Phases 11–15 mega-plan
(fleet → data layer → graphics → live traffic → perfection); master copy
of that plan lives with the session, slice summaries land here + PROGRESS.

## Slices (one commit each)

- **11a. Finish the fleet refactor.** aircraft.ts `P.` → `this.P.`; pass
  `this.P` explicitly to stepPropulsion/computeAero/computeGear (the
  defaulted params args are a silent-C172 trap otherwise); flap clamp →
  `flapDetentsDeg.length - 1`. New `tests/fleet-params.test.ts`: cloned
  params fly bit-identical; doubled wing area changes stall (threading is
  real). Zero numeric drift: suite + validate green unchanged.
- **11b. Piston fleet extensions.** `systems/carb-ice.ts` (TDD), hand-prop
  + no-electrical path in engine-start, `pitotCal` params (default = the
  C172 tables, bit-exact), gear-geometry static spawn attitude.
- **11c. J-3 Cub.** `aircraft/j3cub.ts` + `tests/validate/j3cub.test.ts`:
  stall ~33 ±3 kt, cruise 65–70 kt @2150, climb ~450 ±80 fpm; three-point
  stays straight; frozen-rudder wheel landing ground-loops (emergent).
- **11d. Turbofan (pure).** `sim/turbofan.ts` CFM56-7B26: N1 spool,
  thrust lapse, TSFC; tests: static thrust, FL350/M0.78, spool 4–8 s.
- **11e. Jet/retract/Mach plumbing.** aircraft/aero/trim branches proven
  with a SYNTHETIC jet before real 737 numbers; C172/Cub bit-unchanged.
- **11f. 737-800.** `aircraft/b738.ts` + validation (Vref30 140 ±5 kt @60 t,
  M0.785 fuel 2.4 t/h ±10%, ≥2000 fpm @FL100/65 t); TAWS jet profile
  (TOO LOW — GEAR/FLAPS, FIFTY…TEN).
- **11g. Fleet UX.** `FLY 172|CUB|737` (localStorage + reload), params-fed
  PFD arcs/EIS, buildCub/buildB738 meshes, jet/Cub sound. Browser
  acceptance: Cub three-pointer + ground-loop + carb ice; 737 KSFO
  takeoff → cruise → ILS 28R → GPWS gear callout.

Deviations carried from phase-10.md §"NOT in this pass" stay in force.
