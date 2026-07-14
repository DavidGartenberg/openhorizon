# Phase 2 plan — The US

Goal (§24): terrain streaming + floating origin + all US airports with
runways/lights/windsocks + ground physics on real terrain + airport search
spawn. Acceptance: KHAF→KSFO at dusk, land; no seams/pops/jitter; AGL correct
over the coast range.

## Architecture

- **World frame**: sim keeps NED meters relative to a geodetic anchor
  (lat/lon). Rebase anchor to the aircraft when >10 km out (all tile meshes
  recompute ENU from their lat/lon; aircraft offset shifts) — f32 render
  coords stay small. Earth curvature via d²/2R drop in the terrain vertex
  shader (ellipsoid-placement approximation, noted as deviation).
- **Terrain**: AWS terrarium PNG tiles through our proxy (disk-cached).
  Ring LOD around the aircraft (z13 near → z7 far, ~150 km horizon), decode
  + mesh (positions/normals/vertex-color by elevation/slope) in a Web
  Worker, skirts to hide seams, LRU cache. Heights clamped ≥0 (ocean plane
  is the sea). Nearby-tile heightfields kept for **elevation queries**
  (bilinear) powering per-wheel gear contact, AGL, and later TAWS.
- **Airports**: OurAirports CSVs fetched+cached+parsed by the server into a
  compact US JSON (icao/name/lat/lon/elev + runway end coords/size/surface/
  lighted). Client: spatial grid; nearest airports get runway strips
  (markings, edge lights at dusk, functional PAPI on the nearest runway,
  windsock reading sim wind). **Terrain flattening** under runways applied
  both to physics samples and to tile meshes (runway list shipped to the
  worker per tile).
- **Server**: handlers shared between Express and a Vite dev-middleware
  plugin, so the preview runs one process.
- **Spawn/search**: overlay input, ICAO or name substring → spawn on longest
  runway or 3 nm final. Default spawn: KHAF runway 30.

## Cuts recorded as deviations (in-phase, honest)

- Procedural airport buildings/aprons/terminals → deferred (Phase 8 polish).
- Land-cover (NLCD) texturing → Phase 5; Phase 2 uses elevation/slope ramp.
- Full quadtree geomorph → distance-ring LOD with skirts (revisit if pops).

## Tests

geo roundtrips (tile↔latlon, ENU, curvature), terrarium decode, bilinear
sampling, runway flattening blend, CSV parse fixtures, rebase invariance.
