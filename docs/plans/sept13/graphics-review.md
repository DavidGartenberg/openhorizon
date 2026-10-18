# Stage 1 aircraft graphics review — September 13, 2026

## Verdict

**Spec verdict: pass.** The frozen Stage 1 implementation meets the aircraft
graphics brief within its documented scope. Exact identity remains conservative
for eight mapped selections and all other selections retain the procedural model.
The async swap is atomic, preserves the stable player root plus cockpit and light
attachments, publishes the latest `SurfaceState`, and preserves both parts of the
prop API. Failure leaves the procedural exterior visible.

**Quality verdict: pass, subject to completion of the already-running serial test.**
The two findings from the first review are fixed with direct regressions. TypeScript
passed. The reported 59/60 focused result has one host-pressure timeout in the
all-123 procedural construction test rather than a functional assertion failure;
the parent owns the serial rerun and final verification record. Parent rendered QA
confirmed corrected C172/737 winding and atlas orientation, intact readable
liveries, and the newly included C172 cabin and 737 cockpit glazing.

## Resolved findings

### Public prop handle and studio engine focus — resolved

`LocalAircraftVisual` now supplies an attached native `propDisc`/fan mesh and
`upgradePlayerAircraft` assigns it to `ship.propDisc` at publication. It also
removes the stale procedural `userData.propDiscs` list. Engine OBJ groups receive
the existing `engineNacelle` focus name, so the studio Engine view resolves a live
imported assembly; propeller models resolve the animated prop node. The swap test
asserts that the new public handle belongs to the published local hierarchy.

### Strict geometry validation and fallback — resolved

`validateObj8` now rejects empty or malformed attribute tuples, nonfinite position,
normal and UV values, invalid/out-of-range indices, invalid draw ranges, parser
geometry warnings, and an empty selected LOD. `loadObj8` invokes it immediately
after parsing, before texture loading or GPU construction, and `buildObj8` enforces
the same invariant for direct callers. These failures propagate through the
existing all-or-nothing loader cleanup, so a malformed part cannot replace the
working procedural exterior. Tests cover each rejected stream class and an absent
selected LOD.

## Scope and quality evidence

- `player-exterior` is registered synchronously before the load begins. Main then
  attaches lights and cockpit to the stable root; publication removes only the
  original procedural exterior.
- Publication poses the complete imported model with accumulated controls before
  replacing the fallback. `surfaces`, reversers, prop/fan rotation and visibility
  continue through the existing `AircraftMesh` API.
- OBJ8 clockwise triangle indices are reversed only in the GPU index copy. Parser
  data and authored normals remain unchanged, and a front-side ray regression
  verifies the resulting Three.js face orientation.
- DDS V reflection is applied consistently to all DDS maps. Reflected normal maps
  compensate the derivative bitangent through `normalScale.y`; PNG behavior is
  unchanged. Packed and split normal/material/gloss channel tests remain present.
- Fully transparent atlas texels receive a small alpha cutoff while explicitly
  authored blend/no-blend behavior is retained. Glass/alpha parts remain
  transparent with depth writes disabled.
- The C172 manifest now includes authored cabin and seat geometry behind its
  windows, and the 737 includes authored cockpit glazing. These remain exterior
  children and therefore hide with the exterior in cockpit view.
- Loads retain the two-slot global bound and sequential per-model parts. Texture
  promises are shared per aircraft, texture disposal is deduplicated, partial and
  late loads are disposed, and eviction prevents subsequent parts after the
  current non-abortable image decode.
- No variant substitution, proprietary asset copying, numeric tenfold claim, or
  geometry stretching was introduced. The documented eight-of-123 exact coverage,
  simplified StandardMaterial mapping, generic cockpit separation, incomplete
  X-Plane system animation surface, and A330 nearest-LOD cost remain honest scope
  limitations rather than hidden correctness claims.

No additional blocking code findings remain in the reviewed Stage 1 diff.
