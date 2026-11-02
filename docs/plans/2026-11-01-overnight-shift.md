# Overnight shift — 2026-11-01

Standing instruction (user, asleep, no questions): work with Codex and X-Plane to
1. make every plane look perfect and its physics perfect;
2. make every airport 1:1 (runways, taxiways) with the real layouts;
3. give every plane that isn't the player's the good X-Plane 737-class graphics;
4. make the cockpit screens perfect;
5. then check everything.

## Lanes (so two agents never edit the same file)

| Lane | Owner | Files it may edit |
| --- | --- | --- |
| X-Plane cockpit (737 deck, panel bitmap, datarefs, interaction) | Claude | `src/render/xplane-*.ts`, `tests/xplane-*.test.ts`, the X-Plane block of `src/main.ts` |
| Traffic / AI aircraft graphics from X-Plane models | Claude | `src/render/traffic-layer.ts`, `src/render/traffic-model.ts` (new), `tests/traffic-*.test.ts` |
| Airports from X-Plane `apt.dat` | Claude | `server/apt-*.mjs` (new), `src/world/apt-*.ts` (new), `tests/apt-*.test.ts` |
| Flight-model calibration against each installed `.acf` | Codex (or Claude if Codex has not started) | `src/sim/aircraft/*.ts`, `tests/aircraft-*.test.ts` |
| Docs / CURRENT-STATE / DEVELOPMENT | Codex | `docs/*` (not this file) |

Rules: stage by explicit path, never `git add -A`; never commit another lane's
uncommitted files; keep `npm run validate` green; record every deviation in
`PROGRESS.md`; X-Plane assets are read from the local install at run time and
never copied into the repository.

## Status (update as lanes finish)

- [x] 737 deck: real panel mesh + bitmap, live PFD/ND/EICAS/ISFD, lit MCP windows/lamps/dials (04cdae5)
- [x] Traffic and AI aircraft drawn with the X-Plane exterior models, shared geometry, nearest 8 to the camera (166c367)
- [x] Airports from `Global Scenery/Global Airports/Earth nav data/apt.dat`: pavement polygons with holes, painted lines, taxi network for ground control, level terrain disk (fbd7fc5)
- [x] Cockpit: per-draw lamp/backlight levels (`ATTR_light_level`), night lighting (2004b84)
- [x] Cockpit: mouse operation through the airplane's own manipulators, tooltips (f48073d)
- [x] The player's own roster aircraft use the closest installed model, scaled (this commit); 3- and 4-engine types keep the procedural airframe
- [ ] Resting switch positions on the overhead; lower DU content; clocks; radio windows
- [ ] Runway ends / displaced thresholds / lights from apt.dat; signs; gate labels; parked aircraft at real ramp starts
- [ ] More installed aircraft as exact models (King Air C90B, SF50, RV-10, L-5, Lancair, Aerolite, R22, S-76)
- [ ] Per-airline liveries for traffic
- [ ] Final check: tsc, full tests, validate, build, fresh-clone run, browser verification
