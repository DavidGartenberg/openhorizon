# Shaders and physics mods: inventory

This page lists what the shader and physics work added to OpenHorizon, where it lives, and how each piece is checked. The design notes and measurements are in [PROGRESS.md](../PROGRESS.md) and the plan is in [plans/improvement-20.md](plans/improvement-20.md).

![Terrain relief, dusk, alpine snow, fresh snow cover, wet ground and a contrail, rendered by the real shaders in the preview harnesses](images/weather-shaders.jpg)

*Rendered in the `tests/browser` preview harnesses through the production shaders: `terrain-shader-preview.html` (views `near`, `dusk`, `snow`, `near&snowcover=1`, `far&wet=1`) and `trails-preview.html`.*

## Shaders and visual effects

| Effect | Module | What it does | Checked by |
|---|---|---|---|
| Terrain shading | `src/world/terrain-shader.ts` | Band-limited fBm detail that fades out before it can shimmer. Adds slope rock with warped strata and an alpine snow line broken by noise. Lighting is hemispheric ambient with ground bounce, plus micro-relief normals (analytic gradient), snow glint and aerial perspective. Has Full and Performance tiers. | `terrain-shader.test.ts`, `terrain-shader-math.test.ts`, preview `?count=1` |
| Wet and snowy ground | terrain shader, `src/render/surface-materials.ts` | A water film with Fresnel sky sheen on rock, soil and built-up ground (vegetation soaks it up), and fresh snow settling below the steeps. Wet pavement gets lower roughness and puddles. | `weather-effects.test.ts` (surface state) |
| Windscreen | `src/render/windscreen.ts` | Drops bead and creep at rest, and stream with airspeed. Unheated glass frosts as airframe ice builds. | in-sim renders (rain sweeps) |
| Falling rain and snow | `src/render/precipitation.ts` | A camera-centred, GPU-wrapped particle field with no per-particle CPU work. Rain streaks stretch with the relative airflow, snow flakes sway, and the 737 cabin stays dry. | in-sim renders (rain, snow and storm sweeps) |
| Lightning | `src/render/lightning-bolt.ts`, `src/sim/weather/lightning.ts` | Poisson strikes from reported storms or heavy radar cells. 3D forked bolts with return strokes, a sky flash, and thunder delayed at 343 m/s. | `lightning.test.ts` |
| Contrails and wingtip vapour | `src/render/contrails.ts` | Schmidt–Appleman formation (Schumann 1996 fit) and humid high-lift tip vapour. Sub-pixel ribbons are widened with coverage-scaled alpha. | `weather-effects.test.ts` |
| Fair-weather cumulus | `src/render/clouds.ts`, `src/sim/environment/cumulus.ts` | Raymarched puffs over living thermals, with the base at the lifting condensation level (about 125 m per °C of spread). | `environment/cumulus.test.ts` |
| Ocean | `src/render/ocean.ts` | Subsurface glow through steep crests toward a low sun. | renders |
| Tyre smoke | `src/render/tire-smoke.ts`, `src/sim/touchdown.ts` | Instanced puffs at the main-gear contacts, scaled by touchdown speed and firmness. | `touchdown.test.ts` |
| 737-800 cabin | `src/render/cabin-737.ts` | A full-length Sky Interior cabin behind a flight deck at the real nose station. | `render/cabin-737.test.ts` |
| Google Maps layer | `server/google-tiles.mjs`, `src/world/imagery-source.ts` | Opt-in official Map Tiles API imagery on the terrain, with the API key kept server-side. | `google-tiles.test.ts` |

## Physics mods

| Model | Module | What it models | Checked by |
|---|---|---|---|
| Turbulence | `src/sim/wind.ts` | MIL-F-8785C Dryden. Low-altitude and high-altitude scales, exact Ornstein–Uhlenbeck steps, a spanwise roll gust, and no vertical gusts on the ground. | `environment/physics-mods.test.ts` (RMS and correlation over 2 h) |
| Convective and lee-rotor turbulence | `src/sim/weather/turbulence-sources.ts` | Thunderstorms and radar cells, and rotor downwind of ridges in strong wind. | `turbulence-sources.test.ts` |
| Thermals and ridge lift | `src/sim/environment/thermals.ts` | A sun-driven thermal lattice with a mixed-layer profile, downwind lean and a life cycle. Ridge lift is U·∇h, with sink in the lee. | `physics-mods.test.ts` |
| Microburst windshear | `src/sim/environment/microburst.ts` | A Stokes stream-function field (mass is conserved exactly) and an F-factor detector with a 2 s low-pass, giving jets their reactive WINDSHEAR alert. | `physics-mods.test.ts` |
| Wake turbulence | `src/sim/environment/wake.ts`, `src/sim/atc/wake-caution.ts` | Lamb–Oseen vortex pairs that sink, drift and decay, rolling the aircraft behind them. The tower issues wake cautions. | `physics-mods.test.ts`, `atc/wake-caution.test.ts` |
| Airframe icing | `src/sim/systems/airframe-ice.ts` | E·LWC·V accretion in the supercooled window, CLmax loss, added drag, anti-ice and melt. | `physics-mods.test.ts` |
| Runway contamination | `src/sim/environment/runway-surface.ts` | Braking-action friction from the METAR, slush drag, and hydroplaning above 9·√p kt. | `physics-mods.test.ts` |
| Structural limits | `src/sim/systems/structure.ts` | Certification-category limit and ultimate loads, an overstress latch, and wing failure. | `physics-mods.test.ts` |
| Total-energy variometer | `src/sim/vario.ts` | TE-compensated climb for gliders, with audio tones. | `vario.test.ts` |
| Tyre stick-slip | `src/sim/gear.ts` | Static friction at standstill, so brakes hold against wind and a full-power run-up. | `gear-stiction.test.ts` |
| Large-sideslip and reversed-flow aero | `src/sim/aero.ts`, `src/sim/aircraft.ts` | In-plane (cos²β) lift, sinβ·cosβ dihedral and full-range α, so a parked airplane survives a thunderstorm. | `parked-in-wind.test.ts` |
| Unpowered trim | `src/sim/trim.ts` | Gliders trim on their airbrakes, which gives steady final-approach spawns. | `glider-final-trim.test.ts` |

All of it is inert in calm, clear, dry air, so the POH-validated flight model is unchanged there (`npm run validate`). It can be switched off under **View & graphics → Realism**, or with typed commands (`HELP`).
