# Sept18 terrain GPU acceptance measurements

Actual browser tests/browser/terrain-inspection.html,182/182READYtiles nearKHAF. GPU initialized BEFORE loading terrain assets; this succeeded after repeatable crashes initializing after assets. No production shader changes were made to obtain these results. Empty context and bareThree constructors also succeeded separately; exact platform/resource cause of late-init crash remains unresolved.

The harness renders unmodified production terrain materials to a depth texture, packs depth in a second pass and reads one pixel. CPU raycasting uses indexed geometry and the matching READY visibility predicate only as a separate comparator. All7GPUreads completed; shaderErrors empty. Coarse rawtop at center78.382110m, rendered GPU11.513840m, finest sample11.514202m: coarse terrain no longer occludes fine runway terrain there.

| North m | East m | Sample m | GPU m | GPU−sample m | GPU−physics m |
|---:|---:|---:|---:|---:|---:|
|0|0|11.514202112|11.513840003|-0.000362110|-0.000362326|
|100|0|11.847929424|11.850008538|0.002079114|0.005539751|
|-100|0|11.159738769|11.160982249|0.001243480|-0.022986410|
|0|100|11.102050228|11.102569986|0.000519758|-0.097044301|
|0|-100|11.513395441|11.513840003|0.000444562|-0.308793079|
|250|250|14.216167685|14.217493332|0.001325647|0.001325647|
|-250|-250|6.899226656|6.900463289|0.001236633|0.001236633|

Maximum observed GPU−sample magnitude0.002079m. The main-flight analytic runway-flattening pass differs by up to0.308793m near a shoulder in these probes; this is a separate geometry/physics mismatch still requiring resolution/acceptance, not covered by shader clipping success. CPU visiblemesh/sample differences all under0.000001m. These seven samples do not establish global world correctness, eviction/fallback GPU behavior, rebasedGPUbehavior, or allairportshoulders. Unit tests cover READY/fallback/rebase contracts separately.

Stop button completed with explicit resources-released status; successful test tab closed. Main simulator remained paused/responsive. Three earlier crashed diagnostic pages were left unmarked for normal cleanup; browser tools blocked their internal data crash URLs, no bypass attempted.

## Root cause of shoulder mismatch
`terrain-worker.ts` already calls flattenForRunway on each source sample; main.ts196 then calls Airports.flattenElevation on the interpolated already-flattened result. In a blend band this applies the runway influence twice (effective weight1−(1−w)^2 instead ofw), explaining the measured shoulder drift. This is separate from interpolation error; the indexed visible mesh matches TileManager.elevationAt to sub-micrometer precision in these samples. Do not blindly remove the main fallback: before a usable terrain tile arrives, analytic runway elevation prevents spawning at sea level, and the runway strip itself lies on its own endpoint plane. A coherent follow-up must distinguish actual runway contact / unloaded fallback from already-shaped terrain, preserve coarse/fine lifecycle behavior, and compare runway core/end/shoulder across READY and loading states. Rendered strip uses endpoint plane+0.06m depth separation; do not accidentally treat that visual bias as a new physical datum.
