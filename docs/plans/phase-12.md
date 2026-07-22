# Phase 12 plan — Every plane in the world (data layer)

Part of the approved Phases 11–15 mega-plan. Goal: all ~10k ICAO 8643
type designators present as data (Tier C traffic-visual), a family
archetype mesh system, and a 100+ type performance-validated flyable
roster (Tier B) through one documented derivation generator.

## Slices (one commit each)

- **12a. ICAO type database end-to-end.** `/api/aircraft-types.json`
  (community Doc-8643 mirror CSV, pinned URL + vendored seed fallback in
  `server/cache-seed/`, disk cache like airports; the duplicate
  `/api/frequencies.json` route branch is deleted while editing route()).
  `server/parse.mjs`: `buildAircraftTypes(csv)` → compact rows
  `{d, c (desc code L2J), w (WTC), n (name)}`. Client accessor
  `src/world/aircraft-types.ts` (module-load fetch + Map). TDD fixture
  tests: parse, dedupe, malformed rows, lookup fallback for unknown
  designators.
- **12b. Family archetype meshes.** `src/render/fleet-mesh.ts`: ~10
  parameterized primitive builders; descCode+WTC → (archetype, scale);
  Tier-A/B types override with real span/length; merged BufferGeometry
  1–2 draw calls each; rotorcraft silhouette is traffic-display only.
  TDD mapping table.
- **12c. Roster generator + 15 proving types.** `sim/aircraft/derive.ts`
  (cited estimation chains) + `sim/aircraft/roster.ts` (spec records) +
  `tests/validate/roster.test.ts` (per type: trim converges cruise +
  approach; stall ±3 kt; cruise ±5%; climb ±20% — labeled coarser than
  §5.6). Proving set spans every powerplant/gear/flap combination.
- **12d. Roster expansion to 100+.** Waves: ~40 curated (B1, 3-row),
  then 100+ by family inheritance (B2, 2-row sanity ±10%, documented).
  Data + tests only — no new engine code.

Honesty ladder recorded in PROGRESS at each slice (no aircraft claims
above its tier; the registry is a community mirror that may lag ICAO).
