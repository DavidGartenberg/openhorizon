# Stage 2 airport review

## Findings

No actionable findings.

The initial review concern about apron-only OSM was unsupported. In
`src/world/airports.ts:470-484`, every mapped apron is converted with
`footprintObstacle` and passed to `planAirportFacilities`. That conservative
capsule contains the apron's bounding box plus clearance, and the planner rejects
any fallback compound whose complete padded rectangle intersects it. The retained
procedural pavement is therefore a separate pad required by the missing-terminal
fallback (FBO/hangar), while the sole service fleet is moved onto the mapped apron.
The mapped fleet builder disables its own pavement, so it does not duplicate the
mapped apron mesh. Removing the fallback pad would instead leave the fallback
buildings unsupported off-apron.

## Spec verdict

Pass. The reviewed Stage 2 requirements are represented coherently: deterministic single
primary-runway selection; modest short/soft-field facilities; scale-gated
commercial facilities; bounded deterministic fleets; whole-site runway/taxiway
exclusion; terminal-only and taxiway-only OSM fallback behavior; mapped terminal
facades; visibility/distance-gated simulation-time motion; elevation/grade
placement; parent-relative origin rebasing; eviction registry cleanup; and a
late-response dead-group guard.

The documented terrain limitation is appropriately scoped and does not overclaim
universal layout or elevation accuracy. The reported focused verification remains
20/20 tests with TypeScript exit 0; per review instructions, it was not rerun.

## Quality verdict

Pass. Resource ownership is
explicit: shared module materials and cached textures survive airport eviction,
per-airport geometry and owned sign materials/textures are released, and disposal
is idempotent. OSM normalization bounds features and coordinates before geometry
allocation. The service animation has bounded work and no global vehicle registry.
The main integration is limited to the single service update adjacent to airport
light updates, as required.
