# Procedural surface browser QA

Sept18 initial implementation inspection, before implementer handoff. This is a failing intermediate check, not final acceptance.

Actual IAB tab15 loaded `/tests/browser/aircraft-studio.html`, selected CUB, Full pull/right and Rear quarter. DOM reported procedural source, pitch/roll/yaw1, elevatorRad-.44, 48draws/23,148triangles. Screenshot showed aileron strips separated below the wing and elevator strips below the tail. Source corroborates skins created at y0 then attached preserving world transform to hinges y1/.42. Implementer notified to correct skins and test actual indexed leading-edge-to-hinge and fixedboundary agreement. Cub rudder had become BoxGeometry rather than preserving rounded outline, also returned.

Code inspection found additional related defects while build is in progress: prop elevator outerhinge chord sign disagreed with its actual skin leading edge; V-tail hinges remained flat while skins were canted; no-flap glider fa..fb trailing strip absent; MU2 flap ended at ordinary outboard-aileron boundary despite requiring fullspan flap. These were explicitly sent to implementer before final handoff. They are not final source assertions after repair.

The helper test also originally measured cached mount coordinates; root requested independent renderedrod endchecks and mutations, plus narrow world-transform updates rather than wholeplane traversal perrod. Actualmesh attachment and shape preservation remain acceptance gates.

Studio closed after inspection; main127tab1 remains responsive, PAUSED, no gamepads exposed. Stalledlocalhost14 already gone at turnstart inventory; no further manual close needed. No calibration saved.

## Handoff review did not pass

Initialimplementer16focusedtests+tscpassed afterearlyfixes, butindependent review (procedural-prop-surfaces-review.md) found10remainingissues includinghorizontalrudders,oppositesignedleftflaps/spoilers,missingairbrakewells,Fowlercarriages,completeCubcuts andactualmountedbrackets. BothspecandcodequalityFAIL. Sourcefrozen andfreshgpt6astrageometryrepair dispatchedallfindings+originalbrief; initialpass isnotaccepted. RootwillrefreshactualbrowserQAonlyafterthecorrectedhandoff.

## Sept21 repaired source browser pass

Revalidated after resumption: prior agents absent from live inventory and old
browser tabs/server no longer present. Current renderer edits and repair tests
remain on disk. Root ran all seven focused files: 32/32 tests passed in 35.13 s;
TypeScript exited 0. Restarted the same loopback Vite preview, HMR disabled, and
opened fresh IAB studio tab2. No calibration or main-flight state was edited.

Actual screenshots and DOM controls inspected:

- Cub: full pull/right and full push/left, same rudder-focused camera. Rudder
  remains upright with rounded outline, reverses yaw, and elevators reverse pitch
  at their shared fixed-tail cut. The prior floating strips and sideways rudder
  are no longer visible. Mechanisms are small in these views; exact attachment
  distances remain the indexed-geometry regression evidence.
- C182: flap-left focus, full deployment versus neutral with unchanged camera,
  then elevated and nearly wing-height views. Both flaps deploy downward and
  rejoin the continuous wing surface at neutral. No prior independent mini-airfoil
  strip is visible at the cut.
- MU2: full deployment shows separate primary/secondary full-span elements and
  narrow supports/rails. Neutral plus right-roll command raises the right spoiler
  while the left remains flush; no moving trailing-edge aileron was substituted.
- BE35: focused left ruddervator with combined positive pitch/yaw retains the
  canted V-tail and attached moving aft skin. This is qualitative visual checking,
  not dimensional comparison with manufacturer rigging.
- P180: front-quarter positive controls retain pusher engines, fixed foreplane
  and T-tail layout.
- AN2: rear-quarter full flap deployment shows upper inboard flaps, upper outboard
  aileron droop, and full lower-wing flaps while interplane supports remain. Actual
  automatic AoA-driven leading-edge slats are still a separate integration item;
  no flap-linked slat behavior is claimed.
- Discus: close full-airbrake view shows a real opening and raised panel with
  visible drive rod; the flap control is disabled and effective flapFrac is zero.

Browser error-level logs were empty. Frame counters generally settled at 60 fps
in this isolated studio, but this is not a controlled performance comparison.
The procedural material/shape approximations remain, and no numeric visual gain
or photorealism acceptance is claimed.

Independent review found the DG80/LS8 upper-tier stowage protrusion, so those two
models remain explicitly pending corrected neutral/deployed/underside screenshots.
Also fixed a harness-only misleading display: switching from full flaps to a
flapless type left the disabled slider at one despite effective flapFrac zero.
Disabled flap/spoiler sliders now display zero; fresh-browser verification follows
the pending geometry repair reload. No flight behavior changes in this harness fix.

## Sept21 restored-browser underside inspection

Browser2 recovered through documented tabs.get/Playwright when the combined CUA focus operation timed out. Surface underside button works: hides inspection floor, permits below-wing camera, ordinary Focus surface restores floor and upper viewpoint. No production camera changes.

DG80 and LS8 neutral, selected actual airbrake-left-upper-tier, show no obvious blue tier plate below wing, but cyan linkage rods are visibly below the wing and a long dark exterior strip remains. This is NOT a complete-stow pass. Independent indexed geometry follow-up identifies main airbrake actuator/horns (~42mm max below actual lower wing) plus tier-support escapes. See latest procedural-prop-surfaces-repaired-review.md appendix. Dedicated repair underway.

LS8 Full deployment + Focus surface shows two blue boards, two tier support stations and the main drive connected visually; retraction/stow acceptance withheld pending repair. Console error logs empty. This isolated view is not a performance benchmark. DG80 actual signed simulation integration requires a refreshed harness/main flight check after its independent review.

### Linkage repair browser follow-up

After intentional refresh to the repaired geometry, LS8 neutral underside shows continuous painted lower wing with no airbrake rods below it and no black well-material stripe. Full deployment still shows both boards, two tier supports, and main linkage reaching the well. DG80 underside likewise removes the airbrake hardware/black stripe; its separate flaperon linkage remains visible below the aft wing (not evidence of an airbrake-stow regression). Discus neutral underside shows continuous lower wing and no exposed airbrake actuator. Browser error log empty. These are qualitative screenshots; indexed-geometry tests/review supply measured containment. Actual DG80 signed sim and final deployed close-up remain separate acceptance after simulation review fixes.
