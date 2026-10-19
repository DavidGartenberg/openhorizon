# Stage 7a terrain review

## Spec Compliance

- ✅ Static implementation matches the bounded terrain repair: requested coarse tiles remain available; only READY descendant meshes contribute clipping; geographic frame scaling and worker request identity are reconciled; triangle sampling replaces bilinear interpolation (`src/world/tiles.ts:305`, `src/world/tiles.ts:389`, `src/world/tiles.ts:696`, `src/world/tiles.ts:721`).
- ⚠️ Integrated acceptance remains pending. The required real GPU/visual confirmation, including runway shoulders and fallback after removal, cannot be established from this diff or the reported unit runs. Root must complete the explicit browser probe and record actual GPU-minus-sample and GPU-minus-physics measurements (`tests/browser/terrain-inspection.ts:98`). The earlier stalled automatic harness is not passing evidence.
- ⚠️ Ocean, curvature, lighting and cloud code are retained, but real rendered appearance and resource behavior on the user's GPU still require root's browser check (`src/world/tiles.ts:82`, `src/world/terrain-worker.ts:120`). No hardware calibration acceptance is implied by this terrain review.

## Strengths

- Exact descendant indexing bounds each tile's mask to at most 64×64 bytes. Nonuniform latitude boundaries and six binary comparisons avoid broad approximate masks and per-fragment rectangle scans (`src/world/terrain-coverage.ts:11`, `src/world/terrain-coverage.ts:23`, `src/world/terrain-coverage.ts:47`).
- CPU and GLSL predicates use the same half-open convention, row array, descendant cell indexing and threshold semantics. The worker UV orientation agrees with the shader's north-fraction conversion (`src/world/terrain-coverage.ts:37`, `src/world/terrain-coverage.ts:53`, `src/math/geo.ts:73`). Boundary equality remains subject to the documented float precision tolerance.
- Coverage is built after mesh insertion and refreshed on READY insertion and batched eviction; missing/loading/failed descendants never suppress fallback. Rebase preserves tile-relative coverage (`src/world/tiles.ts:433`, `src/world/tiles.ts:659`, `src/world/tiles.ts:671`, `src/world/tiles.ts:696`).
- Creation uses anchor scale, queued runway coordinates use the stored build scale, and placement rescales geometry for the current frame, including late responses. The normal multiplier compensates for the subsequent model-matrix scale (`src/world/tiles.ts:338`, `src/world/tiles.ts:357`, `src/world/tiles.ts:647`).
- Geometry responses include monotonically assigned request IDs and reject stale generations before building resources (`src/world/tiles.ts:340`, `src/world/tiles.ts:390`, `src/world/terrain-worker.ts:239`).
- Each tile owns its coverage texture, coverage uniforms and normal correction; environment uniform objects remain shared. Imagery clones retain their tile's references and OFF restores that tile's base material. Detail imagery updates only the imagery sampler (`src/world/tiles.ts:414`, `src/world/tiles.ts:456`, `src/world/tiles.ts:619`, `src/world/tiles.ts:253`). Eviction and explicit disposal release the added resources (`src/world/tiles.ts:683`, `src/world/tiles.ts:739`).
- Triangle interpolation matches the worker's actual `(a,d,b)` / `(b,d,e)` indices, including the cell diagonal. Existing sea lowering is intentionally separate from sampled heights; analytic airport flattening remains a documented measurement limitation (`src/world/terrain-coverage.ts:69`, `src/world/terrain-worker.ts:153`, `src/world/terrain-worker.ts:215`).
- The browser harness executes the production material and reads its depth rather than substituting a CPU predicate. GPU work is explicit and yields between probes, and Stop disposes terrain and WebGL resources (`tests/browser/terrain-inspection.ts:15`, `tests/browser/terrain-inspection.ts:61`, `tests/browser/terrain-inspection.ts:108`). A single render/readback can still block the browser; the source does not establish successful GPU execution.

## Issues

### Critical

- None found in the reviewed snapshot.

### Important

- None found in the reviewed source. Required real GPU/visual acceptance remains outstanding as stated above; do not report Stage 7a as fully accepted yet.

### Minor

- None outstanding after the bounded follow-up. The exact Tile identity guard skips obsolete queued generations before dispatch or in-flight accounting (`src/world/tiles.ts:353`). The new regression fills all eight worker slots, replaces the ninth queued generation, completes jobs through the actual worker message callback, and checks nine total dispatches, zero final in-flight jobs, empty queues, nine distinct READY meshes and no imagery work (`tests/terrain-visibility.test.ts:91`). This resolves both the wasted-worker-slot finding and the missing queue-accounting coverage noted in the first review.

## Checks and Scope

- Read `terrain-brief.md`, `verification-brief.md`, `terrain-report.md`, the complete 1,021-line `terrain-review.diff`, and the task-reviewer template. No Git commands, browser operations, production edits or test reruns were performed.
- Focused source checks beyond the snapshot: the worker build function was cut off by diff hunks, so its grid positions, sea lowering, UV assignment and triangle indices were inspected to verify the actual sampling contract (`src/world/terrain-worker.ts:102`). The changed material-sharing contract required checking the omitted constructor and detail-material updates (`src/world/tiles.ts:201`, `src/world/tiles.ts:244`). The geometry/UV contract required checking `metersPerDegree`, frame conversion and `tileGridUv` in `src/math/geo.ts:16`.
- Implementer-reported initial verification: 28/28 focused terrain/geo tests and `npx tsc --noEmit` passed. Follow-up verification: 14/14 terrain tests and TypeScript passed after the exact-identity queue guard. Root additionally reported 1,441 passing tests and four skipped tests across 108 files before that guard. This review inspected the bounded follow-up diff and test without rerunning tests; no unanswered static doubt justified another run.

## Assessment

**Task quality: Approved for the reviewed static implementation; no outstanding source findings.**

**Integrated acceptance: Pending root's actual GPU/visual results.** The repair has coherent bounded ownership, matching visibility predicates and geometry/sampling contracts. Unit tests and code inspection cannot substitute for the required production shader and runway-edge measurements.

Follow-up review: inspected the refreshed snapshot's one-line production guard and the complete new queued-generation regression. No additional production or harness changes were requested or reviewed in this follow-up. GPU acceptance remains pending while root recovers the blocked test tab.
