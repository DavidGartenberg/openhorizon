# OpenHorizon

A browser-based flight simulator built with **Three.js** and **TypeScript** — real US terrain, real airports and airspace, live weather and traffic, a working ATC voice loop, and a small fleet of study-level aircraft, all running client-side against a small Express data server.

No native install, no plugin: open a tab and fly.

## Highlights

- **Real world data** — USGS elevation for the continental US, real airport/runway/frequency/navaid/airspace data, live METAR weather and NEXRAD radar, real satellite imagery and land cover.
- **Physics-driven flight model** — a 6-DOF rigid-body sim validated against real POH performance numbers, not scripted animations. Every gauge and annunciator reads live simulation state.
- **Small validated fleet** — Cessna 172S (full G1000 glass cockpit), Piper J-3 Cub, and Boeing 737-800, plus a wider roster of derived aircraft types for live traffic and AI.
- **ATC and traffic** — tower/ground/approach controllers with real frequencies and phraseology, free-text ATC you can type anything to, speech synthesis, AI pattern traffic, and live ADS-B traffic overlaid on the world.
- **Safety systems** — TCAS traffic advisories and TAWS/GPWS terrain warnings driven by the same flight data as the cockpit instruments.
- **Autopilot** — heading/nav/approach lateral modes, altitude/VS/FLC/glideslope vertical modes, coupled ILS approaches.
- **Flight recorder and grading** — a 10 Hz flight recorder, honest landing debriefs, an ACS-standards maneuver grader, a persistent pilot logbook, and scored landing challenges.
- **Cockpit polish** — a talking copilot with real callouts, animated flight controls and gear doors, exterior/interior lighting, and a from-scratch flight physics model tuned to fly the way the real airplane does.

## Getting started

Requires Node 20+.

```bash
npm install
npm run dev
```

This starts the Vite client (`:5173`) and the Express data server (`:8787`) together. Open `http://localhost:5173`.

For a production-style single-process run:

```bash
npm run build
node server/index.mjs
```

### Optional: Google Maps on the terrain

By default the terrain is draped with USGS satellite imagery (public domain, US only). The sim can instead drape Google's map layers worldwide through the official [Google Maps Platform Map Tiles API](https://developers.google.com/maps/documentation/tile), using your own key:

1. In Google Cloud, enable the **Map Tiles API** for a project with billing, create an API key and restrict it to that API.
2. Start the server with the key in its environment. The key stays on the server and is never sent to the browser.

   ```bash
   GOOGLE_MAPS_API_KEY=your-key npm run dev
   ```

3. In **View & graphics → Map layer**, choose *Google satellite*, *Google hybrid (roads + labels)* or *Google map*. You can also type `IMAGERY GOOGLE`, `IMAGERY MAP` or `IMAGERY USGS` in the command box.

Google's attribution is shown at the bottom left whenever a Google layer is visible. Tiles are cached only in memory, for no longer than Google's cache headers allow, and are never written to disk. Your use of the API is governed by the Google Maps Platform terms for your key. Without a key, the Google options are disabled and the sim uses USGS.

## Weather & physics

Beyond the POH-validated flight model, the sim models the air and the airframe. Everything is inert in calm, clear, dry air, so the validated numbers stay exactly as they are.

- **Turbulence**: MIL-F-8785C Dryden. Scale lengths and intensities vary with height, from the reported gusts and surface wind, and include roll gusts. Thunderstorms (TS, +TS, VCTS, heavy radar cells) and lee rotor downwind of ridges in strong wind add to it.
- **Thermals and ridge lift**: sun-driven thermals with a real life cycle, drifting with the wind, with sink between them. Ridge lift (and lee sink) comes from the wind over the terrain slope. Fair-weather **cumulus** cap the thermals when the air is moist enough. Gliders get a **total-energy variometer** with audio.
- **Microburst windshear**: type `MICROBURST`. Jets get the reactive "WINDSHEAR" alert, spoken.
- **Wake turbulence**: from AI and live traffic, as sinking, drifting, decaying vortex pairs that can roll you hard. The tower adds "caution wake turbulence" behind heavier traffic.
- **Airframe icing**: in cloud or freezing precipitation. It reduces CLmax and adds drag. Jets and turboprops have anti-ice (`ANTI-ICE ON|OFF|AUTO`). Others show an AIRFRAME ICE caution, and their windscreens frost.
- **Runway contamination**: wet, flooded, slush, snow or ice from the METAR, with braking-action friction and hydroplaning above 9·√p kt.
- **Structural limits**: certification-category g limits. Over the limit, the airframe is marked overstressed. Past the ultimate load, a wing fails.
- **Ground handling**: static tyre friction holds a braked airplane against wind and through a full-power run-up. A big enough gust can still weathervane or overturn an untied light airplane (a C172 goes at about 50 kt abeam). Gliders spawned on final come trimmed on the 3° path with the airbrakes part open.
- **Weather visuals**: wet and snow-covered terrain, glossy wet runways, rain and frost on the windscreen, falling rain and snow, lightning bolts with distance-delayed thunder, contrails (Schmidt–Appleman) and wingtip vapour, and touchdown tyre smoke. The View & graphics weather menu has Rain, Snow and Thunderstorm presets.

See [docs/shaders-and-physics.md](docs/shaders-and-physics.md) for every shader and physics model, where it lives and the test that checks it. Switch the models in **View & graphics → Realism** or with typed commands. Type `HELP` in the command box (`/`) for the full list. The landing debrief reports what the environment did on the flight (max g, overstress, windshear, ice, hydroplaning). Saves keep the airframe's condition.

**Performance**: **Frame rate** (Auto 60 / Auto 30 / Fixed) holds a frame-rate target by scaling resolution below the Quality setting. Quality also sets the terrain shader tier and shadow-map size. Far airport buildings and AI traffic drop out by distance, and coarse terrain rings skip the ground under finer ones (12% faster frames in a same-scene A/B). `PERF` shows per-section frame timing. `npm run bench` measures GPU-synchronised frame times on a fixed scene, attributes them by scene category, and runs same-scene A/B variants.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Vite client + Express data server, both with live reload |
| `npm run build` | Type-check and produce a production build in `dist/` |
| `npm test` | Full Vitest test suite |
| `npm run validate` | POH/fleet validation harness (physics accuracy gate) |
| `npm run smoke` | Headless browser smoke test: boot, and boot with the airport list unavailable; fails on page errors or a black 3D view (needs Playwright + Chromium) |
| `npm run bench` | Headless frame-time benchmark: GPU-synchronised frame times on a fixed scene, cost by scene category, same-scene A/B variants (`--ab nocull`) (needs Playwright + Chromium) |

## Architecture

- `src/sim/` — pure, headless simulation code: 6-DOF aircraft physics, autopilot, ATC logic, systems (fuel/electrical/engine), navigation. No DOM, no Three.js — fully unit-testable.
- `src/render/` — Three.js scene, aircraft meshes, cockpit interiors, camera modes, terrain/world rendering.
- `src/world/` — world data plumbing: terrain tiles, airports/navaids/airspace, live traffic.
- `src/cockpit/`, `src/ui/` — PFD/MFD/MCP canvas-drawn instruments and the debug HUD.
- `server/` — small Express server (and matching Vite dev middleware) proxying/caching terrain, imagery, weather, traffic, and airport data from public sources.
- `tests/` — ~80 Vitest suites covering the pure simulation layer, including a dedicated `tests/validate/` gate that checks flight performance against real POH numbers.
- `docs/` — the project's build contract (`FLIGHT-SIM-MASTER-PROMPT.md`) and phase-by-phase development plans.

`PROGRESS.md` is a running log of what's been built, what's been verified, and every honest deviation from "real" that was made along the way.

## Honesty policy

This project is built under a strict rule: never fake an instrument. If something can't be modeled accurately, it's either left honestly unimplemented (and marked INOP in the UI) or the deviation is written down in `PROGRESS.md` — not silently smoothed over. See `docs/FLIGHT-SIM-MASTER-PROMPT.md` for the full contract this codebase is held to.

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and note that this project follows a [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Found a security issue? Please don't open a public issue — see [SECURITY.md](SECURITY.md) for how to report it privately.

## License

This project is licensed under the [MIT License](LICENSE).
