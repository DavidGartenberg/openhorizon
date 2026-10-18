# Aircraft surface and geometry upgrade — 2026-09-08

User request: dramatically improve simplistic airplane surfaces across the fleet.
Continue the authorized graphics work; preserve previous changes and flight behavior.

Chosen design: upgrade procedural models with physically based material detail and
selective geometry. A texture-only pass leaves box wings/intake caps; importing an
unverified asset library loses the established aircraft rigs. Shared material and
component builders let the existing fleet improve consistently.

## Global constraints
- No changes to physics, aircraft dimensions/contact points, gear or flap animation
  schedules, instrument data, or established American-style airliner livery.
- No per-rivet draw calls; surface detail must filter at distance. Bound added
  geometry, avoid external assets/dependencies. Keep MSAA and reversed depth.
- Cabin exterior detail must not obstruct the cockpit eyepoint. Transparent glass
  and propellers must not write opaque depth.
- Preserve all prior uncommitted rendering work. Leave edits locally reviewable.

## Tasks
1. Shared aircraft skin materials and livery maps: meter-scaled filtered seams,
   fasteners, fine paint variation, metal/rubber/fabric distinction. Upgrade
   existing airliner texture typography/windows/doors with aligned roughness and
   relief maps, using correct cylindrical UV and maintaining existing titles.
2. Shared detailed engine and wheel components; integrate in configurable airliner
   builder with smooth airfoil sections, better nacelles/intakes, fairings and
   glazing, preserving animations and type proportions.
3. Root integration: C172 exterior paint layout, cabin/door detail, wing/stabilizer
   surface construction and gear/prop details; dedicated737 shared components and
   appropriate fleet material integration. Inspect close exterior views.
4. Repeatable aircraft inspection route using actual builders/environment, usable
   angles and controls without touching the active flight. Browser compare C172,
   Cub,737 and representative fleet airliner, cockpit visibility and moving gear/
   flaps. Regression tests for geometry boundaries/visibility/animation attachments,
   build/fullsuite; independent review. Record measured limitations and results.


## Completed result

- Shared paint, metal, rubber and fabric PBR materials with filtered flush seams,
  fasteners, subtle normal/roughness variation, fabric rib tapes and shallow sag.
- C172 side paint atlas (2048×1024), wing atlas (2048×512), readable registration
  and titles, door seams/handles, window gaskets, fuel caps, cowling openings,
  connected lift struts and main legs, streamlined spats, profiled tires/hubs and
  a curved two-blade propeller. Fittings are merged by finish, not separate rivets.
- Cub: new open cabin, lofted yellow fabric body and lightning flash, continuous
  10.74 m elliptical-tip airfoil, curved empennage, cylinder cooling fins and
  connected wing/gear struts. Contact and prop stations retained.
- 737/configurable airliners: profiled wing/control-surface sections, shaped
  drooped radome with conforming glazing, real intake recess/rolled lip/instanced
  fan blades, layered nacelle/exhaust, profiled tires and rounded fairings.
  Tail flags follow the fin skin instead of projecting as colored blocks.
- Airliner color/roughness/bump maps align at actual barrel length and radius.
  Windows and doors have separate material response; titles read correctly from
  either side and occupy the forward barrel. Liveries remain American-style.
- Other player archetypes gain smoother cylinders, rounded tail edges, profiled
  wings and PBR skin; traffic keeps its existing inexpensive merged geometry.
- Orbit camera starts at a size appropriate to the aircraft and permits close
  inspection. Development-only `/tests/browser/aircraft-studio.html` compares four
  actual model builders under the same atmospheric/PBR lighting as flight. It
  caches four models and offers both sides, engine close-up, gear/flaps and sun.

## Verification

- `npm test -- --reporter=dot`: 84 files, 1,205 passed, 4 existing skips. Includes
  547 aircraft/POH validation checks. No changes to `src/sim`.
- `npm run build`: TypeScript and production build pass. Existing chunk warning
  remains; bundle about 904 kB minified / 264 kB gzip. No dependencies added.
- `git diff --check`: clean.
- Browser inspection: C172 front and close detail, correct side lettering, actual
  simulator cockpit clearance; Cub front/close fabric and cooling fins; 737 front
  and engine intake; A320 opposite side and flaps/gear. No browser shader errors.
- Independent review found fleet livery dimension mismatch and incorrect A320
  studio ground datum; both corrected. Jet nose winding was caught by a ray test
  and corrected. Rig tests cover wing bounds/normals, open intake, tire contacts,
  prop depth, sleeve travel and cockpit sightline. Player archetype bounding box
  matches the traffic model while its geometry count stays bounded.
- Warm C172/737/A320 inspection views showed 60 FPS at High (1.5× pixel ratio) in
  this browser viewport. C172 before was roughly 7,300 scene triangles / 38 draws;
  its detailed view is roughly 25,000 / 53. This is an inspection scene, not a
  fleet-wide frame-rate guarantee. Shader compilation temporarily lowers FPS.

## Scope and limitations

This is a substantial procedural aircraft upgrade. “10×” visual quality is a
subjective target, not a verified numerical result. These remain approximate
models: panel/rivet patterns are graphic construction cues, cockpit/nose/family
shapes are not CAD replicas, fan blades are static geometry, and glass lacks
ray-traced cabin refraction. Player archetypes outside the detailed C172/Cub/jet
builders still use generalized family shapes. Existing flap/gear behavior and
flight dynamics were preserved rather than recalibrated against the new meshes.
