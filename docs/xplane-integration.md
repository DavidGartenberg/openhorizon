# X-Plane assets in OpenHorizon

The simulator reads the user's own X-Plane 12 install **at run time** and never copies any of it
into the repository. Two read-only server routes expose it; everything else is client code.

| Route | Serves | Code |
| --- | --- | --- |
| `GET /xp/manifest.json`, `GET /xp/aircraft/<path>` | `.obj` `.png` `.dds` `.txt` from `Aircraft/Laminar Research/` (path-checked) | `server/xp-static.mjs` |
| `GET /api/apt/<ICAO>.json` | one airport's real layout parsed from `Global Scenery/Global Airports/Earth nav data/apt.dat` (+ Custom Scenery packs, which override) | `server/apt.mjs`, `server/apt-parse.mjs` |

`XPLANE_DIR` (the "Laminar Research" aircraft folder) and `XPLANE_ROOT` (the X-Plane root) override the
default `/Users/davidgartenberg/X-Plane 12`. With no install, every route answers "not found" and the
procedural airplanes, cockpit and OpenStreetMap airports stay.

## What is drawn from X-Plane, and what drives it

**Exteriors** (`src/render/local-aircraft.ts`, `xplane-manifest.ts`, `xplane-obj8.ts`): nine installed
models (172, 737-800, A330-300, MD-82, SR22, Baron 58, Super Cub, ASK 21, Citation X) are exact for their types.
`xplane-proxy.ts` picks the closest installed model, scaled to the type's real length, for every other
flyable roster aircraft (twin-engine only) and for all traffic (`traffic-model.ts`: one load per model, shared
geometry, gear / flaps / prop disc from observed kinematics, nearest 8 to the camera).

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
Three more routes carry what the old OurAirports database gets wrong or lacks, all read from `apt.dat` and cached on disk:

| Route | Serves |
| --- | --- |
| `GET /api/apt-runways.json` | per airport: overruns; X-Plane's runway ends / width / hard-soft / edge lights where they differ; runways the database lacks; runways X-Plane disproves (`[end, end, -1, -1]`) |
| `GET /api/apt-extent.json` | the box that holds an airport's pavement (airports over ~1.5 km across) |
| `GET /api/apt-land.json?lat&lon&r` | where low airports (up to 20 m) are certainly land, from their X-Plane pavement and runways: runs along 100 m rows; the client levels them only where the elevation data says sea (reclaimed land) |
| `GET /api/apt-airports.json?lat&lon&r` | airports X-Plane has and the database lacks (22k small fields, 6.8k heliports whose pads are short `pad` entries, 589 seaplane bases whose lanes are `pad` + `water` entries), drawn but kept off the ND / MFD lists |

Fields below sea level keep the elevation data's negative heights as land within 12 km (polders, Death Valley) and the ocean is hidden around them; reclaimed land (VHHH, where the data says sea) is levelled from the land mask.

## How to look at it (verification recipes)

- Use a separate browser origin so the user's saved flight and settings are untouched: `http://[::1]:5173/`
  (Vite listens on IPv6 loopback; `localhost` is the user's).
- Hooks on `window` (all verification only): `__ohXp` (status, eye), `__ohXpRead([...datarefs])` (what the deck is
  being told), `__ohXpRef(name, value)` (force one), `__ohXpPick(x, y)`, `__ohAptInfo(icao)`, `__ohAptShow`,
  `__ohAi`, `__ohLocal(lat, lon)`, `__ohPlayerPos`, `__ohFreeCam({e,u,s,yaw,pitch})`, `__ohGround(lat, lon)`,
  `__ohTime(hours)` (adds hours to the clock), `__ohCtl({throttle,…})`.
- Analysis scripts (read the install, print facts): `scripts/xplane/list-datarefs.ts` (every dataref the cockpit
  animates), `find-screens.ts` (display openings), `audit-acf.ts` (masses and speeds versus the sim).

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
