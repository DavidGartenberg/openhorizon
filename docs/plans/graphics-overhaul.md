# Rendering overhaul — 2026-09-08

Goal: a substantial, browser-verified improvement to OpenHorizon's realism,
prioritizing the environment seen in both cockpit and exterior flight. A numerical
“10× realism” claim is not a measurable acceptance criterion; matched visual
comparisons, shader correctness, and frame timing are.

The existing engine is Three.js r180/WebGL2, floating-origin terrain with z14
imagery, procedural aircraft and airport geometry, a solar scattering shader,
billboard clouds, analytic water, and sky PMREM lighting. Physics runs separately
at 120 Hz and has POH validation. The initial view has clipped cyan/white sky,
flat pavement, pale distant terrain, and sprite clouds. Custom shader output
bypasses tone mapping and sRGB conversion. Sky scattering is recomputed for every
screen pixel, and sky projection assumes conventional depth despite reversed-Z.

Chosen approach: upgrade the existing renderer. Exposure-only changes would leave
the geometry/weather limitations; an engine migration would discard working
systems and introduce much greater risk.

- [x] Capture baseline and run regression suite.
- [x] Cache atmospheric radiance in an HDR sky texture; share it with environment
  lighting and ocean reflections. Fix reversed depth, solar update order, sky
  exposure, observer altitude, and reflection refresh on azimuth changes.
- [x] Replace flat puffs with bounded volumetric cloud raymarches, 3D density,
  optical absorption and sunward self-shadowing. Keep METAR slabs and rebase API.
- [x] Add physically motivated water Fresnel, multiscale wave normals and sky
  reflections; use common tone mapping on terrain/water/clouds/sky.
- [x] Add procedural pavement aggregate and wear in metre-scale coordinates,
  retain real runway dimensions and markings, improve terrain detail and haze.
- [x] Add a small graphics control panel and repeatable graphics inspection page
  for daylight, sunset, night, coastal final, cockpit, and overcast comparisons.
- [x] Build, run tests/POH validation, inspect live shaders, capture matching
  screenshots, inspect frame timing, and get an independent code review.

Constraints: no physics changes, no paid services or dependencies, no fake
instrument data, no loss of canvas MSAA or reversed-Z, bounded GPU work. Record
procedural scenery and cloud approximations. Keep user's local project runnable.
No renderer migration or speculative postprocessing until measured headroom.

## Implementation and verification

Implemented in the existing WebGL2 renderer without changing `src/sim` or
installing dependencies. Cached 512×256 HDR atmospheric radiance now supplies the
sky, PMREM environment lighting and water reflections. All custom shaders use
ACES/output conversion. The atmosphere handles reversed depth, observer altitude,
and solar azimuth refresh. Clouds use bounded 3D raymarching with self-shadowing;
local immersion samples the same density field, so sparse-layer gaps remain clear.
Cloud fog is composed consistently with Three's standard materials.

Nearby z13 terrain tiles can now stream z16 photography into 2048×2048 mosaics,
versus the original 512×512: 16 times as many texture pixels over the same area.
The nearest two tiles are retained below 1,800 m AGL. Loading is cancellable,
limited to four requests and one mosaic at a time, with original imagery retained
on failure. Performance quality disables this detail tier. Data remains from the
existing USGS imagery proxy; no credentials or paid service were added.

Pavement has metre-scale aggregate, roughness, concrete joints and threshold-aligned
touchdown wear. Aircraft paint uses clearcoat and environment reflections, with
self-shadowing and a shadow footprint sized to the active aircraft. The C172 has
a continuous lofted airfoil, smoother cowl and tail, and an open cabin shell.
Exterior framing is hidden at the interior eyepoint. Transparent propellers no
longer write opaque depth through clouds. Fleet control/gear/flap stations and
live instrument inputs are preserved.

Use **View & graphics** for camera, quality, exposure, weather, time and overlay.
The development-only `/tests/browser/graphics-lab.html` provides repeatable scene
selection and a 10-second browser frame measurement. It is not part of the
production entry bundle. Run with `npm run dev:client -- --host 127.0.0.1`.

Validation on September 8, 2026:

- `npm run build`: TypeScript and production build pass. Existing large-bundle
  warning remains (about 882 kB minified / 256 kB gzip).
- `npm test -- --reporter=dot`: 80 files, 1,193 passed, 4 existing skips.
- `npm run validate`: 547 passed, 4 existing skips. Also included in full suite.
- `git diff --check`: clean. Independent review findings fixed and regression
  tests added for cloud support/rebase, sparse gaps, propeller depth and imagery
  child footprints; live shader compilation checked in the in-app browser.
- Visual inspections: KHAF runway and coastal final, C172 cockpit/exterior,
  cloud entry, sunset, KSFO final, 737 exterior and cockpit, night instruments.
- Intermediate performance samples in an 861×882 browser viewport, High quality,
  1291×1083 render buffer: 60.1 mean FPS scattered coastal final, 50.1 overcast.
  These are development-browser measurements, not universal hardware targets or
  final-release benchmarks. Inside thick cloud and dense airports cost more.

## Remaining realism limits

This is a substantial renderer upgrade, not a claim that “10× realism” can be
measured or that the simulator is fully photorealistic. Aircraft/cockpit and much
of the scenery remain procedural, and satellite source quality/coverage vary.
Clouds use approximate single scattering, transparent mass sorting and first-hit
scene depth; the local FogExp2 immersion model is an approximation. Cloud cover
attenuates sunlight globally rather than casting spatial shadows on the ground.
The sea has a flat geometric surface with spectral-style normal waves and sky
reflections, without bathymetry, coastal foam or reflected scene/cloud geometry.
The existing moon/star model is approximate. Higher quality photographic models,
scenery assets, depth-aware cloud composition and spatial cloud shadows remain
valuable future work. Physics accuracy is a separate subsequent phase.
