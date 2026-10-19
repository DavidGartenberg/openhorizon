# Stage 8b1 procedural prop and Cub surface report

**Current status (Sept21):** The initial implementation described below failed
independent review. The later geometry repair and thin-tier correction now have
bounded spec/code approval in `procedural-prop-surfaces-repaired-review.md`.
Browser/integration acceptance remains partial; see the current appendices and
`procedural-prop-surfaces-browser-qa.md`. The initial 16-test count is historical.

## Scope delivered

This bounded stage implements moving procedural geometry for every non-jet roster profile and the dedicated J-3 Cub. It does not claim completion of Stage 8: dedicated C172/B738, generic jets, integrated DG-800S signed-flap physics, hardware evidence, and final browser acceptance remain separately staged.

The shared mechanism helper builds a hinge frame whose local axis passes through both supplied swept/dihedral endpoints. Its live actuator rods connect a fixed mount to a mount parented to the moving skin and update transforms without rebuilding geometry. The attachment probe measures the rendered cylinder endplanes against the current mounts; the mutation test deliberately moves a mount without updating the rod and proves the attachment assertion fails.

Generic props now use separate fixed leading/fixed trailing/moving indexed skins. Conventional aircraft receive ailerons, elevators and a rudder. BE35 retains a canted V-tail and mixes pitch/yaw through two ruddervators. T-tail hinge endpoints inherit fin-top height; P180's foreplane remains fixed. The Cub has no flap and now has separate airfoil ailerons/elevators plus a rounded rudder. Its moving skins meet the fixed split at the hinge line.

Profile metadata explicitly selects unusual arrangements. MU2 uses full-span double-element Fowler flaps, rails, connected drives and roll spoilers, with no invented ailerons. AN2 retains both wings/struts/wires, uses upper inboard flaps and upper ailerons, lower full-span flaps, no lower ailerons, and 16 degrees of flap-linked upper-aileron droop. AS21/LS8/Discus/DG80 use wing airbrakes rather than invented trailing-edge flaps. DG80 uses one one-piece flaperon per wing with two connected drive stations.

`SurfaceState` now optionally carries signed `flapsDeg`, `flaperonLeftRad`, and `flaperonRightRad`, all trailing-edge-down positive. Explicit DG80 mixed angles are authoritative and do not receive roll a second time. The compatibility fallback uses signed base degrees plus bounded visual roll. It does not derive positive deployment from legacy `[0]`.

## Changed files

- `src/render/procedural-surfaces.ts` — endpoint hinge frame, allocation-free rendered linkage, finite clamping and physical attachment measurement.
- `src/render/prop-profiles.ts` — explicit roll/flap/airbrake/biplane topology metadata.
- `src/render/prop-aircraft.ts` — split skins, signed animation, mechanisms and exceptional topology.
- `src/render/cub-mesh.ts` — split flapless Cub controls, curved rudder and mechanisms.
- `src/render/aircraft-mesh.ts` — optional DG80 signed render fields only.
- `tests/render/procedural-surfaces.test.ts` — hinge endpoints, rendered rod endpoints and disconnected-end mutation.
- `tests/render/prop-surfaces.test.ts` — all non-jet profiles, indexed motion, signs, endpoints, topology, fractions and finite bounds.
- `tests/prop-aircraft.test.ts` — capability-aware flap assertion using physical surface angle.
- `tests/render/cub-surfaces.test.ts` — bounded draw budget updated for real skins/mechanisms.

## TDD evidence

RED command:

`npm test -- tests/render/procedural-surfaces.test.ts tests/render/prop-surfaces.test.ts --maxWorkers=1 --no-file-parallelism`

Expected RED result: 2 failed files / 3 failed tests. The helper module did not exist; prop/Cub aileron, elevator, rudder and DG80 flaperon skins did not exist. An earlier attempt with Jest's unsupported `--runInBand` was rejected by Vitest before collection and is not counted as the feature RED.

GREEN focused command:

`npm test -- tests/render/procedural-surfaces.test.ts tests/render/prop-surfaces.test.ts tests/prop-aircraft.test.ts tests/render/cub-surfaces.test.ts tests/render/player-aircraft.test.ts tests/fleet-mesh-build.test.ts --maxWorkers=1 --no-file-parallelism`

Final GREEN result: 6 files passed, 16 tests passed. This includes every non-jet profile, player-factory construction and Cub envelope regressions.

TypeScript command: `npx tsc --noEmit` (pass after the final geometry changes).

## Visual calibration and approximations

- Generic aileron travel is approximately 20 degrees up / 10 degrees down; elevator travel approximately 24 degrees; rudder approximately 27.5 degrees. These are bounded visual values where exact profile-specific rigging was not supplied and do not alter aerodynamic parameters.
- Fowler translation uses the existing shared `fowlerPose` schedule. MU2's double element and rail placement are visual reconstruction, not manufacturer CAD dimensions.
- AN2 upper-aileron flap droop is the sourced 16 degrees. Other AN2 hinge/chord proportions are visual estimates.
- DG-800S geometry honors explicit final radians. The maintenance-manual nominal L conversion (`asin(38/122) = 18.148168 degrees`) and asymmetric neutral-flap roll travel belong to the separate simulation mixer; the renderer does not clamp combined angles to pure-flap stops.
- Generic linkage bracket offsets and actuator radii are scaled visual estimates. Endpoint connection is tested throughout sampled travel, but the exact bellcrank geometry is not claimed as type-certified.

## Open acceptance

- Root browser close-ups remain required for Cub, representative high/low wing props, twin/turboprop, BE35, P180, AN2 and all gliders. The first Cub browser pass correctly exposed panel placement and contour defects; these were revised and require refreshed screenshots.
- DG-800S physical signed-detent/mixer/aerodynamic integration remains in the separately authorized task.
- Final full suite, validation and production build are intentionally deferred to root's integrated stage. No Git operation, source-asset write, deployment or publication was performed.

### DG80 / LS8 finite upper-tier stow repair

Independent review found the upper airbrake tier duplicated a full wing section and translated it down: neutral indexed vertices escaped below the actual brake-well underside by 24.583347 mm (DG80) and 26.250007 mm (LS8). The new regression reproduced the DG80 failure before production edits (expected <= 0.020 mm, observed 24.583347 mm).

`src/render/prop-aircraft.ts` now retains the clipped tier's tapered span/chord outline and curved section, but compresses its finite section depth to 10% around the local wing midplane and stows it 12% of parent thickness below that plane. This is a visual thin-board and linkage-travel approximation, not a measured manufacturer board section. The original wing/well geometry, moving panel footprint, two support stations, live rod/horn attachment, deployment rotation and rising travel are unchanged.

`tests/render/prop-surfaces-repair.test.ts` intersects vertical lines with actual indexed brake-well and lid triangles to check every referenced upper-tier vertex against the lower and upper drawn envelope, on both sides of both models. Its mutation lowers the actual tier hinge by 100 mm in aircraft Y and verifies detectable bottom escape; it does not rely on an inaccessible fixture or hidden geometry. An initial mutation used hinge-local Y and also changed span position; it was corrected to aircraft Y so the mutation isolates bottom escape.

Verification: serial `npx vitest run tests/render/prop-surfaces-repair.test.ts tests/render/prop-surfaces.test.ts tests/render/procedural-surfaces.test.ts --maxWorkers=1 --no-file-parallelism` passed all 23 tests in 3 files (35.53 s), including existing raised-tier and physical horn/live rod continuity tests. `npx tsc --noEmit` passed. Browser acceptance remains with the parent task; this bounded repair does not establish whole-fleet visual acceptance.

## Consolidated geometry repair and current evidence

Fixed/moving skins now come from actual cuts of the common full-chord airfoil,
Cub wing and rounded Cub tail meshes. This preserves fixed inboard/tip regions
and complete neutral cut contours. Hinge-parent attachment preserves placement;
side-aware rotations correct bilateral flap, spoiler and rudder behavior, and
aileron up/down differential follows command direction. V-tail cant is retained.

Visible skin-mounted horns connect the fixed and moving indexed skins to live
rods. MU2 has separately cut primary/secondary flap elements, rail-constrained
carriages, fixed-wing braces, secondary supports and flap-mounted trim tabs.
Spoiler pockets remove the real upper wing skin. DG80/LS8 have supported second
tiers; the follow-up above fixes their neutral lower-skin escape.

Additional repair files: `tests/render/prop-surfaces-repair.test.ts` and
`tests/render/surface-geometry-assertions.ts`. Tests independently interrogate
indexed triangles, complete sampled hinge lines, neutral contours, world-space
signed movement, physical horns/rod ends and detached geometry, rather than
accepting names or common animation membership as attachment proof.

Root Sept21 pre-tier-fix verification: seven focused files passed 32 tests in
35.13 seconds and TypeScript exited 0. The final tier-specific update then passed
23 covering tests in three files, including its new containment/mutation case;
independent re-review measured zero upper/lower escapes on both DG80/LS8 sides.
Root also reran TypeScript after the inspection-harness additions: exit 0.

Refreshed browser checks cover Cub, C182, MU2, BE35, P180, AN2 and Discus plus
corrected DG80 deployed and neutral wing-height views. The new explicit underside
inspection button is unverified because browser automation disconnected during
reload. LS8 corrected visual and both glider underside checks remain open. Main
physics DG80 signed-detent integration, automatic AN2 AoA-driven slats, dedicated
C172/B738/procedural jets, full validation/build, hardware and full visual quality
are separate outstanding requirements. No manufacturer CAD, numerical 10X gain
or full simulator completion is claimed.
