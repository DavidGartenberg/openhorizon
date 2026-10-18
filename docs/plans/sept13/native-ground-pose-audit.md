# Native aircraft contact and ground-pose audit

Date: 2026-09-18. Diagnosis only; no production/test changes or source-asset changes.

## Finding

The installed aircraft are correctly kept at native metre scale and registered to their nominal ACF CG. The visible wheels do not match the simulation's contact coordinates. The studio places the **physics** gear plane on the floor, so importing the native exterior exposes that mismatch. Separately, all native suspension datarefs currently read zero, whereas the physics contact springs penetrate the terrain to carry weight. Both are real causes; a bounding-box height offset does not repair either contract.

PA18 needs a different pitch as well as height: at the studio's 8.009° attitude its main tires penetrate 0.354 m and its tail tire floats 0.166 m. ASK 21 has a topology mismatch: three inline wheels versus the derived physics' lateral pair of mains and tailwheel. All-three-wheels-on-floor is not a valid glider constraint.

These are not evidence of a terrain LOD fault or bad native scale. Main flight rendering directly applies the simulation CG and attitude, so it inherits the registration mismatch; fixing the studio alone would not fix flight.

## Evidence method and coordinates

Read `reference-brief.md` and `server/cache/aircraft-audit/ground-audit.ts` first. Used the current `loadLocalAircraft` parser/animation tree with texture loading stubbed, gear fully down, engine stopped, controls neutral. Measurements traverse visible meshes and **only indexed vertices inside each mesh's drawRange**. Wheel identity comes from the enclosing `tire_rotation_angle_deg[index]` animation, not a whole shared vertex buffer, generic object bounds, or filename guess. Each model was loaded independently with `vite-node`; no browser, broad suite, Git operation, or installed-asset write was used.

Native/local render coordinates: `(right, up, aft)`. Body physics coordinates: `(forward, right, down)`. Thus a render point `(a,b,c)` corresponds to physics `(−c,a,−b)`. Positive render root X rotation is nose-up pitch. Native OBJ units are metres. ACF CG/attachment coordinates are feet, converted once by 0.3048.

The reported native rest pose minimizes the height difference between relevant tire support surfaces over pitch at 0.005° increments, with scale fixed at 1. Height then places their lowest support point on the floor. These are **zero-deflection geometry poses**, not certified loaded parked attitudes; loaded struts and A330 bogie articulation alter them. Largest residual among the ordinary three-wheel fits was under 1 mm. ASK 21 uses main plus tail only.

## Origin evidence

The installed ACF `acf/_cgY` and `acf/_cgZ` match `XP_PLACEMENT`. Listed render translations include attachment offset. No missing global CG translation was found.

| Model | ACF CG Y/Z, ft | Applied render group translation (right/up/aft), m |
|---|---:|---:|
| C172 | 0.300 / 2.900 | 0 / −0.09144 / −0.88392 |
| B738 | −2.000 / 59.500 | 0 / +0.60960 / −18.13560 |
| BE58 | −0.200 / 9.650 | 0 / +0.06096 / −2.94132 |
| PA18 | 0 / 0.650 | 0 / 0 / −0.19812 |
| AS21 | 0.500 / 10.750 | 0 / −0.15240 / −3.27660 |
| C750 | 1.000 / 35.750 | 0 / −0.30480 / −10.89660 |
| SR22 | 0 / 0.050 | 0 / −1.20000 / +0.33476 |
| A333 | −3.280 / 97.000 | 0 / +0.99974 / −29.56560 |

SR22 additionally has the already-accounted attachment `(0, −3.937007904, 1.148293972)` ft. Removing it would introduce an origin error.

## Per-model visible contact evidence

Depth is the lowest rendered tire point below the CG at zero body pitch; positive downward, metres. Stations are approximate forward positions of the lowest tire vertex (not exact hub centers; paired tires can have several equal support vertices). `N/M/T` means nose/main/tail. Physics values are uncompressed point-contact coordinates, with no extra tire radius to add.

| Model | Native depth N / M / T | Physics depth N / M / T | Native forward station N / M / T | Physics forward station N / M / T |
|---|---:|---:|---:|---:|
| C172 | 1.398 / 1.362 / — | 1.300 / 1.320 / — | +1.239 / −0.426 / — | +1.300 / −0.350 / — |
| B738 | 2.825 / 3.027 / — | 2.840 / 2.900 / — | +13.994 / −1.596 / — | +14.600 / −1.000 / — |
| BE58 | 1.458 / 1.476 / — | 1.078 / 1.100 / — | +2.425 / −0.554 / — | +2.454 / −0.409 / — |
| PA18 | — / 1.441 / 0.221 | — / 1.100 / 0.495 | — / +0.217 / −4.743 | — / +0.310 / −3.990 |
| AS21 | 0.638 / 0.743 / 0.209 | — / 1.100 / 0.495 | +2.386 / +0.156 / −4.313 | — / +0.376 / −4.843 |
| C750 | 1.637 / 2.008 / — | 1.577 / 1.610 / — | +8.965 / −0.082 / — | +8.379 / −0.617 / — |
| SR22 | 1.156 / 1.218 / — | 1.078 / 1.100 / — | +1.739 / −0.349 / — | +1.030 / −0.356 / — |
| A333 | 4.017 / 4.808 / — | 4.555 / 4.648 / — | +22.906 / −1.786 / — | +24.195 / −1.783 / — |

Lateral disagreement is also material: BE58 native tire support X≈±1.311 m versus physics ±0.922 m; SR22 ≈±1.308 m versus ±0.934 m. ASK 21 native wheel centers are approximately X=0, while physics mains are ±1.360 m. These are not correctable by a common Y translation.

A separate ACF sanity check used each `_gear/i/` pivot, leg length, extension angles, and tire radius. Approximate zero-deflection contact depth was calculated as `(cgY − gear_y + leg_len*cos(latE)*cos(lonE) + tire_radius)*0.3048`. This is a dimensional cross-check, not a substitute for full X-Plane suspension mechanics. Resulting N/M/T depths:

| Model | ACF reconstructed depth, m |
|---|---:|
| C172 | 1.364 / 1.350 / — |
| B738 | 2.807 / 3.009 / — |
| BE58 | 1.456 / 1.466 / — |
| PA18 | — / 1.443 / 0.218 |
| AS21 | 0.653 / 0.743 / 0.219 |
| C750 | 1.613 / 1.975 / — |
| SR22 | 1.180 / 1.251 / — |
| A333 | 4.011 / 4.795 / — |

Agreement to roughly 0.002–0.034 m between authored ACF and visible zero-deflection tires independently supports the native origin and metre scale. The much larger BE58/PA18/C750/AS21 discrepancies belong to the simulation contact approximation, not a missing feet-to-metres conversion.

## Studio poses versus native support poses

Signed clearance is relative to the studio floor: negative is penetration. This reproduces the earlier full-visible-geometry audit using positively identified tire draws.

| Model | Studio pitch / CG height | Native uncompressed support pitch / CG height | Studio tire clearance N / M / T, m |
|---|---:|---:|---:|
| C172 | −0.694° / 1.316 m | +1.245° / 1.371 m | −0.097 / −0.041 / — |
| B738 | −0.220° / 2.896 m | −0.740° / 3.006 m | +0.017 / −0.125 / — |
| BE58 | −0.440° / 1.097 m | −0.355° / 1.473 m | −0.380 / −0.375 / — |
| PA18 | +8.009° / 1.046 m | +13.940° / 1.359 m | — / −0.354 / +0.166 |
| AS21 | +6.613° / 1.049 m | +6.815° / 0.720 m | +0.690 / +0.329 / +0.345 |
| C750 | −0.205° / 1.607 m | −2.345° / 2.003 m | −0.062 / −0.400 / — |
| SR22 | −0.909° / 1.094 m | −1.700° / 1.207 m | −0.089 / −0.118 / — |
| A333 | −0.205° / 4.642 m | −1.835° / 4.749 m | +0.543 / −0.160 / — |

For ASK 21, the legitimate tail-down support pair is native index0 main plus index2 tail. Index1 nose is expected to remain clear in that pose. Trying to make all three collinear wheels touch gives an invalid compromise (best all-three spread ≈0.247 m).

For PA18, merely raising the model 0.354 m at the current 8.009° would leave the tailwheel about **0.521 m above the floor**. For C750, merely lifting the main tires leaves the nose ≈0.339 m high. These directly disprove the single-offset fix.

## Suspension and runtime mismatch

`localDatarefReader` handles deploy ratio but falls through to `return 0` for tire deflection, steering, wheel rotation, and A330 eagle-claw angle. `SurfaceState` carries no per-leg suspension compression. `computeGear` computes penetration per contact, then only retains a maximum in `GearOutput`; the individual compressions are not published to the native animation adapter.

Authored references:

- Most models: `sim/flightmodel2/gear/tire_vertical_deflection_mtr[i]`.
- C750: **`sim/flightmodel/parts/tire_vrt_def_veh[i]`**, including scissor/strut linkage as well as tire translation. Supporting only the newer dataref would miss this aircraft.
- PA18 uses deflection-driven rotating bungee gear assemblies and tail spring geometry; translating just the tires would detach them from the gear.
- A333 additionally needs `eagle_claw_angle_deg[1/2]` and individual bogie/tire constraints; the table's zero-ref support fit does not certify every axle is in loaded parked position.
- ASK 21 has an authored main-wheel deflection path; its nose and tail wheel rotation nodes do not have matching suspension paths in the imported object.

A bounded perturbation assigned **0.100 m to the existing deflection datarefs only**, keeping deploy=1 and all other values unchanged. This is a sensitivity test, not an assumed parked load:

| Model | Zero → 0.100 m input effect |
|---|---|
| BE58 | Main lowest depth 1.476→1.376 m; studio penetration remains ≈0.275 m. Suspension alone does not explain the deficit. |
| PA18 | Main depth 1.441→1.343 m; tail 0.221→0.120 m; support pitch remains ≈13.895°. At the old studio attitude mains still penetrate ≈0.258 m and tail floats ≈0.261 m. |
| C750 | Main depth 2.008→≈1.907 m; nose 1.637→1.537 m; old studio main penetration remains ≈0.299 m. |
| AS21 | Main depth 0.743→0.643 m; nose/tail unchanged. Main-tail support pitch changes 6.815→5.545°, height 0.720→0.625 m. |

Thus nonzero suspension is necessary, but assigning a plausible constant deflection does not reconcile incompatible physics anchors.

`Aircraft.spawnOnGround` supplies tricycles with a fixed +0.03 rad (+1.719°) and height `main.z−0.07`. Taildraggers use their physics main/tail plane minus 0.05 m. This is distinct from the studio's uncompressed contact-plane solve. Native tire clearance at that exact initial flight spawn (before dynamic settling):

| Model | Nose / main / tail clearance, m |
|---|---:|
| C172 | −0.110 / −0.124 / — |
| B738 | +0.426 / −0.243 / — |
| BE58 | −0.355 / −0.462 / — |
| PA18 | — / −0.404 / +0.116 |
| AS21 | +0.640 / +0.279 / +0.295 |
| C750 | +0.172 / −0.470 / — |
| SR22 | −0.073 / −0.198 / — |
| A333 | +1.250 / −0.342 / — |

These numbers are initial-pose calculations, **not a flight settling test**. Flight dynamics can change pitch and height after spawn; they cannot make mismatched native and physics wheel locations identical. `main.ts` applies `mesh.group.position.set(pos.y,−pos.z,−pos.x)` and flight heading/pitch/roll directly, with no native ground compensation.

## Recommended coherent correction

1. **Define explicit native gear metadata**, kept separate from control-surface calibration: ACF datum/CG/attachment, verified wheel groups/indices, support geometry, suspension dataref names, and topology. Maintain native scale=1 and the correct CG registration. Store support points or tire surfaces from actual indexed triangles and animation transforms; never recenter a shared buffer bounding box.
2. **Fix studio preview placement using that native support contract after async native upgrade.** Evaluate a declared suspension state, solve pitch/height from the intended support set (three-point tricycle/taildragger; main+tail for ASK 21), then update preview ground height/camera focus. Existing `select()` derives pose once from `AircraftParams` before native load completes. Procedural previews may retain their physics-derived placement. Treat the table's zero-deflection poses as reproducible diagnostics, not hardcoded final parked angles for every load.
3. **Publish per-leg physical compression and contact state**, with explicit mapping to X-Plane indices. Drive the authored whole gear linkage, including the C750 alias and PA18 bungee rotation. Terrain contact should be queried at the same physical wheel locations; distinguish actual force-bearing wheel contact from merely visible extended geometry.
4. **Resolve the flight contact geometry as an explicit accuracy correction, separately reviewed from cosmetic work.** The installed ACF and visible tires agree independently while generic derived gear coordinates differ in height, track, wheelbase, and sometimes topology. That is evidence for replacing the approximated gear-contact representation for these exact variants, not changing aerodynamics/mass or scaling art to make a screenshot fit. ASK 21 requires a suitable inline-gear/support model rather than pretending a lateral main pair exists. New contact coordinates must be referenced to the simulation's intended CG and checked with mass/loading, braking, takeoff rotation, suspension force distribution, and terrain. Do not silently copy the visual lowest-vertex table into force lever arms.
5. **Until that flight physics decision is made, keep the limitation explicit.** A studio fix can be completed independently. A permanent global visual CG offset would move cockpit/camera/airframe relative to the physical origin and still leave wheelbase/track errors. A whole-airframe rotation to match the wheel plane in flight would make pitch indications disagree with the real model. Neither is a complete grounding fix. Preserve the existing physics until a justified contact-model correction is authorized and validated.

Acceptance should inspect all tire contacts and strut continuity at rest, through load/compression changes, over uneven terrain, during takeoff rotation, and after gear retraction. A333 requires every bogie axle; PA18 needs the tail as well as mains; ASK 21 must use the correct support topology. The CG-attached airframe must retain the same dimensions and orientation contract in flight.

## Reproducible draw provenance

`TRIS start+count` identifies the actual indexed range measured under the specified tire-rotation animation. Left/right ordering follows X-Plane indices, not appearance.

| Model / OBJ | Tire index : TRIS range |
|---|---|
| C172 / fuselage_gear.obj | 0:16500+2244; 1:39753+2418; 2:28287+2418 |
| B738 / 738maingear.obj; 738nosegear.obj | 1:0+4896; 2:7944+4896; nose0:504+4608 |
| BE58 / B58_fuselage.obj | 0:70335+3456; 1:77871+4134; 2:85251+4134 |
| PA18 / fuselage.obj | main0:45384+4506; main1:49890+4506; tail2:54396+1728 |
| AS21 / fuse.obj | nose1:40185+4800; main0:44985+4800; tail2:49785+4800 |
| C750 / gear.obj | 0:16134+13824; 1:53997+15264; 2:88476+15264 |
| SR22 / SR22_exterior.obj | 0:3399+10308; 1:282213+10326; 2:292539+10308 |
| A333 / A330_main_gear.obj | index1:236814,526218,269634,627600 each +32820; index2:94284,392016,127104,493398 each +32820 |
| A333 / A330_nose_gear.obj | index0:0+21708 and 24510+21708 |

Local source root: `/Users/davidgartenberg/X-Plane 12/Aircraft/Laminar Research/`. ACFs inspected: `Cessna_172SP.acf`, `b738.acf`, `Baron_58.acf`, `PA-18-150.acf`, `ASK21.acf`, `Cessna_CitationX.acf`, `Cirrus SR22.acf`, `A330.acf`, each in its manifest aircraft directory.

Relevant code: `src/render/local-aircraft.ts` (CG transform, zero-default reader, async swap), `src/render/xplane-manifest.ts` (placement), `src/render/xplane-obj8.ts` (indexed drawRange and animation transforms), `src/sim/aircraft/derive.ts` (generic gear), `src/sim/aircraft.ts` (spawn), `src/sim/gear.ts` (spring penetration), `tests/browser/aircraft-studio.ts` (preview root pose), `src/main.ts` (flight root pose).
