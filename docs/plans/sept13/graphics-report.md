# Stage 1 aircraft graphics report — September 13, 2026

Implemented the exact local-aircraft path and fleet-wide finish changes. Main and
studio keep a synchronous procedural aircraft and a stable root. Only a complete
local exterior replaces its children; attached cockpit and aircraft lights remain
on that same root. A stable exterior visibility container is registered before
asynchronous loading, so switching to cockpit view hides the imported exterior
without waiting for another visibility scan. The existing surface API is forwarded
with the latest state at publication; `updateProp` supports the local prop/fan
animator. No proprietary assets were copied into the project.

## Coverage and measured evidence

Exact matches enabled for eight of 123 selectable types. The remaining 115 retain
procedural aircraft with the upgraded shared finishes. The existing MD82 asset is
not used for the selectable MD88; J3 CUB is not mapped to PA18, nor A332 to A333.
This does not establish or claim a numeric tenfold appearance improvement.

The installed-asset test reads real OBJ files, verifies local texture-file
existence (image decode is stubbed in Node), builds the nearest LOD, checks finite
native-scale bounds and control updates, and disposes each aircraft. Numbers are
submitted nearest-LOD triangle counts, before visibility hides individual draws:

| Selection | Exact local model | OBJ parts | Triangles | Texture cache entries |
|---|---|---:|---:|---:|
| 172 | Cessna 172 SP + authored cabin/seats | 9 | 110,415 | 11 |
| 737 | Boeing 737-800 + authored cockpit glazing | 9 | 126,329 | 16 |
| SR22 | Cirrus SR22 | 2 | 130,746 | 5 |
| PA18 | Piper PA-18-150 | 4 | 41,167 | 7 |
| BE58 | Beechcraft Baron 58 | 5 | 59,481 | 10 |
| AS21 | Schleicher ASK 21 | 5 | 22,967 | 4 |
| C750 | Cessna Citation X | 6 | 94,942 | 9 |
| A333 | Airbus A330-300 | 10 | 602,166 | 33 |

Cessna measured bounds: 10.983 m span, 8.269 m length. 737: 36.268 m span,
39.980 m length including authored extremities. Geometry is neither stretched nor
normalized to fit catalog dimensions. Installed textures include 4096×4096 DXT1
DDS albedo atlases; the C172 fuselage DDS was decoded for visual inspection in
`/tmp/c172-atlas.png`, outside the repository.

## Placement and animation corrections

`xplane-manifest.ts` now records factual ACF `_cgY` / `_cgZ` values and the SR22
attachment translation. All selected exterior attachment rotations were checked
and are zero. OBJ vertices use metres; ACF placement uses feet and is converted by
0.3048. SR22 attachment is [0, -3.937007904, 1.148293972] feet before subtracting CG.
ACF control travels are recorded separately: animation key limits are calibration
points and cannot be treated as physical deflection limits. This matters for the
737's identity degree keys (0→0°, 1→1°).

Importer fixes found by regressions/real assets:

- OBJ8 triangle fronts are clockwise, whereas Three uses counterclockwise.
  Build-time index winding is now reversed while preserving source normals and
  parser index data. Parent QA confirmed this corrects the apparently mirrored
  livery/inside-out surface: the previous render showed the far shell through
  culled near-side faces. A front-side ray-intersection regression covers it.
- Invalid vertex/normal/UV tuples, nonfinite attributes, invalid/out-of-bounds
  indices, malformed geometry and empty retained LODs are rejected before GPU
  construction or texture loading.

- Abbreviated constant ANIM_trans and ANIM_rotate forms used by Blender exports
  now retain their attachment pivots, instead of silently dropping them.
- Animation keyframes extrapolate outside their calibration interval, as specified
  by OBJ8; the earlier clamp behavior was incorrect. Keyframe loops now wrap.
- Datarefs cover actual authored flap, slat, aileron, spoiler, gear, reverser,
  propeller and engine rotation inputs. Doors, failure states and vibrations stay
  neutral. A330 composite ailerons are mapped from roll.
- Authored prop-disc alpha receives a separate transparent material without
  making the solid SR22 airframe transparent. Glass/alpha exterior parts preserve
  alpha and disable depth writing. Fully transparent texels are cut out of
  otherwise opaque body materials, preserving window/decal holes.

The C750 engine OBJ contains two ANIM_hide failure directives outside an ANIM
block. These source defects remain warnings and are ignored; the asset audit
rejects malformed transforms/unbalanced trees, but does not fail on those known
neutral failure-hide warnings.

## Materials and texture orientation

Packed X-Plane normal maps use RG for tangent normal XY, reconstructed normal Z,
alpha for gloss, and optional blue for base reflectance. The shader now decodes
those channels; the older importer incorrectly used reflectance as normal Z.
XP12 split TEXTURE_MAP normal / material_gloss / gloss textures are parsed and
loaded separately; material_gloss uses red reflectance and green gloss. Material
inputs remain linear; albedo/emission are sRGB. GLOBAL_specular scales gloss.
F0 is converted to Three's metallic fraction relative to a .04 dielectric base;
this is a practical StandardMaterial approximation, not X-Plane's full BSDF.

Parent visual QA found scrambled C172/737 atlas islands. The installed DDS images
are top-down, contradicting the old loader's pre-flipped assumption. DDS now
reflects V in its texture matrix; PNG retains the normal upload flip. A regression
covers this orientation rule. Parent confirmed corrected C172/737 intact exteriors and readable liveries after
both orientation and winding corrections. A CPU texture projection from the
actual C172 OBJ/atlas supplied an independent UV reference; the lower cowling
ovals and wing-root spar strips are authored features. Reflected DDS normal maps
also compensate the derivative-derived bitangent via normalScale.y = -1, so they
remain consistent with equivalent PNG normals.

All procedural paint/metal users also receive restrained smooth variation. Metal
has its own program and directional, derivative-filtered microrelief and
roughness for a brushed finish. Fabric rib tapes and existing caller overrides
are retained. No geometry or simulation dimensions change through these finishes.

## Lifecycle

Each local aircraft has one texture cache shared across its OBJ parts. Geometry,
materials and textures have explicit disposal; each texture is released once even
when multiple materials reference it. A failed part disposes completed parts and
their textures. Late completion after eviction disposes without publication.
The public propDisc handle is updated to an attached native prop/fan mesh, and
native engine groups receive engineNacelle names so studio Engine view focuses
the live imported assembly. Temporary UV/albedo diagnostic controls were removed
once the winding defect was established, preventing diagnostic cache leakage.
Eviction aborts further parts, and the global loader runs at most two aircraft at
a time, including requests whose current Three image decode cannot be aborted.
Studio retains only two models. The fallback remains visible on unavailable route,
missing OBJ, invalid geometry, or missing required albedo.

## Verification

Red/green regressions observed for packed material channels, split XP12 maps,
keyframe looping, abbreviated static transforms, extrapolation, prop alpha, DDS
orientation, exact identity, atomic publication, fallback, cancellation and load
concurrency. Additional ownership test verifies five parts share two texture
objects and dispose each once.

Latest focused command:

`node node_modules/vitest/vitest.mjs run --maxWorkers=1 --fileParallelism=false tests/xplane-obj8.test.ts tests/render/local-aircraft.test.ts tests/render/local-aircraft-assets.test.ts tests/aircraft-materials.test.ts tests/render/player-aircraft.test.ts tests/render/aircraft-finish.test.ts`

Includes all 123 procedural constructions and all eight installed native models.
Final serial run: **6 files passed, 60 tests passed**, 77.95 seconds. This includes
all 123 procedural aircraft and all eight installed exact models. Fresh
`node node_modules/typescript/bin/tsc --noEmit` exited 0. An earlier parallel run
passed 59/60 but timed out constructing the unchanged full procedural fleet and
reported worker RPC timeouts under host load; serial verification resolved the
contention without increasing test timeouts or weakening assertions. Root performs representative browser/cockpit/airport integration QA.

## Remaining approximations

Only eight selectable types have exact exterior assets in this manifest. Imported
exteriors use the installed default livery, not a livery chooser. The C172 includes authored cabin wall and seat geometry; the 737 includes its
authored cockpit glazing that was absent from the earlier manifest. Other native
exterior geometry and generic simulator cockpit eyepoints are separate systems; imported
exteriors are hidden in cockpit view to preserve unobstructed controls. Pitch/yaw,
wheel rotation/strut compression, custom hydraulic geometry, damage, rain and
load-dependent wing flex are not synthesized. Control travel is model-authored,
but the shared SurfaceState does not carry every X-Plane control/system input.
The A330 has over 600k nearest-LOD triangles; the importer presently uses nearest
LOD for the player, so performance remains hardware-dependent. Full XP12
material modes, per-draw lighting attributes, weather decals and renderer parity
are outside this adapter. GPU appearance must be judged in the browser, not from
headless shader-source tests.

Sources checked:
[OBJ8 specification](https://developer.x-plane.com/article/obj8-file-format-specification/),
[X-Plane material model](https://developer.x-plane.com/article/x-plane-11-material-model/),
and the installed Laminar ACF/OBJ files under the existing read-only route.

Parent browser QA confirmed the corrected C172 and 737 exteriors, readable livery,
proper 737 nacelles and twin nose wheels; the 737 view reported 60 fps before the
small glazing addition. Final cabin/glazing additions and the other representative
models remain part of the parent's browser acceptance, rather than a child claim.
