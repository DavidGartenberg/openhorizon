# Glider airbrakes review

## Verdict

**Approved for bounded code acceptance, subject to root-owned browser verification.** No blocking spec or quality findings remain in the reviewed repair. The updated implementation addresses all three prior findings and preserves truthful scope. The reported final verification is 20 focused tests passing plus TypeScript compilation passing; this re-review did not repeat those commands.

Browser proof that the real `V` and quadrant paths produce nonzero `spoilerPos` and drive the existing authored 95-degree ASK21 animation remains pending with root. The DG80 flaperon/flap model is also an explicit, separately scoped missing capability. This approval covers the bounded airbrake repair only and does not certify the broader all-surface goal.

## Resolved findings

### Glider controls no longer inherit the jet ARM cycle

- `src/input/speedbrake-control.ts` makes non-auto-deploy airbrakes cycle directly between DOWN and FULL, always clearing `spoilerArmed`.
- `src/main.ts` uses that helper for `V` and rejects the hardware ARM detent on types without `groundAutoDeploy`.
- Jets retain DOWN/ARM/FLIGHT behavior, including the existing touchdown deployment capability.
- `tests/controller-main.test.ts` covers both glider keyboard/ARM rejection and preserved jet keyboard/hardware ARM behavior through the extracted `pollControls` path.

### The airbrake test no longer authenticates missing flaps across the fleet

- `tests/glider-airbrakes.test.ts` limits the `[0]` flap assertion to ASK21.
- `glider-airbrakes-report.md` explicitly documents the DG-800S flaperon evidence, leaves the roster's current DG80 flap metadata unchanged, and identifies the full DG80 flap/flaperon model as separate missing work.
- The airbrake capability assertions for DG80, LS8, and DISC no longer make their legacy flap metadata part of this repair's acceptance contract.

### Live actuator-to-aerodynamics coverage now spans all four gliders

- AS21, DG80, LS8, and DISC each receive a clean/deployed comparison starting from the same safe trimmed state.
- The deployed instance is commanded through `spoilerCmd`, advances to full through `Aircraft.step()`, and must lose at least 8 m more specific energy over eight seconds.
- This protects the live command to actuator to position-scaled drag/lift-dump path rather than relying only on direct trim coefficient injection. The separate matched-speed equilibrium test still demonstrates a materially steeper descent condition.

## Confirmed bounded contracts

- All four supported gliders receive the shared normalized actuator with positive calibrated drag and lift-dump increments and `groundAutoDeploy: false`.
- Actuator travel clamps to `[0,1]`; ASK21 uses the sourced one-second extension/retraction rate; `spawnOnGround()` resets command, position, and arm state.
- Zero deployment adds exactly zero drag and lift dump, preserving the established clean polar. The clean identity and existing clean stall/glide validations remain reported green.
- B738 and derived jets explicitly retain `groundAutoDeploy: true`, and the existing touchdown regression exercises that behavior.
- The report labels `dCd = 0.12` and `dCl = 0.35` as calibrated approximations and does not claim source-derived aerodynamic equivalence.

