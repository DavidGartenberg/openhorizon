# Stage 7a — READY terrain visibility

Status: bounded implementation complete; focused tests pass. Real GPU/visual acceptance remains pending with root. The first automatic inspection harness stalled its browser tab before completed GPU measurements were obtained; it has been replaced with explicit, incremental measurement and resource disposal.

## Reproduction and design

The recorded KHAF reproduction had raw z7 geometry at 60.35m while z13 and physics were 11.51m. Ring render order and depth biases could not resolve a higher coarse triangle. Existing desired-ring annulus omission also removed fallback before fine tiles were available. Separate frame scaling and bilinear sampling mismatches were reproduced with synthetic geometry before repair.

Every coarse tile now owns a byte occupancy texture with one cell for each exact z13 descendant tile. Sizes are 64×64 (z7), 16×16 (z9), 4×4 (z11), and 1×1 (z13). A READY descendant fills exactly its child cells; absent, loading, and failed descendants never fill them. Nonuniform geographic latitude row boundaries are computed from slippy-tile boundaries and stored as 65 float uniforms. The fragment shader uses at most six binary comparisons and one nearest texture lookup, with no per-fragment scan of tile rectangles and no kilometer-scale raster-mask rounding. CPU visibility uses the same row boundaries and half-open cell convention.

Requested coarse tiles remain loaded under desired fine coverage. READY insertion updates only the tile and its loaded ancestors; eviction updates retained coverage once per batch; rebasing cannot invalidate it because it is tile-relative. Render-only coarse depth biases are zero: visibility ownership replaces the original attempt to bury overlaps.

Rebase normal correction compensates for nonuniform horizontal scale before transforming normals. Tile dimensions and runway flatten coordinates use the frame's horizontal scale at creation. Placement rescales the stored geometry to the current frame, including worker replies arriving after a rebase. Request IDs reject stale responses for evicted/re-requested keys. Tile-specific base materials own coverage uniforms/textures, while lighting/fog/sky uniforms remain shared. Imagery materials retain their tile's coverage references; imagery OFF restores that tile's base material. Eviction disposes base material and coverage texture as well as existing resources.

The elevation query now interpolates the actual worker triangle diagonal. A synthetic saddle previously sampled 25m despite the rendered center being 0m; it now returns 0m. Existing ocean vertex lowering remains intact.

## Files

- `src/world/tiles.ts`: READY mask ownership/lifecycle, geographic frame alignment, fallback retention, request identities, triangle sampling, production visibility predicate.
- `src/world/terrain-coverage.ts`: bounded coverage representation, matching CPU/GLSL lookup, triangle interpolation.
- `src/world/terrain-worker.ts`: echo request generation identity.
- `tests/terrain-visibility.test.ts`: focused synthetic coverage/geometry/lifecycle/material regressions.
- `tests/browser/terrain-inspection.{ts,html}`: production GPU depth readbacks, CPU-visible/raw geometry probes, and a rendered KHAF view.

## Verification so far

Initial seven tests failed for expected behavioral reasons before source repair. After the first source batch, all seven passed. Additional tests cover stale generation replies, rebasing while fine work is pending, and an actual raycast through a coarse 100m plane above fine 10m geometry.

- `npx vitest run tests/terrain-visibility.test.ts tests/geo.test.ts`: **28/28 passed** (13 terrain, 15 existing geo), after final changes.
- `npx tsc --noEmit`: **passed**, including the final source and revised incremental GPU harness.
- Follow-up tests first failed for unrelated coverage uploads and incorrect nonuniform-scale normals; both now pass. A final disposal test first failed, then passed after adding `TileManager.dispose()`.
- Root observed a clear-depth packing edge case before tiles loaded; the revised harness returns the clear-depth sentinel explicitly. No completed GPU height verification was obtained from the first harness. Browser unresponsiveness prompted removal of all automatic GPU work.

No full-project suite/build was run by this agent. Root owns that gate and browser results.

## Browser instructions and limits

Open `/tests/browser/terrain-inspection.html`, press **Load KHAF terrain**, and wait for READY counts to stabilize. This phase performs no WebGL rendering. Press **Measure GPU once** to run one explicit seven-probe measurement, yielding between probes, then render the perspective view once. There is no periodic GPU readback loop. **Stop and release resources** terminates terrain workers and releases terrain and WebGL resources. `rawTopMeshM` is expected to remain high because raycasts ignore shader clipping. `visibleMeshM` uses the production CPU predicate. `gpuHeightM` reads the depth texture after executing the unmodified production terrain shader, so it independently verifies fragment discard. Check `shaderErrors` is empty and `gpuMinusSampleM` is close to zero. The harness shows a perspective view as well.

Readback quantization is approximately 0.0012m over its 20km camera range. GPU float geometry/interpolation and row boundary uniforms retain normal floating-point edge tolerances; coverage is not expanded beyond tile bounds. Terrain pixels at water locations can retain the existing 0.15m sea lowering (the harness has no ocean plane).

`physicsM` additionally applies Airports' analytic runway flattening after the terrain sample. That second nonlinear flattening is not identical to interpolation of already-flattened mesh vertices at every runway shoulder. The harness reports the remaining `gpuMinusPhysicsM` separately; quantify with real KHAF results rather than claiming universal agreement. This repair does not modify aircraft gear/ground-clearance logic or airport analytic flattening.

## Review follow-up — stale queued generations

Addressed the review's minor lifecycle finding with a one-line dispatch guard: `pump()` now requires the queued Tile object to be the exact current map entry, rather than merely finding the same key. Obsolete queued generations are skipped before incrementing in-flight accounting or posting a worker message.

Added one regression that exercises the actual queue and worker message callbacks: eight jobs occupy all slots, a ninth queued generation is removed/re-requested, and completing the first worker job must dispatch the replacement directly. Before the fix it failed because request 9 (obsolete) dispatched instead of request 10 (replacement). After the fix, exactly nine total requests complete, in-flight returns to zero, the queue empties, and exactly nine distinct READY meshes exist. Imagery stays disabled with zero imagery loads/queued operations; no duplicate imagery/resource operations were introduced.

Verification: `npx vitest run tests/terrain-visibility.test.ts` — **14/14 passed**; `npx tsc --noEmit` also passed. Production change is limited to the queued-object identity guard; no imagery lifecycle or GPU/harness edits in this follow-up. Root's GPU acceptance remains pending.
