# X-Plane assets in OpenHorizon

Source audit updated 2026-11-25 at published baseline `a3d3879` and subsequent
FCU/Boeing paint work. See [CURRENT-STATE](CURRENT-STATE.md) for exact checks,
known limits and the publication queue.

The simulator reads the user's X-Plane 12 installation **at run time**. The
repository contains the loaders and mappings. The server exposes these
read-only route families.

| Route | Serves | Code |
| --- | --- | --- |
| `GET /xp/manifest.json`, `GET /xp/aircraft/<path>` | `.obj` `.png` `.dds` `.txt` from `Aircraft/Laminar Research/` (path-checked) | `server/xp-static.mjs` |
| `GET /api/apt/<ICAO>.json` | one airport's real layout parsed from `Global Scenery/Global Airports/Earth nav data/apt.dat` (+ Custom Scenery packs, which override) | `server/apt.mjs`, `server/apt-parse.mjs` |

`XPLANE_DIR` sets the Laminar Research aircraft folder, defaulting to
`/Users/davidgartenberg/X-Plane 12/Aircraft/Laminar Research`. `XPLANE_ROOT` sets
the airport-data installation root, which otherwise derives from `XPLANE_DIR`.
Without an install, `/xp/manifest.json` returns `available:false`, asset files
return 404, and procedural airplanes/cockpits and airport fallbacks remain.

## What is drawn from X-Plane, and what drives it

**Exteriors** (`src/render/local-aircraft.ts`, `xplane-manifest.ts`, `xplane-obj8.ts`): ten installed
models (172, 737-800, A330-300, MD-82, SR22, Baron 58, Super Cub, ASK 21, Citation X,
King Air C90B) are exact for their types.
`xplane-proxy.ts` selects a scaled installed donor for many other player types
with up to two engines. Traffic also uses donor selection (`traffic-model.ts`),
with shared geometry and gear/flap/prop appearance inferred from kinematics.

The local Airbus work exempts non-A333 Airbus player types from exterior
replacement. Their own shape remains while the flight deck uses the fitted A330
donor. Boeing variants other than the exact 737-800 keep their geometry and
receive projected texture charts from the installed B738. Projection replaces
their old procedural color, roughness and bump maps on marked surfaces. Check
`localModelFor(key).exact` and the actual upgrade path when reporting fidelity.
Projected Boeing surfaces also replace the old procedural seam/rivet shader
with the shared fine-detail pack, so authored panel lines have a single source.

**737 flight deck** (`xplane-cockpit.ts`, `xplane-datarefs.ts`, `xplane-panel.ts`, `xplane-interact.ts`):
- 14 shell objects + the panel mesh `b738_cockpit.obj`, posed every frame from a *dataref reader*
  (`makeXpDatarefReader`): a function from X-Plane dataref names to numbers, built from the simulator's
  real state. A dataref the simulator has no state for reads 0, or its resting value in `XP_B738_RESTING`.
  Nothing animates unless the sim value moved.
- The glass displays, MCP windows, radio windows and transponder are drawn into one 2048 × 1024 bitmap
  (`XpPanel`) that the panel mesh maps onto the cockpit. The rectangles are measured from the mesh UVs;
  `tests/xplane-panel.test.ts` re-derives them from the OBJ whenever the install is present.
- Lamps and backlights use the OBJ's own `ATTR_light_level` (each distinct level gets a material that glows on
  its dataref; brightness in nits ÷ 500, capped).
- Mouse: every `ATTR_manip_*` in the panel mesh is an invisible hit box that moves with its lever; a click maps to
  the matching simulator action (`xpActionFor`) or says "NOT SIMULATED" with the control's own name.

**Airports** (`src/world/apt-layout.ts`, `airport-flatten.ts`, `runway-marks.ts`, `server/apt.mjs`): pavement polygons with
holes and Bézier edges draped on the ground (rebuilt when the fine terrain has loaded), painted lines, gate numbers,
taxi lights and signs, displaced thresholds, blast pads / overruns with chevrons, PAPI and windsocks, decorative parked
airplanes at the gates, concrete versus asphalt, the taxi network (names real taxiways for ground control) and a level
terrain area sized from X-Plane's real pavement extent. Terminals are OpenStreetMap footprints (X-Plane has none).
Four additional airport routes supply runway and layout data from `apt.dat`.
The server caches derived data on disk.

| Route | Serves |
| --- | --- |
| `GET /api/apt-runways.json` | per airport: overruns; X-Plane's runway ends / width / hard-soft / edge lights where they differ; runways the database lacks; runways X-Plane disproves (`[end, end, -1, -1]`) |
| `GET /api/apt-extent.json` | the box that holds an airport's pavement (airports over ~1.5 km across) |
| `GET /api/apt-land.json?lat&lon&r` | where low airports (up to 20 m) are certainly land, from their X-Plane pavement and runways: runs along 100 m rows; the client levels them only where the elevation data says sea (reclaimed land) |
| `GET /api/apt-airports.json?lat&lon&r` | airports X-Plane has and the database lacks (22k small fields, 6.8k heliports whose pads are short `pad` entries, 589 seaplane bases whose lanes are `pad` + `water` entries), drawn but kept off the ND / MFD lists |

Fields below sea level keep the elevation data's negative heights as land within 12 km (polders, Death Valley) and the ocean is hidden around them; reclaimed land (VHHH, where the data says sea) is levelled from the land mask.

## How to look at it (verification recipes)

- Start an isolated Vite server with `OPENHORIZON_HMR=0 PORT=5174 npm run dev:client`.
  Open that port so the user's saved flight and settings are untouched. See
  [DEVELOPMENT](DEVELOPMENT.md) for the startup checks and other ports.
- Hooks on `window` (all verification only): `__ohXp` (status, eye), `__ohXpRead([...datarefs])` (what the deck is
  being told), `__ohXpRef(name, value)` (force one), `__ohXpPick(x, y)`, `__ohAptInfo(icao)`, `__ohAptShow`,
  `__ohAi`, `__ohLocal(lat, lon)`, `__ohPlayerPos`, `__ohFreeCam({e,u,s,yaw,pitch})`, `__ohGround(lat, lon)`,
  `__ohTime(hours)` (adds hours to the clock), `__ohCtl({throttle,…})`.
- Analysis scripts (read the install, print facts): `scripts/xplane/list-datarefs.ts` (every dataref the cockpit
  animates), `find-screens.ts` (display openings), `audit-acf.ts` (masses and speeds versus the sim).

## Cockpits across the fleet

- **Airbus transports** use the installed A330-300 cockpit. The A333 uses its
  ACF eye and native model placement. Other Airbus types keep their own exterior
  and fit the A330 deck to cockpit width and eye-to-nose distance.
- **Other transports at committed HEAD** (Boeing and airliner turboprops,
  `cockpitProfile(...).deck`) use the X-Plane 737-800 deck. In any type but the
  737 it is placed at that type's own design eye and scaled to its cabin
  (`loadXpCockpit(..., { place })`).
- **Light airplanes** fly an X-Plane light-airplane cockpit (`xplane-ga-cockpits.ts`): their own when X-Plane has it
  (C172 SP, SR22, Baron 58, PA-18, ASK 21, King Air C90B), else the closest by how they are flown (`gaCockpitFor`:
  gliders the ASK 21, side-yoke Cirruses the SR22, turboprops the King Air, piston twins the Baron, stick singles the
  Super Cub, other singles the 172). Each entry is the airplane's interior objects, click map, panel art and pilot's eye,
  read from its `.acf`.
- Their gauges are 3D instruments animated on X-Plane datarefs in X-Plane's units: `xplane-ga-datarefs.ts`
  (`makeXpGaDatarefReader`) maps the simulator's state onto them. Manifold pressure and a turboprop's N1 and ITT are
  derived from throttle and shaft power (the simulator models no intake or gas generator). Avionics screens
  (`ATTR_cockpit_device`: G1000 PFD / MFD, GNS 530 / 430) show the simulator's own PFD and moving map.
- Clicks (`xplane-interact.ts`): throttle and mixture plungers follow a held drag; the flap lever, trim wheel and buttons,
  parking brake, battery / alternator / avionics / pitot heat / fuel pump switches, landing light, COM 1 / NAV 1 standby
  tuning and flip (read out as a toast), OBS, barometer and the stock autopilot buttons act. Everything else answers
  "NOT SIMULATED" by its own name.
- Limits: X-Plane paints its 2D instruments into the panel art at run time, so those faces are dark here (the King Air's
  EFIS and attitude indicator, the radios' frequency windows). `C90B_lights.obj` (light points only) is left out.
- `__ohXpHits('throttle')` lists where matching hit boxes project on screen; `__ohXpRead([...])` what the deck is told.

### Airbus deck and screens

`xplane-airbus.ts` routes all Airbus-labelled roster types to the installed
A330-300 cockpit. The native A333 uses the ACF eyepoint. Other Airbus types fit
its width and eye-to-nose distance to their own procedural exterior. Their panel
layout remains the A330 donor layout.

`XpAirbusPanel` draws into the measured 2048 × 1024 screen atlas. Main supplies
live aircraft/AP/navigation/engine/fuel state to dedicated Airbus PFD, ND, EWD,
systems and standby draws. The FO screens copy the captain's view. The systems
page covers implemented fuel/configuration data. MCDU geometry currently uses
the shared flight-information display. AP2 and managed speed/vertical schedules
remain unsupported. Selected heading, altitude, speed and VS controls use the
existing AP and autothrottle paths. LOC has its own localizer-only action.

The screen faces and UVs are measured from the installed mesh, but dynamic
screen graphics are OpenHorizon canvas drawings rather than X-Plane's running
instrument pixels. They use the donor layout and integrated simulator state;
do not claim pixel-identical instruments. AP2 and unsupported managed modes
must remain visibly unmodeled.

The FCU windows now use the installed A330's `cockpit_3d/generic/7segment/Autopilot`
digit/sign/dash/label atlases, with ACF positions and per-digit rows. The simulator
supplies the selected IAS, heading, altitude and VS. A missing image warns and
falls back to readable live text; no X-Plane image is copied into the repository.

The local reader maps sidesticks, flap and spoiler handles, parking brake,
throttle, FCU windows, AP/A/THR lamps and panel brightness from simulator state.
Unsupported controls report their own name. Add mappings only when the simulator
has the underlying state and action.

`tests/browser/xplane-airbus.html` is an isolated diagnostic scene with selectable
A333/A320/A388 placement and day/night lighting. Its display values are deterministic
test inputs. Actual flight integration requires the main simulator scenario.
OBJ8 authored `NORMAL_DECAL`, `NORMAL_DECAL_KEYED`, and
`NORMAL_DECAL_PARAMS` forms are supported with bounded repeat sampling.
Projected `NORMAL_DECAL_PARAMS_PROJ` UVs remain unsupported and warn explicitly.

## Adding things

- **A dataref**: add the name to `makeXpDatarefReader` (live) or `XP_B738_RESTING` (a recorded stand-in) with a test
  in `tests/xplane-datarefs.test.ts` / `xplane-lights.test.ts`; then look at it in the browser.
- **A manipulator action**: add the command or dataref to `xpActionFor` (test in `xplane-interact.test.ts`) and carry
  it out in `xpAct` in `src/main.ts` using the same function the keyboard uses.
- **Another X-Plane aircraft**: add its objects, CG and control limits to `xplane-manifest.ts` (the exterior), then
  repeat the 737 deck's steps for a cockpit: load the objects, find the panel mesh and its UV rectangles, map datarefs.

## Known limits

Recorded in `PROGRESS.md` (overnight shift): overhead switches are resting positions, the lower DU shows modelled
readouts, one autopilot stands behind CMD A/B, and only the airliner exteriors take X-Plane liveries (two at a time).
Airports: sea the elevation data puts beyond 13.5 km of a below-sea field (the Dutch coast) and reclaimed land of fields above 20 m is
not handled; terminal heights come from OpenStreetMap; seaplane bases exist but there is no floatplane physics; the
shoreline where a level area meets the sea is stepped at the terrain's cell size; the parked airplanes are scenery
(no label, no radar return).
