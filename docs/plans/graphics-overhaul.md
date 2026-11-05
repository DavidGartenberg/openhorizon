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

## Cloud shadows (2026-11-03)

`src/render/cloud-shadows.ts`. Each cloud mass is drawn into a 1,024² top-down transmittance map covering 32 km around
the camera: for every ground point the sun ray is marched through the mass with the same density function the visible
clouds use (`CLOUD_DENSITY_GLSL`, shared with `clouds.ts`), so a shadow has the shape of its cloud and is displaced along
the sun ray; overlapping masses multiply. The terrain shader, the ocean's sun glint and every built-in lit material
(pavement, buildings, aircraft: one `onBeforeCompile` default, `patchCloudShadow`) multiply their directional light by the
map value at the point where their own sun ray crosses sea level. The map is exact below the lowest cloud base; above it
surfaces take the transmission at the aircraft (computed on the CPU with the same density, `Clouds.sunTransmissionAt`), so
a plane above the clouds stays in full sun while the ground below it is dappled. The scene's sun light itself now follows
that measured transmission instead of a uniform dimming by cloud cover (an aircraft inside a dense mass is nearly
unlit; one in a gap is in full sun). The map is redrawn when the camera moves a texel (31 m), the sun moves, or the masses
are refilled. "Cloud shadows" in View & graphics switches it (saved with the other effects); `__ohCloudShadows`,
`__ohCloudShadowMap` (what the map holds, with a sketch) and `__ohCloudsVisible` are the inspection hooks.

Limits: the field of clouds reaches 14 km, so below about 12° of sun elevation a cloud's shadow falls beyond the cloud
field and the map is faded out (uniform dimming again); the sea takes the shadow only in its sun glint (it has no diffuse
term); the CPU density lacks the shader's finest noise octave (a few per cent in a mass's rim).

Checked in the browser (separate origin) with scattered cloud over San Francisco: the map agrees with the CPU transmission
at a 5 × 5 grid of ground points (0.27/0.25, 0.19/0.22, 0.41/0.36 …), a soft-edged shadow lies across the city blocks with
the switch on and not with it off, and runway, aircraft, cockpit and terrain still render with no shader errors.

## Land shading (2026-11-03)

The terrain shader (`TERRAIN_FRAG` in `src/world/tiles.ts`) now relights the ground instead of tinting it. Five octaves of
procedural relief (wavelengths from 22 m down to 0.5 m, each fading out as it nears the pixel footprint, so distant ground
goes smooth instead of shimmering) tilt the surface normal through a surface-gradient bump (no tangents), so the sun finds
small slopes and low sun rakes the ground; over satellite photographs only 40 % of that is added, since a photo carries its
own shading, and exactly level ground (an airfield's graded pad) gets a quarter of it. Steep ground sheds its cover where
there is no photograph (rock and bare soil by slope), broad warm/cool colour drift at 220 m and 800 m scales breaks up
flat ground, and the sky fill follows the tilted normal. Checked in the browser at KSFO with imagery off and on; it is a
look, not a measurement (a recogniser cannot judge terrain either), and the amplitudes were set by eye.

## Aerial perspective on objects (2026-11-03)

Terrain, sea and clouds were hazed by the atmosphere, but aircraft, buildings and pavement were not, so a far taxiway or
terminal stayed crisp and dark against the ground that faded around it. `src/render/atmosphere-materials.ts` gives every
built-in lit material the terrain shader's haze: an exponential height density integrated along the view segment, mixed
toward the sky's radiance in the view direction, in linear light before tone mapping. It rides the same shader hook as the
cloud shadows (`patchAtmosphere`; one default `onBeforeCompile` for built-in materials, an explicit call for the two that
patch their own). Nothing within 20 m is touched, so the cockpit and the player's own aircraft are unchanged; the density is
the one the terrain uses (from the weather's visibility). Checked at KSFO at 6 SM: runways and taxiways that stood out dark
and crisp to the horizon now dissolve into the haze like the ground. `__ohAerial(on)` switches it for comparison.

## Wet ground (2026-11-03)

`src/render/wetness.ts`. The METAR's present weather (`-RA`, `TSRA`, `BR`, `FG` ...) sets how wet the ground is, 0..1: heavy rain
soaks it, rain and showers 0.85, light rain 0.62, fog 0.5, mist 0.3, snow melting 0.35, rain in the vicinity 40 % of that.
Wetting takes about two simulated minutes and drying about fifteen; a new place or a set weather starts at its target (it
was already raining when you got there). One shared uniform feeds the shaders: pavement goes darker and glossier with the sky
reflected in it (roughness down, indirect specular up), with puddles standing in broad low spots drawn from the pavement's
own noise; terrain goes darker and a little richer in colour, less so over a photograph. Checked at KSFO with the same
view dry and in rain: the runway shows sky-mirroring puddles and darker, wet-looking asphalt; dry is unchanged. There is no
rain itself yet (no streaks, no windshield droplets); this is the surfaces only.

Snow follows the same way (`snowFromWeather`, `SnowModel`): `SN` 0.9 (light 0.7, heavy 1), grains and pellets a little,
settling over about 20 minutes of snowfall and melting over about 3 hours, so it is still there after the snow stops. Terrain
whitens on level and gently sloping ground (patchy at first, thin on steep faces); pavement keeps a dusting in its grain
(less on runways, which are ploughed); wet gloss is suppressed under snow. Checked at KSFO in `-SN OVC015`: snow-covered
airfield with the ploughed taxiway lines still dark.

## Remaining realism limits

This is a substantial renderer upgrade, not a claim that “10× realism” can be
measured or that the simulator is fully photorealistic. Aircraft/cockpit and much
of the scenery remain procedural, and satellite source quality/coverage vary.
Clouds use approximate single scattering, transparent mass sorting and first-hit
scene depth; the local FogExp2 immersion model is an approximation. Cloud
shadows are the cloud masses' own (see below); beyond 16 km of the camera, with the sun below about 12° or
with the switch off, cloud cover dims the sunlight uniformly as before.
The sea has a flat geometric surface with spectral-style normal waves and sky
reflections, without bathymetry, coastal foam or reflected scene/cloud geometry.
The existing moon/star model is approximate. Higher quality photographic models,
scenery assets and depth-aware cloud composition remain valuable future work. Physics accuracy is a separate subsequent phase.
