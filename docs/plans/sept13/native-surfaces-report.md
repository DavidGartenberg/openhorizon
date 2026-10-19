# Stage8a native moving surfaces — 18 September 2026

Software implemented for the eight currently selectable exact native models. Root-owned GPU/studio inspection remains pending; this is not whole-goal completion. Stage6 physical hardware calibration and Stage7 terrain GPU checks are separate.

## Effective state and reset

`main.ts` now sends the post-AP/SAS authoritative `Aircraft.appliedControlSurfaces` pitch, roll and yaw, plus effective elevator and separate trim values. Rudder trim is already included in effective yaw and is not mixed twice. The original Baron rudder trim tab receives its separate normalized trim state.

The snapshot adds trim, untrimmed elevator command, trim authority, elevator-only angle and stabilizer angle. Aerodynamic calculations are unchanged. For native stabilizer aircraft the adapter uses the untrimmed command and separate trim authority; for tab aircraft it uses actual effective elevator deflection. This also handles the native PA18's stabilizer even though its generic nonjet aerodynamic anchor uses combined elevator trim. Ground respawn zeros the entire snapshot. Async native swaps preserve a copied latest state rather than retaining a caller's mutable object.

Nonfinite normalized/angle inputs become zero; normalized inputs clamp to their valid interval, angle inputs to native ACF limits. Unknown doors, failures and vibration remain neutral. Asset scale, original materials and authored animation chains remain intact; no procedural duplicate surfaces or mechanisms were added.

## Exact primary mapping

Standard wing prefix below is `sim/flightmodel2/wing/`. All directions were checked from actual indexed vertices transformed through the full authored animation hierarchy. Positive roll raises the right trailing edge and lowers the left; positive pitch/pull raises elevator trailing edges; positive yaw moves rudder trailing edges to model +X/right. Thus native elevator/aileron degrees are negative for trailing-edge-up, while native rudder degrees have the opposite sign to this simulator's aerodynamic rudder angle.

| Model | Aileron left/right refs | Aileron up/down ° | Elevator refs | Elevator up/down ° | Rudder refs; left/right ° |
|---|---|---:|---|---:|---|
| C172 | `aileron1_deg[2]`, `[3]` | 20 / 15 | `elevator1_deg[8]` | 20 / 15 | `rudder1_deg[10]`; 20 / 20 |
| B738 | `aileron1_deg[4]`, `[5]` | 20 / 16 | `elevator1_deg[8]`, `[9]` | 20 / 22 | `rudder1_deg[10]`; 29 / 29 |
| A333 | `laminar/A333/flight_controls/composite_innerL_ail`, `composite_outerL_ail`; corresponding `R` refs | 25 / 25 | `laminar/A333/flight_controls/composite_elevL`, `composite_elevR` | 30 / 15 | `rudder1_deg[10]`; 35 / 35 |
| SR22 | `aileron1_deg[4]`, `[5]` | 30 / 10 | `elevator1_deg[8]` | 25 / 20 | `rudder1_deg[10]`; 15 / 15 |
| BE58 | `aileron1_deg[2]`, `[3]` | 18 / 12 | `elevator1_deg[8]` | 25 / 20* | `rudder1_deg[10]`; 27 / 27 |
| PA18 | `aileron1_deg[0]`, `[1]` | 18 / 18 | `elevator1_deg[8]` | 34 / 29 | `rudder1_deg[10]`; 30 / 30 |
| AS21 | `aileron1_deg[0]`, `[1]` | 29 / 17 | `elevator1_deg[8]` | 30 / 15 | `rudder1_deg[10]`; 35 / 35 |
| C750 | `aileron1_deg[2]`, `[3]` | 25 / 25 | `elevator1_deg[8]`, `[9]` | 27 / 22 | `rudder1_deg[10]`; 30 / 30; `rudder2_deg[10]`; 18 / 18 |

Limits are read-verified against the installed ACF, not inferred from OBJ key magnitude. Some models use −1/+1 calibration keys and extrapolate correctly to physical degrees. *The Baron's original elevator OBJ explicitly plateaus at 15° down although its ACF commands 20° down; the authored plateau is preserved rather than modifying original geometry/animation. Physical sides are explicitly listed in calibration after indexed geometry inspection; index parity is not used.

## Deployment and trim mapping

All listed degree refs below use the standard wing prefix. Fractions sample the original chains at 0, .25, .5, .75 and 1. Slat refs are `sim/flightmodel2/controls/slatN_deploy_ratio` and receive the normalized flap deployment.

| Model | Authored flap refs / full input ° | Slats | Spoiler / speedbrake full input ° |
|---|---|---|---|
| C172 | `flap1_deg[0,1]` / 30 | none | none |
| B738 | `flap1_deg[0,1]`, `flap2_deg[1,2,3,4]` / 40 | 1, 2 | `speedbrake1_deg[0,1]` 52; `speedbrake2_deg[2,3]` 60; `spoiler1_deg[2,3]` 38; `spoiler2_deg[2,3]` 33 |
| A333 | `flap1_deg[0,1]`, `flap2_deg[2,3]` / 32 | 1, 2 | `speedbrake1_deg[0,1]`, `spoiler1_deg[2,3,4,5]`, `spoiler2_deg[2,3,4,5]` / 35 |
| SR22 | `flap1_deg[2,3]` / 30 | none | none authored |
| BE58 | `flap1_deg[0,1]` / 30 | none | none |
| PA18 | `flap1_deg[0,1]` / 50 | none | none |
| AS21 | none | none | `speedbrake1_deg[0,1]` / 95 |
| C750 | `flap1_deg[0,1,2,3]` / 35 | 1 | `speedbrake1_deg[2,3]` 40; `spoiler1_deg[2,3]`, `spoiler2_deg[2,3]` 35 |

`sim/flightmodel2/controls/elevator_trim` drives C172/BE58 tabs; `sim/cockpit2/controls/elevator_trim` also drives the C172's original trim wheel. The Baron's `sim/flightmodel2/controls/rudder_trim` is supported. Normalized tab inputs stay within −1..1.

`sim/flightmodel2/controls/stabilizer_deflection_degrees` receives separate trim authority: B738 up/down 8.5°/8.5°, A333 8°/8°, PA18 4°/2.5°, C750 12°/2°. Negative input raises trailing edges for all four types. The initial PA18 sign override was removed after signed aft-vertex tests demonstrated it reversed trim (see review fix below). Original zero-key rest transforms are preserved.

## Initial geometry and mechanism evidence (aggregate attachment gate superseded below)

The installed OBJ parser/build path is exercised without textures or browser dependencies. Tests enumerate each mesh's `geometry.index` only within its actual `drawRange`, then apply `matrixWorld`; they never use whole shared-buffer bounding boxes. Direction checks use the aft-most 12% of each surface's actual indexed vertices at ±.5 and ±1 control input. Trim animation additionally changes real indexed geometry. Original flap/slat/spoiler transforms change at every deployment sample.

Attachment checks measure nearest actual moving-to-fixed geometry contacts at each sample. The 737's secondary `flap2_deg[1]` is measured against its moving primary flap parent assembly as well as the fixed wing. This is an assembly contact regression, not a claim that every original rail/actuator joint has independently measured load-path continuity. The authored hierarchy and meshes are reused intact. Per-model regression thresholds bound the original exported gaps:

| Model | Moving primary/deployment refs | Largest sampled contact gap | Regression limit |
|---|---:|---:|---:|
| C172 | 6 | 13.9 mm | 25 mm |
| B738 | 21 | 27.4 mm | 40 mm |
| A333 | 23 | 21.8 mm | 35 mm |
| SR22 | 6 | 5.9 mm | 15 mm |
| BE58 | 6 | 19.3 mm | 30 mm |
| PA18 | 6 | 3.9 mm | 15 mm |
| AS21 | 6 | 36.0 mm | 50 mm |
| C750 | 17 | 68.6 mm | 85 mm |

All unrelated fixed mesh world matrices remain unchanged, with indexed fixed-vertex samples additionally checked. Main rendering assets already contain the tested moving surfaces and mechanisms; no additional exterior parts were necessary. Original installed files were read only.

## Studio / browser handoff

`tests/browser/aircraft-studio.html` retains model/camera/gear/engine/lighting controls and adds labelled pitch, roll, rudder, pitch trim, rudder trim, normalized flap and spoiler sliders. Presets: Neutral surfaces, Full deployment, Full pull/right, Full push/left. Native full-control endpoints use ACF limits, while main flight follows actual effective aerodynamic elevator state. Unsupported native flap/spoiler sliders are disabled. `#surface-state` is DOM-readable JSON with model/source, normalized/effective controls and all original authored surface dataref values. The native group's `userData.surfaceValues` supplies the same evidence.

Root owns intentional reload/visual acceptance; this agent did not operate a browser or trigger HMR. Check representative flight and studio views, particularly the 737/A330 extended mechanisms and PA18 stabilizer, before GPU acceptance.

## Verification and remaining scope

Initial new tests failed for absent elevator/rudder mapping and absent separated trim snapshot. The completed focused serial command is:

`npx vitest run tests/render/native-surfaces.test.ts tests/render/local-aircraft.test.ts tests/captain-systems.test.ts --maxWorkers=1`

33 tests passed, including eight actual installed OBJ geometry cases and ACF calibration verification, asynchronous swap preservation, Captain snapshot/reset regression and existing native lifecycle tests. `npx tsc --noEmit` passed. Discovery-only probe was removed from normal tests and retained under `/tmp`; final regressions contain assertions.

Stage8b still owns procedural factories, all-catalog geometry splitting, swept hinge frames and procedural actuator/Fowler attachment work. Traffic LOD models remain separate. Original asset quirks (including Baron down-elevator plateau) are preserved and disclosed. No Git, commit, publishing, licence or original-asset changes were made.

## Review fix — localized verification and PA18 trim correction

**Status: production sign defect fixed; localized attachment coverage strengthened; exhaustive native joint acceptance remains open for the unsupported interfaces listed below.** The previous per-dataref nearest-any-fixed assertion and its aggregate thresholds were removed from the test suite. They are not used to accept joints.

### Real PA18 defect found by the requested signed test

The new negative-trim test measured the PA18's actual aft-most stabilizer/elevator vertices moving **+18.6 mm upward** with negative trim. The earlier centroid-based `stabilizerSign: -1` assumption was wrong: forward-of-pivot geometry made its centroid misleading. Removing the override makes both trim endpoints move correctly. This is the only production mapping change in this review fix. No original OBJ, geometry, scale or material was modified.

Signed positive/negative checks now cover every authored stabilizer, C172/BE58 elevator trim tab and BE58 rudder trim tab. Positive pitch trim raises stabilizer trailing edges and lowers elevator-tab trailing edges. The original positive rudder-tab ref moves its trailing edge right; the effective rudder already includes the separate pilot rudder-trim mix. Required authored dataref presence is independently compared with `native-surface-datarefs.json`, so an omitted object/ref cannot silently disappear from the existing enumeration. Informational output requires `NATIVE_SURFACE_DIAGNOSTICS=1`.

### Focused local interface witnesses

`tests/fixtures/native-surface-interfaces.json` stores **352 localized drawn-interface witnesses and 10 embedded support-tip witnesses**, selected from the actual native exterior draws. Decorative fasteners and arbitrary disconnected triangle islands are not an exhaustive acceptance target. The broader discovery scripts/output were moved to `/tmp`, outside normal tests.

Each record freezes the source OBJ path, exact TRIS draw start, welded connected component's first vertex, source vertex index, partner component, and partner triangle indices. Components are derived only from each draw's actual index range, welding coincident positions at 0.01 mm. The test does not rediscover a convenient nearby partner after motion.

For each requested pose, the source attachment vertex is expressed in the identified partner triangle's local frame. Its three coordinates must remain within **2 mm of that interface's original authored pose profile**. This detects tangential slipping as well as a growing gap. The fixture records each interface's own original maximum surface clearance; these are not one aircraft-wide distance threshold. Original slots and sliding motion are retained in the stored profiles. Poses are neutral, deployment .25/.5/.75/1, and positive/negative pitch, roll, yaw and trim.

| Aircraft | Local interface witnesses | Embedded tips | Largest original clearance among selected drawn interfaces |
|---|---:|---:|---:|
| C172 | 22 | 0 | 36.310 mm |
| B738 | 110 | 2 | 34.126 mm |
| A333 | 102 | 8 | 36.102 mm |
| SR22 | 14 | 0 | 8.895 mm |
| BE58 | 18 | 0 | 35.020 mm |
| PA18 | 18 | 0 | 8.713 mm |
| AS21 | 16 | 0 | 21.438 mm |
| C750 | 52 | 0 | 24.777 mm |

Explicit two-ended mechanisms include the C172 trim pushrod (`wings.obj`, draw 24534, island 6759), both flap actuators (draws 25260/25986, islands 7048/7337), B738 inboard flap linkage islands 611/1403, and eight A333 slat-track islands. The fixture identifies each separate end and its partner rather than allowing the other end to satisfy the assertion.

The B738 linkages enter their primary flap skin. Eight A333 track ends enter designated fixed wing sections. For these original hidden sockets, the test intersects the **specific partner component's drawn upper/lower skin at the endpoint's exact x/z position** and requires the tip to stay inside both surfaces. It additionally preserves each tip's own upper/lower clearance profile within 2 mm. A broad aircraft bounding box or unrelated fixed component cannot satisfy this check. Opposite ends are separately checked at the actual panel-side interface.

The A333 embedded track sources are `A330_wings.obj` draw/island pairs `24693/8108`, `13248/3784`, `67302/19898`, `95424/27496`, `107925/32258`, `107925/33041`, `117075/35277`, and `117075/36060`. Exact fixed-wing partner components and endpoint indices are in the fixture. The B738 sources are `738wings.obj` `8370/611` and `10941/1403`; their opposite ends reference the moving flap panels, preserving the original nested mechanism.

### Fault injection

The regression clones the actual C172 left flap draw's position buffer and moves only the connected flap-panel island (`wings.obj` draw 24930, island 6902) upward by **0.5 m** at half deployment. Its local interface registration fails by over 0.1 m. The separately identified left flap actuator under the **same `flap1_deg[0]` dataref** remains within both endpoint tolerances. Other islands sharing the draw are left untouched. This demonstrates the previous aggregate-contact false positive is rejected by the new checks.

### What is still unverified

These focused witnesses establish the named interfaces, not every original visible or hidden load-path joint. Do not call the Important review finding fully closed from these results alone.

- Remaining jet track/actuator ends and all separate support interfaces need individual identification before blanket mechanism acceptance. In particular, not all B738/A333/C750 rail, carriage and actuator endpoints have both partners proved.
- The A333 audit found additional potential embedded ends, but the initially found contained vertices were not at the required terminal region. They were **not** promoted to socket acceptance and their large exterior-skin distances were **not** converted into permissive joint tolerances. Remaining `A330_wings.obj` draw/island candidates include `19407/6449`, `19407/6457`, `24693/8112`, `62016/18239`, `62016/18247`, `67302/19902`, `13248/3796`, `95424/27508`, `107925/32278`, `117075/35297`, and the separate `15366/4406` support.
- Full independent endpoint coverage for AS21 airbrake support arms and PA18 exposed cable/linkage ends also remains beyond the selected panel interfaces. Unmodeled internal bushings cannot be established from an exterior skin alone.
- Static discharge-wick free tips, fairing tails and intentional Fowler/slat slots are not attachment defects. Their existence must not be used to weaken tests of actual joints.

Root reports original all-eight browser inspection and corrected PA18 evidence separately. Root retains AS21 flight-capability integration, terrain/browser work and Stage8b. This review fix does not remove the original glider airbrakes or alter their mapping.

### Fresh verification

`npx vitest run tests/render/native-surfaces.test.ts tests/render/native-surface-interfaces.test.ts tests/render/local-aircraft.test.ts tests/captain-systems.test.ts --maxWorkers=1`

Output: **4 files passed; 42 tests passed** (12 native motion/ACF tests, 9 localized interface/mutation tests, 9 native lifecycle tests, 12 Captain tests). Duration 19.68 s. The final mutation uses the unchanged left actuator under the same dataref as the detached left panel.

`npx tsc --noEmit` — passed, exit 0.

Identification method detail: discovery split actual TRIS draws into welded components, retained each component's authored dataref ancestry, and proposed local component/triangle partners from the source endpoint's neighborhood. Linkage endpoint candidates used the low/high terminal 20% of the component's dominant geometric axis; panel candidates used the two span halves. Candidate separation was inspected over the sampled authored poses before freezing identities. This geometric discovery is **not** semantic proof that every proposed pair is a real aircraft joint. The committed fixture was narrowed to the selected close panel registrations, the explicitly named C172/B738 mechanisms and the eight A333 terminal socket witnesses. Socket selection additionally required the selected vertex to lie in the actual terminal region; merely finding some interior point elsewhere on a track was rejected. The remaining candidate IDs above are consequently a concrete verification backlog, not accepted geometry with enlarged bounds.
