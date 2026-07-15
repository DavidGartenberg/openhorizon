# Phase 3 Task 2a brief — systems sim

(Reconstructed from the implementer dispatch prompt — this is the exact
spec the implementer worked from.)

Build the pure `/sim` systems layer (no rendering/UI — that's later tasks),
TDD, in `src/sim/systems/`:

1. **`electrical.ts`**: 28V alternator + 24V battery. Master battery
   switch, master alternator switch, avionics bus switch(es). Alternator
   on + battery on → bus ~28V, battery charges. Alternator failed (or
   master alt off) + battery on → battery discharges under load over real
   time (capacity/amp-hours or equivalent "minutes remaining" model);
   once depleted, essential-bus-only (G1000-equivalent) load loses power
   while a standby bus/circuit stays live (real G1000 aircraft: standby
   attitude/airspeed/altimeter survive on battery after alternator
   failure). Expose bus voltage, battery capacity/percent, which loads
   are currently powered.

2. **`fuel.ts`**: two 26.5 US gal tanks (L/R), selector `L | R | BOTH |
   OFF`, fuel pump on/off. Gravity-feed imbalance: single-tank selection
   only depletes that tank; if the selected tank empties, fuel flow stops
   (starvation, engine can stop); switching to a tank with fuel restores
   flow. BOTH draws from both (consistent split, total burn matches
   engine demand). Expose L/R quantities + low-fuel flag.

3. **`pitot.ts`**: pitot heat on/off. Pitot icing (caller-supplied
   "icing conditions" boolean) with heat off → airspeed freezes at
   whatever it read when blocked, then behaves like an altimeter
   (increases in climb, decreases in descent) since the static port still
   senses ambient pressure. Static blockage (separate failure input) →
   altimeter/VSI misread while airspeed stays correct — opposite symptom
   pattern. Pure function/class: (true IAS/alt-rate, blockage state) →
   displayed reading. Does not touch real `aircraft.data` truth.

4. **`engine-start.ts`**: cold-and-dark POH start-sequence state machine
   — ignition/starter engages → engine catches, RPM comes up → magneto
   check (L/R/BOTH cycling shows 100-150 RPM drop per magneto, ≤50 RPM
   difference between L and R — real POH numbers, test must assert this
   range) → starter disengages once running. Hot-start and flooded-start
   as distinct failure/retry paths (flooded start needs a different
   technique, e.g. throttle-open-no-prime, to succeed — doesn't need to
   be a full thermodynamic model). Engine-stopped must be a real reachable
   state (Phase 1 always ran the engine) with zero thrust/RPM decay, and
   a successful start brings it back. Must not touch aero/gear/6-DOF math.

5. **Mixture/EGT**: replace/extend Phase 1's `mixturePowerFactor` in
   `propulsion.ts` with an EGT model: EGT rises as mixture leans from full
   rich, peaks at some setting (real "peak EGT" leaning technique point),
   then falls as mixture goes further lean (or power falls off). Test must
   sweep mixture rich→lean and assert a genuine local maximum exists
   (peak-EGT must be a real findable value, not monotonic) — this is what
   a later lean-assist cockpit page needs to work off real data.

## Binding constraints
- `src/sim/` and `src/math/` must never import three.js or touch the DOM
  (`tests/sim-purity.test.ts` must stay green).
- `npx tsc --noEmit` clean; full `npm test` suite green throughout.
- Mirror the existing `Aircraft.groundElevAt` pattern (optional field the
  caller wires in) rather than reaching into rendering.
- Do not touch `src/render/`, `src/cockpit/`, `src/main.ts`, or flight
  dynamics/tuning in `src/sim/aircraft/c172s.ts`.
- No LLM-guessed magic numbers without a comment citing the source (POH,
  published data) — flag anywhere a real source wasn't available in-repo
  rather than silently picking a number.

## Tests required (`tests/systems/`)
`electrical.test.ts`, `fuel.test.ts`, `pitot.test.ts`, `engine-start.test.ts`
(cold-and-dark start, magneto-check range, flooded-start technique,
peak-EGT sweep — sweep test may live in engine-start.test.ts or its own file).
