# Stage 8b1 repaired procedural surfaces — independent review

Reviewed 2026-09-21. Scope: all eleven files in `procedural-prop-surfaces-repaired-review.diff`, current source, the binding procedural brief and DG80 staging constraints, and the original ten-finding review. This is a new review of the repaired implementation, not an endorsement of the stale implementation report.

**Spec compliance: FAIL — one remaining P2 geometry correction required.**

**Code review: changes required for the same defect.** The previous major hinge, bilateral-sign, split-contour and attachment defects have substantial, directly inspectable repairs. No other material correctness defect was established in this bounded review.

## Remaining finding

1. **[P2] The stowed second airbrake tier protrudes below the DG80 and LS8 wing.** `src/render/prop-aircraft.ts:178–184` constructs the upper tier from the entire original airfoil section, including its lower skin, then translates that full-thickness section downward by `thickness * .30` at `spoilerFrac = 0`. Its lower surface consequently projects through the preserved brake-well underside. An independent Node/Vite SSR diagnostic transformed indexed upper-tier vertices into world space and raycast upward against the original lower half retained in `brake-well-left/right`. Maximum protrusion below that lower skin was **0.02458335 m on both DG80 wings** and **0.02625001 m on both LS8 wings**. Hundreds of indexed vertices were below the underside, so this is not an isolated floating-point seam. This violates the retained neutral silhouette and the intended upper-wing airbrake topology. Make the second tier thin enough and position it within the original wing envelope when retracted; retain connected supports through extension. Add a neutral containment check against both original wing surfaces, on both sides. The current two-tier test only checks that both centers rise, while the neutral contour test explicitly excludes the upper tier; neither detects the protrusion.

## Original finding disposition

| Original finding | Repaired implementation and disposition |
| --- | --- |
| 1. Rudders rotated sideways | **Resolved.** Prop and Cub rudder geometry is clipped in aircraft coordinates and reparented with `attachSkin`, preserving its neutral transform. The vertical hinge endpoints are derived in the same coordinates. |
| 2. Left flaps move upward | **Resolved.** Flap records retain side; physical down-positive travel is converted into each root-to-tip hinge basis using `side * physical`. This includes AN2 lower flaps. Indexed centroid tests now sample both sides through deployment. |
| 3. Intact spoiler wing, asymmetric motion, missing second tier | **Partially resolved.** Upper skin is actually removed over each pocket, a retained lower half forms the well, and side-aware rotation makes both sides rise. DG80 and LS8 now have two connected tiers. The new upper-tier stowage defect above prevents closing this finding completely. |
| 4. Cub loses inboard/tip trailing skin | **Resolved.** Both moving and fixed regions are clipped from the unchanged `wingGeometry`; the center strip, tip strips and forward control-region slices are retained. The rounded-tip contour is no longer replaced with an independent rectangular airfoil. |
| 5. MU2 lacks carriages and a separated second element | **Resolved at the declared visual-approximation level.** The primary and secondary elements occupy separate original chord intervals; the second has its own relative translation and rotation. Two actual carriages per wing follow rails, with rail-root braces, carriage arms and skin-attached secondary supports. MU2 trim tabs replace their own secondary-element trailing regions and do not receive roll input. This is not manufacturer-dimension or rigid-link kinematic certification. |
| 6. Invisible mounts falsely certify attachment | **Resolved.** `skinDrive` anchors real cylinder horns to indexed skin vertices and places each mount at the other end. New tests independently compare horn ends to skin triangles and rendered rod ends to mounts. The mutation moves a real mount and horn together and updates its live rod; the skin-continuity assertion still detects the floating assembly. |
| 7. Miniature airfoils change the cut contour | **Resolved.** `cutSkin` clips the shared full-chord curved geometry, interpolates normals and caps cut sections. AN2 lower fixed and moving pieces use the same original lower-wing geometry and one common plane. Current materials use geometry-space procedural detail, so the helper's omission of UV attributes does not discard a required current texture mapping. |
| 8. Cub stabilizer asymmetric/overlapping | **Resolved.** Fixed and moving portions now come from the same symmetric original oval tail and the common z=4.05 cut. Elevators are separated by side from that shared aft portion. |
| 9. Differential tied permanently to side | **Resolved.** Up/down magnitude now depends on `side * roll > 0`, with side used separately for hinge-coordinate conversion. Reversing roll exchanges the up/down travel magnitudes. |
| 10. Geometry acceptance tests insufficient | **Substantially repaired, with the remaining tier-containment gap above.** Added checks use indexed triangles for cut adjacency/exclusion, signed world movement, nine points along stationary hinge lines, physical horns/rods, sampled deployment and the real disconnected-assembly mutation. Moving Fowler axes and airbrake/secondary mechanisms are explicitly excluded from the stationary-hinge test and assessed through their mechanism-specific checks instead. |

## Other checked requirements

- BE35 retains two canted fixed/moving V-tail halves and pitch/yaw mixing; no conventional fin is added. Conventional and T-tail control skins inherit their actual neutral placement. P180 retains its fixed forward lifting plane.
- AN2 retains the lower-wing/upper-wing topology, interplane struts and wire; lower wings have flaps rather than ailerons. Upper ailerons receive the specified 16-degree flap droop. No flap-driven leading-edge slat animation was added.
- Cub has no flap. AS21/LS8/Discus have fixed trailing inboard regions and airbrakes. DG80 has one moving flaperon per wing and two physically connected drive stations.
- Optional DG80 signed degrees and explicit left/right mixed radians remain additive render-contract fields. Explicit final angles bypass roll recomputation; legacy `flapFrac` does not invent DG80 positive flaps. Effective elevator radians override the fallback pitch command without adding trim again. Missing/nonfinite inputs are bounded.
- Surface updates transform existing geometry and update existing live rods; no per-frame geometry construction was introduced. Native adapter and async substitution source were not changed in this diff.

## Evidence and coverage limits

Root supplied fresh verification of **32/32 tests across seven files in 35.13 seconds** and `npx tsc --noEmit` exit 0. Those results are acknowledged as root evidence; this reviewer did not rerun the same suite or independently claim those command results.

This reviewer ran only the targeted stowed-tier diagnostic described above. It instantiated DG80 and LS8, checked actual indexed vertices against the retained lower skin with world-space raycasts, and exited 0. Vite reported a sandbox `EPERM` for its incidental WebSocket listener; SSR module loading and measurements completed and the server was closed. This is geometry evidence, not browser evidence.

Production code/tests, Git, browser state and source assets were not edited. Only this review report was written. The original implementation report still needs a repair appendix with the added files, revised geometry/mechanisms, current verification and remaining limits.

Root owns renewed browser close-ups, including undersides and neutral/deployed glider airbrakes. This review does not establish visual polish, absence of all self-intersections, type-certified control dimensions, exact airbrake/Fowler linkage kinematics, hardware behavior, the separate DG80 signed-detent/mixer/aerodynamic task, or whole-fleet/full-suite/validation/build acceptance. This subset does not complete Stage 8 or the broader goal.

## Final narrow repair re-review — 2026-09-21

**Final bounded verdict: PASS spec / PASS code.** This supersedes the earlier FAIL verdict for the procedural prop/Cub geometry implementation reviewed here. The remaining P2 is resolved; no additional material finding was identified in the narrow delta. Original finding 3 and its associated finding-10 containment gap can now be closed at the declared visual-approximation level.

Compared `procedural-prop-surfaces-repaired-review.diff` with `procedural-prop-surfaces-final-review.diff`. The source delta is limited to compressing the second tier's finite depth to 10% about the local dihedral midplane, recomputing its normals, and reducing neutral downward offset from 30% to 12% of parent thickness. Original wing/well/lid geometry, tier span/chord outline, deployment schedule and two physical support stations are unchanged. The thinner curved tier fits inside the real opening without altering the parent silhouette. The implementation report now documents this specific repair and its approximation.

Read the new regression independently: its projected barycentric intersections use the actual indexed well and lid triangles, check every referenced tier vertex on both sides of DG80 and LS8, and reject missing footprint coverage. Its 100 mm aircraft-Y mutation moves the actual visible tier and must fail containment. It neither verifies only node names nor duplicates the new 10%/12% constants.

Repeated this reviewer's independent raycast diagnostic against the repaired source, including downward rays against the upper lid as well as the original upward rays against the well underside. All four model/side combinations had **zero below-wing or above-wing escapes** among raycast-covered indexed vertices. Minimum measured lower-skin clearance was **12.29404 mm for DG80** and **13.12800 mm for LS8**, equal on left/right. Minimum upper-skin clearance was **32.15560 mm for DG80** and **34.33566 mm for LS8**. Three.js raycasts omit some exact shared-edge intersections; the regression's barycentric footprint assertion addresses those vertices. The diagnostic exited 0 after closing its server; the same incidental sandbox WebSocket `EPERM` did not prevent SSR measurements.

The repair agent/root report **23 passing focused tests across three files in 35.53 seconds** and TypeScript success. These were read as supplied verification evidence, not rerun or claimed as this reviewer's commands. This reviewer changed only this report. Browser neutral/deployed underside inspection remains with root, as do all previously stated integration, hardware, full-validation and separate DG80 simulation limits. This PASS does not mark the broader goal or Stage 8 complete.

## Underside mechanism follow-up — 2026-09-21

**Updated verdict: changes required, P2.** Root's underside screenshots prompted a wider check of the complete neutral airbrake assembly. The preceding PASS established the repaired tier plate's containment but missed its rods and horns; it does not stand as approval of authentic complete-mechanism stowage. The plate repair remains valid.

**[P2] Airbrake rods and horns still project below the closed wing.** The visible underside hardware cannot be explained solely as separate aileron/flaperon drives. Both DG80 and LS8 have main airbrake actuator cylinders fully below the original lower-wing envelope in neutral state. All 52 referenced cylinder vertices were below the lower skin on each side of each aircraft. Some second-tier support cylinders also cross that skin. These parts are connected to their skins, but their stowed positions are outside the upper-wing brake enclosure.

Measured maximum protrusion of actual indexed cylinder vertices below the original lower-wing surface (positive values mean outside):

| Aircraft | Mesh identity | Left mm | Right mm |
| --- | --- | ---: | ---: |
| DG80 | `airbrake-{side}-actuator` | 42.010 | 42.011 |
| LS8 | `airbrake-{side}-actuator` | 41.895 | 42.131 |
| DG80 | `airbrake-{side}-actuator-fixed-horn` | 37.215 | 37.215 |
| LS8 | `airbrake-{side}-actuator-fixed-horn` | 37.221 | 37.221 |
| DG80 | `airbrake-{side}-actuator-moving-horn` | 13.451 | 13.451 |
| LS8 | `airbrake-{side}-actuator-moving-horn` | 7.830 | 11.838 |
| DG80 | `airbrake-{side}-tier-support-0.2` | 6.287 | 6.424 |
| LS8 | `airbrake-{side}-tier-support-0.2` | 6.675 | 6.527 |
| DG80 | `airbrake-{side}-tier-support-0.8` | 1.725 | 1.729 |
| LS8 | `airbrake-{side}-tier-support-0.8` | 0.324 | 0.310 |

The `tier-support-0.2-moving-horn` also crosses the underside by approximately 1.87–1.94 mm. Both tier-support fixed horns and the 0.8 moving horn remain inside. These small crossings are additional to the much larger main actuator exposure.

For comparison, LS8's actual `aileron-left/right-actuator` cylinders remain inside the original wing, with a minimum lower-skin clearance of **6.709 mm**. They therefore cannot account for its exterior rods near the airbrake. DG80's separate two `flaperon-drive-{side}` cylinders do extend below the wing by approximately **42.063 mm** and **21.045 mm**, respectively, on both sides. This identifies additional potentially visible control hardware but does not turn the named airbrake actuators into flaperon drives. Exact screenshot-pixel attribution was not attempted without opening the browser.

Cause: `prop-aircraft.ts:174` applies the generic surface `drive` to the brake lid. Its `skinDrive` call (`prop-aircraft.ts:154–157`) selects nearest indexed skin vertices, and `procedural-surfaces.ts:120–122` always adds a downward horn/mount offset. That is a connected geometry construction, not a guarantee of enclosure. The tier supports at `prop-aircraft.ts:189–191` use the same downward-offset helper. Shrinking only the tier skin consequently could not contain those attached mechanisms. Give airbrake hardware internal mounting/offset geometry that fits the real well in neutral, and retain physical connections through extension. Extend the containment regression to actual actuator/support cylinders and their horns; endpoint-coincidence tests alone are insufficient. Do not hide the rods to satisfy the assertion.

The long black strip has a separate, direct explanation: `prop-aircraft.ts:171` assigns `dark` to the **whole retained lower-half pocket**, including the exterior lower wing skin, not just an interior cavity surface. The underside strip is thus drawn intact lower skin with a dark material, not an opening or protruding tier. For an unchanged painted exterior, keep the outer lower skin's aircraft material and apply the dark material only to interior well faces. The current source provides no evidence that a dark exterior underside strip is an authentic livery detail.

Evidence: a fresh read-only Node/Vite SSR diagnostic built DG80/LS8 at zero controls/brakes, transformed every referenced vertex of each named cylinder/horn into world space, and raycast vertically against the original uncut wing geometry reconstructed with the factory's same airfoil, taper, dihedral, dimensions and exterior offset. The whole original wing was needed because the main actuator extends forward of the well footprint. Every measured hardware vertex had a lower-envelope ray hit. The diagnostic exited 0; incidental WebSocket sandbox `EPERM` again did not affect SSR calculations. No production/tests, browser, assets or Git were changed; only this appendix was written. No whole-suite rerun or new broader completion claim is made.
