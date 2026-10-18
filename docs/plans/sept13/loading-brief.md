# Stage 5 — editable fuel and payload

Read global constraints in implementation.md. Preserve all preceding work. Own
new pure loading validation/conversion state and UI panel, main.ts loading/reset/
save integration, narrowly scoped Aircraft defaults if needed, focused tests.

User wants to change weight and fuel quantity. Add a visible Fuel & payload panel
showing editable payload (pilot/passengers/bags) and left/right tank fuel, total
fuel, empty weight, gross weight and current aircraft MTOW. Support kg/lb units;
avoid volume units without fuel-type density. AircraftParams already has
emptyMassKg, mtowKg, fuelCapacityKg. Validate finite nonnegative values, each tank
<=half total capacity, positive usable mass; alert clearly when gross exceeds
MTOW. Permit deliberate overweight payload with clear warning if otherwise valid,
rather than silently clipping to a C172-specific number. Apply ground/stationary
only (say why in UI); don't mutate mass while user merely types/drafts values.
Use actual aircraft mass after apply, never display-only settings.

Authoritative fuelState leftKg/rightKg gets stepped each tick and its sum
overwrites aircraft.fuelKg. Apply both ledgers transactionally so next physics
tick preserves edits; no magic refilling on selector change. Preserve actual
engine fuel starvation/restart behavior. Store a per-aircraft loading selection
for next flight/respawn; save/load snapshot has higher priority than preferences.
Keep tank imbalance in snapshots (backward-compatible old total-only saves).
Reset currently fills both tanks unconditionally in resetOnboardSystems; remove
that conflict. Constructor payloadKg=250 also overloads small gliders—choose a
sensible default bounded by type useful load while preserving established types
where valid. Avoid changing unrelated aerodynamics.

WEIGHT command currently payload lb clamped0..500kg and compares to2558lb for all
aircraft: route through same validation/apply logic; retain compatibility. WB MFD
already has C172-only envelope: preserve it and don't display C172CG as universal.
Panel focus must disable flight controls; blur/close restore properly, matching
other panels without stealing typed ATC focus or latching held hardware actions.
Opening panel mid-flight should show current fuel, not a stale full-tank draft.

Tests first: conversions/NaN/negative/capacity, two-tank application survives burn,
actual mass, overweight warning, ground guard, glider/GA/airliner defaults,
per-type preference independence, reset selection, old/new snapshot restoration.
Run focused fuel/loading/aircraft/save tests and tsc. Root browser only. Full report
loading-report.md, concise status, no commits.
