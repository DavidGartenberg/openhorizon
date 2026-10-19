# AS21 airbrake and PA18 exposed-linkage audit

Bounded read-only audit of the two remaining small-aircraft mechanism questions from `native-surfaces-report.md`. This identifies the actual drawn connected components and freezes both endpoint partners. It does not use nearest-any-fixed contact as acceptance, and it does not claim that an exterior skin proves an unmodeled internal bearing.

No production code, tests, fixtures, manifest entries, or original X-Plane assets were changed. The proposed witnesses below are not yet regressions.

## Method and pose set

Only the native files already selected by `XP_MODELS` were loaded:

- AS21: `Schleicher ASK 21/objects/wing_L.obj` and `wing_R.obj`
- PA18: `Piper PA-18 Super Cub/objects/fuselage.obj`

The existing `nativeInterfaceScene`, `drawComponents`, and `vertexWorld` helpers supplied the OBJ8 parser/build path, authored animation transforms, actual `TRIS` draw ranges, and connected components welded at 0.01 mm. IDs are `OBJ path | drawRange.start | minimum indexed vertex`. Unused shared-buffer vertices and whole-buffer bounds were excluded.

AS21 speedbrakes were sampled independently at deployment fractions `0, .25, .5, .75, 1`, with pitch, roll, yaw, and trim neutral. PA18 rudder links were sampled at yaw `-1, 0, +1`; the full diagnostic also held the linkages through the five neutral/deployment samples and independent pitch, roll, and trim endpoints. Those unrelated controls did not move the rudder-link components. Distances below are from a named terminal vertex to a frozen triangle on the identified semantic partner. This is a repeatable witness, not a search for whichever triangle becomes convenient at each pose.

## Kinematic and containment result

### AS21: four support arms rotate from panel pivots and remain embedded in the wing

The actual support arms are the two narrow components at draws `2334` and `2442` in each wing OBJ. Each inherits only its side's `speedbrake1_deg` dataref. One terminal is at the authored panel-side rotation center; the other sweeps inside the fixed wing component (`357|107`).

The ancestry makes this explicit. On the left, draw `2334` rotates around `[-3.06983, 0.470173, 2.94055]` and draw `2442` around `[-4.04349, 0.539151, 2.92605]`, both on local Z from 0 degrees at speedbrake 0 to 40 degrees at the native 90-degree dataref endpoint. The right side mirrors the centers and uses local `-Z`. Both are nested under the airbrake parent's authored translation of approximately 0.039 m spanwise and 0.130 m upward at full deployment. The previously selected panel-side terminal vertices lie within about 0.001-0.020 m of those rotation centers before the parent transform; they are the pivot ends, not detached tips.

Distances are metres in deployment order `0 / .25 / .5 / .75 / 1`.

| Side / support component | Sweeping wing-side terminal | Distance to one frozen exterior triangle | Panel-pivot terminal | Pivot-partner gap profile |
|---|---|---|---|---|
| L `wing_L.obj|2334|882` | v911 -> `wing_L.obj|357|107`, tri 160/162/161 | .006333 / .031246 / .052527 / .068329 / **.076987** | v899 -> `wing_L.obj|624|668`, tri 687/685/686 | .005147 / .005147 / .005147 / .005147 / .005146 |
| L `wing_L.obj|2442|955` | v990 -> `wing_L.obj|357|107`, tri 131/133/132 | .062360 / .039017 / .020270 / .007874 / .029045 | v980 -> `wing_L.obj|624|668`, tri 866/878/877 | .003513 / .003517 / .003522 / .003526 / .003531 |
| R `wing_R.obj|2334|882` | v910 -> `wing_R.obj|357|107`, tri 160/162/161 | .006333 / .031244 / .052524 / .068324 / **.076980** | v898 -> `wing_R.obj|624|668`, tri 687/685/686 | .005424 / .005423 / .005422 / .005421 / .005419 |
| R `wing_R.obj|2442|955` | v991 -> `wing_R.obj|357|107`, tri 131/133/132 | .062360 / .039015 / .020267 / .007869 / .029055 | v955 -> `wing_R.obj|624|668`, tri 671/669/670 | .004961 / .004962 / .004962 / .004962 / .004962 |

The changing values in the third column are **not attachment gaps**. They measure a rotating terminal against one frozen outer-skin triangle, so they necessarily change as the arm sweeps about its other end.

Containment against the actual fixed-wing component reverses the earlier interpretation. For every wing-side terminal and all five deployment samples, three independent ray-parity directions classify the point inside `357|107`. Vertical skin intersections also enclose it with finite positive lower/upper clearance. The closest upper-skin clearances over the five poses are 6.365/31.404/52.793/68.675/77.377 mm for the first left arm and 129.827/153.490/172.749/185.816/93.236 mm for the second; the right side mirrors these within measurement precision. The arm ends stay buried in the same wing envelope while rotating.

Accordingly, **no AS21 detachment or geometry defect is demonstrated**. The asset depicts a panel-pivoted support disappearing into the wing; it does not draw the internal guide, slot, or secondary pivot. That absent internal geometry prevents proof of a complete load path, but it is not evidence of a broken exterior joint.

### PA18: exposed rudder cables rotate and slide at the fuselage exit

The exposed mechanism is a mirrored chain under `rudder1_deg[10]`. The two most cable-like terminal components and their real endpoint partners are:

| Side / cable component | Fuselage-side endpoint | Gap at yaw `-1 / 0 / +1` | Rudder/link-side endpoint | Gap at yaw `-1 / 0 / +1` |
|---|---|---|---|---|
| component `fuselage.obj|56760|17823` | v17826 -> fixed fuselage `fuselage.obj|2322|770`, tri 925/924/922 | .004237 / .004943 / **.020817** | v17823 -> moving link `fuselage.obj|56760|17705`, tri 17798/17797/17795 | .000665 / .000665 / .000665 |
| mirrored component `fuselage.obj|56532|17575` | v17584 -> fixed fuselage `fuselage.obj|2322|770`, tri 926/921/918 | .009143 / .006028 / .008297 | v17580 -> moving link `fuselage.obj|56532|17587`, tri 17614/17613/17611 | .000665 / .000665 / .000665 |

The adjacent horn/link chain is independently identifiable: `56760|17705` joins `56760|17711` within 0.335 mm and `56532|17587` joins `56532|17659` within 0.334 mm at every sampled pose. Small terminal pieces `36840|12502`, `12538`, `12562`, and `12586` remain within 0.019-0.319 mm of their named moving partners. These stable local registrations show that the mechanism is not globally detached and prevent a different nearby surface from masking the cable-end result.

The nested animation explains why a frozen exterior-triangle distance changes. Component `56760|17823` has its own yaw rotation around the translated center `[0.055470001, 0.0065899999, -1.96436]`, calibrated approximately -30.300/0/+29.200 degrees, inside a parent rudder rotation of approximately +30/0/-30 degrees. Its mirror `56532|17575` uses center `[-0.056030001, 0.00655, -1.96436]` and approximately -29.200/0/+30.500 degrees. This counter-rotation is consistent with an exposed cable/link sliding at a fuselage exit, not a rigid two-pin rod whose endpoint must remain registered to one skin triangle.

The `17826` fuselage-side terminal moves only about 56 mm longitudinally across full yaw and remains inside the fixed fuselage component's actual bounds. Three-direction ray parity classifies it inside at yaw -1 and 0. At yaw +1 it crosses the outer-skin boundary near the modeled exit region; its nearest forward ray hit is only 3.489 mm away. The mirrored `17584` terminal remains inside at all three yaw samples, with its nearest lateral skin clearance decreasing to 3.015 mm. Thus the earlier 20.817 mm value is only distance to one frozen, no-longer-local triangle. It does not demonstrate an exposed gap between the cable and its fuselage exit.

Accordingly, **no PA18 geometry defect is demonstrated** by these samples. The exposed moving-side ends remain registered, while the fuselage-side ends remain buried or slide immediately through the exterior exit region. The OBJ does not model a deforming cable, pulley, grommet, or internal termination, so complete cable continuity remains unproved.

The raw component search also labels many small rudder/stabilizer details as generic `linkage-end` candidates. Their identities are not promoted here merely because they are close: several are panel hardware, hinge covers, or parts of the stabilizer assembly. No additional PA18 defect is claimed without semantic endpoint proof.

## Intentionally free tips and absent proof

- No AS21 support-arm terminal in the four components above is classified as an intentionally free tip. Their narrow geometry, paired mirrored layout, speedbrake ancestry, authored pivot centers, and wing-envelope containment identify them as supports.
- Static discharge wicks and fairing tails remain legitimate free tips, but none is used as a witness in this audit.
- The AS21 internal wing-side pivots are not drawn. Exterior skin containment alone would not establish a bearing, so no socket witness is proposed for an absent component.
- PA18 cable flexibility, pulleys, and internal fuselage terminations are not modeled. The report proves the location and motion of the exposed mesh endpoints; it does not prove a complete internal control-cable load path.
- Absence of such internal geometry is an evidence limitation. It is not promoted to a demonstrated defect.

## Proposed focused regressions

1. Freeze the four AS21 records above, including the exact source vertices, panel-side pivot partners, authored rotation centers, and fixed-wing envelope component. Require the wing-side terminal patch to remain inside that same envelope at `0/.25/.5/.75/1`; do not require it to remain near one exterior triangle.
2. Freeze both endpoints of PA18 components `56760|17823` and `56532|17575` at yaw `-1, 0, +1`, plus independent pitch, roll, trim, and deployment controls. Preserve the stable moving-side registration. At the fuselage side, use a bounded exit-region containment/intersection witness that permits the authored sliding motion; do not preserve the misleading 20.817 mm frozen-triangle value as a defect threshold.
3. Use `interfacePosition` only for endpoints that are actually pinned to a named triangle. Use fixed-component containment and terminal-region bounds for embedded or sliding endpoints. Never rediscover an arbitrary partner at each pose or accept an aircraft-wide maximum distance.
4. Add paired fault injections: translate only one AS21 support island outside the named wing envelope and only one PA18 cable island away from its bounded exit region while leaving the panel/rudder and the other linkage pieces unchanged. Each exact witness must fail independently.
5. Keep explicit metadata for `modeled joint`, `known separated endpoint`, `intentionally free tip`, and `hidden/unmodeled joint`. A hidden joint must not be converted into a permissive clearance tolerance.

## Scope conclusion

The prior ambiguity is narrowed to concrete components, animation centers, and endpoint roles. The earlier apparent AS21 support-arm and PA18 cable “gaps” were artifacts of measuring rotating or sliding terminals against frozen exterior triangles. They are retracted as defect claims. No actual geometry defect was demonstrated in these bounded samples. Complete internal mechanical continuity remains unprovable because the relevant guide/bearings, flexible cable path, and internal terminations are not drawn. This audit supplies regression-ready identities and appropriate containment/profile methods, but does not itself close mechanism acceptance.
