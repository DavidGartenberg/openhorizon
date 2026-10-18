# Stage 2 airport facilities report

Implementation complete; no commits. Existing uncommitted rendering and other
work preserved on dev-server-port-flexibility. Root owns independent review and
whole-project/browser integration verification.

## Files and behavior

- `src/world/airport-scenery.ts` (new): deterministic primary-runway selection,
  scale-aware facility site planning, merged building/vehicle geometry, mapped
  terminal facade enrichment, mapped apron placement, service animation and
  idempotent owned-resource disposal.
- `src/world/airport-detail.ts`: procedural taxiway pavement/signs remain here;
  old simple apron/buildings moved out into the independent facility builder.
  Unique number/sign materials now explicitly owned; cached text textures shared.
- `src/world/airports.ts`: exactly one primary runway regardless of equal-length
  ties; facilities built independently of paved-runway marking thresholds so short
  and soft runways receive an FBO/hangar and fleet. Facility rebuild callback
  responds to OSM components. Eviction disposes owned resources, marks the group
  dead, and removes osmIdentSegs. Shared PAPI material remains shared. Added a
  bounded/distance-gated service update and procedural taxi-light index tracking.
- `src/world/osm-layout.ts`: validates/caps external geometry before use; empty,
  malformed, remote, duplicate or late responses do not erase fallback or revive
  evicted groups. Preserves mapped terminal polygons and adds facade glazing,
  mullions and roof edges. OSM taxiway geometry replaces procedural taxiways;
  apron/terminal-only data retains nonoverlapping taxi fallback. Removes fallback
  that intersects mapped footprints. Missing buildings retain a separately planned
  facility, and safe mapped aprons receive the fleet without a pavement overlay.
  A separate, nonoverlapping pad remains under missing fallback buildings.
  Removed procedural taxiways also lose their obsolete blue light points.
- `src/main.ts`: one `airports.updateServices(loop.simTime, camera.x, camera.z)`
  call beside existing airport-light updates. Other main.ts changes predate this
  stage and belong to root/prior work.
- `tests/airport-scenery.test.ts`, `tests/osm-airport-lifecycle.test.ts` (new).
- `tests/browser/airport-studio.html` and `.ts` (new): production scene/sky and
  facilities, strip/GA/commercial/mapped examples, approach/apron/vehicle views,
  pause control, live draw/triangle counts. Query `?size=commercial`, `?size=ga`,
  or `?size=mapped`; default strip.

## Design and safety decisions

Commercial facilities require a medium/large airport AND a >=2130m hard runway;
short/soft fields stay modest even when their airport classification is large.
Short strips get one hangar/FBO and 2 vehicles; GA gets two hangars/FBO and 4;
commercial gets main terminal, concourse, four jet bridges, glazed tower cab and
8 vehicles. Building batches include glazing, mullions, parapets, canopy/pillars,
roof HVAC and hangar sliding-door panels/pitched roof. Canopies are omitted at
hangar doors so aircraft wings have a clear approach.

Fleet shapes distinguish fuel tankers (cylindrical tank), baggage tugs with two
carts, glazed buses, and orange operations vehicles. Each vehicle uses merged
material batches; windows are not individual draw calls. Bounded rectangle loops
stay inside the apron and away from building fronts. Traffic uses absolute
simulation time (pause-safe), inherits airport parent rebases and elevation,
and updates only for visible airport groups within 12km of the camera. There is
no global vehicle registry to leak after eviction.

The complete proposed facility rectangle is checked conservatively against ALL
airport runway strips (width plus 24m clearance) and mapped taxiway capsules and
footprint interiors. The deterministic search tries at most 70 sites on both
sides of the primary runway, out to 1800m extra lateral distance. If none is safe,
no unsafe fallback is placed. Mapped apron placement uses 25 candidate centers
per polygon and requires a padded site wholly inside the polygon, rejects
intersecting concave boundary edges and all runway/taxiway/building conflicts.
Mapped fleet placement removes the fallback fleet, avoiding duplicate fleets.
Real terminal footprints suppress procedural buildings while preserving vehicles.

OSM normalization caps feature and point counts, drops malformed features whole
(never joins broken polylines), validates nonzero polygon area, and rejects
coordinates farther than 20km from the airport reference. Facade detail has a
360-part budget per polygon. Material/texture ownership is explicit: module
finishes, shared PAPI, cached text textures survive eviction; unique geometry,
instance data, signs, sign textures and light materials dispose exactly once.
The dead-group check occurs after the fetch/JSON await and before any registry or
geometry mutation. ATC's osmIdentSegs remains populated for current live groups.

## Tests and evidence

TDD red evidence:
- Initial planner suite failed because the new module did not yet exist.
- Lifecycle suite then failed for terminal-only fallback deletion, malformed/null
  layouts and late responses; each now passes.
- Browser-discovered hangar canopy issue received a raycast test: before the fix
  its intersection height was 3.3126m in the hangar door approach; after omission
  of the canopy/pillars it sees only the apron (<0.5m).
- Apron-only OSM regression failed because the entire taxi fallback disappeared;
  component/footprint-aware retention now passes.

Latest verification (2026-09-13):

```
npx vitest run tests/airport-scenery.test.ts tests/osm-airport-lifecycle.test.ts tests/papi.test.ts --maxWorkers=1 --fileParallelism=false
```

PASS: 3 files, 20/20 tests. Includes short/soft coverage, scale, equal-length
primary ties, crossing-runway/taxiway exclusion, deterministic plans and fleet
counts, safe/narrow/blocked mapped apron placement, hangar clearance, bounded
commercial mesh count, shared material lifetime, sim-time pause/motion,
idempotent geometry disposal, short-airport integration, registry eviction,
partial OSM components, malformed responses and late-fetch/new-registry safety.

```
npx tsc --noEmit
```

PASS: exit 0 after final implementation. No full build/full suite claimed here;
root is handling those after all requested stages.

Root browser inspection (root's reported evidence): commercial apron/vehicles
and short strip show recognizable 8/2 vehicles, terminal glazing/tower and
appropriate scale. Measured studio scene: strip 19 draw calls / 3,414 triangles;
commercial 49 draws / 12,822 triangles (before hangar-canopy removal). Mapped
example preserved the L footprint with window bands and 8 vehicles. Root found
the hangar-canopy obstruction; fixed and regression-tested as above. These are
representative scene measurements, not claimed frame-rate or numeric multiplier
improvements. Child did not launch/control browser tools.

## Remaining limits

- Layouts are visibly plausible procedural facilities, not exact real diagrams.
  Conservative obstacle rejection can place fallback away from the existing
  taxiway, and pathological/densely occupied fields can exhaust safe candidates.
  A field with no valid runway has no inferred facility anchor.
- Off-runway rough terrain remains an inherited limitation: fallback foundations
  and vehicles use runway elevation/grade; mapped pavement and vehicles use the
  mapped airport elevation. There is no blind sampling of the terrain API's
  unavailable-tile zero value. Hilly distant aprons can still float/sink relative
  to terrain; root explicitly retained this policy for full-project QA.
- Vehicles follow simple low-speed service loops with instantaneous corner yaw;
  they are visual traffic, not independently simulated collision/dispatch agents.
- Mapped terminal heights and glazing detail are estimates. Mapped terminals get
  facade/roof-edge detail; procedural terminals supply the richer entrance/HVAC/
  jet-bridge/tower arrangement. No claim of real gate/bridge accuracy.
- Full real-airport integration flight and final independent review remain root
  verification tasks. Host contention caused multi-minute tool startup delays
  during initial runs; completed serial checks above all passed.


## Review follow-up and integration evidence

Root reported independent spec/quality review PASS. A proposed apron-only
"duplicate pavement" finding was retracted after examining the placement policy.
No production fix was needed: the fallback planner includes mapped apron
footprints as exclusion obstacles, and the missing FBO/hangars need their separate
pad. "No duplicate pavement" means no procedural overlay on the mapped apron;
it does not mean deleting a disjoint pad that supports missing buildings.

Added an integration regression through the real `Airports.updateVisuals` →
async OSM enhancement → actual `rebuildFacilities` callback with a usable mapped
apron. It verifies missing FBO/hangar retention, exactly one fleet, that fleet on
the mapped apron, no generated pavement mesh under that mapped fleet, a retained
fallback building pad, and disjoint mapped/fallback bounds. All assertions passed
without any production edit.

Latest follow-up command:

```
npx vitest run tests/airport-scenery.test.ts tests/osm-airport-lifecycle.test.ts tests/papi.test.ts --maxWorkers=1 --fileParallelism=false
npx tsc --noEmit
```

Focused suite: PASS, 3 files / 21 tests. TypeScript: PASS, exit 0.

Root's read-only audit of the installed global airport catalog found all 11,408
valid/runway airports received plans: 3,679 strip, 5,158 GA, 2,571 commercial, zero
missing. This is catalog coverage evidence, not proof of exact real-world layout
or terrain fit. Existing rough-terrain limits still apply.
