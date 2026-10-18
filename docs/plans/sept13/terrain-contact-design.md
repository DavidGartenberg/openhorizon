# Terrain and runway contact contract

Design proposal, 2026-09-18. This document changes no production code. No tests, build, browser session, or Git commands were run for this design.

## Diagnosis and scope

The measurements in `terrain-gpu-qa.md` establish agreement between seven sampled visible terrain points and the CPU triangle sampler to within 0.002079 m. They do not establish agreement between terrain and the aircraft contact callback: `src/main.ts` applies `Airports.flattenElevation` after `TileManager.elevationAt`, even though `terrain-worker.ts` already flattened every source vertex. In the transition band, this pulls the already-shaped triangle toward the runway again. The measured shoulder discrepancy reaches approximately 0.309 m.

Remove this second shaping operation for usable READY terrain. Preserve an explicit missing-terrain fallback and account separately for the actual runway strip. Do not change worker shaping, ring coverage, LOD, or triangle interpolation in this fix.

Three small-looking solutions have different consequences:

1. **Recommended: compose the existing physical surfaces.** Use READY terrain unchanged outside strips; inside strips use the higher of the READY triangle and the strip's unbiased plane. Only missing terrain receives the existing analytic fallback. This removes double shaping and never puts contact below an occluding terrain surface. It honestly retains coarse-terrain burial and LOD arrival steps as limitations.
2. Always override the strip with its plane. This stabilizes runway contact but can place aircraft below a coarse READY triangle that visibly covers the runway. Reject without a corresponding measured visual change.
3. Clip or reshape terrain under strips and make the strip authoritative. This could provide runway availability regardless of terrain resolution, but requires a separate rendering/coverage change and edge acceptance. Do not smuggle it into the shoulder fix.

## Minimal production design

### Distinguish missing from sea level

Add `TileManager.sampleElevationAt(lat, lon): number | null` using the existing finest-to-coarsest finite READY triangle sampling loop. Return `null` only when no usable READY sample exists. Keep `elevationAt` as the compatibility wrapper `sampleElevationAt(...) ?? 0`, so unrelated callers retain their present behavior.

Do not use `height === 0`, truthiness, global `readyCount`, or a requested tile's existence as availability. A valid zero is terrain data. A loading/failed child with a usable READY parent has data. All non-finite candidates still fall through to coarser rings, then to `null`.

### Model the actual runway rectangle

Add a small shared runway-strip geometry descriptor used by both `Airports.buildAirport` and a new `Airports.runwayElevationAt(lat, lon): number | null`. It must describe the current rendered rectangle, not the terrain-flattening capsule:

- Length is `r.l * FT`, width is `max(r.w * FT, 8)`. The worker's minimum half-width of 12 m and its additional 40 m flat apron are not strip bounds.
- Heading is the existing `bearingDeg(endpoint1, endpoint2)`. Center is the existing endpoint midpoint in the airport group's local frame, with `111_319.5` north meters per degree and longitude scaled at `ap.la`.
- Query coordinates must follow actual group placement: subtract `frame.toLocal(ap.la, ap.lo)` from `frame.toLocal(queryLat, queryLon)` and then subtract the descriptor's center. Do not substitute a query-latitude projection. Airport groups translate on rebase but their local geometry is not rescaled; the query must match that behavior.
- For east/north displacement `(de, dn)` from the strip center, compute `along = de*sin(hdg) + dn*cos(hdg)` and `across = de*cos(hdg) - dn*sin(hdg)`. A hit requires `abs(along) <= length/2` and `abs(across) <= width/2`. Use only a machine-precision boundary tolerance, not a contact margin.
- The physical height is `e1M + (along/length + 0.5) * (e2M-e1M)`. The negative longitudinal end is e1; the positive end is e2. Endpoints supplied in the database and metadata length can disagree, so do not silently replace this with endpoint-segment projection.
- Return `null` immediately outside either end or either side. No clamped endpoint extension, rounded end cap, extrapolated slope, apron, or blend band belongs to this surface.
- If strips overlap, return the highest finite plane, matching the physical union of the rendered strips. Reject non-finite/degenerate descriptors rather than generating NaNs.

The descriptor extraction must preserve current strip geometry; compare the sampler against independently transformed actual mesh vertices/rays, not only against the same helper's formula. Preserve existing airport candidate lookup for this bounded fix and record its airport-reference-radius limitation; do not claim it proves worldwide airport coverage.

### Compose contact once

Replace the main aircraft ground callback's unconditional flattening with the following decision table. A small pure resolver can live in a focused world contact module if needed for direct regression testing; it must not import Three.js into `src/sim`.

| Usable READY terrain | Actual strip hit | Contact height |
| --- | --- | --- |
| Yes | No | Exact READY triangle sample |
| Yes | Yes | `max(terrainHeight, stripPlaneHeight)` |
| No | Yes | Strip plane height |
| No | No | Existing `flattenElevation(0, lat, lon)` fallback |

Only evaluate analytic flattening in the final row. Rename/document that API as unloaded-terrain fallback if its remaining call sites permit, so it cannot be mistaken for a required post-processing pass.

The existing ground spawn can continue calling `aircraft.groundElevAt` at its actual point 120 m beyond the selected threshold. This preserves sloped, elevated runway spawns with no terrain, including a runway at exactly zero meters. `?? thr.e * FT` alone cannot handle missing tiles because the callback already returns a number.

### Visible bias and coarse terrain

The strip mesh is drawn at physical plane +0.06 m to separate depth. Keep that rendering bias out of physical contact. If the strip is the visible top surface, compare its rendered sample after subtracting this known bias; when terrain lies between the unbiased plane and the biased strip, the physical union remains terrain and the remaining visual/contact gap is bounded by 0.06 m. Do not call that a new 6 cm physics error or add 6 cm to spawn height. Markings also have decorative offsets and are not contact surfaces.

A coarse READY triangle may miss every narrow-runway flattened vertex and sit above the strip. In that case it is genuinely visible terrain and contact follows it. Loading a fine tile may change the surface height; eviction may restore the coarse one. The proposed fix neither smooths that change nor promises an available runway plane throughout streaming. An absolute requirement for stable runway-plane contact during coarse loading cannot be satisfied by callback-only changes while preserving visual/physics agreement. It needs separate visual clipping/shaping, or a spawn readiness gate with its own loading behavior.

Missing-terrain analytic shoulders are explicitly temporary synthetic fallback, not a claim of visual agreement with an absent mesh. Once any usable READY terrain exists, the synthetic shoulder is retired. Diagnostics should identify `terrain`, `runway`, or `unloaded fallback`, plus sampled heights, so acceptance cannot mistake the fallback for measured terrain. A test/harness resolver result is sufficient; no new cockpit UI is required.

## Acceptance cases

1. **Availability:** empty/loading/failed tiles yield `null`; a valid READY zero yields `0`; invalid fine samples fall through to a valid parent; no valid parent yields `null`. Confirm compatibility `elevationAt` still returns zero when missing.
2. **Shoulder regression:** an already-shaped triangle within the analytic blend band is returned exactly, including the zero-height case. Use a fixture where applying `flattenForRunway` twice demonstrably changes the result; verify the production contact resolver does not invoke fallback for READY input.
3. **Sloped strip bounds:** test center, both ends, both side edges, corners, and points 0.1 m inside/outside every edge. Include nonzero heading, asymmetric endpoint heights, width below 24 m, and metadata length different from geographic endpoint distance. Validate against actual strip geometry, subtracting exactly 0.06 m from its rendered height.
4. **Spawn with no tiles:** test the actual selected runway's 120 m spawn from both ends on elevated sloped and zero-elevation runways. Verify the callback uses the strip plane at that position, not an endpoint height or a truthiness fallback.
5. **Coarse burial:** use a READY coarse triangle above a narrow runway and verify terrain wins; below the runway, verify its plane wins. Include terrain between plane and plane +0.06 m and explicitly account for the display bias. Verify crossing strips choose the highest plane.
6. **Lifecycle:** drive missing → coarse READY → fine READY → fine failure/removal → coarse restored using the existing terrain-visibility fixture. At each stage compare contact to the surface selected by the table, and confirm shoulders are never flattened again. Do not assert temporal continuity the meshes do not provide.
7. **Rebase:** repeat strip and terrain comparisons after moving the world anchor and after a queued tile completes across that rebase. Sample transformed strip positions to catch using airport latitude when the current group placement requires current-frame coordinates.
8. **Measured browser acceptance:** repeat the seven KHAF GPU probes, then add strip center, both ends, just beyond each end, both edges, and shoulder points. Record terrain-only depth separately from runway-strip depth. READY shoulders should track the existing terrain GPU/sample tolerance (observed maximum 2.079 mm in the baseline; this is not a global guarantee). On strips, use the surface/bias rules above. Explicitly exercise coarse-only and fine arrival/removal, and repeat a meaningful rebase. Use production materials and no diagnostic shader replacement.
9. **Integrated verification:** run focused contact/terrain/geo regressions, then required unit suite, validation, and build in the implementation task. Assess stationary spawn/gear settling and a low-speed crossing of the strip end/shoulder in the main simulator. Record remaining streaming steps or buried strips instead of claiming global terrain acceptance.

## Limits and decision

Proceed with the surface-composition fix if the goal is honest contact plus removal of measured double flattening. It is small and preserves the current visuals and worker output. If the required outcome is an always-exposed runway across all loading states, expand the scope explicitly to visual runway/terrain composition before implementation; do not ship a hidden analytic strip override as though it solves that problem.
