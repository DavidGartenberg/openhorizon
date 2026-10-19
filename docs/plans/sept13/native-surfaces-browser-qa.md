# Sept18 native surface browser checks

Root loaded current aircraft-studio in actual Codex browser. Every exact imported selection reached source=local-xplane; all eight rendered, no error-level browser console messages on the completed session. Studio closed after checks to release GPU resources. This is visual/runtime evidence in addition to geometry tests, not whole-goal acceptance.

| Model | Browser control / authored observation | Visual observation |
|---|---|---|
| C172 | Full pull/right: elevator−20°, rudder+20°, leftail+15/right−20. Neutral then full flap30°; spoiler disabled. | Rear screenshot shows separate ailerons/elevator/rudder; full flaps visibly droop from wing. |
| B738 | Full deployment flap40°, slats1, spoilers38/33°, speedbrakes52/60°; pull elevator−20°, rudder29°, ailerons+16/−20. | Rear screenshot shows deployed original flap/slat/spoiler pieces; detailed individual support continuity still needs stronger acceptance. |
| A333 | Full deployment flap32°, slats1, spoilers35°; composite elevators−30°, composite leftail+25/right−25, rudder35°. | Front and rear screenshots show original mechanisms deploying. |
| AS21 | Flaps disabled/0; speedbrakes95°, ailerons+17/−29, elevator−30°, rudder35°. | Upper-wing red airbrakes deploy, full control movement visible. Flight actuator gap found below. |
| PA18 | Neutral pitch0 with trim+1 gives stabilizer+4°, elevator0°, trimRad−.069813. | Rear screenshot shows stabilizer trim separately; signed geometry regression requested for both signs. |
| SR22 | Full push/left: elevator20°, rudder−15°, leftail−30/right+10; flaps30°, spoiler disabled. | Rear screenshot confirms control/deployment changes; empty/dark cabin and ground-pose issues remain Stage9. |
| BE58 | Full push/left: commanded elevator20° (original assetplateau15° disclosed), rudder−27°, ailerons−18/+12, flaps30°. | Rear screenshot; tires remain noticeably buried, tracked Stage9 rather than attributed to terrain. |
| C750 | Full push/left: elevator22°, rudder−30/−18°, ailerons−25/+25; flap35°, slat1, speedbrake40°, spoilers35°. | Rear screenshot shows T-tail moving surfaces and original deployment parts; detailed support acceptance pending. |

Observed rates varied15–22fps with main simulator rendering concurrently; not a benchmark or performance acceptance. C17265draws105126tris, B738217/127367, A333341/602510, AS2132/25177, PA1851/42633, SR2248/130582, BE5874/59543, C750101/97152.

Cross-task issue: AS21 airbrakes cannot operate in actual flight because Aircraft.spoilerPos updates only for P.spoilers, assigned only to jets in derive.ts. Added glider-airbrakes-brief.md, requires meaningful actuator/aero support and real main V/quadrant path acceptance. Do not omit real glider airbrakes to fit missing old configuration.

Stage8a review requires localized interfaces and detached-component mutation; aggregate minimum contact proximity is insufficient. Native implementer is fixing verification. Actual post-AP/SAS/trim flight and connected hardware acceptance remain separate from studio controls.

## Corrected PA18 trim follow-up
The initial PA18 row above recorded the old reversed sign and is superseded. New signed aft-trailing-vertex regression found the centroid-based sign wrong; implementer removed PA18 stabilizerSign override. Fresh actual studio reload verified trim+1→stabilizer−4°, trim−1→stabilizer+2.5°, elevator command remains0° at both endpoints. Side screenshots inspected both corrected positions. Test studio closed afterward. All-eight signed trim geometry tests reported passing; localized attachment verification remains underway.

## Focused mechanism camera follow-up
Root added an Inspect surface selector and Focus surface action to the studio. Camera bounds use only actual indexed draw ranges beneath the chosen authored dataref, respecting visibility; shared whole-buffer bounds are excluded. TypeScript passed. Native737 flap2_deg[1] at full and half travel was inspected close-up from rear, overhead-oblique and low spanwise angles: separate panels, two visible local hinge/support locations and original exposed internal wing/flap structure remained present through the motion. This is representative supporting visual evidence, not certification of every hidden actuator endpoint. The new tool enables remaining named-interface checks without repeatedly guessing whole-aircraft orbit distances. Root source snapshots: /tmp/openhorizon-studio-before-focus.ts/.html.
