# Development, verification and troubleshooting

Inspected against published baseline `a3d3879` and the following work described
in CURRENT-STATE, 2026-11-25. See
[CURRENT-STATE.md](CURRENT-STATE.md) for the latest recorded results, including
known failures. Commands below run from the repository root.

## Toolchain and startup

The repository setup calls for Node **20+**; use the audited Node 24 runtime on
this machine. It is Node **24.18.0**, npm **11.16.0**, installed at
`~/.local/node/bin`. The project has a committed `package-lock.json`.

```sh
cd "/Users/davidgartenberg/David Claude/openhorizon"
export PATH="$HOME/.local/node/bin:$PATH"
node --version
npm --version
npm ci
```

Run `npm ci` for a clean dependency installation when needed; avoid replacing an
existing dependency tree while another session is using it.

| Command | Behavior |
|---|---|
| `npm run dev` | Starts Vite at 5173 and standalone Express at 8787 concurrently |
| `npm run dev:client` | Vite alone, including the shared data/voice/local-asset middleware; sufficient for development |
| `PORT=5174 npm run dev:client` | Uses a separate Vite port; `strictPort` rejects conflicts |
| `OPENHORIZON_HMR=0 PORT=5174 npm run dev:client` | Disables HMR for a stable hardware/visual test session |
| `npm run build` | Runs `tsc --noEmit`, then Vite writes `dist/`; a type error prevents bundling |
| `node server/index.mjs` | Express on 8787; serves `dist/` when it exists at process startup |
| `PORT=8788 node server/index.mjs` | Runs the standalone host on another port |

Open the Vite origin at its selected port, or the standalone origin after a
successful build. Express's `/health` reports `{ ok, service, dist }`; Vite does
not define that health route. Restart Express if `dist/` was absent when the
process started. Vite development middleware is not installed by `vite preview`.

For QA, use a separate **origin**, such as localhost on another port.
Same-origin tabs share localStorage. Check for
already-running servers before starting/restarting one. Do not let source HMR,
forced respawns or controller calibration experiments disrupt a live flight.

Client code uses Vite HMR unless disabled. Express runs as a plain Node process,
without a file watcher; restart it after server changes. Shared server modules are
also cached by Node's ESM loader in the Vite process, so restart Vite when changing
those handlers rather than assuming client HMR reloads them.

## Verification

```sh
npm test
npm run validate
npm run build
```

Vitest is configured in `vite.config.ts` with Node environment and
`tests/**/*.test.ts`. `tsconfig.json` includes both `src` and `tests`, so untracked
test files participate in the normal tests and type-check. `npm test` already
includes `tests/validate/`; the explicit validation command provides a useful
separate physics/fleet result. It uses `--passWithNoTests`, so ensure the expected
validation cases actually ran rather than relying on the exit code alone.

Focused examples while developing:

```sh
npx vitest run tests/sim-purity.test.ts
npx vitest run tests/autopilot-gs-descent.test.ts tests/ap-panel-flight.test.ts tests/autoland-flight.test.ts
npx vitest run tests/controller-runtime.test.ts tests/controller-main.test.ts tests/tca-controller.test.ts
npx vitest run tests/voice-service.test.ts tests/voice-ptt.test.ts tests/spoken-aviation.test.ts
npx vitest run tests/dg800-simulation.test.ts tests/dg800-main.test.ts
```

Some integration tests extract actual functions from `main.ts` using the
TypeScript AST. Function boundaries/names can be part of these harnesses. Tests
under `tests/render/` may inspect real geometry without exercising a GPU; some
read installed X-Plane assets and skip when those assets are absent. Report skips
and dependency availability when moving to another machine.

Vitest caps concurrency at four workers in `vite.config.ts`; the full fleet
geometry suite passed with this setting after unrestricted workers starved two
heavy tests until their 60-second timeouts. Run build and full tests sequentially.
The cloud-shadow and mesh suites consume significant CPU. An unhandled worker
error makes the run fail even if its case summary lists passing tests.

GitHub CI uses Node 24 and a clean lockfile install on Ubuntu. It runs type-check,
full tests, validation and a production Vite build. Verify the PR's exact head SHA
and completed checks. Local-only regression files and installed original assets
change the test population, so record those differences when comparing runs.

For flight-law changes, verify a realistic long coupled scenario with actual
`Aircraft`, range/sign conventions and app wiring. A simple plant or short
frozen-altitude test does not establish stable ILS descent. For visual, audio or
hardware changes, additionally record representative browser, audible or physical
device evidence. Test counts alone do not establish full project acceptance.

### Browser inspection pages (Vite development server)

These are manual diagnostic tools, not automatically executed browser tests or
production-build pages. Prefix each path with the isolated Vite origin.

| Page | Purpose |
|---|---|
| `/tests/browser/aircraft-studio.html` | Selectable player models, cameras, surface motion and optional local exteriors |
| `/tests/browser/airport-studio.html` | Airport detail and scene inspection |
| `/tests/browser/graphics-lab.html` | Graphics inspection |
| `/tests/browser/terrain-inspection.html` | Terrain continuity, CPU/GPU probes and resource measurements |
| `/tests/browser/safety-studio.html` | Safety state/callout scenarios |
| `/tests/browser/system-check.html` | Browser speech/microphone/gamepad capabilities |
| `/tests/browser/webgl-context.html` | WebGL context checks |
| `/tests/browser/imported-audio.html` | Imported audio experiment; not proof of an integrated authored engine-audio runtime |
| `/tests/browser/xplane-airbus.html` | Local work-in-progress A330 donor cockpit, native/fitted placement and day/night panel inspection with deterministic diagnostic values |

### Main-page diagnostic hooks

Hooks are defined in main's `Object.assign(window, ...)`; inspect their signatures
before use. `?launcher=0` bypasses the launcher for automation. Hooks still need
loaded world data, and real UI paths deserve their own checks.

| Purpose | Hooks |
|---|---|
| Inspect flight/world | `__ohData()`, `__ohFleet()`, `__ohSystems()`, `__ohGraphics()`, `__ohPerf()`, `__ohTiles()`, `__ohJoy()` |
| Inspect local assets/scenery | `__ohXp()`, `__ohXpRead([...])`, `__ohXpHits(text)`, `__ohScenery()`, `__ohAptInfo(icao)` |
| Inspect guidance/navigation | `__ohApPanel()`, `__ohApState()`, `__ohNav()`, `__ohIls()`, `__ohAirspace()` |
| Inspect traffic/audio/recording | `__ohSafety()`, `__ohTraffic()`, `__ohAi()`, `__ohAudio()`, `__ohDebrief()`, `__ohLogbook()` |
| Drive a test | `__ohSpawn(query)`, `__ohRate(0\|1\|2\|4)`, `__ohStep(seconds)`, `__ohWind(dir,kt)`, `__ohCam(mode)` |
| Exercise panel/wiring | `__ohTune(fields)`, `__ohFpl(waypoints)`, `__ohApPress(action)`, `__ohApTurn(knob,steps)`, `__ohApMaster(on)` |
| Set direct test inputs | `__ohCtl(fields)`; no argument reads overrides, `null` clears; `__ohApMode(...)` owns targets until the next panel press |
| Other persistent/mutating tools | `__ohSave()`, `__ohLoad()`, `__ohLoading(selection)`, `__ohFail(name,on)` |

Pause between automation calls when needed; the worker can otherwise advance the
flight while tools run. To advance deterministically, set rate 1, step a bounded
interval and pause again in the same call. `__ohStep` honors the current sim rate,
so it does not move physics while paused. Do this only in an isolated test page.

## Data service and optional dependencies

The following table describes source configuration, not an online availability
check. Shared routes live in `server/handlers.mjs`, parsing in `server/parse.mjs`.

| API / route | Source and coverage / cache behavior |
|---|---|
| `/api/airports.json`, `/api/navaids.json`, `/api/frequencies.json` | Global OurAirports datasets; compact JSON and downloaded CSVs cached on disk |
| `/api/ils.json` | Global ILS parsed from the configured `earth_nav.dat` community mirror; disk cache; retain published antenna geometry where supplied |
| `/api/procedures/{ICAO}.json` | FAA CIFP procedures, not a global procedure database; discovers current download link on cold build, extracts `FAACIFP18` with system `unzip` |
| `/api/airspace.json` | US FAA ArcGIS feeds, compacted/cached US airspace |
| `/api/aircraft-types.json` | Community ICAO designator mirrors; committed `server/cache-seed/aircraft-types.json` is an offline fallback |
| `/api/metar?bbox=...` | AviationWeather METAR request; see handler for bbox format/caching |
| `/api/traffic?lat=...&lon=...` | adsb.lol, adsb.fi, OpenSky provider chain; 10-second bucket cache, global spacing, cooldowns and stale timestamps |
| `/api/osm/{ICAO}.json?lat=...&lon=...` | Overpass airport layout, reused indefinitely from memory/disk until manually refreshed; procedural scenery fallback when incomplete/unavailable |
| `/api/osm-buildings/14/{x}/{y}.json` | OpenFreeMap/OpenStreetMap building footprints and road exclusion geometry, versioned derived files in `server/cache/osm-bld/`, reused from disk |
| `/api/apt/{ICAO}.json`, `/api/apt-runways.json`, `/api/apt-extent.json`, `/api/apt-land.json`, `/api/apt-airports.json` | Optional installed X-Plane airport layouts, runway corrections, pavement extents, reclaimed-land masks and supplementary fields. Source/index/cache details in `server/apt.mjs` |
| `/proxy/terrain/{z}/{x}/{y}.png` | AWS Terrarium elevation tiles, disk-cached; not a fresh direct USGS DEM request |
| `/proxy/imagery/{z}/{x}/{y}` | USGS National Map imagery (US coverage); validates image bytes before disk caching |
| `/proxy/landcover/{z}/{x}/{y}.png` | MRLC NLCD 2021 lower-48 WMS, disk-cached |
| `/proxy/nexrad/{z}/{x}/{y}.png` | Iowa Environmental Mesonet national composite; five-minute in-memory TTL |
| `/api/voice/status`, `/api/voice/transcribe`, `/api/voice/speak` | Local speech service with its own loopback/origin checks; see [voice-atc.md](voice-atc.md) |
| `/xp/manifest.json`, `/xp/aircraft/<relative-path>` | Read-only optional installed X-Plane asset access; see below |

Dynamic regex routes match the full URL and can depend on query order/form.
Use the client-generated format before adding cache-buster parameters.

### Cache maintenance

`server/cache/` is ignored and created lazily; it is not a complete vendored world
dataset. Many static datasets are reused indefinitely from disk and module memory.
The FAA link is rediscovered only when its downloaded/parsed cache permits that
path; a current download index does not imply a current cached cycle.

For a deliberate refresh: identify the owning handler and cache files, stop the
affected server, move just those files to a backup, then restart and request that
dataset. Examples: OurAirports uses `global-airports.json` plus `airports.csv` and
`runways.csv`; CIFP uses `cifp-procedures.json` plus `cifp.zip`; ILS uses
`global-ils.json` plus `earth_nav.dat`. Removing only derived JSON can rebuild it
from the same old raw file. Restart clears module-level dataset variables. Do not
delete the whole cache: it can contain the Whisper model and costly tile downloads.
OSM layouts similarly reuse `osm-{ICAO}.json` without an age check; a one-week
HTTP cache header on that route does not expire the server's stored layout.
Network failure can leave a dataset unavailable; the aircraft-type seed is not a
fallback for all other APIs. No provider freshness was verified in this audit.

### Environment variables and local assets

| Variable | Meaning |
|---|---|
| `PORT` | Vite port (default 5173) or direct Express port (default 8787). `npm run dev:server` explicitly sets 8787 |
| `OPENHORIZON_HMR=0` | Disable Vite hot module reload |
| `XPLANE_DIR` | Laminar Research **aircraft folder**, default `/Users/davidgartenberg/X-Plane 12/Aircraft/Laminar Research` |
| `XPLANE_ROOT` | X-Plane installation root used for `apt.dat` and Custom Scenery. Defaults to two directories above `XPLANE_DIR` |
| `OPENHORIZON_WHISPER_BIN` | Local whisper CLI, default `/opt/homebrew/bin/whisper-cli` |
| `OPENHORIZON_WHISPER_MODEL` | Local GGML model, default `server/cache/speech/ggml-base.en.bin` |

The server reads these from `process.env`; there is no Express `.env` loader.
Pass/export them in the shell. No cloud API key is required by the checked-in
configuration. Optional speech tools and local aircraft files are not installed
by `npm ci`.

X-Plane files stream from disk through the allow-listed static route. Install
them separately. Player exteriors currently support exact assets and scaled
donors, as recorded by `localModelFor(key).exact`. Unsupported or failed
loads keep procedural player exteriors. Airbus variants retain their own
exterior while fitting the A330 cockpit. Boeing variants other than the exact
737-800 retain their geometry and receive projected B738 texture charts; the
projected materials remove their previous procedural paint maps. See
[X-Plane integration](xplane-integration.md) for the current mapping and limits.
Keep installed originals intact and exclude their bytes and derived artwork
from source control.
Some original-asset tests use machine-specific paths; setting `XPLANE_DIR` for the
server does not automatically relocate every test fixture. User-provided licensed
aural clips under `public/audio/boeing-custom/` are ignored except the README.
See the audio READMEs before modifying packs or generation scripts.

## Persistence and controls

The browser's localStorage holds simulator settings and progress. Main keys
include `oh-save`, `oh-aircraft`, `oh-gamepad-map`, `oh-loading-preferences`,
`oh-logbook`, `oh-challenges`, `oh-imagery`, `oh-live-traffic`, `oh-ai-density`,
`oh-instruments`, `oh-fov`, `oh-flight-info`, `oh-last-departure`, and window
positions under `oh-win-*`. `oh-frame-mode` selects rendering pace, `oh-fx` stores
AO/lens/cloud-shadow/building/tree switches, and `oh-voice-my-calls` controls pilot
speech. The local material work adds `oh-material-finish`. Pending cross-aircraft
launches use sessionStorage
(see `PENDING_LAUNCH_KEY` in `src/ui/shell/launcher.ts`). Saving/loading restores a
trimmed flight state, not arbitrary mid-maneuver angular rates; inspect snapshot
schema/migration before changing aircraft or flap metadata. Keep controller
calibration and pilot logbook data when troubleshooting; do not clear all storage.

Key bindings live in `src/input/input.ts`, `main.ts::handleDiscreteKeys`, the
launcher key handler and PTT bindings. Common bindings now are:

| Key | Action |
|---|---|
| M or N | Launcher / aircraft selection |
| Q | Engine-sound mute toggle (old logs saying M are historical) |
| Space; 1 / 2 / 3 | Pause/resume; 1× / 2× / 4× when ATC menu is closed |
| C; / | Cycle camera; command/search box |
| Y; X | AP toggle; stability-assist cycle |
| J | Controller panel/calibration |
| F / G; U | Flaps next/previous detent; retractable gear |
| O / P; R | Save/load; respawn (mutates flight) |
| T; backquote | Push-to-talk; ATC menu |
| Shift+B | Parking brake |

Hardware and keyboard paths share some aliases but also have dedicated lever and
button semantics. Verify neutral/reverse detents, focus/blur, disconnect/reconnect,
fresh presses vs latched switches and actual surface state; stored calibration
and a screenshot of the panel do not establish physical control acceptance.

## Troubleshooting map

| Symptom | First checks |
|---|---|
| Node/npm unavailable | Prepend `~/.local/node/bin` and confirm versions |
| Port already used | Inspect/reuse the intended server or choose a separate port; preserve live sessions |
| Standalone API works but no UI | `/health` `dist` flag; successful build; restart if dist was absent at boot |
| Browser shows old visuals | Correct origin/process; whether a failed build left old dist; HTML revalidation vs immutable hashed assets |
| Terrain/airport/weather absent | Network response and JSON error; provider-specific cache/source; distinguish missing data from rendering failure |
| Uncommanded thrust/control movement | `__ohJoy`, panel diagnostics, physical levers, stored map, `__ohCtl()`, AP/A/T/assist state before tuning physics |
| Frozen or divergent flight | Console/frame error, finite state, sim rate, stale overrides, guidance sign/range, actual long-run repro |
| Voice unavailable | Secure localhost, permissions, `/api/voice/status`, local tools/model vs browser recognition support; typed ATC remains available |
| Silent sound | User gesture/audio unlock, mute, permissions, speech priority and actual playback; node-graph inspection is insufficient |
| DG800 test/type errors | Known local baseline in CURRENT-STATE and [DG800 review](plans/sept13/dg800-simulation-review.md); preserve regression files |
