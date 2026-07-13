# Phase 1 plan — C172S flight model

Goal (§24): §5 complete for the C172S over flat terrain; trim solver; headless
validation harness. Acceptance: every §5.6 row passes `npm run validate`;
handling behaviors verified by scenario tests + hand-flying.

## Conventions

- Body axes: x forward, y right, z down (standard flight dynamics).
- World: local flat NED (north/east/down), ground plane z=0, altitude = −z.
  Geodetic/ECEF truth state arrives with Phase 2's world (per §24 ordering);
  recorded as a deviation until then.
- SI units internally; knots/feet only at display and POH-table boundaries.
- Render frame (x east, y up, z south) ⇄ NED conversion at the render boundary.

## Modules (all /sim + /math pure, no three.js)

- `math/vec.ts` — minimal Vec3/Quat ops (sim cannot import three).
- `sim/atmosphere.ts` — ISA T/p/ρ/a; TAS/CAS/IAS with the C172S position-error
  calibration (POH §5: 48 KIAS ↔ 53 KCAS at clean stall).
- `sim/aircraft/c172s.ts` — all parameters: geometry, mass/inertia, aero
  derivatives (Roskam starting values, tuned to pass §5.6), flap increments,
  prop Ct/Cp polynomials, gear geometry/stiffness, engine ratings.
- `sim/aero.ts` — coefficient buildup → body-frame forces/moments: nonlinear
  lift with smooth post-stall blend, drag polar + increments, full static +
  dynamic derivatives, adverse yaw, propwash on tail, P-factor + slipstream +
  torque, ground effect.
- `sim/propulsion.ts` — engine torque map (throttle, RPM, density via
  Gagg-Ferrar) vs prop torque (Cp(J)); RPM is a dynamic state. Thrust from
  Ct(J) including negative (windmilling drag) past J₀. Fuel burn from power.
- `sim/gear.ts` — 3 spring-damper struts vs the z=0 plane: rolling/braking/
  lateral tire forces, nosewheel steering, differential braking.
- `sim/wind.ts` — steady wind + gusts + simplified Dryden turbulence filters.
- `sim/aircraft.ts` — the Aircraft: state, force summation, semi-implicit
  6-DOF integration at 120 Hz, derived data (α, β, IAS/CAS/TAS, VS…).
- `sim/trim.ts` — damped-Newton trim: given V/h and power or γ, solve α, δe,
  throttle (or γ). Powers validation + spawn-in-cruise.

## Validation harness (`tests/validate/poh.test.ts`)

Closed-loop headless flight per §5.6 row: speed-hold climbs, altitude-hold
deceleration stalls reading IAS through the pitot calibration, trim cruise at
75% power, glide ratio, ground-roll integrations, static RPM, ceiling
bracketing (climb >100 fpm at 12,500, <100 at 15,500). Scenario tests: power-on
stall torque/P-factor yaw, slip sink rate, go-around pitch-up, crosswind drift.

## Render/UI

Placeholder C172 built from primitives (geometry matches gear contact points),
grass island + 1000 m runway at origin for ground-handling verification, chase
camera, flight-control key/gamepad bindings, HUD flight data + `window.__oh`
extensions (ias/alt/vs/rpm/aoa) for browser verification.

## Risks

- Tuning loop: CD0/CLmax/Ct0/calibration interact across table rows — expect
  2–4 iterations; keep every knob in c172s.ts.
- Gear stiffness at 120 Hz — semi-implicit integration + real damping ratios;
  clamp penetration forces.
- Keyboard-rate control feel — shape inputs (attack/centering rates) outside
  the sim so the dynamics stay honest.
