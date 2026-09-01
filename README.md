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

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Vite client + Express data server, both with live reload |
| `npm run build` | Type-check and produce a production build in `dist/` |
| `npm test` | Full Vitest test suite |
| `npm run validate` | POH/fleet validation harness (physics accuracy gate) |

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

## License

No license file is currently included — all rights reserved by default. Contact the repository owner before reusing this code.
