# Phase 13 plan — Graphics (approved mega-plan, phase 3 of 5)

Every slice ends with the same measured gate: `__ohPerf` (frame-time ring
+ draw calls) at a fixed heavy scene, before/after recorded in PROGRESS;
degrade or abort if p95 approaches 16.7 ms or calls approach 600 (§23).

## Slices (one commit each)

- **13a. Sun shadows + `__ohPerf`.** renderer.shadowMap (PCFSoft 2048);
  sun repositioned near the aircraft each frame (direction unchanged —
  directional lights only use direction) with a tight ±120 m ortho
  frustum, texel-snapped against shimmer; `shadow-catcher.ts`
  (ShadowMaterial plane pinned to terrain height under the aircraft);
  runways receiveShadow. Terrain's custom shader does NOT receive
  shadows this slice (catcher approximates — recorded deviation).
- **13b. Satellite imagery terrain.** `/proxy/imagery` → USGS National
  Map (public domain, US-only), disk-cached; worker emits UVs; z13/z11
  rings textured with vertex-color fallback everywhere else and on any
  miss. `IMAGERY ON|OFF`.
- **13c. Night.** Urban-mask city glow (procedural, recorded), runway
  edge/threshold/beacon lighting as additive sprites, aircraft
  nav/beacon/strobe lights (timing pure-tested), landing-light spot.
- **13d. PAPI.** Pure `world/papi.ts` (4 units 2.5/2.83/3.17/3.5°,
  TDD exact transitions); placement heuristic recorded; acceptance =
  PAPI agrees with the KSFO 28R glideslope needle.
- **13e. Clouds + ocean.** Silver-lining phase term, base darkening,
  dusk tint; METAR-wind ocean state + whitecaps. Perf-neutral target.
- **13f. Optional bloom** — only if ≥3 ms headroom; written abandon
  criterion otherwise.
