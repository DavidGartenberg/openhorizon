import { FixedTimestepLoop, type SimRate } from './sim/loop'
import { Aircraft } from './sim/aircraft'
import { WindModel } from './sim/wind'
import { parseMetar } from './sim/weather/metar'
import { blendWeather, type StationWeather, type BlendedWeather } from './sim/weather/weather'
import { cloudSlabs, inCloudFactor, type CloudSlab } from './sim/weather/clouds-model'
import { Clouds } from './render/clouds'
import { NexradField } from './world/nexrad'
import { CommsBus, isAudible, type Transmission } from './sim/atc/comms'
import { AiPatternPilot } from './sim/traffic/ai-pilot'
import { LiveTrafficStore, type LiveTargetWire } from './sim/traffic/live'
import { TcasComputer } from './sim/tcas'
import { TawsComputer } from './sim/taws'
import { FlightRecorder, analyzeLanding, type RunwayRef } from './sim/recorder'
import { buildAtis } from './sim/atc/atis'
import { TowerController, pilotPhrase, type PilotRequestKind, type TrafficView } from './sim/atc/tower'
import { GroundController } from './sim/atc/ground'
import { trim } from './sim/trim'
import { FT, KT, isa, kcasFromKias, indicatedAltitudeFt } from './sim/atmosphere'
import { C172S } from './sim/aircraft/c172s'
import { bearingDeg, distanceM, windDirFromNed, type LatLon } from './math/geo'
import { createScene } from './render/scene'
import { SkyDome } from './render/sky'
import { Ocean } from './render/ocean'
import { FlyCamera } from './render/camera'
import { ChaseCamera } from './render/chase-camera'
import { OrbitCamera } from './render/orbit-camera'
import { CockpitCamera } from './render/cockpit-camera'
import { buildC172, buildCub, buildB738, updateProp, type AircraftMesh } from './render/aircraft-mesh'
import { PlaneMenu } from './render/plane-menu'
import { loadIls, ilsLoaded, ilsCount } from './world/ils'
import { osmIdentSegs } from './world/osm-layout'
import { routeIdents } from './sim/atc/ground'
import { interpretTransmission } from './sim/atc/freetext'
import { ApproachController, HANDOFF_GATE_M } from './sim/atc/approach'
import { buildAirliner, airlinerCfgFor } from './render/airliner-mesh'
import type { AircraftParams } from './sim/aircraft/params'
import { J3CUB } from './sim/aircraft/j3cub'
import { B738 } from './sim/aircraft/b738'
import { makeCarbIceState, stepCarbIce, carbIcePowerFactor } from './sim/systems/carb-ice'
import { loadAircraftTypes, aircraftTypesLoaded, aircraftTypeCount, typeInfo, parseDesc } from './world/aircraft-types'
import * as THREE from 'three'
import { archetypeFor } from './world/fleet-map'
import { buildArchetype, buildArchetypeShip } from './render/fleet-mesh'
import { ShadowCatcher } from './render/shadow-catcher'
import { AircraftLights } from './render/aircraft-lights'
import { ReplayView } from './render/replay-view'
import { buildReplayPlots } from './sim/replay'
import { TrafficLayer } from './render/traffic-layer'
import { ROSTER, rosterParams } from './sim/aircraft/roster'
import type { ArchetypeSpec } from './world/fleet-map'
import { buildCockpit, panelLayoutFor, updateCockpitControls, updateCockpitDisplays, updateEicas, updateMcp, CockpitInteraction, type SwitchId } from './render/cockpit'
import type { PfdInput } from './cockpit/pfd'
import { Input } from './input/input'
import { EngineSound } from './audio/engine-sound'
import { Hud } from './ui/hud'
import { WorldFrame, TileManager } from './world/tiles'
import { Airports, type AirportData, type RunwayData } from './world/airports'
import { makeElectricalState, stepElectrical } from './sim/systems/electrical'
import { c172WeightBalance, C172S_ENVELOPE } from './sim/weight-balance'
import { applyDeadzone, axisToUnipolar, detectMovedAxis, detectPressedButton, leverWithReverse, parseGamepadMap, serializeGamepadMap, tcaPresetFor, DEFAULT_SINGLE_STICK, TCA_PRESET_VERSION, HELD_ALIASES, type BindableAxis, type BindableButton, type GamepadMap } from './sim/gamepad-map'
import { makeFuelState, stepFuel, type FuelSelector } from './sim/systems/fuel'
import { PitotStaticSystem } from './sim/systems/pitot'
import { stepEngineStart, type EngineStartState, type MagnetoPosition } from './sim/systems/engine-start'
import { makeEngineTemps, stepEngineTemps } from './sim/systems/engine-temps'
import { NavaidsIndex } from './sim/nav/navaids'
import { FlightPlan, gpsCdiDeflection, determinePhase, activeLegProgress } from './sim/nav/gps'
import { airspacesContaining, type AirspacePolygon } from './sim/nav/airspace'
import { makeAutopilotState, stepAutopilot, disconnect as disconnectAutopilot, type LateralMode, type VerticalMode } from './sim/autopilot'
import {
  findTunedVor, vorCdiFraction, ilsRefFromRunwayThreshold, localizerFraction, glideslopeFraction, findKnownIls,
  ilsOnFinal, NO_NAV_RESULT, type TunedNavResult,
} from './sim/nav/tuning'
import { finiteOr } from './sim/guards'
import { copilotCallouts, copilotSpeedsFor, makeCopilotLatches, type CopilotObs } from './sim/copilot'

const KHAF = { lat: 37.5134, lon: -122.5011 }

const app = document.getElementById('app')
if (!app) throw new Error('missing #app element')

const { renderer, scene, camera } = createScene(app)
const input = new Input(renderer.domElement)
const engineSound = new EngineSound()
// Browsers gate audio behind a user gesture; unlock() is idempotent so the
// listeners stay attached (they also resume a tab-suspended context).
window.addEventListener('pointerdown', () => engineSound.unlock())
window.addEventListener('keydown', () => engineSound.unlock())
const sky = new SkyDome(scene)
const ocean = new Ocean(scene)
const clouds = new Clouds(scene)
const hud = new Hud()
const loop = new FixedTimestepLoop(120)

const frame = new WorldFrame(KHAF)
const airports = new Airports(scene, frame)
const tiles = new TileManager(scene, frame, (s, n, w, e) => airports.runwaysInBounds(s, n, w, e))
// Satellite imagery (13b) defaults ON; `IMAGERY OFF` persists across loads.
try { if (localStorage.getItem('oh-imagery') === 'OFF') tiles.setImagery(false) } catch { /* private mode */ }

// ---- Phase 4: nav/airspace data loading. `NavaidsIndex`/`airspacesContaining`
// are pure `/sim` modules (§4.1) that don't fetch themselves — this mirrors
// `Airports.load()`'s "caller fetches JSON, hands the parsed array to the
// pure holder" pattern, just without a dedicated class (there's no three.js-
// side rendering/spatial-index need for navaids/airspace the way there is
// for airports/runways).
const navaidsIndex = new NavaidsIndex()
let airspacePolygons: AirspacePolygon[] = []
fetch('/api/navaids.json')
  .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`navaids: HTTP ${res.status}`))))
  .then((data) => navaidsIndex.load(data))
  .catch((err) => console.error('navaid data failed to load:', err))
fetch('/api/airspace.json')
  .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`airspace: HTTP ${res.status}`))))
  .then((data) => {
    airspacePolygons = data as AirspacePolygon[]
  })
  .catch((err) => console.error('airspace data failed to load:', err))

/** CIFP procedure JSON, fetched on demand per airport (not all at boot —
 *  there could be many airports' worth of procedures, per the phase plan's
 *  explicit "on demand" instruction) and cached once loaded. */
const procedureCache = new Map<string, unknown>()
async function loadProcedures(icao: string): Promise<unknown> {
  const cached = procedureCache.get(icao)
  if (cached) return cached
  const res = await fetch(`/api/procedures/${icao}.json`)
  if (!res.ok) throw new Error(`procedures ${icao}: HTTP ${res.status}`)
  const json = await res.json()
  procedureCache.set(icao, json)
  return json
}

// ---- Fleet selection (Phase 11g): `FLY 172|CUB|737` in the search box.
// Selection persists and takes effect via reload — an honest "respawn
// required", not a live-swap of a flying airframe. ----
const FLEET: Record<string, {
  params: AircraftParams
  label: string
  build: () => ReturnType<typeof buildC172>
  /** onFinal spawn config: approach CAS + flap detent/angle (+gear). */
  final: { kias: number; flapsIndex: number; flapsDeg: number }
}> = {
  '172': { params: C172S, label: 'Cessna 172S', build: buildC172, final: { kias: 70, flapsIndex: 1, flapsDeg: 10 } },
  CUB: { params: J3CUB, label: 'Piper J-3 Cub', build: buildCub, final: { kias: 50, flapsIndex: 0, flapsDeg: 0 } },
  '737': { params: B738, label: 'Boeing 737-800', build: buildB738, final: { kias: 140, flapsIndex: 5, flapsDeg: 30 } },
}
/** Archetype pick for a Tier-B roster entry (spec-exact sizes). */
function rosterArchetype(entry: (typeof ROSTER)[number]): ArchetypeSpec {
  const sp = entry.spec
  const pp = sp.powerplant
  const arch =
    pp.kind === 'none' ? 'glider'
    : pp.kind === 'jet' ? (sp.mtowKg > 120_000 ? 'widebody' : sp.mtowKg > 30_000 ? 'narrowbody' : 'bizjet')
    : pp.kind === 'turboprop' ? (pp.count > 1 ? 'twin-turboprop' : 'single-turboprop')
    : pp.count > 1 ? 'twin-piston'
    : sp.gear.layout === 'taildragger' ? 'taildragger'
    : 'ga-low-wing'
  return { archetype: arch, spanM: sp.spanM, lengthM: sp.lengthM, engines: pp.kind === 'none' ? 0 : pp.count, quad: pp.kind === 'jet' && pp.count >= 4 }
}

const fleetKey = ((): string => {
  try {
    const k = localStorage.getItem('oh-aircraft') ?? '172'
    if (FLEET[k]) return k
    if (ROSTER.some((r) => r.spec.designator === k)) return k
    return '172'
  } catch {
    return '172'
  }
})()
const FLEET_ACTIVE = ((): (typeof FLEET)[string] => {
  if (FLEET[fleetKey]) return FLEET[fleetKey]!
  const entry = ROSTER.find((r) => r.spec.designator === fleetKey)!
  const params = rosterParams(fleetKey)!
  const lastIdx = entry.spec.flapDetentsDeg.length - 1
  return {
    params,
    label: `${entry.spec.label} (Tier B)`,
    build: entry.opts.cd0Class === 'airliner' || entry.opts.cd0Class === 'bizjet'
      ? () => buildAirliner(airlinerCfgFor(entry.spec))
      : () => buildArchetypeShip(rosterArchetype(entry)),
    final: {
      kias: entry.spec.vSpeeds.approachKcas,
      flapsIndex: lastIdx,
      flapsDeg: entry.spec.flapDetentsDeg[lastIdx]!,
    },
  }
})()

loadAircraftTypes() // Phase 12a: Doc-8643 registry (traffic typing)
loadIls() // N4: global ILS table (offline seed until it lands)

const aircraft = new Aircraft(FLEET_ACTIVE.params)
aircraft.groundElevAt = (n, e) => {
  const ll = frame.fromLocal(n, e)
  return airports.flattenElevation(tiles.elevationAt(ll.lat, ll.lon), ll.lat, ll.lon)
}
const mesh = FLEET_ACTIVE.build()
// N1: aircraft menu (M or N) — selection respawns via the FLY path.
const planeMenu = new PlaneMenu((key) => {
  try { localStorage.setItem('oh-aircraft', key) } catch { /* private mode */ }
  location.reload()
}, fleetKey) // fleetKey is the validated, private-mode-safe read of 'oh-aircraft'
window.addEventListener('keydown', (e) => {
  if (planeMenu.isOpen) {
    if (planeMenu.handleKey(e.code)) { e.preventDefault(); e.stopImmediatePropagation() }
    return
  }
  if ((e.code === 'KeyM' || e.code === 'KeyN') && document.activeElement?.tagName !== 'INPUT') {
    planeMenu.open()
    e.preventDefault()
    e.stopImmediatePropagation()
  }
}, { capture: true })
const shadowCatcher = new ShadowCatcher(scene)
scene.add(mesh.group)
// 13c: exterior lights (nav/beacon/strobe glow points + landing spot).
const aircraftLights = new AircraftLights(scene)
aircraftLights.attach(mesh.group)
// 14d: live-traffic silhouettes + labels.
const trafficLayer = new TrafficLayer(scene)
// 16d: replay viewer (REPLAY verb).
const replayView = new ReplayView()
const cockpit = buildCockpit(mesh.group, panelLayoutFor(fleetKey, FLEET_ACTIVE.params.trimIsStabilizer ?? false))
const cockpitInteraction = new CockpitInteraction(camera)

const wind = new WindModel()
const chase = new ChaseCamera(camera)
// Chase camera terrain clamp: render x = east, z = south → NED n = −z, e = x.
chase.setGroundProbe((x, z) => aircraft.groundElevAt?.(-z, x) ?? 0)
chase.setSizeScale(Math.max(FLEET_ACTIVE.params.spanM / 11, 1))
const orbit = new OrbitCamera(camera)
const freeCam = new FlyCamera(camera)
const cockpitCam = new CockpitCamera(camera)
// Per-layout eyepoint (Slice 3): GA eye under the C172 cabin top;
// transport eye above the re-seated 737/Airbus glareshield.
cockpitCam.setEye(panelLayoutFor(fleetKey, FLEET_ACTIVE.params.trimIsStabilizer ?? false) === 'g1000' ? 'ga' : 'transport')
let cameraMode: 'chase' | 'orbit' | 'free' | 'cockpit' = 'chase'
const DEFAULT_NEAR = camera.near // 0.5 m (scene.ts) — correct for exterior views
const COCKPIT_NEAR = 0.02 // cockpit controls sit centimeters from the eyepoint

// ---- systems (Phase 3 §8): electrical, fuel, pitot-static, engine-start,
// engine temps. None of this touches aero/gear/6-DOF math — it only feeds
// `aircraft.engineRunning` and cockpit gauge truth. Wired into the fixed-
// timestep loop in `advanceFrame` below. `engineStartState` is seeded
// 'running' (not the cold-and-dark 'stopped' default the state machine
// itself starts at) so existing verified spawn/takeoff behavior — which
// assumes a running engine at spawn, e.g. the ground-yaw flight-assist
// fix — is unaffected; cold-and-dark is fully reachable by turning the
// ignition key/battery off via the cockpit switches or __ohFail, it's just
// not the boot default. See task report for the full rationale.
const electricalState = makeElectricalState()
// Fuel ledger sized to the ACTIVE aircraft (user-found: the A320neo
// flamed out after four minutes — every non-C172 type was flying on the
// C172's 144 kg tank ledger while burning jet fuel flows through it).
// Full tanks, capped so spawn mass stays under 97% MTOW (same rule as
// the fleet-takeoff lattice). C172 numbers land bit-exact on the old
// default.
// FULL tanks for the active type (user: "add the fuel to the max for
// each plane"). A few heavies can sit above MTOW with full fuel and no
// payload — that's real ramp behavior; the fleet-takeoff tests defuel
// themselves and are unaffected.
const initialFuelPerSideKg = FLEET_ACTIVE.params.fuelCapacityKg / 2
const fuelState = makeFuelState(initialFuelPerSideKg, initialFuelPerSideKg)
const pitotSystem = new PitotStaticSystem()
// Boot default: engine already running (see comment above) rather than the
// cold-and-dark default `makeEngineStartState()` would give. Shared with
// `resetSystemsState` below so respawn seeds the exact same values instead
// of a second, hand-maintained "normal" state.
const ENGINE_START_BOOT_RUNNING: EngineStartState = { status: 'running', rpm: 700, crankTimeS: 0 }
const engineStartState: EngineStartState = { ...ENGINE_START_BOOT_RUNNING }

// ---- Fleet systems state (11g) ----
const carbIceState = makeCarbIceState()
let carbHeatOn = false
let handPropRequested = false
/** Temp−dewpoint spread (°C) from the nearest METAR; large = dry air.
 *  Feeds the carb-ice humidity factor; 12 (dry) until weather arrives. */
let wxTempDewSpreadC = 12
const engineTemps = makeEngineTemps()

/** Cockpit switch/knob/selector state — mirrors how `aircraft.controls`
 *  already works, but for systems that live outside `Aircraft` (§ plan:
 *  "a parallel SystemsControls lives with SystemsState"). Both the
 *  keyboard/mouse flight controls (`pollControls`) and the 3D cockpit
 *  click/drag (`cockpitInteraction`) write into this and `aircraft.controls`
 *  side by side — this task adds a second input path, it doesn't replace
 *  the first. */
type SystemsControls = {
  masterBattery: boolean
  masterAlternator: boolean
  avionicsSwitch: boolean
  pitotHeat: boolean
  magneto: MagnetoPosition
  starterEngaged: boolean
  fuelSelector: FuelSelector
  boostPumpOn: boolean
  /** GFC700 autopilot master engage/disengage (Phase 4 Task 6) — a real
   *  physical cockpit switch, unlike the mode-select targets below it
   *  which are debug-hook-only this task (see `apTargets`' doc). */
  apMaster: boolean
}
// Shared with `resetSystemsState` below so a respawn puts these switches
// back to the same "just started" defaults the sim boots with.
const SYSTEMS_CONTROLS_DEFAULT: SystemsControls = {
  masterBattery: true,
  masterAlternator: true,
  avionicsSwitch: true,
  pitotHeat: false,
  magneto: 'both',
  starterEngaged: false,
  fuelSelector: 'BOTH',
  boostPumpOn: false,
  apMaster: false,
}
const systemsControls: SystemsControls = { ...SYSTEMS_CONTROLS_DEFAULT }

// ---- Phase 4 Task 6: radio/GPS/autopilot state ----

/** NAV1/NAV2/COM1/COM2 flip-flop frequency state + OBS course selectors.
 *  NAV1/COM1 get physical 3D-cockpit tuning knobs (`render/cockpit.ts`);
 *  NAV2/COM2 are modeled state without a physical control this task (scope
 *  cut — see task report). Boot frequencies are arbitrary in-band defaults,
 *  not tied to any real station until the pilot tunes one. */
const radios = {
  nav1: { activeMhz: 109.55, standbyMhz: 115.8 },
  nav2: { activeMhz: 112.3, standbyMhz: 112.3 },
  com1: { activeMhz: 118.0, standbyMhz: 121.5 },
  com2: { activeMhz: 122.8, standbyMhz: 122.8 },
  obs1Deg: 0,
  obs2Deg: 0,
}

/** Minimal flight plan (`gps.ts`'s `FlightPlan`) — no FPL-entry UI this task
 *  (MFD's FPL page stays a visual skeleton per Phase 3's disclosed gap,
 *  per the task brief's explicit scope guidance); populated via the
 *  `__ohFpl` debug hook for verification, empty by default. */
const flightPlan = new FlightPlan()

/** GFC700 autopilot state + mode-select targets. No physical mode-select
 *  panel this task (scope cut, see task report) — modes/targets are set via
 *  the `__ohApMode` debug hook, mirroring the existing `__ohFail`/`__ohWind`
 *  hook pattern. AP master engage/disengage IS a physical cockpit switch
 *  (`systemsControls.apMaster`, wired through `CockpitInteraction`). */
const apState = makeAutopilotState()
const apTargets = {
  lateralMode: 'ROL' as LateralMode,
  verticalMode: 'PIT' as VerticalMode,
  headingBugDeg: 0,
  altitudeBugFt: 0,
  vsTargetFpm: 0,
  iasTargetKt: 90,
  bankCommandDeg: 0,
  pitchCommandDeg: 0,
}

/** Scenario/failure flags — the debug-hook side of the failures the phase
 *  plan calls out (`__ohFail`); no in-sim UI to trigger these yet (that's
 *  Phase 9 per the phase plan's recorded cuts). */
const failures = { alternatorFailed: false, icingConditions: false, staticBlocked: false }

/** Resets every Phase 3 §8 systems-state object to its boot-time default.
 *  Called on respawn (KeyR / search-spawn) so draining a tank, killing the
 *  battery, or stopping the engine via the cockpit switches doesn't leave a
 *  fresh airframe stuck with stale/dead systems state (§ task review finding:
 *  respawn didn't reset `fuelState`/`electricalState`/`engineStartState`,
 *  only `Aircraft`'s own fields). Mirrors the module-scope boot seeding above
 *  exactly (reuses the same defaults/constants) rather than inventing a
 *  second "normal" state. */
function resetSystemsState(): void {
  Object.assign(fuelState, makeFuelState(initialFuelPerSideKg, initialFuelPerSideKg)) // full tanks for THIS type — bare makeFuelState() reset every plane to C172 tanks (the A320 flameout)
  Object.assign(electricalState, makeElectricalState())
  Object.assign(engineStartState, ENGINE_START_BOOT_RUNNING)
  Object.assign(engineTemps, makeEngineTemps())
  Object.assign(systemsControls, SYSTEMS_CONTROLS_DEFAULT)
  failures.alternatorFailed = false
  failures.icingConditions = false
  failures.staticBlocked = false
  disconnectAutopilot(apState)
  // 9A/9B respawn leaks: a fully-iced carburetor survived respawn
  // (silently powerless engine), and control overrides / wing-leveler /
  // baro / landing light all carried into the new flight.
  Object.assign(carbIceState, makeCarbIceState())
  carbHeatOn = false
  aircraft.spoilerCmd = 0
  aircraft.spoilerArmed = false
  aircraft.reverseCmd = false
  aircraftLights.landingOn = false
  baroSetInHg = 29.92
  ctlOverride = null
  holdWingsLevel = false
}
let parkingBrake = false
// Default OFF per §17 ("assists default OFF") — the ground-yaw hold is
// verified (±5.7° drift, within tolerance), but the airborne climb-hold
// is not: it delays but doesn't prevent settling back to the runway after
// a hands-off rotation (phugoid-like — needs a staged attitude→airspeed
// controller, not more gain tuning). Don't default-on an assist that can
// still fly a hands-off climb into the ground.
let assistOn = false
/** Runway heading captured at the start of the takeoff roll (ground assist
 *  holds it — a pure yaw-rate damper can't null the P-factor/torque bias,
 *  it only slows the turn, so heading still drifts under constant torque). */
let groundHeadingLockDeg: number | null = null
/** Climb pitch attitude captured when the pilot releases pitch control
 *  airborne (assist holds it — see the airborne assist branch below). */
let airbornePitchLockDeg: number | null = null
let spawnDesc = 'boot'

// ---- spawning ----

function pickRunway(ap: AirportData, ident?: string): { r: RunwayData; fromHigh: boolean } {
  const byIdent = ident
    ? ap.r.map((r) => ({ r, fromHigh: r.hi === ident })).find(({ r, fromHigh }) => (fromHigh ? r.hi === ident : r.li === ident) || r.hi === ident || r.li === ident)
    : undefined
  if (byIdent) return { r: byIdent.r, fromHigh: byIdent.r.hi === ident }
  const longest = [...ap.r].sort((a, b) => b.l - a.l)[0]!
  return { r: longest, fromHigh: false }
}

function spawnAtAirport(ap: AirportData, rwyIdent?: string, onFinal = false): void {
  aircraft.crashed = false
  resetSystemsState()
  // Copilot latches reset with the flight (Slice 4) — a respawn is a new
  // leg; without this the callouts stay spent from the previous one.
  copilotLatches = makeCopilotLatches()
  copilotPrev = null
  // 9A: pending controller replies die with the flight they answered.
  cancelAtcTimers()
  // 9A: an airborne respawn used to LOG A LANDING — the teleport
  // discontinuity read as a touchdown and fabricated a logbook entry
  // (and challenge best). The recorder starts clean with the flight.
  recorder.reset()
  flightStartSimS = null
  lastOnGround = true
  debriefLine = ''
  const { r, fromHigh } = pickRunway(ap, rwyIdent)
  const thr = fromHigh ? { lat: r.la2, lon: r.lo2, e: r.e2 } : { lat: r.la1, lon: r.lo1, e: r.e1 }
  const far = fromHigh ? { lat: r.la1, lon: r.lo1, e: r.e1 } : { lat: r.la2, lon: r.lo2, e: r.e2 }
  const hdg = bearingDeg({ lat: thr.lat, lon: thr.lon }, { lat: far.lat, lon: far.lon })
  // Rebase the world to the airport.
  frame.anchor = { lat: ap.la, lon: ap.lo }
  tiles.onRebase()
  airports.positionAll()

  if (!onFinal) {
    const p = frame.toLocal(thr.lat, thr.lon)
    const hRad = (hdg * Math.PI) / 180
    const spawnN = p.n + Math.cos(hRad) * 120
    const spawnE = p.e + Math.sin(hRad) * 120
    // Runways can have real longitudinal grade (e.g. KHAF 30: 36→59 ft over
    // 5000 ft) — use the flattened elevation at the actual spawn point, not
    // the threshold's, or the gear model finds itself embedded in the slope.
    const elevM = aircraft.groundElevAt?.(spawnN, spawnE) ?? thr.e * FT
    aircraft.spawnOnGround(spawnN, spawnE, hRad, elevM)
  } else {
    // Final-approach spawn at the ACTIVE aircraft's approach config (11g):
    // 3 nm (5 nm for the jet) at a -3° path, gear down.
    const fin = FLEET_ACTIVE.final
    const distM = (aircraft.P.jet ? 5 : 3) * 1852
    const hRad = (hdg * Math.PI) / 180
    const p = frame.toLocal(thr.lat, thr.lon)
    const n = p.n - Math.cos(hRad) * distM
    const e = p.e - Math.sin(hRad) * distM
    const altM = thr.e * FT + distM * Math.tan(0.0524)
    // TAS at the FIELD's density (a sea-level conversion spawned ~8 kt slow
    // at Tahoe — Phase-7 finding). Per-aircraft pitot cal; none = IAS=CAS.
    const kcas = aircraft.P.pitotCal ? kcasFromKias(fin.kias, fin.flapsDeg, aircraft.P.pitotCal) : fin.kias
    const tas = kcas * KT * Math.sqrt(1.225 / isa(altM).densityKgM3)
    const gearCd = aircraft.P.gearRetractable ? aircraft.P.gearRetractable.dCdExtended : 0
    const t = trim({ tasMs: tas, altM, massKg: aircraft.massKg, flapsDeg: fin.flapsDeg, gammaRad: -0.052, params: aircraft.P, extraCd: gearCd, isaTempOffsetC: aircraft.isaTempOffsetC })
    aircraft.flapsDeg = fin.flapsDeg
    aircraft.controls.flapsIndex = fin.flapsIndex
    aircraft.gearDownCommanded = true
    aircraft.gearPos = 1
    aircraft.applyTrimState(tas, t.alphaRad, altM, hRad, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
    aircraft.posNed.x = n
    aircraft.posNed.y = e
  }
  aircraft.controls.brakeLeft = aircraft.controls.brakeRight = 0
  if (!onFinal) {
    // Ground spawns start with a clean cockpit: stale trim/flaps/throttle
    // from a previous flight made a KSFO 1L takeoff refuse to rotate at 65
    // KIAS (found by the §27 flight; KeyR always did this — search-box and
    // hook spawns must too). applyTrimState covers the onFinal branch.
    aircraft.controls.throttle = 0
    aircraft.controls.trim = 0
    aircraft.controls.flapsIndex = 0
    aircraft.controls.pitch = aircraft.controls.roll = aircraft.controls.yaw = 0
    aircraft.flapsDeg = 0
    aircraft.gearDownCommanded = true
    aircraft.gearPos = 1
  }
  parkingBrake = !onFinal // hold position on ground spawns until power-up
  setDaytimeAt(ap.lo)
  spawnDesc = `${ap.i} ${rwyIdent ?? ''}${onFinal ? ' final' : ''}`.trim()
  tiles.update(aircraft.posNed.x, aircraft.posNed.y)
  airports.updateVisuals(frame.anchor.lat, frame.anchor.lon)
}

// ---- Phase 8d: landing challenges (§21) — three real hard strips,
// launched from the search box, scored by the landing analyzer. ----
const CHALLENGES: Record<string, { icao: string; rwy: string; name: string }> = {
  CATALINA: { icao: 'KAVX', rwy: '22', name: 'Catalina cliff runway' },
  ASPEN: { icao: 'KASE', rwy: '15', name: 'Aspen valley approach' },
  TAHOE: { icao: 'KTVL', rwy: '18', name: 'Lake Tahoe density altitude' },
}
let challengeActive: string | null = null
let challengeBest: Record<string, number> = {}
try {
  challengeBest = JSON.parse(localStorage.getItem('oh-challenges') ?? '{}') as Record<string, number>
} catch {
  challengeBest = {}
}

/** 0-100: start at 100, lose points for sink beyond smooth, centerline
 *  offset, and missing the 300 m touchdown zone. Documented, simple. */
function challengeScore(a: { touchdownVsFpm: number; pastThresholdM: number; centerlineOffsetM: number }): number {
  let s = 100
  s -= Math.max(-a.touchdownVsFpm - 200, 0) / 8
  s -= Math.abs(a.centerlineOffsetM) / 2
  s -= Math.abs(a.pastThresholdM - 300) / 15
  return Math.max(Math.round(s), 0)
}

// ---- Phase 9b: save/load snapshot (§17 subset) + payload loading ----
// A snapshot restores a *trimmed* flight state (position/alt/hdg/speed/
// config/fuel/clock), not mid-maneuver rates — documented deviation; the
// full 6-DOF state doesn't survive a floating-origin rebase honestly.
interface Snapshot {
  v: 1
  lat: number; lon: number; altFt: number; hdgDeg: number; kias: number
  flapsIndex: number; fuelKg: number; payloadKg: number
  simMs: number; onGround: boolean; spawn: string
}

let toastLine = ''
let toastUntil = 0
function toast(msg: string): void {
  toastLine = msg
  toastUntil = performance.now() + 6000
}

function saveSnapshot(): void {
  const d = aircraft.data
  const ll = frame.fromLocal(aircraft.posNed.x, aircraft.posNed.y)
  const snap: Snapshot = {
    v: 1, lat: ll.lat, lon: ll.lon, altFt: d.altitudeFt, hdgDeg: d.headingDeg,
    kias: d.kias, flapsIndex: aircraft.controls.flapsIndex, fuelKg: aircraft.fuelKg,
    payloadKg: aircraft.payloadKg,
    simMs: baseDate.getTime() + (loop.simTime + scrubSeconds) * 1000,
    // 9A: a ground save restores to where you ARE — spawnDesc is the
    // last spawn point, wrong after landing somewhere else.
    onGround: d.onGround, spawn: d.onGround ? (airports.near(ll.lat, ll.lon, 5000)[0]?.i ?? spawnDesc) : spawnDesc,
  }
  try {
    localStorage.setItem('oh-save', JSON.stringify(snap))
    toast(`SAVED — ${snap.spawn || 'airborne'} ${Math.round(snap.altFt)} ft`)
  } catch {
    // Private-mode/full storage: the save is unavailable, the sim is not.
    toast('SAVE FAILED — STORAGE UNAVAILABLE')
  }
}

function loadSnapshot(): boolean {
  let snap: Snapshot | null = null
  try {
    snap = JSON.parse(localStorage.getItem('oh-save') ?? 'null') as Snapshot | null
  } catch { /* corrupt save — treat as absent */ }
  if (!snap || snap.v !== 1) {
    toast('NO SAVE')
    return false
  }
  aircraft.payloadKg = snap.payloadKg
  if (snap.onGround) {
    // Ground saves restore to the saved runway's spawn point (the exact
    // ramp spot isn't part of the trimmed-state contract).
    const parts = snap.spawn.split(' ')
    const ap = airports.find(parts[0] || 'KHAF')
    if (!ap) { toast('SAVE AIRPORT UNKNOWN'); return false }
    spawnAtAirport(ap, parts[1])
  } else {
    aircraft.crashed = false
    resetSystemsState()
    frame.anchor = { lat: snap.lat, lon: snap.lon }
    tiles.onRebase()
    airports.positionAll()
    const altM = snap.altFt * FT
    // 9A: the airborne restore used to trim EVERY type as a C172 —
    // hardcoded detents, default params, default pitot cal.
    const flapsDeg = aircraft.P.flapDetentsDeg[snap.flapsIndex] ?? 0
    aircraft.fuelKg = snap.fuelKg // before trim: mass affects the solve
    const tas = kcasFromKias(Math.max(snap.kias, 55), flapsDeg, aircraft.P.pitotCal) * KT * Math.sqrt(1.225 / isa(altM).densityKgM3)
    const t = trim({ tasMs: tas, altM, massKg: aircraft.massKg, flapsDeg, gammaRad: 0, params: aircraft.P, isaTempOffsetC: aircraft.isaTempOffsetC })
    aircraft.flapsDeg = flapsDeg
    aircraft.controls.flapsIndex = snap.flapsIndex
    aircraft.applyTrimState(tas, t.alphaRad, altM, (snap.hdgDeg * Math.PI) / 180, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
    parkingBrake = false
    spawnDesc = snap.spawn
    tiles.update(aircraft.posNed.x, aircraft.posNed.y)
    airports.updateVisuals(frame.anchor.lat, frame.anchor.lon)
  }
  aircraft.fuelKg = snap.fuelKg
  // The per-tank ledger overwrites aircraft.fuelKg every tick — restore
  // it too or the load silently reverts to pre-save quantities.
  fuelState.leftKg = snap.fuelKg / 2
  fuelState.rightKg = snap.fuelKg / 2
  scrubSeconds = (snap.simMs - baseDate.getTime()) / 1000 - loop.simTime
  toast(`LOADED — ${snap.spawn || 'airborne'} ${Math.round(snap.altFt)} ft`)
  return true
}

function handleSearch(query: string): void {
  const parts = query.trim().toUpperCase().split(/\s+/)
  if (parts.length === 0 || !parts[0]) return
  if (parts[0] === 'FLY' && parts[1]) {
    // Aircraft swap (11g): persist and reload — a respawn, honestly.
    if (FLEET[parts[1]] || ROSTER.some((r) => r.spec.designator === parts[1])) {
      try { localStorage.setItem('oh-aircraft', parts[1]) } catch { /* private mode */ }
      location.reload()
    } else {
      toast(`UNKNOWN — FLY ${Object.keys(FLEET).join('|')} or ${ROSTER.map((r) => r.spec.designator).join('|')}`)
    }
    return
  }
  if (parts[0] === 'AI' && (parts[1] === 'OFF' || parts[1] === 'LIGHT' || parts[1] === 'REAL')) {
    aiDensity = parts[1] === 'OFF' ? 0 : parts[1] === 'LIGHT' ? 2 : 5
    try { localStorage.setItem('oh-ai-density', parts[1]) } catch { /* private mode */ }
    // Force the ATC scan to rebuild the pattern ships at the new density.
    disposeAiShips()
    activeAtc = null
    toast(`AI TRAFFIC ${parts[1]} — ${aiDensity} pattern ship${aiDensity === 1 ? '' : 's'}`)
    return
  }
  if (parts[0] === 'LIVE' && parts[1] === 'TRAFFIC' && (parts[2] === 'ON' || parts[2] === 'OFF')) {
    liveTrafficOn = parts[2] === 'ON'
    if (!liveTrafficOn) liveTraffic.targets.clear()
    else lastTrafficFetchAt = -Infinity // poll immediately
    try { localStorage.setItem('oh-live-traffic', parts[2]) } catch { /* private mode */ }
    toast(`LIVE TRAFFIC ${parts[2]}${liveTrafficOn ? ' — real ADS-B, display+TCAS only' : ''}`)
    return
  }
  if (parts[0] === 'IMAGERY' && (parts[1] === 'ON' || parts[1] === 'OFF')) {
    const on = parts[1] === 'ON'
    tiles.setImagery(on)
    try { localStorage.setItem('oh-imagery', parts[1]) } catch { /* private mode */ }
    toast(`SATELLITE IMAGERY ${parts[1]}${on ? '' : ' — stylized terrain'}`)
    return
  }
  if (parts[0] === 'REPLAY') {
    replayView.toggle(recorder.samples, debriefLine)
    if (!replayView.isOpen) toast('REPLAY closed')
    return
  }
  if (parts[0] === 'JOY') {
    if (parts[1] === 'CLEAR') {
      gamepadMap = {}
      try { localStorage.removeItem('oh-gamepad-map') } catch { /* private mode */ }
      toast('JOY: all bindings cleared')
      return
    }
    if (parts[1] === 'PROP') {
      toast('PROP lever — INOP: no controllable-pitch model (governed props auto-govern; recorded)')
      return
    }
    if (parts[1] === 'BUTTONS') {
      startBtnCapture(['gear', 'flapsUp', 'flapsDown', 'trimUp', 'trimDown', 'apDisconnect', 'brakes', 'reverse'])
      return
    }
    const one = parts[1]?.toLowerCase() as BindableAxis | undefined
    const valid: BindableAxis[] = ['pitch', 'roll', 'yaw', 'throttle', 'throttle2', 'mixture', 'brakes']
    if (one && valid.includes(one)) startJoyCapture([one])
    else if (!parts[1]) startJoyCapture(['pitch', 'roll', 'yaw', 'throttle', 'throttle2'])
    else toast('JOY [PITCH|ROLL|YAW|THROTTLE|THROTTLE2|MIXTURE|BRAKES|BUTTONS|CLEAR]')
    return
  }
  if (parts[0] === 'FAIL' && parts[1]) {
    // 15c failures panel: verb-driven (matches the sim's search-verb UI
    // style) over the same flags as the __ohFail hook.
    const name = parts[1]
    if (name === 'ALTERNATOR') failures.alternatorFailed = true
    else if (name === 'ICING') failures.icingConditions = true
    else if (name === 'STATIC') failures.staticBlocked = true
    else if (name === 'NONE') {
      failures.alternatorFailed = false
      failures.icingConditions = false
      failures.staticBlocked = false
    } else {
      toast('FAIL ALTERNATOR|ICING|STATIC|NONE')
      return
    }
    toast(`FAILURES — ALT ${failures.alternatorFailed ? 'FAILED' : 'OK'} · ICE ${failures.icingConditions ? 'ON' : 'OFF'} · STATIC ${failures.staticBlocked ? 'BLOCKED' : 'OK'}`)
    return
  }
  if (parts[0] === 'WB') {
    mfdPage = 'wb'
    toast('MFD — WEIGHT & BALANCE (WB verb; MAP/ENGINE/FPL softkeys return)')
    return
  }
  if (parts[0] === 'WEIGHT' && parts[1]) {
    // `weight 400` — payload (pilot+pax+bags) in lb. Envelope plot is
    // deferred (PROGRESS deviation); gross/limit shown honestly.
    const lb = Number(parts[1])
    if (Number.isFinite(lb)) {
      aircraft.payloadKg = Math.min(Math.max(lb / 2.2046, 0), 500)
      const grossLb = aircraft.massKg * 2.2046
      toast(`PAYLOAD ${Math.round(aircraft.payloadKg * 2.2046)} lb — GROSS ${Math.round(grossLb)} lb${grossLb > 2558 ? ' — OVER MAX RAMP 2558' : ''}`)
    }
    return
  }
  if (parts[0] === 'CHALLENGE' && parts[1] && CHALLENGES[parts[1]]) {
    const ch = CHALLENGES[parts[1]]!
    const ap = airports.find(ch.icao)
    if (ap) {
      challengeActive = parts[1]
      spawnAtAirport(ap, ch.rwy, true)
    }
    return
  }
  if (!airports.loaded) {
    toast('AIRPORT DATA STILL LOADING — TRY AGAIN IN A MOMENT')
    return
  }
  const onFinal = parts[parts.length - 1] === 'FINAL'
  const rwy = parts.length > 1 && parts[1] !== 'FINAL' ? parts[1] : undefined
  const ap = airports.find(parts[0])
  if (ap) spawnAtAirport(ap, rwy, onFinal)
}

// ---- search overlay ----
const searchBox = document.createElement('input')
searchBox.placeholder = 'ICAO [rwy] [final] — e.g. KSFO 28R final'
searchBox.style.cssText =
  'position:fixed;top:45%;left:50%;transform:translateX(-50%);width:340px;padding:10px 14px;' +
  'font:14px ui-monospace,monospace;background:rgba(0,10,20,.9);color:#aef;border:1px solid #4a7;' +
  'border-radius:8px;display:none;z-index:20;outline:none'
document.body.appendChild(searchBox)
searchBox.addEventListener('keydown', (e) => {
  e.stopPropagation()
  if (e.key === 'Enter') {
    handleSearch(searchBox.value)
    searchBox.value = ''
    searchBox.style.display = 'none'
    input.enabled = true
  } else if (e.key === 'Escape') {
    searchBox.style.display = 'none'
    input.enabled = true
  }
})
// Focus trap fix (Slice 0): clicking away from the open search box used
// to leave it invisible-but-focused with sim input disabled — every key
// dead until the pilot rediscovered the box. Blur = close + re-enable.
searchBox.addEventListener('blur', () => {
  searchBox.style.display = 'none'
  searchBox.value = ''
  input.enabled = true
})

// ---- controls ----
const shaped = { pitch: 0, roll: 0, yaw: 0 }

/** Keyboard focus is leaving the sim (search/ATC text box). Drop every
 *  transient: held keys, gamepad key-aliases, pending presses, and the
 *  shaped control axes — pollControls() stops running while disabled, so
 *  anything held at this instant would otherwise latch (a brake alias
 *  held while a box opened once kept the brakes dragging for a whole
 *  takeoff roll). Absolute levers (throttle/trim) stay put on purpose. */
function disableSimInput(): void {
  input.enabled = false
  input.clearHeld()
  shaped.pitch = 0
  shaped.roll = 0
  shaped.yaw = 0
  if (!parkingBrake) {
    aircraft.controls.brakeLeft = 0
    aircraft.controls.brakeRight = 0
  }
}

// ---- 16a: joystick / throttle quadrant ----
// Bound axes OWN their control absolutely while the device is
// connected (stick: pitch/roll/yaw through deadzone+expo; quadrant:
// throttle/mixture as absolute lever positions with end detents;
// brakes max-combined with the B key). Capture convention: move the
// axis to the function's POSITIVE extreme — that direction becomes +1,
// so inverted hardware never needs a checkbox.
let gamepadMap: GamepadMap = {}
try {
  const storedJoy = localStorage.getItem('oh-gamepad-map')
  if (storedJoy) gamepadMap = parseGamepadMap(storedJoy) ?? {}
} catch { /* private mode */ }
let joyCapture: { fn: BindableAxis; queue: BindableAxis[]; baseline: number[][]; deadlineMs: number } | null = null
let btnCapture: { fn: BindableButton; queue: BindableButton[]; baseline: boolean[][]; deadlineMs: number } | null = null
let btnPrev: boolean[][] = []
let joyBrakeHeld = false
let joyWizardChain = false
let joyReverseHeld = false
/** True while the QUADRANT's lifted reverse zone is the thing holding
 *  reverseCmd — so the lever leaving the zone rescinds only its OWN
 *  engagement and can no longer cancel the KeyZ toggle every frame. */
let leverReverseActive = false

const JOY_PROMPT: Record<BindableAxis, string> = {
  pitch: 'PULL — nose UP', roll: 'roll RIGHT', yaw: 'RIGHT rudder',
  throttle: 'LEVER 1 to TOGA (full forward)', throttle2: 'LEVER 2 to TOGA (full forward)',
  mixture: 'mixture FULL RICH', brakes: 'brakes full ON',
}
const BTN_PROMPT: Record<BindableButton, string> = {
  gear: 'GEAR toggle', flapsUp: 'FLAPS UP one step', flapsDown: 'FLAPS DOWN one step',
  trimUp: 'TRIM nose-down (forward)', trimDown: 'TRIM nose-up (back)',
  apDisconnect: 'AP DISCONNECT', brakes: 'BRAKES (hold)', reverse: 'REVERSE (hold)',
}

function padsSnapshot(): number[][] {
  const pads = navigator.getGamepads?.() ?? []
  const out: number[][] = []
  for (const p of pads) out.push(p ? [...p.axes] : [])
  return out
}

function padsButtonSnapshot(): boolean[][] {
  const pads = navigator.getGamepads?.() ?? []
  const out: boolean[][] = []
  for (const p of pads) out.push(p ? p.buttons.map((b) => b.pressed) : [])
  return out
}

function startBtnCapture(queue: BindableButton[]): void {
  const fn = queue[0]!
  btnCapture = { fn, queue: queue.slice(1), baseline: padsButtonSnapshot(), deadlineMs: performance.now() + 8000 }
  toast(`JOY BTN — press: ${BTN_PROMPT[fn]} (8 s to skip)`)
}

function startJoyCapture(queue: BindableAxis[]): void {
  const fn = queue[0]!
  joyCapture = { fn, queue: queue.slice(1), baseline: padsSnapshot(), deadlineMs: performance.now() + 8000 }
  toast(`JOY — ${JOY_PROMPT[fn]} (8 s)`)
}

function saveJoyMap(): void {
  try { localStorage.setItem('oh-gamepad-map', serializeGamepadMap(gamepadMap)) } catch { /* private mode */ }
}

window.addEventListener('gamepadconnected', (e) => {
  const g = (e as GamepadEvent).gamepad
  // TCA Captain Pack (sidestick + quadrant) auto-preset: applied only
  // over UNBOUND functions so a saved custom map always wins. Re-runs on
  // each connect so the quadrant slots in whenever it enumerates.
  const padList = (navigator.getGamepads?.() ?? [])
    .filter((p): p is Gamepad => !!p)
    .map((p) => ({ id: p.id, axes: p.axes.length, index: p.index }))
  const preset = tcaPresetFor(padList)
  if (preset) {
    // A stale-version map (the v1 guess inverted the quadrant → idle
    // levers read as FULL thrust) gets its preset-defined axes OVERWRITTEN;
    // a current-version map only fills unbound functions so the J wizard's
    // custom bindings always win.
    const stale = (gamepadMap.v ?? 0) < TCA_PRESET_VERSION
    let applied = 0
    for (const [k, v] of Object.entries(preset)) {
      if (k === 'btn' || k === 'v' || k === 'btnKeys') continue
      const nb = v as { pad: number; axis: number; sign: 1 | -1 }
      const cur = gamepadMap[k as BindableAxis]
      // Overwrite when unbound, or when upgrading a stale preset AND the
      // current binding sits on the preset's own pad/axis (a J-wizard
      // capture on a different axis is the pilot's choice — keep it).
      const presetSourced = !!cur && cur.pad === nb.pad && cur.axis === nb.axis
      if (!cur || (stale && presetSourced)) {
        gamepadMap[k as BindableAxis] = nb
        applied++
      }
    }
    // Button tables: a stale map takes the full preset; a current one
    // keeps the pilot's own captures and only fills missing entries.
    if (preset.btnKeys) gamepadMap.btnKeys = stale ? { ...preset.btnKeys } : { ...preset.btnKeys, ...(gamepadMap.btnKeys ?? {}) }
    if (preset.btn) gamepadMap.btn = stale ? { ...preset.btn } : { ...preset.btn, ...(gamepadMap.btn ?? {}) }
    gamepadMap.v = TCA_PRESET_VERSION
    if (applied || stale) {
      saveJoyMap()
      toast(`TCA DETECTED: ${g.id.slice(0, 30)} — ${applied} axes + ${Object.keys(gamepadMap.btnKeys ?? {}).length} buttons mapped (J to fine-tune)`)
      return
    }
  }
  if (Object.keys(gamepadMap).length === 0 && g.axes.length >= 4) {
    gamepadMap = { ...DEFAULT_SINGLE_STICK }
    toast(`JOYSTICK: ${g.id.slice(0, 36)} — default map (J to rebind)`)
  } else {
    toast(`GAMEPAD CONNECTED: ${g.id.slice(0, 40)}`)
  }
})
window.addEventListener('gamepaddisconnected', (e) => {
  toast(`GAMEPAD DISCONNECTED: ${(e as GamepadEvent).gamepad.id.slice(0, 36)}`)
})

/** Read a binding's current value in command sign, or null if unplugged. */
function joyRead(fn: BindableAxis): number | null {
  const b = gamepadMap[fn]
  if (!b) return null
  const pad = (navigator.getGamepads?.() ?? [])[b.pad]
  if (!pad) return null
  return (pad.axes[b.axis] ?? 0) * b.sign
}

/** Capture tick: returns true while a capture is consuming input. */
function pollJoyCapture(nowMs: number): boolean {
  if (btnCapture) {
    const hit = detectPressedButton(btnCapture.baseline, padsButtonSnapshot())
    if (hit) {
      gamepadMap.btn = { ...(gamepadMap.btn ?? {}), [btnCapture.fn]: hit }
      saveJoyMap()
      toast(`JOY: ${btnCapture.fn.toUpperCase()} ← pad${hit.pad} button${hit.btn}`)
      const q = btnCapture.queue
      btnCapture = null
      if (q.length) startBtnCapture(q)
    } else if (nowMs > btnCapture.deadlineMs) {
      toast(`JOY: ${btnCapture.fn.toUpperCase()} — skipped`)
      const q = btnCapture.queue
      btnCapture = null
      if (q.length) startBtnCapture(q)
    }
    return true
  }
  if (!joyCapture) return false
  const hit = detectMovedAxis(joyCapture.baseline, padsSnapshot(), 0.45)
  if (hit) {
    gamepadMap[joyCapture.fn] = hit
    saveJoyMap()
    toast(`JOY: ${joyCapture.fn.toUpperCase()} ← pad${hit.pad} axis${hit.axis}${hit.sign < 0 ? ' (inverted)' : ''}`)
    const q = joyCapture.queue
    joyCapture = null
    if (q.length) startJoyCapture(q)
    else if (joyWizardChain) { joyWizardChain = false; startBtnCapture(['gear', 'flapsUp', 'flapsDown', 'trimUp', 'trimDown', 'apDisconnect', 'brakes', 'reverse']) }
  } else if (nowMs > joyCapture.deadlineMs) {
    toast(`JOY: ${joyCapture.fn.toUpperCase()} — nothing moved, skipped`)
    const q = joyCapture.queue
    joyCapture = null
    if (q.length) startJoyCapture(q)
    else if (joyWizardChain) { joyWizardChain = false; startBtnCapture(['gear', 'flapsUp', 'flapsDown', 'trimUp', 'trimDown', 'apDisconnect', 'brakes', 'reverse']) }
  }
  return true
}
function shapeAxis(current: number, held: number, dt: number, attack = 2.2, recenter = 3.0): number {
  if (held !== 0) return Math.min(Math.max(current + held * attack * dt, -1), 1)
  const mag = Math.max(Math.abs(current) - recenter * dt, 0)
  return Math.sign(current) * mag
}

const baseDate = new Date()
let scrubSeconds = 0

/** Default the clock to pleasant daylight (~10:00 local solar time) at the
 *  spawn longitude; the real/custom time-of-day picker is Phase 8 (§17).
 *  The [ ] scrub keys still move time freely. */
function setDaytimeAt(lonDeg: number): void {
  const targetUtcHour = (10 - lonDeg / 15 + 24) % 24
  const target = new Date(baseDate)
  target.setUTCHours(Math.floor(targetUtcHour), Math.round((targetUtcHour % 1) * 60), 0, 0)
  scrubSeconds = (target.getTime() - baseDate.getTime()) / 1000 - loop.simTime
}
let lastFrame = performance.now()
let lastVisualUpdate = 0

function handleDiscreteKeys(): void {
  const c = aircraft.controls
  if (input.wasPressed('Slash')) {
    searchBox.style.display = 'block'
    searchBox.focus()
    disableSimInput()
    return
  }
  if (input.wasPressed('KeyT')) {
    // Slice 0: with no facility in range the menu used to open with
    // nothing rendered — an invisible mode that silently ate the 1/2/3
    // sim-rate keys. Only toggle when there is actually a menu to show.
    if (activeAtc) {
      atcMenuOpen = !atcMenuOpen
      renderAtcMenu()
    } else {
      toast('NO ATC IN RANGE')
    }
  }
  if (atcMenuOpen && !activeAtc) {
    // Facility went out of range while the menu was up.
    atcMenuOpen = false
    renderAtcMenu()
  }
  if (atcMenuOpen) {
    const items = atcMenuItems()
    for (let k = 1; k <= Math.min(items.length, 9); k++) {
      if (input.wasPressed(`Digit${k}`)) {
        items[k - 1]!.run()
        atcMenuOpen = false
        renderAtcMenu()
      }
    }
  }
  if (input.wasPressed('Space')) loop.setRate(loop.paused ? 1 : 0)
  if (!atcMenuOpen) {
    for (const [key, rate] of [['Digit1', 1], ['Digit2', 2], ['Digit3', 4]] as const) {
      if (input.wasPressed(key)) loop.setRate(rate as SimRate)
    }
  }
  if (input.wasPressed('KeyJ')) {
    // Full joystick wizard: axes, then the button tour chained on the
    // end (each step skips after 8 s of silence). TCA pack: stick axes,
    // lever 1, lever 2, then gear/flaps/trim/AP-disc/brakes/reverse.
    joyWizardChain = true
    startJoyCapture(['pitch', 'roll', 'yaw', 'throttle', 'throttle2'])
  }
  if (input.wasPressed('KeyX')) assistOn = !assistOn
  if (input.wasPressed('KeyQ')) engineSound.muted = !engineSound.muted // mute moved M→Q (M = plane menu)
  if (input.wasPressed('KeyO')) saveSnapshot()
  if (input.wasPressed('KeyP')) loadSnapshot()
  // Fleet keys (11g): U gear (retractable only), H hand-prop, K carb heat.
  if (input.wasPressed('KeyU') && aircraft.P.gearRetractable) {
    aircraft.gearDownCommanded = !aircraft.gearDownCommanded
    toast(aircraft.gearDownCommanded ? 'GEAR DOWN' : 'GEAR UP')
  }
  if (input.wasPressed('KeyH')) handPropRequested = true
  if (input.wasPressed('KeyK') && aircraft.P.carburetor) {
    carbHeatOn = !carbHeatOn
    toast(carbHeatOn ? 'CARB HEAT ON' : 'CARB HEAT OFF')
  }
  // 13c: L landing light (needs the electrical bus — the Cub has none).
  if (input.wasPressed('KeyL')) {
    if (aircraft.P.electrical === false) {
      toast('NO ELECTRICAL SYSTEM — NO LIGHTS')
    } else {
      aircraftLights.landingOn = !aircraftLights.landingOn
      toast(aircraftLights.landingOn ? 'LANDING LIGHT ON' : 'LANDING LIGHT OFF')
    }
  }
  if (input.wasPressed('KeyC')) {
    cameraMode =
      cameraMode === 'chase' ? 'orbit' : cameraMode === 'orbit' ? 'free' : cameraMode === 'free' ? 'cockpit' : 'chase'
  }
  if (input.wasPressed('KeyF')) c.flapsIndex = Math.min(c.flapsIndex + 1, aircraft.P.flapDetentsDeg.length - 1)
  if (input.wasPressed('KeyG')) c.flapsIndex = Math.max(c.flapsIndex - 1, 0)
  if (input.wasPressed('KeyR')) {
    // 9A: reset returns to YOUR runway — the no-ident call re-picked the
    // airport's longest/default runway instead.
    const parts = spawnDesc.split(' ')
    const ap = airports.find(parts[0] || 'KHAF')
    if (ap) spawnAtAirport(ap, parts[1])
    aircraft.crashed = false
    c.throttle = 0
    c.trim = 0
    c.flapsIndex = 0
  }
}

function pollControls(dt: number): void {
  if (!input.enabled) return
  const c = aircraft.controls
  const pitchKey = input.axis('ArrowDown', 'ArrowUp')
  const rollKey = input.axis('ArrowRight', 'ArrowLeft')
  const yawKey = input.axis('KeyD', 'KeyA')
  shaped.pitch = shapeAxis(shaped.pitch, pitchKey, dt, 1.5, 2.5)
  shaped.roll = shapeAxis(shaped.roll, rollKey, dt)
  shaped.yaw = shapeAxis(shaped.yaw, yawKey, dt, 2.5, 4)
  c.throttle = Math.min(Math.max(c.throttle + input.axis('KeyW', 'KeyS') * 0.5 * dt, 0), 1)
  c.trim = Math.min(Math.max(c.trim + input.axis('Period', 'Comma') * 0.25 * dt, -1), 1)
  baroSetInHg = Math.min(Math.max(baroSetInHg + input.axis('Quote', 'Semicolon') * 0.2 * dt, 27.5), 31.5)
  // Parking brake: set on ground spawn, auto-releases when power comes up.
  if (parkingBrake && c.throttle > 0.15) parkingBrake = false
  c.brakeLeft = c.brakeRight = input.isHeld('KeyB') || parkingBrake ? 1 : 0
  if (input.wasPressed('KeyV')) {
    if (aircraft.P.spoilers) {
      // Lever cycle: DOWN → ARM → FLIGHT DETENT → DOWN (737 quadrant).
      if (aircraft.spoilerArmed) { aircraft.spoilerArmed = false; aircraft.spoilerCmd = 1; toast('SPEEDBRAKE — FLIGHT DETENT') }
      else if (aircraft.spoilerCmd > 0.5) { aircraft.spoilerCmd = 0; toast('SPEEDBRAKE DOWN') }
      else { aircraft.spoilerArmed = true; toast('SPEEDBRAKE ARMED — auto-deploys on touchdown') }
    } else {
      toast('NO SPEEDBRAKES ON THIS TYPE')
    }
  }
  if (input.wasPressed('KeyZ')) {
    if (aircraft.P.reversers) {
      aircraft.reverseCmd = !aircraft.reverseCmd
      toast(aircraft.reverseCmd ? 'REVERSE THRUST (deploys on ground)' : 'REVERSERS STOWED')
    } else {
      toast('NO REVERSERS ON THIS TYPE')
    }
  }
  // 16a: mapped gamepad axes own their controls while connected.
  if (!pollJoyCapture(performance.now())) {
    const jr = joyRead('roll')
    const jp = joyRead('pitch')
    const jy = joyRead('yaw')
    if (jr !== null) shaped.roll = applyDeadzone(jr)
    if (jp !== null) shaped.pitch = applyDeadzone(jp)
    if (jy !== null) shaped.yaw = applyDeadzone(jy)
    const jt = joyRead('throttle')
    if (jt !== null) {
      // Two-lever quadrant (TCA): average both levers; travel below the
      // idle detent (the lifted reverse gate) commands reverse thrust
      // with zone depth as reverse power — jets only, WoW-interlocked
      // downstream like the Z key.
      const jt2 = joyRead('throttle2')
      const raw = jt2 !== null ? (jt + jt2) / 2 : jt
      const lev = leverWithReverse(raw)
      if (lev.reverse && aircraft.P.reversers) {
        aircraft.reverseCmd = true
        leverReverseActive = true
        // Airborne, the reverse zone commands IDLE — the sleeves are
        // WoW-gated but the throttle wasn't, so a lifted lever in
        // flight used to command full FORWARD N1.
        c.throttle = aircraft.data.onGround && lev.power >= 0.02 ? lev.power : 0
      } else {
        // Only the lever's OWN engagement is rescinded when it leaves
        // the zone — this branch used to clear reverseCmd EVERY frame,
        // cancelling the KeyZ toggle the same frame it was pressed.
        if (aircraft.P.reversers && leverReverseActive && !joyReverseHeld) {
          aircraft.reverseCmd = false
          leverReverseActive = false
        }
        c.throttle = lev.power < 0.02 ? 0 : lev.power > 0.98 ? 1 : lev.power
      }
    }
    const jm = joyRead('mixture')
    if (jm !== null) {
      const lever = axisToUnipolar(jm)
      c.mixture = lever < 0.02 ? 0 : lever > 0.98 ? 1 : lever
    }
    const jb = joyRead('brakes')
    if (jb !== null) {
      const brake = axisToUnipolar(jb)
      c.brakeLeft = Math.max(c.brakeLeft, brake)
      c.brakeRight = Math.max(c.brakeRight, brake)
    }
    // 16a-b: bound BUTTONS (TCA stick/quadrant switches). Edge-triggered
    // toggles + held functions, same actions as their keyboard twins.
    const btns = gamepadMap.btn ?? (gamepadMap.btnKeys ? {} : null)
    if (btns) {
      const now = padsButtonSnapshot()
      // 9A: a pad set change (connect/disconnect/slot move) resyncs
      // btnPrev WITHOUT edge processing — a stale baseline used to fire
      // phantom gear/flap/AP-disconnect presses the frame a device came
      // back (latched base switches read pressed at rest).
      const padsChanged = now.length !== btnPrev.length || now.some((p, i) => p.length !== (btnPrev[i]?.length ?? -1))
      if (padsChanged) {
        if (btnPrev.length > 0 && now.length < btnPrev.length) toast('GAMEPAD DISCONNECTED — bindings idle until it returns')
        btnPrev = now
      } else {
      const down = (fn: BindableButton): boolean => {
        const b = btns[fn]
        return !!b && !!now[b.pad]?.[b.btn]
      }
      const pressed = (fn: BindableButton): boolean => {
        const b = btns[fn]
        return !!b && !!now[b.pad]?.[b.btn] && !btnPrev[b.pad]?.[b.btn]
      }
      if (pressed('gear') && aircraft.P.gearRetractable) {
        aircraft.gearDownCommanded = !aircraft.gearDownCommanded
        toast(aircraft.gearDownCommanded ? 'GEAR DOWN' : 'GEAR UP')
      }
      if (pressed('flapsDown')) c.flapsIndex = Math.min(c.flapsIndex + 1, aircraft.P.flapDetentsDeg.length - 1)
      if (pressed('flapsUp')) c.flapsIndex = Math.max(c.flapsIndex - 1, 0)
      if (pressed('trimUp')) c.trim = Math.min(Math.max(c.trim - 0.02, -1), 1)
      if (pressed('trimDown')) c.trim = Math.min(Math.max(c.trim + 0.02, -1), 1)
      if (pressed('apDisconnect') && systemsControls.apMaster) {
        systemsControls.apMaster = false
        toast('AP DISCONNECT')
      }
      joyBrakeHeld = down('brakes')
      if (joyBrakeHeld) {
        c.brakeLeft = Math.max(c.brakeLeft, 1)
        c.brakeRight = Math.max(c.brakeRight, 1)
      }
      joyReverseHeld = down('reverse')
      if (aircraft.P.reversers && joyReverseHeld) aircraft.reverseCmd = true
      // Key-alias buttons: the whole stick/quadrant face drives the
      // existing key handlers (gear/flaps/spoilers/ATC/menu/camera/pause…).
      const aliases = gamepadMap.btnKeys
      if (aliases) {
        for (const [key, code] of Object.entries(aliases)) {
          const [padS, btnS] = key.split(':')
          const p = Number(padS), b = Number(btnS)
          const isDown = !!now[p]?.[b]
          if (HELD_ALIASES.has(code)) input.setVirtualHeld(code, isDown)
          else if (isDown && !btnPrev[p]?.[b]) input.injectPress(code)
        }
      }
      btnPrev = now
      }
    }
  } else {
    // 9A: btnPrev stays FRESH through a J-wizard capture — it used to
    // freeze, then fire phantom edges the frame capture ended.
    btnPrev = padsButtonSnapshot()
  }
  // Expo curve: fine control near center, full authority at the stops.
  const expo = (v: number) => v * Math.abs(v) * 0.65 + v * 0.35
  c.pitch = expo(shaped.pitch)
  c.roll = expo(shaped.roll)
  c.yaw = expo(shaped.yaw)
  // Flight assist (X toggles): untouched axes get stability help — wing
  // leveler, pitch-rate damping, auto-coordinated rudder. Pilot-side aid;
  // the flight model itself is untouched.
  if (assistOn && aircraft.data.onGround && yawKey === 0) {
    // Ground assist: hold the heading captured the moment this condition
    // first arms (a pure yaw-rate damper only slows the P-factor/torque
    // swerve, it can't null a steady disturbance — heading still drifts).
    // Lock once, not continuously, or an early swing before liftoff-speed
    // never gets corrected — it just becomes the new "locked" heading.
    if (groundHeadingLockDeg === null) groundHeadingLockDeg = aircraft.data.headingDeg
    let errDeg = aircraft.data.headingDeg - groundHeadingLockDeg
    errDeg = ((errDeg + 180) % 360 + 360) % 360 - 180
    const errRad = (errDeg * Math.PI) / 180
    // Feed-forward: the P-factor/torque/slipstream left-yaw tendency grows
    // with power (RPM keeps climbing through the roll as speed builds on
    // this fixed-pitch prop), so a reactive P+D loop on heading error alone
    // always lags a still-increasing disturbance. Anticipate it from RPM
    // directly instead of waiting for the error to appear.
    const ffYaw = 0.4 * Math.min(aircraft.data.rpm / 2700, 1)
    c.yaw = Math.min(Math.max(ffYaw - 2.2 * errRad - 6 * aircraft.rates.z, -0.6), 0.6)
  } else {
    groundHeadingLockDeg = null
  }
  if (assistOn && !aircraft.data.onGround) {
    const rollRad = (aircraft.data.rollDeg * Math.PI) / 180
    const betaRad = (aircraft.data.betaDeg * Math.PI) / 180
    if (rollKey === 0) {
      c.roll = Math.min(Math.max(-0.9 * rollRad - 0.35 * aircraft.rates.x, -0.5), 0.5)
    }
    // Pitch: hold the attitude captured the moment the pilot lets go, not
    // just damp rate — a pure rate damper has no target, so releasing the
    // stick after rotation let the aircraft sink back toward its trimmed
    // (near-level) attitude and settle back onto the runway instead of
    // sustaining the climb. Re-locks fresh each time the pilot takes pitch
    // control back (or after a fresh liftoff — see the on-ground branch).
    if (pitchKey === 0) {
      if (airbornePitchLockDeg === null) airbornePitchLockDeg = aircraft.data.pitchDeg
      const pitchErrRad = ((aircraft.data.pitchDeg - airbornePitchLockDeg) * Math.PI) / 180
      const pitchCmd = Math.min(Math.max(-1.2 * pitchErrRad - 1.8 * aircraft.rates.y, -0.4), 0.4)
      c.pitch += pitchCmd
      // Trim follow-up: a real hands-off climb needs the trim wheel set,
      // not a permanently-held elevator force (headless trace showed the
      // aircraft pitching from +16 deg to -3.5 deg in 2.4 s at elevator
      // neutral with trim untouched — it was seeking its untrimmed
      // equilibrium, not unstable). Slowly bleed the sustained elevator
      // command into trim so the controller isn't fighting it forever.
      c.trim = Math.min(Math.max(c.trim + pitchCmd * dt * 0.4, -1), 1)
    } else {
      airbornePitchLockDeg = null
    }
    if (yawKey === 0) {
      c.yaw = Math.min(Math.max(1.6 * betaRad - 0.8 * aircraft.rates.z, -0.6), 0.6)
    }
  } else {
    airbornePitchLockDeg = null
  }
  const scrub = input.axis('BracketRight', 'BracketLeft')
  if (scrub !== 0) scrubSeconds += scrub * dt * 3600
}

// ---- live weather (Phase 5 §11) ----
// Fetch METARs in a bbox around the aircraft every 10 min (or on a >50 km
// move), blend at the aircraft position every few seconds, and apply to BOTH
// physics (wind model, ISA temperature offset → density altitude) and the
// HUD from the same state (§1). `__ohWind` switches to manual weather.
let liveWeatherOn = true
let wxStations: StationWeather[] = []
let wxDesc = ''
let wxSlabs: CloudSlab[] = []
/** Altimeter baro window (Kollsman) and the actual area QNH it should be
 *  set to; ; and ' keys turn the knob (±0.01 inHg steps, held = spin). */
let baroSetInHg = 29.92
let qnhInHg = 29.92
let wxBlended: BlendedWeather | null = null
let lastWxFetchAt = -Infinity
let lastWxFetchLL = { lat: 0, lon: 0 }
let lastWxApplyAt = -Infinity
/** Cumulative floating-origin shift (render→world grid), for stable clouds. */
const worldShift = { e: 0, n: 0 }

// In-cloud whiteout overlay: opacity IS `inCloudFactor` of the same slabs
// the renderer draws — one weather state for physics, visuals, and HUD (§1).
const whiteout = document.createElement('div')
whiteout.style.cssText =
  'position:fixed;inset:0;pointer-events:none;z-index:5;opacity:0;background:#c8ccd2;transition:opacity 120ms linear'
document.body.appendChild(whiteout)

// ---- live ADS-B traffic (14b): poll on the METAR cadence pattern ----
// Store steps with WALL time — real aircraft ignore sim time accel/pause
// (recorded). Rendering/TCAS integration land in 14c/14d.
const liveTraffic = new LiveTrafficStore()
let liveTrafficOn = true
try { if (localStorage.getItem('oh-live-traffic') === 'OFF') liveTrafficOn = false } catch { /* private mode */ }
let lastTrafficFetchAt = -Infinity
let lastTrafficLL = { lat: 0, lon: 0 }
let lastTrafficPayloadTs = 0
let lastTrafficStepAt = 0
let trafficPollCount = 0
let trafficLastErr = ''
let trafficInFlightPoll = false

function updateLiveTraffic(lat: number, lon: number, now: number): void {
  // Wall-clock step every frame (clamped against tab-suspend gaps).
  const wallNow = Date.now()
  const dt = Math.min(Math.max((wallNow - lastTrafficStepAt) / 1000, 0), 2)
  lastTrafficStepAt = wallNow
  if (liveTrafficOn && dt > 0) liveTraffic.step(dt, wallNow)
  if (!liveTrafficOn) return
  // In-flight guard + client timeout (soak finding): during a
  // multi-minute upstream outage the server legitimately takes ~30 s
  // per cold answer (provider-chain timeouts) — unguarded 10 s polls
  // piled onto those and starved the pipeline for good. One poll at a
  // time, and a hung one dies at 9 s.
  if (!trafficInFlightPoll && (now - lastTrafficFetchAt > 10_000 || distanceM(lastTrafficLL, { lat, lon }) > 20_000)) {
    lastTrafficFetchAt = now
    lastTrafficLL = { lat, lon }
    trafficPollCount++
    trafficInFlightPoll = true
    fetch(`/api/traffic?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, { signal: AbortSignal.timeout(9000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json: { ac: LiveTargetWire[]; ts: number }) => {
        if (!liveTrafficOn) return
        lastTrafficPayloadTs = json.ts
        liveTraffic.ingest(json.ac, Date.now(), lat, lon)
      })
      .catch((e: unknown) => { trafficLastErr = String(e).slice(0, 80) /* stale-while-error server-side; next poll retries */ })
      .finally(() => { trafficInFlightPoll = false })
  }
}

function updateLiveWeather(lat: number, lon: number, now: number): void {
  if (!liveWeatherOn) return
  if (
    now - lastWxFetchAt > 600_000 ||
    distanceM(lastWxFetchLL, { lat, lon }) > 50_000
  ) {
    lastWxFetchAt = now
    // Teleport/long-move: drop the old region's stations immediately so a
    // stale set can never be blended at the new position mid-refetch (the
    // 150 km guard in blendWeather is the second line of defense).
    if (distanceM(lastWxFetchLL, { lat, lon }) > 50_000) {
      wxStations = []
      applyBlendedWeather(null) // neutral until the new region's data lands
    }
    lastWxFetchLL = { lat, lon }
    const bbox = `${(lat - 1.2).toFixed(2)},${(lon - 1.5).toFixed(2)},${(lat + 1.2).toFixed(2)},${(lon + 1.5).toFixed(2)}`
    fetch(`/api/metar?bbox=${bbox}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((arr: Array<{ rawOb?: string; lat?: number; lon?: number; elev?: number }>) => {
        wxStations = arr
          .filter((e) => e.rawOb && e.lat !== undefined && e.lon !== undefined)
          .map((e) => ({
            metar: parseMetar(e.rawOb!),
            lat: e.lat!,
            lon: e.lon!,
            elevFt: (e.elev ?? 0) / 0.3048,
          }))
      })
      .catch((err) => console.warn('live weather unavailable (manual/calm retained):', err))
  }
  if (now - lastWxApplyAt > 5000 && wxStations.length > 0) {
    lastWxApplyAt = now
    applyBlendedWeather(blendWeather(wxStations, lat, lon))
    // Carb-ice humidity input (11g): nearest station's temp−dewpoint spread.
    let best = Infinity
    for (const s of wxStations) {
      const dM = distanceM({ lat, lon }, { lat: s.lat, lon: s.lon })
      if (dM < best && s.metar.tempC !== undefined && s.metar.dewpointC !== undefined) {
        best = dM
        wxTempDewSpreadC = Math.max(s.metar.tempC - s.metar.dewpointC, 0)
      }
    }
  }
}

// ---- ATC (Phase 6c): nearest towered field wired to the real radios ----
const CALLSIGN = 'Skyhawk 123AB'
const comms = new CommsBus()
let atcFreqs: Record<string, Array<{ t: string; f: number; d: string }>> = {}
fetch('/api/frequencies.json')
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .then((j) => (atcFreqs = j))
  .catch((e) => console.warn('frequencies unavailable (ATC silent):', e))

interface ActiveAtc {
  ident: string
  ll: LatLon
  tower: TowerController
  ground: GroundController
  /** N7 arrival chain: radar approach facility (real APP/DEP freq). */
  approach: ApproachController
  appF: number
  atis: ReturnType<typeof buildAtis>
  twrF: number
  gndF: number
  atisF: number
  /** Weather + broadcast hour the ATIS was built from (9A) — a change
   *  forces a facility refresh so the broadcast is never frozen. */
  atisWx: string
  atisHour: number
}
let activeAtc: ActiveAtc | null = null
let atisPlayedFor = ''
/** AI pattern traffic at the active ATC field (Phase 6d/6e wiring; 14e:
 *  ONE record list — the parallel pilot/mesh arrays drifted by index —
 *  with density OFF/LIGHT/REAL = 0/2/5 and Tier-C type variety). */
let aiShips: Array<{ pilot: AiPatternPilot; mesh: AircraftMesh }> = []
let aiDensity = 2
try {
  const d = localStorage.getItem('oh-ai-density')
  if (d === 'OFF') aiDensity = 0
  else if (d === 'REAL') aiDensity = 5
} catch { /* private mode */ }
/** Callsign / ICAO type / start-delay staggering for up to REAL density. */
const AI_ROSTER: Array<[string, string, number]> = [
  ['N77GA', 'C172', 25], ['N42PK', 'P28A', 210], ['N158CD', 'SR22', 430],
  ['N631SP', 'C182', 650], ['N905TB', 'BE36', 870],
]

// ---- Phase 8c: flight recorder + auto-debrief + logbook (§18/§19) ----
const recorder = new FlightRecorder()
let lastOnGround = true
let flightStartSimS: number | null = null
let flightFrom = ''
let debriefLine = ''
let debriefUntil = 0
interface LogEntry {
  date: string; from: string; to: string; durationMin: number
  touchdownFpm: number; grade: string
}
let logbook: LogEntry[] = []
try {
  logbook = JSON.parse(localStorage.getItem('oh-logbook') ?? '[]') as LogEntry[]
} catch {
  logbook = [] // storage unavailable → session-only, never blocks the sim
}

function nearestRunwayRef(lat: number, lon: number, touchdownHdgDeg: number): { ref: RunwayRef; icao: string } | null {
  const ap = airports.near(lat, lon, 6000)[0]
  if (!ap || ap.r.length === 0) return null
  let best: RunwayRef | null = null
  let bestD = Infinity
  const mLat = 111_320
  for (const r of ap.r) {
    for (const end of [
      { la: r.la1, lo: r.lo1, e: r.e1, far: { la: r.la2, lo: r.lo2 } },
      { la: r.la2, lo: r.lo2, e: r.e2, far: { la: r.la1, lo: r.lo1 } },
    ]) {
      // The threshold LANDED ON is the end whose course matches the
      // touchdown heading — nearest-end alone picked the far end after a
      // mid-runway rollout (negative past-threshold in the first debrief).
      const hdg = bearingDeg({ lat: end.la, lon: end.lo }, { lat: end.far.la, lon: end.far.lo })
      let dh = Math.abs(hdg - touchdownHdgDeg) % 360
      if (dh > 180) dh = 360 - dh
      if (dh > 90) continue
      const d = Math.hypot((end.la - lat) * mLat, (end.lo - lon) * mLat * Math.cos((lat * Math.PI) / 180))
      if (d < bestD) {
        bestD = d
        best = { thrLat: end.la, thrLon: end.lo, elevFt: end.e, headingDeg: hdg }
      }
    }
  }
  return best ? { ref: best, icao: ap.i } : null
}

function updateRecorder(ll: { lat: number; lon: number }): void {
  const d = aircraft.data
  recorder.record(loop.simTime, {
    t: loop.simTime, lat: ll.lat, lon: ll.lon, altFt: d.altitudeFt, iasKt: d.kias,
    vsFpm: d.verticalSpeedFpm, headingDeg: d.headingDeg, pitchDeg: d.pitchDeg,
    rollDeg: d.rollDeg, aglFt: d.aglFt, onGround: d.onGround,
  })
  if (lastOnGround && !d.onGround) {
    flightStartSimS = loop.simTime
    // The field actually departed — NOT the ATC facility (which is the
    // nearest TOWERED airport and logged 'KSFO' for a KHAF departure).
    flightFrom = airports.near(ll.lat, ll.lon, 5000)[0]?.i ?? spawnDesc.split(' ')[0] ?? '?'
    debriefLine = ''
  }
  if (!lastOnGround && d.onGround && flightStartSimS !== null && !aircraft.crashed) {
    const near = nearestRunwayRef(ll.lat, ll.lon, aircraft.data.headingDeg)
    if (near) {
      const a = analyzeLanding(recorder.samples, near.ref)
      if (a) {
        const side = a.centerlineOffsetM >= 0 ? 'R' : 'L'
        debriefUntil = performance.now() + 45_000 // show, then release the line
        debriefLine =
          `LANDED ${near.icao}: ${Math.round(-a.touchdownVsFpm)} fpm (${a.grade}) · ` +
          `${Math.round(a.pastThresholdM)} m past thr · ${side}${Math.abs(a.centerlineOffsetM).toFixed(0)} m of CL`
        logbook.push({
          date: new Date().toISOString().slice(0, 10), from: flightFrom, to: near.icao,
          durationMin: Math.max(Math.round((loop.simTime - flightStartSimS) / 60), 1),
          touchdownFpm: Math.round(a.touchdownVsFpm), grade: a.grade,
        })
        if (challengeActive) {
          const score = challengeScore(a)
          const prev = challengeBest[challengeActive] ?? 0
          debriefLine += ` · ${challengeActive} SCORE ${score}${score > prev ? ' — NEW BEST' : ` (best ${prev})`}`
          if (score > prev) {
            challengeBest[challengeActive] = score
            try {
              localStorage.setItem('oh-challenges', JSON.stringify(challengeBest))
            } catch { /* session-only */ }
          }
          challengeActive = null
        }
        try {
          localStorage.setItem('oh-logbook', JSON.stringify(logbook.slice(-200)))
        } catch { /* session-only */ }
      }
    }
    flightStartSimS = null
  }
  lastOnGround = d.onGround
}

// ---- Phase 7c: TCAS (TAS presentation) + TAWS wiring ----
const tcas = new TcasComputer({ taOnly: true })
const taws = new TawsComputer()
let lastSafetyAt = -Infinity
let liftoffSimS: number | null = null
let safetyLine = ''
let trafficDots: Array<{ dNorthM: number; dEastM: number; relAltFt: number; alerted: boolean }> = []
let lastTcasDebug: { level: string; trackLevels: string[] } = { level: 'NONE', trackLevels: [] }

/** Speech priority gate (Slice 4): the synth is ONE global FIFO with no
 *  cancel anywhere before this — a TCAS aural could queue behind ATIS.
 *  Classes: 'safety' cancel()s everything and speaks NOW; 'copilot'
 *  speaks only into an idle synth (otherwise the caller drops to its
 *  HUD line — callouts are moment-critical, never queued); 'radio'
 *  keeps the FIFO behavior it always had. Returns whether it spoke. */
let synthBusy = false
function gatedSpeak(u: SpeechSynthesisUtterance, cls: 'safety' | 'copilot' | 'radio'): boolean {
  const synth = window.speechSynthesis
  if (!synth) return false
  if (cls === 'safety') synth.cancel()
  else if (cls === 'copilot' && (synthBusy || synth.speaking || synth.pending)) return false
  const chainedEnd = u.onend
  u.onstart = () => { synthBusy = true }
  u.onend = (e) => { synthBusy = false; if (chainedEnd) chainedEnd.call(u, e) }
  u.onerror = () => { synthBusy = false }
  synth.speak(u)
  return true
}

/** Non-radio cockpit annunciation (TCAS/TAWS aurals) — spoken urgently,
 *  never logged to the comms transcript (they aren't transmissions). */
function annunciate(text: string): void {
  try {
    const u = new SpeechSynthesisUtterance(text.toLowerCase())
    u.rate = 1.25
    u.pitch = 0.9
    gatedSpeak(u, 'safety')
  } catch {
    // no speech available — HUD/PFD annunciation still shows it
  }
}

// ---- Slice 4: copilot (pure engine in src/sim/copilot.ts) ----
const copilotSpeeds = copilotSpeedsFor({
  vs1Kt: FLEET_ACTIVE.params.vSpeeds.vs1,
  clMaxClean: FLEET_ACTIVE.params.clMaxClean,
  flapDClMax: FLEET_ACTIVE.params.flapDClMax,
  flapDetentsDeg: FLEET_ACTIVE.params.flapDetentsDeg,
  jet: !!FLEET_ACTIVE.params.jet,
})
let copilotLatches = makeCopilotLatches()
let copilotPrev: CopilotObs | null = null
let copilotLine = ''
let copilotUntil = 0
let copilotVoice: SpeechSynthesisVoice | null = null

/** First-officer voice: FIXED distinct voice (hashed from a constant so
 *  it never collides with the hashed ATC voices), calmer than the
 *  safety annunciator. Tolerates an empty getVoices() at boot — the
 *  pick retries on the next call. */
function speakCopilot(text: string): void {
  try {
    const u = new SpeechSynthesisUtterance(text)
    const voices = window.speechSynthesis?.getVoices() ?? []
    if (voices.length > 0) {
      if (!copilotVoice) {
        let h = 0
        for (const c of 'first-officer') h = (h * 31 + c.charCodeAt(0)) | 0
        copilotVoice = voices[Math.abs(h) % voices.length]!
      }
      u.voice = copilotVoice
    }
    u.rate = 1.05
    u.pitch = 1.1
    gatedSpeak(u, 'copilot') // drops silently if the synth is busy — HUD line still shows
  } catch { /* no speech — HUD line still shows */ }
}

function stepCopilot(): void {
  const d = aircraft.data
  const o: CopilotObs = {
    kias: d.kias,
    aglFt: d.aglFt,
    vsFpm: d.verticalSpeedFpm,
    onGround: d.onGround,
    gearDown: aircraft.P.gearRetractable ? aircraft.gearDownCommanded : true,
    flapsIndex: aircraft.controls.flapsIndex,
    throttle: aircraft.controls.throttle,
  }
  if (copilotPrev) {
    const calls = copilotCallouts(o, copilotPrev, copilotSpeeds, copilotLatches, !!aircraft.P.gearRetractable)
    if (calls.length > 0) {
      copilotLine = calls.join(' · ')
      copilotUntil = performance.now() + 5000
      speakCopilot(calls.join(', '))
    }
  }
  copilotPrev = o
}

function updateSafety(now: number): void {
  if (now - lastSafetyAt < 500) return
  lastSafetyAt = now
  const d = aircraft.data
  if (d.onGround) liftoffSimS = null
  else if (liftoffSimS === null) liftoffSimS = loop.simTime

  const pos = aircraft.posNed
  const mLat = 111_320
  const ll0 = frame.fromLocal(pos.x, pos.y)
  const mLon = mLat * Math.cos((ll0.lat * Math.PI) / 180)
  const trackRad = (d.trackDeg * Math.PI) / 180
  const gsMs = d.groundSpeedKt * KT
  const ownVn = Math.cos(trackRad) * gsMs
  const ownVe = Math.sin(trackRad) * gsMs

  // TCAS from airborne AI traffic (14c: stable per-pilot ids — the old
  // literal 'AI' collapsed every intruder onto one hysteresis state) plus
  // the live ADS-B store (hex ids; baro altitudes — recorded).
  const tracks = aiShips
    .map(({ pilot }, i) => ({ p: pilot, i }))
    .filter(({ p }) => p.phase === 'pattern' && !p.onGround)
    .map(({ p, i }) => {
      const hRad = (p.plane.headingDeg * Math.PI) / 180
      const v = p.plane.gsKt * KT
      return {
        id: `AI${i}`, relNorthM: (p.plane.lat - ll0.lat) * mLat, relEastM: (p.plane.lon - ll0.lon) * mLon,
        relVnMs: Math.cos(hRad) * v - ownVn, relVeMs: Math.sin(hRad) * v - ownVe,
        altFt: p.plane.altFt, vsFpm: 0,
      }
    })
  for (const t of liveTraffic.targets.values()) {
    if (t.gnd) continue
    const hRad = (t.trkDeg * Math.PI) / 180
    const v = t.gsKt * KT
    tracks.push({
      id: t.id, relNorthM: (t.lat - ll0.lat) * mLat, relEastM: (t.lon - ll0.lon) * mLon,
      relVnMs: Math.cos(hRad) * v - ownVn, relVeMs: Math.sin(hRad) * v - ownVe,
      altFt: t.altFt, vsFpm: t.vsFpm,
    })
  }
  const tc = tcas.step(0.5, { altFt: d.altitudeFt, aglFt: d.aglFt, vsFpm: d.verticalSpeedFpm }, tracks)
  lastTcasDebug = { level: tc.level, trackLevels: tc.tracks.filter((t) => t.level !== 'NONE').map((t) => `${t.id}:${t.level}@${Math.round(t.rangeM)}m/${Math.round(t.relAltFt)}ft`) }
  trafficDots = tc.tracks.map((t) => ({
    dNorthM: 0, dEastM: 0, relAltFt: t.relAltFt, alerted: t.level === 'TA' || t.level === 'RA',
  }))
  // Fill dot offsets from the same track list (index-aligned).
  tracks.forEach((t, i) => {
    trafficDots[i]!.dNorthM = t.relNorthM
    trafficDots[i]!.dEastM = t.relEastM
  })
  if (tc.newAural && tc.aural) annunciate(tc.aural)

  // TAWS.
  const nav = computeTunedNav(ll0, d.altitudeFt)
  const tw = taws.step(0.5, {
    aglFt: d.aglFt, altFt: d.altitudeFt, vsFpm: d.verticalSpeedFpm, gsKt: d.groundSpeedKt,
    headingDeg: d.headingDeg, rollDeg: d.rollDeg, flapsDeg: d.flapsDeg,
    sinceTakeoffS: liftoffSimS === null ? Infinity : loop.simTime - liftoffSimS,
    terrainAheadFt: (la) => {
      const elevM = aircraft.groundElevAt?.(pos.x + Math.cos(trackRad) * gsMs * la, pos.y + Math.sin(trackRad) * gsMs * la) ?? 0
      return elevM / 0.3048
    },
    nearRunwayFinal: d.aglFt < 1800 && airports.near(ll0.lat, ll0.lon, 4 * 1852).length > 0,
    // 15a Mode-5 gate: only a receivable ILS we're actually established on
    // — a stale tuned ILS from another field fired spurious GLIDESLOPE.
    gsDeviation:
      nav.hasGlideslope && nav.courseDeg !== undefined && ilsOnFinal(nav.deflectionFraction ?? 2, d.headingDeg, nav.courseDeg)
        ? nav.glideslopeFraction ?? null
        : null,
    jetProfile: !!aircraft.P.jet,
    gearDown: aircraft.gearDownCommanded && aircraft.gearPos >= 1,
  })
  if (tw.newAural && tw.aural) annunciate(tw.aural)

  const parts: string[] = []
  if (tc.level === 'TA' || tc.level === 'RA') parts.push(`⚠ ${tc.aural}`)
  if (tw.level !== 'NONE' && tw.aural) parts.push(`${tw.level === 'WARNING' ? '⛰' : '△'} ${tw.aural}`)
  safetyLine = parts.join('  ')

  // Copilot monitors on the same 2 Hz cadence (crossing detection needs
  // a stable prev sample, and callouts don't need frame rate).
  stepCopilot()
}
let lastAtcScanAt = -Infinity
let lastTowerTickAt = -Infinity
let atcMenuOpen = false

// 9A: tracked ATC reply timers. Raw setTimeout replies used to fire
// after a respawn or facility change — the old controller answering on
// the new field's frequency. Cancelled wholesale on both events.
let atcTimers: number[] = []
function atcDelay(fn: () => void, ms: number): void {
  const id = window.setTimeout(() => {
    atcTimers = atcTimers.filter((t) => t !== id)
    fn()
  }, ms)
  atcTimers.push(id)
}
function cancelAtcTimers(): void {
  for (const id of atcTimers) clearTimeout(id)
  atcTimers = []
}

/** Real taxiway idents between the aircraft and the active threshold,
 *  when the OSM layout knows them (shared by the menu, the free-text
 *  context, and the ground bridge). */
/** Remove + dispose the AI pattern ships (9A: three removal sites
 *  leaked every ship's merged geometry on facility change). */
function disposeAiShips(): void {
  for (const s of aiShips) {
    scene.remove(s.mesh.group)
    s.mesh.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) o.geometry.dispose()
    })
  }
  aiShips = []
}

function taxiRouteIdents(): string[] | undefined {
  const a = activeAtc
  if (!a) return undefined
  const segs = osmIdentSegs.get(a.ident)
  if (!segs?.length) return undefined
  const ap = airports.find(a.ident)
  const rw = ap?.r.find((r) => r.li === a.atis.activeRunway || r.hi === a.atis.activeRunway)
  if (!ap || !rw) return undefined
  const fromHigh = rw.hi === a.atis.activeRunway
  const thrLat = fromHigh ? rw.la2 : rw.la1
  const thrLon = fromHigh ? rw.lo2 : rw.lo1
  const mLat = 111_320
  const mLon = mLat * Math.cos((ap.la * Math.PI) / 180)
  const ll = frame.fromLocal(aircraft.posNed.x, aircraft.posNed.y)
  const from = { x: (ll.lon - ap.lo) * mLon, z: -(ll.lat - ap.la) * mLat }
  const to = { x: (thrLon - ap.lo) * mLon, z: -(thrLat - ap.la) * mLat }
  const ids = routeIdents(segs, from, to)
  return ids.length ? ids : undefined
}

const transcriptDiv = document.createElement('div')
transcriptDiv.style.cssText =
  'position:fixed;left:8px;bottom:8px;max-width:520px;z-index:12;font:12px/1.5 ui-monospace,monospace;' +
  'color:#cfe;background:rgba(0,10,18,.72);padding:8px 10px;border-radius:6px;white-space:pre-wrap;display:none'
document.body.appendChild(transcriptDiv)
const atcMenuDiv = document.createElement('div')
atcMenuDiv.style.cssText =
  'position:fixed;right:8px;bottom:8px;z-index:12;font:13px/1.7 ui-monospace,monospace;' +
  'color:#ffd;background:rgba(10,14,4,.85);padding:8px 12px;border-radius:6px;white-space:pre;display:none'
document.body.appendChild(atcMenuDiv)
const transcript: string[] = []
// Free-text ATC (goal: type anything, they respond — emergencies included).
const atcTypeBox = document.createElement('input')
atcTypeBox.placeholder = 'transmit to ATC — type anything, Enter to send (T)'
atcTypeBox.style.cssText =
  'position:fixed;left:8px;bottom:8px;width:504px;z-index:13;font:12px ui-monospace,monospace;' +
  'color:#dff;background:rgba(0,16,26,.9);border:1px solid #2a4a5a;border-radius:6px;padding:6px 8px;display:none'
document.body.appendChild(atcTypeBox)
atcTypeBox.addEventListener('focus', () => { disableSimInput() })
atcTypeBox.addEventListener('blur', () => { input.enabled = true })
atcTypeBox.addEventListener('keydown', (e) => {
  e.stopPropagation()
  if (e.key === 'Enter' && atcTypeBox.value.trim()) {
    const said = atcTypeBox.value.trim()
    atcTypeBox.value = ''
    sendFreeTextAtc(said)
  } else if (e.key === 'Escape') {
    atcTypeBox.style.display = 'none'
    input.enabled = true
    atcTypeBox.blur()
  }
})
function sendFreeTextAtc(said: string): void {
  if (!activeAtc) return
  const a = activeAtc
  const view = playerAtcView()
  const reply = interpretTransmission(said, {
    callsign: CALLSIGN,
    facility: `${a.ident} Tower`,
    activeRunway: a.atis.activeRunway,
    windDirDeg: wxBlended?.windDirDeg ?? 0,
    windKt: wxBlended?.windKt ?? 0,
    altimeterInHg: wxBlended?.qnhInHg,
    taxiVia: taxiRouteIdents(),
  })
  const facility = `${a.ident.startsWith('K') ? a.ident.slice(1) : a.ident} Tower`
  const keyUp = (freq: number): void => {
    // Keying the mic tunes the right facility (same auto-tune as the menu).
    radios.com1.activeMhz = freq
    comms.transmit({ freqMhz: freq, from: CALLSIGN, text: `${said}, ${CALLSIGN}`, atSimS: loop.simTime })
  }
  const sendMachine = (replies: Transmission[]): void => {
    atcDelay(() => replies.forEach((r) => comms.transmit({ ...r, atSimS: loop.simTime })), 700)
  }
  if (reply.intent === 'goAround') pilotGoAround()

  // Emergency: the free-text controller transmits its richer emergency
  // phraseology AND flags the tower strip — the flagged tick() issues
  // the landing clearance (no double request, no contradictions).
  if (reply.emergency) {
    keyUp(a.twrF)
    a.tower.declareEmergency(CALLSIGN, view)
    atcDelay(() => comms.transmit({ freqMhz: a.twrF, from: facility, text: `${CALLSIGN}, ${reply.response}`, atSimS: loop.simTime }), 1100)
    return
  }

  // Single-reply rule (Slice 5): for intents the strip machines own the
  // free-text engine is a CLASSIFIER only — the sequencing authority is
  // the ONLY transmitter (the free-text reply always cleared while the
  // tower might say "hold short": two contradictory clearances).
  const bridged: Partial<Record<string, PilotRequestKind>> = {
    takeoff: 'readyTakeoff', landing: 'inboundLanding', position: 'inboundLanding', goAround: 'goAround', taxi: 'taxiOut',
  }
  const kind = reply.bridge ? bridged[reply.intent] : undefined
  if (kind === 'taxiOut' && view.onGround) {
    keyUp(a.gndF)
    sendMachine(a.ground.request(CALLSIGN, 'taxiOut', loop.simTime, taxiRouteIdents()))
    return
  }
  if (kind && kind !== 'taxiOut') {
    // Airborne outside the approach handoff gate, an inbound call is
    // approach's business — check in there, not with the tower.
    if (kind === 'inboundLanding' && !view.onGround && view.distanceM > HANDOFF_GATE_M && !a.approach.handedOff(CALLSIGN)) {
      keyUp(a.appF)
      sendMachine(a.approach.checkIn(CALLSIGN, { distanceM: view.distanceM, aglFt: view.aglFt }, loop.simTime))
      return
    }
    keyUp(a.twrF)
    sendMachine(a.tower.request(CALLSIGN, kind, view, loop.simTime))
    return
  }

  // Non-strip intents (weather/heading/altitude/direct/radio-check/…)
  // keep the free-text controller's own reply.
  keyUp(a.twrF)
  atcDelay(() => comms.transmit({ freqMhz: a.twrF, from: facility, text: `${CALLSIGN}, ${reply.response}`, atSimS: loop.simTime }), 1100)
}

function radioSquelch(): void {
  try {
    thunderCtx ??= new AudioContext()
    const len = 0.06
    const buf = thunderCtx.createBuffer(1, thunderCtx.sampleRate * len, thunderCtx.sampleRate)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * 0.25
    const src = thunderCtx.createBufferSource()
    src.buffer = buf
    const bp = thunderCtx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1600
    src.connect(bp)
    bp.connect(thunderCtx.destination)
    src.start()
  } catch { /* pre-gesture autoplay block — fine */ }
}

/** Voice: speechSynthesis with a per-speaker voice. LIMITATION (recorded):
 *  the Web Speech API cannot route through WebAudio, so the §12.3 band-pass
 *  radio effect is approximated with squelch clicks around the utterance. */
function speak(t: Transmission): void {
  const synth = window.speechSynthesis
  if (!synth) return
  const u = new SpeechSynthesisUtterance(t.text)
  const voices = synth.getVoices()
  if (voices.length > 0) {
    let h = 0
    for (const c of t.from) h = (h * 31 + c.charCodeAt(0)) | 0
    u.voice = voices[Math.abs(h) % voices.length]!
  }
  u.rate = 1.15
  radioSquelch()
  u.onend = () => radioSquelch()
  gatedSpeak(u, 'radio')
}

comms.subscribe((t) => {
  if (!isAudible(t.freqMhz, radios.com1.activeMhz)) return // wrong freq = silence
  transcript.push(`[${t.freqMhz.toFixed(2)}] ${t.from}: ${t.text}`)
  if (transcript.length > 7) transcript.shift()
  transcriptDiv.style.display = 'block'
  transcriptDiv.textContent = transcript.join('\n')
  if (t.from !== CALLSIGN) speak(t)
})

/** Going around (9B): a captured glideslope had no un-capture path — the
 *  AP kept chasing a beam behind the aircraft. A go-around drops an
 *  approach-coupled AP to manual, like a real TOGA press. */
function pilotGoAround(): void {
  if (apState.verticalMode === 'GS' || apState.lateralMode === 'APR') {
    disconnectAutopilot(apState)
    systemsControls.apMaster = false
    toast('AP DISCONNECT — GO-AROUND')
  }
}

function playerAtcView(): TrafficView {
  const d = aircraft.data
  if (!activeAtc) return { distanceM: 0, aglFt: d.aglFt, onGround: d.onGround }
  const p = frame.toLocal(activeAtc.ll.lat, activeAtc.ll.lon)
  return {
    distanceM: Math.hypot(p.n - aircraft.posNed.x, p.e - aircraft.posNed.y),
    aglFt: d.aglFt,
    onGround: d.onGround,
  }
}

function scanAtc(lat: number, lon: number, now: number): void {
  if (now - lastAtcScanAt > 5000) {
    lastAtcScanAt = now
    const candidates = airports
      .near(lat, lon, 25_000)
      .filter((ap) => (atcFreqs[ap.i] ?? []).some((f) => f.t === 'TWR'))
      .sort((a, b) => distanceM({ lat, lon }, { lat: a.la, lon: a.lo }) - distanceM({ lat, lon }, { lat: b.la, lon: b.lo }))
    const nearest = candidates[0]
    if (nearest && activeAtc?.ident !== nearest.i) {
      const fs = atcFreqs[nearest.i]!
      const twrF = fs.find((f) => f.t === 'TWR')!.f
      const gndF = fs.find((f) => f.t === 'GND')?.f ?? twrF
      const atisF = fs.find((f) => f.t === 'ATIS')?.f ?? twrF
      const runwayHeadings = nearest.r.flatMap((r) => {
        const h = bearingDeg({ lat: r.la1, lon: r.lo1 }, { lat: r.la2, lon: r.lo2 })
        return [
          { ident: r.li, headingDeg: h },
          { ident: r.hi, headingDeg: (h + 180) % 360 },
        ]
      })
      const name = nearest.n.replace(/ (Airport|Field|Municipal.*|Regional.*|International.*)$/i, '')
      // 9A: the letter comes from the SIM clock hour (was process
      // uptime — meaningless and never advancing with time scrubs).
      const atisHour = Math.floor((baseDate.getTime() / 1000 + loop.simTime + scrubSeconds) / 3600) % 26
      const atis = buildAtis(name, wxBlended, runwayHeadings, atisHour)
      // A facility change abandons the old controller's pending replies.
      cancelAtcTimers()
      const actRw = nearest.r.find((r) => r.li === atis.activeRunway || r.hi === atis.activeRunway)
      activeAtc = {
        ident: nearest.i,
        ll: { lat: nearest.la, lon: nearest.lo },
        tower: new TowerController({
          facility: `${name} Tower`,
          freqMhz: twrF,
          activeRunway: atis.activeRunway,
          departureFreqMhz: fs.find((x) => x.t === 'DEP')?.f ?? fs.find((x) => x.t === 'APP')?.f,
          runwayLengthM: actRw
            ? distanceM({ lat: actRw.la1, lon: actRw.lo1 }, { lat: actRw.la2, lon: actRw.lo2 })
            : undefined,
        }),
        ground: new GroundController({ facility: `${name} Ground`, freqMhz: gndF, activeRunway: atis.activeRunway }),
        approach: new ApproachController({
          facility: `${name} Approach`,
          freqMhz: fs.find((x) => x.t === 'APP')?.f ?? fs.find((x) => x.t === 'DEP')?.f ?? twrF,
          activeRunway: atis.activeRunway,
          towerFreqMhz: twrF,
        }),
        appF: fs.find((x) => x.t === 'APP')?.f ?? fs.find((x) => x.t === 'DEP')?.f ?? twrF,
        atis, twrF, gndF, atisF,
        atisWx: wxDesc, atisHour,
      }
      atisPlayedFor = ''
      // Rebuild AI pattern traffic for the new field's active runway end
      // (14e: aiDensity ships with Tier-C type variety — archetype
      // silhouettes, 1 draw call each vs the old full C172 builds).
      disposeAiShips()
      const act = atis.activeRunway
      const rw = nearest.r.find((r) => r.li === act || r.hi === act)
      if (rw) {
        const fromHigh = rw.hi === act
        const thr = fromHigh ? { lat: rw.la2, lon: rw.lo2, e: rw.e2 } : { lat: rw.la1, lon: rw.lo1, e: rw.e1 }
        const far = fromHigh ? { lat: rw.la1, lon: rw.lo1 } : { lat: rw.la2, lon: rw.lo2 }
        const patternRwy = {
          thrLat: thr.lat, thrLon: thr.lon,
          headingDeg: bearingDeg({ lat: thr.lat, lon: thr.lon }, far),
          elevFt: thr.e,
        }
        for (const [cs, des, delay] of AI_ROSTER.slice(0, aiDensity)) {
          const pilot = new AiPatternPilot({
            callsign: cs, runway: patternRwy, runwayIdent: act,
            tower: activeAtc.tower, bus: comms, freqMhz: twrF, startDelayS: loop.simTime + delay,
          })
          const info = typeInfo(des)
          const m = buildArchetypeShip(archetypeFor(des, info.desc, info.wtc))
          scene.add(m.group)
          aiShips.push({ pilot, mesh: m })
        }
      }
    } else if (!nearest) {
      if (activeAtc) cancelAtcTimers()
      activeAtc = null
      disposeAiShips()
    }
  }
  if (activeAtc) {
    // 9A: a weather change or a new broadcast hour retires the whole
    // facility — the next scan rebuilds it with a fresh ATIS (the old
    // one was built once and frozen forever).
    const hourNow = Math.floor((baseDate.getTime() / 1000 + loop.simTime + scrubSeconds) / 3600) % 26
    if (activeAtc.atisWx !== wxDesc || activeAtc.atisHour !== hourNow) {
      cancelAtcTimers()
      activeAtc = null
      lastAtcScanAt = -Infinity
      return
    }
    // ATIS broadcast on tune-in.
    const key = `${activeAtc.ident}-${activeAtc.atis.letter}`
    if (isAudible(activeAtc.atisF, radios.com1.activeMhz) && atisPlayedFor !== key) {
      atisPlayedFor = key
      comms.transmit({ freqMhz: activeAtc.atisF, from: `${activeAtc.ident} ATIS`, text: activeAtc.atis.text, atSimS: loop.simTime })
    }
    if (now - lastTowerTickAt > 5000) {
      lastTowerTickAt = now
      for (const t of activeAtc.tower.tick(loop.simTime, [{ callsign: CALLSIGN, view: playerAtcView() }])) comms.transmit(t)
      {
        const v = playerAtcView()
        for (const t of activeAtc.approach.tick(loop.simTime, [{ callsign: CALLSIGN, view: { distanceM: v.distanceM, aglFt: v.aglFt } }])) comms.transmit(t)
      }
    }
  }
}

type AtcMenuItem = { label: string; run: () => void }
function atcMenuItems(): AtcMenuItem[] {
  const a = activeAtc
  if (!a) return []
  const view = playerAtcView()
  const items: AtcMenuItem[] = []
  const sendPilot = (kind: PilotRequestKind, freq: number, handle: () => Transmission[]) => {
    // The menu action includes the tune — a real pilot tunes, then keys up.
    // (Found by the §27 flight: both calls went out on the boot default
    // 118.00 and no controller ever heard them.)
    radios.com1.activeMhz = freq
    comms.transmit({ freqMhz: radios.com1.activeMhz, from: CALLSIGN, text: pilotPhrase(CALLSIGN, kind, a.atis.activeRunway), atSimS: loop.simTime })
    if (isAudible(freq, radios.com1.activeMhz)) {
      const replies = handle()
      atcDelay(() => replies.forEach((r) => comms.transmit({ ...r, atSimS: loop.simTime })), 700)
    }
  }
  if (view.onGround && a.ground.awaitingReadback(CALLSIGN)) {
    items.push({
      label: 'Read back taxi clearance',
      run: () => {
        radios.com1.activeMhz = a.gndF // readback goes to whoever issued it
        comms.transmit({
          freqMhz: radios.com1.activeMhz, from: CALLSIGN,
          text: `runway ${a.atis.activeRunway}, taxi via the parallel, hold short ${a.atis.activeRunway}, ${CALLSIGN}`,
          atSimS: loop.simTime,
        })
        if (isAudible(a.gndF, radios.com1.activeMhz)) {
          const replies = a.ground.readback(CALLSIGN, 'taxiOut', loop.simTime)
          atcDelay(() => replies.forEach((r) => comms.transmit({ ...r, atSimS: loop.simTime })), 700)
        }
      },
    })
  } else if (view.onGround) {
    // N7: name REAL taxiways when the OSM layout knows them (shared
    // helper — same route the free-text bridge names).
    items.push({ label: `Request taxi (Ground ${a.gndF.toFixed(2)})`, run: () => sendPilot('taxiOut', a.gndF, () => a.ground.request(CALLSIGN, 'taxiOut', loop.simTime, taxiRouteIdents())) })
    items.push({ label: `Ready for departure (Tower ${a.twrF.toFixed(2)})`, run: () => sendPilot('readyTakeoff', a.twrF, () => a.tower.request(CALLSIGN, 'readyTakeoff', playerAtcView(), loop.simTime)) })
  } else {
    // Gate aligned OUTSIDE the 8 nm handoff gate (the old 4 nm menu gate
    // sat inside it — a late check-in fired the whole ladder in one tick).
    if (!a.approach.handedOff(CALLSIGN) && view.distanceM > HANDOFF_GATE_M) {
      items.push({
        label: `Check in with approach (App ${a.appF.toFixed(2)})`,
        run: () => {
          radios.com1.activeMhz = a.appF
          const v = playerAtcView()
          comms.transmit({ freqMhz: a.appF, from: CALLSIGN, text: `${Math.max(1, Math.round(v.distanceM / 1852))} miles out, inbound with the ATIS, request ILS runway ${a.atis.activeRunway}, ${CALLSIGN}`, atSimS: loop.simTime })
          const replies = a.approach.checkIn(CALLSIGN, { distanceM: v.distanceM, aglFt: v.aglFt }, loop.simTime)
          atcDelay(() => replies.forEach((r) => comms.transmit({ ...r, atSimS: loop.simTime })), 700)
        },
      })
    }
    items.push({ label: `Inbound for landing (Tower ${a.twrF.toFixed(2)})`, run: () => sendPilot('inboundLanding', a.twrF, () => a.tower.request(CALLSIGN, 'inboundLanding', playerAtcView(), loop.simTime)) })
    items.push({ label: 'Going around', run: () => { pilotGoAround(); sendPilot('goAround', a.twrF, () => a.tower.request(CALLSIGN, 'goAround', playerAtcView(), loop.simTime)) } })
  }
  return items
}

function renderAtcMenu(): void {
  if (!atcMenuOpen || !activeAtc) {
    atcMenuDiv.style.display = 'none'
    atcTypeBox.style.display = 'none'
    if (document.activeElement === atcTypeBox) { atcTypeBox.blur(); input.enabled = true }
    return
  }
  const items = atcMenuItems()
  atcMenuDiv.style.display = 'block'
  // Free-text transmit box rides with the ATC panel (click to type).
  atcTypeBox.style.display = 'block'
  atcMenuDiv.textContent =
    `ATC — ${activeAtc.ident} (ATIS ${activeAtc.atisF.toFixed(2)})\n` +
    items.map((it, i) => ` ${i + 1}. ${it.label}`).join('\n') +
    `\n T close`
}

// ---- FIS-B NEXRAD + in-world precip/lightning (Phase 5 step 5) ----
const nexrad = new NexradField()
let nexradMfdCells: Array<{ dNorthM: number; dEastM: number; intensity: 1 | 2 | 3 }> = []
let lastRadarCellsAt = -Infinity
let nextLightningAt = 0
let appliedWxVisM = 45 * 1609
const lightningFlash = document.createElement('div')
lightningFlash.style.cssText =
  'position:fixed;inset:0;pointer-events:none;z-index:6;opacity:0;background:#eaf2ff;transition:opacity 90ms linear'
document.body.appendChild(lightningFlash)

/** Low rumble via WebAudio, delayed by distance at the call site. No sample
 *  assets — synthesized noise burst (full sound design is Phase 9 §16). */
let thunderCtx: AudioContext | null = null
function thunder(): void {
  try {
    thunderCtx ??= new AudioContext()
    const len = 1.8
    const buf = thunderCtx.createBuffer(1, thunderCtx.sampleRate * len, thunderCtx.sampleRate)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < ch.length; i++) {
      const t = i / ch.length
      ch[i] = (Math.random() * 2 - 1) * Math.exp(-3.2 * t) * (1 - Math.exp(-50 * t))
    }
    const src = thunderCtx.createBufferSource()
    src.buffer = buf
    const lp = thunderCtx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 200
    const gain = thunderCtx.createGain()
    gain.gain.value = 0.45
    src.connect(lp)
    lp.connect(gain)
    gain.connect(thunderCtx.destination)
    src.start()
  } catch {
    // Autoplay policy blocks audio before a user gesture — visual-only then.
  }
}

function updateRadar(lat: number, lon: number, now: number): void {
  nexrad.update(lat, lon, now)
  if (now - lastRadarCellsAt < 5000) return
  lastRadarCellsAt = now
  const mLat = 111_320
  const mLon = mLat * Math.cos((lat * Math.PI) / 180)
  nexradMfdCells = nexrad.cellsNear(lat, lon, 45 * 1852).map((c) => ({
    dNorthM: (c.lat - lat) * mLat,
    dEastM: (c.lon - lon) * mLon,
    intensity: c.intensity,
  }))
  // In-precip visibility: radar returns cap visibility below the METAR value
  // while inside a cell (light 5 SM / moderate 2.5 / heavy 1).
  const here = nexrad.intensityAt(lat, lon)
  const radarVisM = here > 0 ? [0, 5, 2.5, 1][here]! * 1609 : Infinity
  tiles.setVisibilityM(Math.min(appliedWxVisM, radarVisM))
  // Lightning near heavy cells: flash now, thunder delayed by distance.
  const heavyDistM = nexrad.nearestHeavyM(lat, lon, 25_000)
  if (heavyDistM !== null && now >= nextLightningAt) {
    nextLightningAt = now + 5000 + Math.random() * 12_000
    lightningFlash.style.opacity = '0.8'
    setTimeout(() => (lightningFlash.style.opacity = '0'), 110)
    setTimeout(thunder, (heavyDistM / 340) * 1000)
  }
}

function applyBlendedWeather(b: BlendedWeather | null): void {
  wxBlended = b
  if (!b) {
    // No usable stations here (e.g. just teleported, region refetch still in
    // flight): neutral conditions, empty readout — never leave the previous
    // region's weather applied at the new position (§1).
    wxDesc = ''
    wxSlabs = []
    aircraft.isaTempOffsetC = 0
    qnhInHg = 29.92
    wind.setSteady(0, 0)
    wind.intensity = 0
    appliedWxVisM = 45 * 1609
    tiles.setVisibilityM(appliedWxVisM)
    return
  }
  wxSlabs = cloudSlabs(b.clouds, b.stationElevFt)
  wind.setSteady(b.windDirDeg, b.windKt, b.gustKt)
  wind.intensity = Math.min(Math.max((b.gustKt - b.windKt) / 8, 0), 2)
  aircraft.isaTempOffsetC = b.isaTempOffsetC
  qnhInHg = b.qnhInHg
  appliedWxVisM = (b.visibilitySm >= 10 ? 45 : b.visibilitySm) * 1609
  tiles.setVisibilityM(appliedWxVisM)
  const cl = b.clouds[0] ? ` ${b.clouds[0].cover}${String(Math.round(b.clouds[0].baseFt / 100)).padStart(3, '0')}` : ''
  wxDesc = `${b.nearestStation} ${String(b.windDirDeg).padStart(3, '0')}@${Math.round(b.windKt)}` +
    `${b.gustKt > b.windKt + 3 ? `G${Math.round(b.gustKt)}` : ''} ${b.visibilitySm}SM${cl} ISA${b.isaTempOffsetC >= 0 ? '+' : ''}${b.isaTempOffsetC.toFixed(0)}`
}

function rebaseIfNeeded(): void {
  const n = aircraft.posNed.x
  const e = aircraft.posNed.y
  if (Math.hypot(n, e) < 10_000) return
  frame.anchor = frame.fromLocal(n, e)
  aircraft.posNed.x = 0
  aircraft.posNed.y = 0
  tiles.onRebase()
  airports.positionAll()
  camera.position.x -= e
  camera.position.z += n
  chase.shiftWorld(-e, n)
  worldShift.e += e
  worldShift.n += n
  clouds.onRebase()
}

/** Verification-only wings-leveler/coordinator (mirrors the headless test
 *  pilots) so scripted flights don't torque-spiral; toggled via __ohHold. */
let holdWingsLevel = false
/** Verification-only control overrides — applied AFTER keyboard polling
 *  (which writes the axes every frame), else scripts get wiped to zero. */
let ctlOverride: Record<string, number> | null = null

// ---- Phase 4 Task 6: NAV1 CDI source resolution ----

/**
 * What NAV1 is actually receiving right now, given its tuned active
 * frequency and the aircraft's position: a real ILS localizer/glideslope
 * (via the known-ILS stopgap table + real runway threshold geometry, see
 * `tuning.ts`'s header for why a table is needed at all), a real VOR radial,
 * or — honestly — nothing (`NO_NAV_RESULT`), never a fabricated signal.
 */
function computeTunedNav(aircraftLL: { lat: number; lon: number }, altitudeFt: number): TunedNavResult {
  const activeMhz = radios.nav1.activeMhz
  for (const ap of airports.near(aircraftLL.lat, aircraftLL.lon, 30 * 1852)) {
    const known = findKnownIls(ap.i, activeMhz)
    if (!known) continue
    const rwy = ap.r.find((r) => r.li === known.runway || r.hi === known.runway)
    if (!rwy) continue
    const fromHigh = rwy.hi === known.runway
    const threshold = fromHigh ? { lat: rwy.la2, lon: rwy.lo2, elevFt: rwy.e2 } : { lat: rwy.la1, lon: rwy.lo1, elevFt: rwy.e1 }
    const opposite = fromHigh ? { lat: rwy.la1, lon: rwy.lo1 } : { lat: rwy.la2, lon: rwy.lo2 }
    const ils = ilsRefFromRunwayThreshold({
      thresholdLat: threshold.lat, thresholdLon: threshold.lon, thresholdElevFt: threshold.elevFt,
      oppositeLat: opposite.lat, oppositeLon: opposite.lon,
    })
    const loc = localizerFraction(ils, aircraftLL)
    const gs = glideslopeFraction(ils, aircraftLL, altitudeFt)
    return {
      source: 'LOC', identifier: `${ap.i} ${known.runway}`,
      deflectionFraction: loc.deflectionFraction, hasGlideslope: true, glideslopeFraction: gs,
      stationRangeM: distanceM(aircraftLL, { lat: threshold.lat, lon: threshold.lon }),
      courseDeg: ils.courseDeg,
    }
  }
  const nearbyNavaids = navaidsIndex.near(aircraftLL.lat, aircraftLL.lon, 200 * 1852)
  const vor = findTunedVor(nearbyNavaids, activeMhz)
  if (vor) {
    const r = vorCdiFraction(vor, radios.obs1Deg, aircraftLL)
    return {
      source: 'VOR', identifier: vor.i, deflectionFraction: r.deflectionFraction,
      toFrom: r.toFrom, hasGlideslope: false,
      stationRangeM: distanceM(aircraftLL, { lat: vor.la, lon: vor.lo }),
    }
  }
  return NO_NAV_RESULT
}

/** GPS/flight-plan CDI, if a flight plan is loaded and has an active leg —
 *  undefined (not zero) when there's genuinely nothing to track, same
 *  anti-faking rule as `computeTunedNav`. */
function computeGpsCdi(aircraftLL: { lat: number; lon: number }): { deflectionFraction: number } | undefined {
  const legs = flightPlan.legs()
  if (legs.length === 0) return undefined
  const progress = activeLegProgress(legs, aircraftLL)
  if (!progress) return undefined
  const phase = determinePhase({
    distFromDepartureNm: Infinity,
    distToDestinationNm: progress.distanceRemainingM / 1852,
    onFinalApproachSegment: progress.legIndex === legs.length - 1,
  })
  return gpsCdiDeflection(progress.crossTrackNm, phase)
}

let mfdPage: 'map' | 'lean' | 'fpl' | 'wb' = 'map'
/** Last computed in-airspace result (Phase 4 Task 5 wiring) — updated once
 *  per frame in `advanceFrame`, exposed via `__ohAirspace` for a later
 *  acceptance task to verify "the sim knows when the aircraft is inside the
 *  Bravo shelf" without needing its own polygon math. */
let currentAirspace: AirspacePolygon[] = []

// ---- §23 perf instrumentation (13a): full-frame cost ring + draw calls ----
const perfRing = new Float32Array(180)
let perfIdx = 0
let perfCount = 0

function advanceFrame(elapsed: number, now: number): void {
  const perfT0 = performance.now()
  handleDiscreteKeys()
  pollControls(elapsed)
  if (ctlOverride) Object.assign(aircraft.controls, ctlOverride)
  if (holdWingsLevel) {
    const rollRad = (aircraft.data.rollDeg * Math.PI) / 180
    aircraft.controls.roll = Math.min(Math.max(-1.4 * rollRad - 0.4 * aircraft.rates.x, -1), 1)
    const betaRad = (aircraft.data.betaDeg * Math.PI) / 180
    aircraft.controls.yaw = Math.min(Math.max(1.8 * betaRad - 0.9 * aircraft.rates.z, -1), 1)
  }

  // ---- Phase 4 Task 6: nav-source resolution + autopilot, once per
  // rendered frame (not re-resolved every fixed sub-tick — the aircraft
  // moves negligibly relative to navaid/runway geometry within one frame,
  // same "doesn't need to be literally every physics tick" latitude the
  // task brief gives airspace detection). Computed against the position at
  // the *start* of this frame, one frame stale at most.
  const preStepLL = frame.fromLocal(aircraft.posNed.x, aircraft.posNed.y)
  const tunedNav = computeTunedNav(preStepLL, aircraft.data.altitudeFt)
  const gpsCdi = computeGpsCdi(preStepLL)
  let navDeviationForAp = 0
  let glideslopeDeviationForAp = 0
  let navRangeForAp: number | undefined
  if (apTargets.lateralMode === 'APR' || apTargets.lateralMode === 'BC') {
    // SIGN CONTRACT (found by round-4's independent review — the un-negated
    // feed made app-side APR diverge even after the control law was fixed):
    // `localizerDeflection` is positive = aircraft LEFT of course;
    // `AutopilotInputs.navDeviation` requires positive = RIGHT of course.
    navDeviationForAp = tunedNav.source === 'LOC' ? -tunedNav.deflectionFraction : 0
    glideslopeDeviationForAp = tunedNav.hasGlideslope ? tunedNav.glideslopeFraction ?? 0 : 0
    navRangeForAp = tunedNav.source === 'LOC' ? tunedNav.stationRangeM : undefined
  } else if (apTargets.lateralMode === 'NAV') {
    // GPS CDI is already in the AP's aircraft-offset convention (positive =
    // right of course, fixed-width scale). VOR is a NEEDLE deflection like
    // LOC (positive = course to the right) → negate, and pass range since
    // it's an angular source (round-4 review finding).
    navDeviationForAp = gpsCdi ? gpsCdi.deflectionFraction : tunedNav.source === 'VOR' ? -tunedNav.deflectionFraction : 0
    navRangeForAp = !gpsCdi && tunedNav.source === 'VOR' ? tunedNav.stationRangeM : undefined
  }
  const pfdCdi: PfdInput['cdi'] = tunedNav.source
    ? { source: tunedNav.source, deflectionFraction: tunedNav.deflectionFraction, toFrom: tunedNav.toFrom, identifier: tunedNav.identifier }
    : gpsCdi
      ? // GPS fraction is aircraft-offset (positive = right of course); the
        // needle is fly-toward (positive = course to the right) → negate for
        // display, matching how VOR/LOC already arrive in needle convention.
        { source: 'GPS', deflectionFraction: -gpsCdi.deflectionFraction }
      : undefined

  let remaining = elapsed
  while (remaining > 1e-6) {
    const chunk = Math.min(remaining, 0.25)
    loop.advance(chunk, (dt) => {
      wind.step(dt, aircraft.windNed)

      stepAutopilot(apState, dt, {
        iasKt: aircraft.data.kias,
        altitudeFt: aircraft.data.altitudeFt,
        verticalSpeedFpm: aircraft.data.verticalSpeedFpm,
        headingDeg: aircraft.data.headingDeg,
        pitchDeg: aircraft.data.pitchDeg,
        rollDeg: aircraft.data.rollDeg,
        masterEnabled: systemsControls.apMaster,
        lateralMode: apTargets.lateralMode,
        verticalMode: apTargets.verticalMode,
        headingBugDeg: apTargets.headingBugDeg,
        altitudeBugFt: apTargets.altitudeBugFt,
        vsTargetFpm: apTargets.vsTargetFpm,
        iasTargetKt: apTargets.iasTargetKt,
        bankCommandDeg: apTargets.bankCommandDeg,
        pitchCommandDeg: apTargets.pitchCommandDeg,
        navDeviation: navDeviationForAp,
        glideslopeDeviation: glideslopeDeviationForAp,
        navRangeM: navRangeForAp,
        trackDeg: aircraft.data.trackDeg,
      })
      // While localizer TRACKING is active, the heading bug is this AP's
      // course datum — pin it to the front course continuously (a real
      // GFC700 reads the CDI course input and ignores the bug here; leaving
      // it >25° off-course starves the tracking law's intercept authority —
      // the second app-side divergence round-4's review found). Continuous,
      // not edge-triggered: stepAutopilot can arm AND capture within one
      // step when APR is engaged already inside half-scale (reviewer's
      // instant-capture repro), so a captured-transition detector never
      // fires on that path.
      if (
        !apState.lateralArmed &&
        (apTargets.lateralMode === 'APR' || apTargets.lateralMode === 'BC') &&
        tunedNav.courseDeg !== undefined
      ) {
        apTargets.headingBugDeg = Math.round(tunedNav.courseDeg)
      }
      // Servos take the yoke when engaged — overwrites the same
      // `aircraft.controls` fields `pollControls`/`CockpitInteraction` write,
      // exactly like a real AP servo clutch; when disengaged those two
      // input paths are untouched (see `AutopilotState.rollCmd` etc.'s doc:
      // they rate-limit to 0 on disconnect rather than snapping, so this
      // assignment is always well-defined even mid-disconnect).
      if (apState.masterEnabled) {
        aircraft.controls.pitch = apState.pitchCmd
        aircraft.controls.roll = apState.rollCmd
        aircraft.controls.yaw = apState.yawCmd
        aircraft.controls.trim = apState.trimCommand
      }

      aircraft.step(dt)

      // ---- systems (Phase 3 §8) — fixed-timestep, same cadence as
      // aircraft.step. Order matters: fuel's `fuelFlowing` must be fresh
      // before engine-start reads it, and engine-start's status must be
      // fresh before electrical reads `aircraft.engineRunning`.
      stepFuel(fuelState, dt, {
        selector: systemsControls.fuelSelector,
        boostPumpOn: systemsControls.boostPumpOn,
        demandKgS: aircraft.prop.fuelFlowKgS,
        // FUEL LOW scaled to THIS type's tankage (~7.5% of capacity,
        // floor 8 kg; none for fuel-less gliders) — the C172 constant
        // warned an A380 at 36 kg and gliders permanently.
        lowFuelKg: aircraft.P.fuelCapacityKg < 1 ? 0 : Math.max(aircraft.P.fuelCapacityKg * 0.075, 8),
      })
      // `fuelState.leftKg`/`rightKg` (this file) is the authoritative fuel
      // ledger — it's the only one that knows about the selector/starvation
      // logic (a tank can run dry while the other is full). `aircraft.fuelKg`
      // (src/sim/aircraft.ts) is a single-pool mirror that `aircraft.step()`
      // above already decremented by the same `prop.fuelFlowKgS * dt` this
      // tick, blind to per-tank state; overwriting it here from the fresh
      // `fuelState` sum makes it track the authoritative ledger exactly
      // (mass/propulsion gating in Aircraft still reads `fuelKg` as before)
      // instead of drifting as an independent second ledger. Not a double
      // decrement: this replaces aircraft.step()'s decrement for the tick
      // rather than subtracting again.
      aircraft.fuelKg = fuelState.leftKg + fuelState.rightKg
      stepEngineStart(engineStartState, dt, {
        masterBattery: systemsControls.masterBattery,
        starterEngaged: systemsControls.starterEngaged,
        magneto: systemsControls.magneto,
        mixtureRich: aircraft.controls.mixture > 0.9,
        throttleFrac: aircraft.controls.throttle,
        fuelAvailable: fuelState.fuelFlowing,
        hotEngine: false,
        floodedEngine: false,
        primed: false,
        hasElectrical: aircraft.P.electrical !== false,
        handPropPull: handPropRequested,
      })
      handPropRequested = false // momentary — one compression stroke per press
      aircraft.engineRunning = engineStartState.status === 'running'
      // Carb ice (11b/11g): carbureted engines only; injected/jet see 1.
      if (aircraft.P.carburetor) {
        const oatCNow = isa(Math.max(aircraft.data.altitudeFt, 0) * FT).temperatureK - 273.15 + aircraft.isaTempOffsetC
        stepCarbIce(carbIceState, dt, {
          carburetor: true,
          carbHeatOn,
          powerFrac: Math.min(Math.max(aircraft.data.shaftPowerW / aircraft.P.ratedPowerW, 0), 1),
          oatC: oatCNow,
          dewpointC: oatCNow - wxTempDewSpreadC,
        })
        aircraft.intakePowerFactor = carbIcePowerFactor(carbIceState, carbHeatOn)
      } else {
        aircraft.intakePowerFactor = 1
      }
      stepElectrical(electricalState, dt, {
        masterBattery: systemsControls.masterBattery,
        masterAlternator: systemsControls.masterAlternator,
        avionicsSwitch: systemsControls.avionicsSwitch,
        alternatorFailed: failures.alternatorFailed,
        engineRunning: aircraft.engineRunning,
      })
      const oatC = isa(Math.max(aircraft.data.altitudeFt, 0) * FT).temperatureK - 273.15
      stepEngineTemps(engineTemps, dt, aircraft.data.rpm, aircraft.P.redlineRpm, aircraft.engineRunning, oatC)
    })
    remaining -= chunk
  }

  rebaseIfNeeded()
  const pos = aircraft.posNed
  const ll = frame.fromLocal(pos.x, pos.y)
  tiles.update(pos.x, pos.y)
  if (now - lastVisualUpdate > 2000) {
    lastVisualUpdate = now
    airports.updateVisuals(ll.lat, ll.lon)
  }
  airports.positionAll()
  updateLiveWeather(ll.lat, ll.lon, now)
  updateLiveTraffic(ll.lat, ll.lon, now)
  trafficLayer.update(
    liveTraffic.targets.values(),
    (la, lo) => frame.toLocal(la, lo),
    (la, lo) => tiles.elevationAt(la, lo),
    camera,
    now / 1000,
    // Real frame dt (Slice 7): `now - lastFrame` was ALWAYS 0 here
    // (lastFrame is re-stamped before advanceFrame runs), so the || made
    // every frame 1/60 — ADS-B targets drifted at the wrong rate at any
    // fps other than 60.
    Math.min(elapsed || 1 / 60, 0.5),
  )
  updateRadar(ll.lat, ll.lon, now)
  scanAtc(ll.lat, ll.lon, now)
  updateSafety(now)
  updateRecorder(ll)
  if (atcMenuOpen) renderAtcMenu()
  for (const { pilot: p, mesh: m } of aiShips) {
    // 15c: AI steps with SIM dt — wall-dt made time-accel leave the
    // pattern ships behind. Slice 7: step the SAME total sim time the
    // physics consumed, in bounded chunks — the old single clamped
    // 0.25 s step fell 4× behind on long background ticks.
    let aiRem = elapsed * loop.getRate()
    while (aiRem > 1e-6) {
      const c = Math.min(aiRem, 0.25)
      p.step(c, loop.simTime)
      aiRem -= c
    }
    const lp = frame.toLocal(p.plane.lat, p.plane.lon)
    m.group.position.set(lp.e, p.plane.altFt * 0.3048, -lp.n)
    m.group.rotation.order = 'YXZ'
    m.group.rotation.y = (-p.plane.headingDeg * Math.PI) / 180
    updateProp(m, p.phase === 'pattern' ? 2400 : 800, elapsed)
  }

  // Phase 4 Task 5 wiring: in-airspace detection, once per rendered frame
  // (airspace shelves are large relative to per-tick aircraft motion — the
  // task brief explicitly allows a "reasonable update cadence", not every
  // physics tick).
  currentAirspace = airspacesContaining(ll, aircraft.data.altitudeFt, airspacePolygons)

  mesh.group.position.set(pos.y, -pos.z, -pos.x)
  const d = aircraft.data
  mesh.group.rotation.order = 'YXZ'
  mesh.group.rotation.y = (-d.headingDeg * Math.PI) / 180
  mesh.group.rotation.x = (d.pitchDeg * Math.PI) / 180
  mesh.group.rotation.z = (-d.rollDeg * Math.PI) / 180
  updateProp(mesh, d.rpm, elapsed)
  mesh.surfaces?.({
    flapFrac: aircraft.flapsDeg / Math.max(FLEET_ACTIVE.params.flapDetentsDeg[FLEET_ACTIVE.params.flapDetentsDeg.length - 1] ?? 1, 1),
    spoilerFrac: aircraft.spoilerPos,
    roll: aircraft.controls.roll,
    gearPos: aircraft.gearPos,
    reverseFrac: aircraft.reversePos,
  })

  engineSound.update({
    rpm: d.rpm,
    powerFrac: aircraft.P.jet
      ? Math.min(Math.max(d.n1Pct / 100, 0), 1)
      : Math.min(Math.max(d.shaftPowerW / aircraft.P.ratedPowerW, 0), 1),
    jet: !!aircraft.P.jet,
    n1Pct: d.n1Pct,
    iasKt: d.kias,
    gsKt: d.groundSpeedKt,
    onGround: d.onGround,
    // sigmoid stallFraction hits 0.08 ~2.8° below the stall peak — the AoA
    // vane's 5-8 kt early warning, tracking flap config for free. alphaDeg>0
    // because stallFraction is max(positive, negative-stall) and the vane
    // only lifts at high positive AoA (found in-browser: a hard push at 70 kt
    // fired the horn off the negative branch).
    stallWarn: !!aircraft.P.stallHorn && d.stallFraction > 0.08 && d.alphaDeg > 0 && !d.onGround && d.kias > 40 && !aircraft.crashed,
    engineRunning: aircraft.engineRunning,
  })

  // Slice 3: the cockpit shell (roof beam, pillars, panel) is sized for
  // the interior eyepoint, not the exterior silhouette — it must never
  // ride on top of the outside view (it poked through the C172's roof).
  // Hiding it outside cockpit mode also drops its draw calls.
  cockpit.group.visible = cameraMode === 'cockpit'
  if (cameraMode === 'chase') chase.update(elapsed, mesh.group.position, (d.headingDeg * Math.PI) / 180)
  else if (cameraMode === 'orbit') orbit.update(input, mesh.group.position)
  else if (cameraMode === 'cockpit') {
    // The shared camera's default near plane (0.5 m, `scene.ts`) is tuned
    // for exterior views of a ~2 m aircraft — every cockpit control sits
    // well inside that distance from the eyepoint, so it must shrink while
    // in this mode or the whole panel clips out of view. Restored on the
    // else-branch below when leaving cockpit mode.
    if (camera.near !== COCKPIT_NEAR) {
      camera.near = COCKPIT_NEAR
      camera.updateProjectionMatrix()
    }
    cockpitInteraction.update(input, cockpit, systemsControls, aircraft.controls, radios)
    // 15c: MFD softkey routing (MAP/ENGINE/FPL switch pages; the rest of
    // the representative bezel set answers honestly INOP).
    const sk = cockpitInteraction.consumeSoftkey()
    if (sk) {
      if (sk === 'MAP') mfdPage = 'map'
      else if (sk === 'ENGINE') mfdPage = 'lean'
      else if (sk === 'FPL') mfdPage = 'fpl'
      else toast(`SOFTKEY ${sk} — INOP (representative bezel set)`)
    }
    cockpitCam.update(
      mesh.group.position,
      (d.headingDeg * Math.PI) / 180,
      (d.pitchDeg * Math.PI) / 180,
      (d.rollDeg * Math.PI) / 180,
      input,
      !cockpitInteraction.isDraggingControl,
    )
  } else {
    if (camera.near !== DEFAULT_NEAR) {
      camera.near = DEFAULT_NEAR
      camera.updateProjectionMatrix()
    }
    freeCam.update(elapsed, input)
  }

  const switchStates: Record<SwitchId, boolean> = {
    masterBattery: systemsControls.masterBattery,
    masterAlternator: systemsControls.masterAlternator,
    avionicsSwitch: systemsControls.avionicsSwitch,
    pitotHeat: systemsControls.pitotHeat,
    apMaster: systemsControls.apMaster,
    boostPump: systemsControls.boostPumpOn,
  }
  updateCockpitControls(
    cockpit,
    switchStates,
    aircraft.controls.throttle,
    aircraft.controls.mixture,
    aircraft.controls.flapsIndex,
    aircraft.controls.trim,
    aircraft.controls.pitch,
    aircraft.controls.roll,
  )
  const pitotReadings = pitotSystem.step({
    trueIasKt: d.kias,
    trueAltFt: d.altitudeFt,
    trueVsiFpm: d.verticalSpeedFpm,
    pitotHeatOn: systemsControls.pitotHeat,
    icingConditions: failures.icingConditions,
    staticBlocked: failures.staticBlocked,
  })
  const annunciations: string[] = []
  if (!electricalState.mainBusPowered) annunciations.push('AVIONICS BUS OFF')
  if (failures.alternatorFailed) annunciations.push('ALTERNATOR FAIL')
  if (fuelState.lowFuelFlag) annunciations.push('FUEL LOW')
  if (!fuelState.fuelFlowing) annunciations.push('FUEL STARV')
  updateCockpitDisplays(
    cockpit,
    {
      vSpeeds: aircraft.P.vSpeeds,
      iasKt: pitotReadings.iasKt,
      iasTrendKtPerS: 0,
      pitchDeg: d.pitchDeg,
      rollDeg: d.rollDeg,
      slipSkidDeg: d.betaDeg,
      altitudeFt: indicatedAltitudeFt(pitotReadings.altFt, baroSetInHg, qnhInHg),
      verticalSpeedFpm: pitotReadings.vsiFpm,
      baroInHg: baroSetInHg,
      headingDeg: d.headingDeg,
      headingBugDeg: apTargets.headingBugDeg,
      windDirDeg: windDirFromNed(aircraft.windNed),
      windSpeedKt: Math.hypot(aircraft.windNed.x, aircraft.windNed.y) / KT,
      ktas: d.ktas,
      groundSpeedKt: d.groundSpeedKt,
      oatC: isa(Math.max(d.altitudeFt, 0) * FT).temperatureK - 273.15 + aircraft.isaTempOffsetC,
      nav1: radios.nav1,
      com1: radios.com1,
      squawk: '1200',
      annunciations,
      cdi: pfdCdi,
      fd: { pitchDeg: apState.fdPitchDeg, bankDeg: apState.fdBankDeg },
      apAnnunciation: {
        masterEnabled: apState.masterEnabled,
        lateralMode: apState.lateralMode,
        lateralArmed: apState.lateralArmed,
        verticalMode: apState.verticalMode,
        verticalArmed: apState.verticalArmed,
      },
    },
    {
      page: mfdPage,
      rpm: d.rpm,
      fuelFlowGph: d.fuelFlowGph,
      n1Pct: aircraft.P.jet ? d.n1Pct : undefined,
      ffKgH: aircraft.P.jet ? aircraft.prop.fuelFlowKgS * 3600 : undefined,
      redlineRpm: aircraft.P.redlineRpm,
      mixture: aircraft.controls.mixture,
      engineTemps,
      fuelLeftKg: fuelState.leftKg,
      fuelRightKg: fuelState.rightKg,
      fuelCapPerSideKg: aircraft.P.fuelCapacityKg / 2,
      electrical: {
        busVoltage: electricalState.busVoltage,
        alternatorAmps: electricalState.alternatorAmps,
        batteryAmps: electricalState.batteryAmps,
      },
      wb: mfdPage === 'wb'
        ? (fleetKey === '172'
          ? { ...c172WeightBalance(aircraft.P.emptyMassKg, aircraft.payloadKg, aircraft.fuelKg), fwdLimitIn: C172S_ENVELOPE.fwdLimitIn, aftLimitIn: C172S_ENVELOPE.aftLimitIn, maxGrossLb: C172S_ENVELOPE.maxGrossLb }
          : null)
        : undefined,
      map: mfdPage === 'map' ? {
        aircraftLat: ll.lat,
        aircraftLon: ll.lon,
        headingDeg: d.headingDeg,
        rangeM: 20 * 1852,
        trackUp: false,
        airports: airports.near(ll.lat, ll.lon, 60 * 1852).map((ap) => ({ id: ap.i, name: ap.n, lat: ap.la, lon: ap.lo })),
        airspace: currentAirspace,
        aircraftAglFt: d.aglFt,
        radarCells: nexradMfdCells,
        trafficDots,
        radarAgeMin: nexrad.ageMin(now),
      } : undefined,
    },
  )

  if (aircraft.P.jet) updateEicas(cockpit, { n1Pct: d.n1Pct, ffKgH: aircraft.prop.fuelFlowKgS * 3600 })
  updateMcp(cockpit, {
    iasKt: apTargets.iasTargetKt,
    hdgDeg: apTargets.headingBugDeg,
    altFt: apTargets.altitudeBugFt,
    vsFpm: apTargets.vsTargetFpm,
    master: apState.masterEnabled,
    lateral: apState.lateralMode,
    vertical: apState.verticalMode,
    lateralArmed: apState.lateralArmed,
    verticalArmed: apState.verticalArmed,
  })

  const simDate = new Date(baseDate.getTime() + (loop.simTime + scrubSeconds) * 1000)
  sky.updateEnvironment(renderer, scene)
  sky.setShadowTarget(mesh.group.position)
  shadowCatcher.update(
    mesh.group.position.x,
    (aircraft.groundElevAt?.(pos.x, pos.y) ?? 0),
    mesh.group.position.z,
  )
  const sunDir = sky.update(simDate, ll.lat, ll.lon)
  const dayness = Math.min(Math.max((sky.elevationDeg + 6) / 16, 0), 1)
  // 13e: METAR surface wind drives the sea state; sun-position dusk factor
  // (peaks with the sun at the horizon) warms the cloud decks.
  ocean.update(now / 1000, sunDir, dayness, wind.steadyMs, wind.steadyTowardRad)
  const dusk = Math.min(Math.max(1 - Math.abs(sky.elevationDeg) / 8, 0), 1)
  const lowSunT = Math.min(1, Math.max(0, 1 - sky.elevationDeg / 25))
  tiles.setLight(sunDir, dayness, lowSunT * lowSunT * (3 - 2 * lowSunT))
  clouds.update(wxSlabs, camera.position, worldShift.e, worldShift.n, dayness, sunDir, dusk)
  // 13c night lights: airport layer + aircraft exterior lights.
  const night = Math.min(Math.max(1 - dayness * 1.6, 0), 1)
  airports.updateNight(loop.simTime, night)
  // 13d PAPI: colored from the camera's real elevation angle each frame.
  airports.updatePapi(camera.position.x, camera.position.y, camera.position.z)
  // Jets: the electrical model is piston-only (bus reads 0 V), which
  // silently killed every exterior light on the 737/airliners — found by
  // the user. Until a jet electrical model exists, jets count as powered
  // (recorded simplification).
  const lightsPowered = aircraft.P.jet ? true : aircraft.P.electrical !== false && electricalState.busVoltage > 18
  aircraftLights.update(
    loop.simTime, lightsPowered, aircraft.data.aglFt * FT, mesh.group,
    (xE, zS) => {
      const g = frame.fromLocal(-zS, xE)
      return tiles.elevationAt(g.lat, g.lon)
    },
  )
  const obscuration = inCloudFactor(wxSlabs, aircraft.data.altitudeFt)
  whiteout.style.opacity = String(obscuration)
  whiteout.style.background = dayness > 0.4 ? '#c8ccd2' : '#14161a'

  hud.update(
    {
      simDate,
      simRate: loop.getRate(),
      flight: aircraft.data,
      aircraftLabel: FLEET_ACTIVE.label,
      gear: aircraft.P.gearRetractable
        ? aircraft.gearPos >= 1 ? 'DOWN' : aircraft.gearPos <= 0 ? 'UP' : 'TRANSIT'
        : undefined,
      ffKgH: aircraft.P.jet ? aircraft.prop.fuelFlowKgS * 3600 : undefined,
      throttlePct: aircraft.controls.throttle,
      trimPct: aircraft.controls.trim,
      cameraMode,
      tilesReady: tiles.readyCount,
      wx: wxDesc || undefined,
      // Safety strict priority (9A): a live TCAS/TAWS line must never be
      // blanked by a gear/spoiler toast; the debrief line expires instead
      // of squatting the slot forever.
      safety: safetyLine || (performance.now() < toastUntil ? toastLine : '') || (performance.now() < debriefUntil ? debriefLine : '') || undefined,
      copilot: performance.now() < copilotUntil ? copilotLine : undefined,
      // Slice 6: honest live-traffic status — silent emptiness used to be
      // indistinguishable from a dead feed (which flapped all month).
      tfc: ((): string | undefined => {
        if (!liveTrafficOn) return undefined
        if (!lastTrafficPayloadTs) return 'LIVE TFC NO FEED'
        const ageS = (Date.now() - lastTrafficPayloadTs) / 1000
        return ageS > 30 ? `LIVE TFC STALE ${Math.round(ageS)}s` : `LIVE TFC ${liveTraffic.targets.size}`
      })(),
      spawnDesc,
      lat: ll.lat,
      lon: ll.lon,
    },
    loop.ticks,
  )

  renderer.render(scene, camera)
  input.endFrame()
  perfRing[perfIdx] = performance.now() - perfT0
  perfIdx = (perfIdx + 1) % perfRing.length
  if (perfCount < perfRing.length) perfCount++
}

let lastRafAt = 0
let frameErrorToasted = false
/** Error boundary for the sim loop (Slice 0): before this, any throw in
 *  advanceFrame unwound past requestAnimationFrame and the loop was
 *  never re-armed — one bad frame froze the whole sim silently. */
function safeAdvance(elapsed: number, now: number): void {
  try {
    advanceFrame(elapsed, now)
  } catch (err) {
    console.error('frame error (loop re-armed):', err)
    if (!frameErrorToasted) {
      frameErrorToasted = true
      toast('FRAME ERROR — SEE CONSOLE (SIM CONTINUES)')
    }
  }
}
function frame_(now: number): void {
  lastRafAt = now
  const elapsed = (now - lastFrame) / 1000
  lastFrame = now
  safeAdvance(elapsed, now)
  requestAnimationFrame(frame_)
}

// Background continuation (15e): the old setInterval fallback froze in
// hidden tabs — page timers get intensively throttled to ~1 wake/min
// after 5 min hidden. Worker clocks are exempt, so a metronome worker
// ticks the same idle-stepper instead. Elapsed is clamped to 1 s per
// tick: background runs near-real-time and RESUMES after an OS sleep
// rather than fast-forwarding the gap.
const metronome = new Worker(new URL('./metronome-worker.ts', import.meta.url), { type: 'module' })
metronome.onmessage = () => {
  const now = performance.now()
  if (now - lastRafAt < 400) return
  const elapsed = Math.min((now - lastFrame) / 1000, 1)
  if (elapsed < 0.2) return
  lastFrame = now
  safeAdvance(elapsed, now)
}

// ---- boot ----
airports
  .load()
  .then(() => {
    const khaf = airports.find('KHAF')
    if (khaf) spawnAtAirport(khaf, '30')
  })
  .catch((err) => console.error('airport data failed to load:', err))

requestAnimationFrame(frame_)

// Deterministic verification hooks (see PROGRESS.md). Every numeric
// argument passes through finiteOr(): garbage from the console (NaN,
// Infinity, strings) once froze physics permanently via one bad hook.
Object.assign(window as unknown as Record<string, unknown>, {
  __ohStep: (seconds: number) => {
    const s = finiteOr(seconds)
    if (s === null) return
    const now = performance.now()
    lastFrame = now
    lastRafAt = now
    advanceFrame(Math.max(s, 1 / 120), now)
  },
  __ohData: () => {
    const ll = frame.fromLocal(aircraft.posNed.x, aircraft.posNed.y)
    return {
      ias: aircraft.data.kias,
      alt: aircraft.data.altitudeFt,
      agl: aircraft.data.aglFt,
      vs: aircraft.data.verticalSpeedFpm,
      rpm: aircraft.data.rpm,
      aoa: aircraft.data.alphaDeg,
      hdg: aircraft.data.headingDeg,
      pitch: aircraft.data.pitchDeg,
      roll: aircraft.data.rollDeg,
      gnd: aircraft.data.onGround,
      crashed: aircraft.crashed,
      throttle: aircraft.controls.throttle,
      trim: aircraft.controls.trim,
      lat: ll.lat,
      lon: ll.lon,
      tiles: tiles.readyCount,
      simTime: loop.simTime,
      spawn: spawnDesc,
      airportsLoaded: airports.loaded,
      navaidsLoaded: navaidsIndex.count > 0,
      airspaceLoaded: airspacePolygons.length > 0,
    }
  },
  /** Phase 4 Task 6: current in-airspace result (§6.5 acceptance —
   *  "the sim knows when the aircraft is inside the Bravo shelf") — the
   *  same `currentAirspace` array fed into the MFD map page, exposed
   *  directly so a later acceptance task doesn't need to re-derive it. */
  __ohAirspace: () => currentAirspace.map((p) => ({ name: p.n, kind: p.k, floorFt: p.fl, ceilingFt: p.ce })),
  /** Current NAV1 CDI/localizer/glideslope resolution (Phase 4 Task 6) —
   *  the same value fed to the PFD and the autopilot's NAV/APR modes. */
  __ohNav: () => {
    const ll = frame.fromLocal(aircraft.posNed.x, aircraft.posNed.y)
    return computeTunedNav(ll, aircraft.data.altitudeFt)
  },
  /** Tune NAV1/COM1 active+standby frequencies directly (bypassing the 3D
   *  cockpit knobs) and/or the OBS1 course, for headless verification. Any
   *  omitted field is left unchanged. */
  __ohTune: (freqs: { nav1Active?: number; nav1Standby?: number; com1Active?: number; com1Standby?: number; obs1Deg?: number }) => {
    if (!freqs || typeof freqs !== 'object') return
    const n1a = finiteOr(freqs.nav1Active); if (n1a !== null) radios.nav1.activeMhz = n1a
    const n1s = finiteOr(freqs.nav1Standby); if (n1s !== null) radios.nav1.standbyMhz = n1s
    const c1a = finiteOr(freqs.com1Active); if (c1a !== null) radios.com1.activeMhz = c1a
    const c1s = finiteOr(freqs.com1Standby); if (c1s !== null) radios.com1.standbyMhz = c1s
    const obs = finiteOr(freqs.obs1Deg); if (obs !== null) radios.obs1Deg = obs
  },
  /** Load a flight plan directly as a waypoint list (no FPL-entry UI this
   *  task — see task report). Also usable to load a CIFP procedure's legs
   *  as waypoints for a simple GPS-mode flyable path: fetch via
   *  `/api/procedures/{ICAO}.json` and pass the resolved fixes in. */
  __ohFpl: (waypoints: { ident: string; lat: number; lon: number }[]) => {
    flightPlan.setWaypoints(waypoints)
  },
  /** Fetch + expose a raw CIFP procedure JSON blob for a later acceptance
   *  task's own leg assembly/inspection (`assembleProcedureLegs`,
   *  `procedures.ts`) — this hook only fetches/caches, it doesn't fly the
   *  procedure (that's `__ohFpl` + `__ohApMode('NAV', ...)` composed by the
   *  caller). */
  __ohProcedures: (icao: string) => loadProcedures(icao),
  /** AP mode-select debug hook (Phase 4 Task 6) — mirrors this file's
   *  existing `__ohFail`/`__ohWind` hook pattern. A full physical AP
   *  mode-select panel (HDG/NAV/APR/ALT/VS buttons in the 3D cockpit) is
   *  deferred (scope cut, see task report); AP master engage/disengage IS
   *  a physical switch (`sw_apMaster`). Any omitted argument leaves that
   *  part of `apTargets` unchanged. */
  __ohApMode: (
    lateral?: LateralMode,
    vertical?: VerticalMode,
    targets?: Partial<{ headingBugDeg: number; altitudeBugFt: number; vsTargetFpm: number; iasTargetKt: number; bankCommandDeg: number; pitchCommandDeg: number }>,
  ) => {
    if (lateral && ['ROL', 'HDG', 'NAV', 'APR', 'BC'].includes(lateral)) apTargets.lateralMode = lateral
    if (vertical && ['PIT', 'ALT', 'ALTS', 'VS', 'FLC', 'GS'].includes(vertical)) apTargets.verticalMode = vertical
    if (targets && typeof targets === 'object') {
      for (const k of ['headingBugDeg', 'altitudeBugFt', 'vsTargetFpm', 'iasTargetKt', 'bankCommandDeg', 'pitchCommandDeg'] as const) {
        const v = finiteOr(targets[k])
        if (v !== null) (apTargets as unknown as Record<string, number>)[k] = v
      }
    }
  },
  __ohApState: () => ({ ...apState }),
  __ohSafety: () => ({ safetyLine, dots: trafficDots, tcas: lastTcasDebug }),
  __ohAudio: () => ({ unlocked: engineSound.unlocked, muted: engineSound.muted, ...engineSound.inspect() }),
  /** Fleet verification hooks (11g) — mirror the U/H/K keys + inspection. */
  /** 12b visual check: line up archetype silhouettes beside the aircraft
   *  (real designators through the real registry) for a screenshot. */
  __ohMeshTest: (designators?: string[]) => {
    const list = designators ?? ['C172', 'P28A', 'J3', 'BE58', 'PC12', 'DH8D', 'C130', 'GLF5', 'B738', 'B77W', 'A388', 'GLID', 'R44', 'ZZZZ']
    // Grid ahead of the aircraft along its heading so the chase camera
    // frames it: 4 columns x rows, 100 m spacing, starting 180 m out.
    const group = new THREE.Group()
    const hRad = (aircraft.data.headingDeg * Math.PI) / 180
    const fwd = { x: Math.sin(hRad), z: -Math.cos(hRad) } // render frame
    const right = { x: -fwd.z, z: fwd.x }
    for (let i = 0; i < list.length; i++) {
      const des = list[i]!
      const info = typeInfo(des)
      const spec = archetypeFor(des, info.desc, info.wtc)
      const m = buildArchetype(spec)
      const col = (i % 4) - 1.5
      const row = Math.floor(i / 4)
      const ahead = 90 + row * 85
      const side = col * 70
      m.position.set(
        mesh.group.position.x + fwd.x * ahead + right.x * side,
        mesh.group.position.y + 3 + row * 2,
        mesh.group.position.z + fwd.z * ahead + right.z * side,
      )
      m.rotation.y = -hRad // face the camera-ish (nose toward viewer)
      group.add(m)
    }
    scene.add(group)
    setTimeout(() => scene.remove(group), 120_000)
    return { placed: list.length }
  },
  __ohPerf: () => {
    const n = perfCount
    const arr = Array.from(perfRing.slice(0, n)).sort((a, b) => a - b)
    const at = (q: number) => (n ? +arr[Math.min(Math.floor(q * n), n - 1)]!.toFixed(2) : 0)
    return {
      frames: n,
      p50: at(0.5),
      p95: at(0.95),
      max: n ? +arr[n - 1]!.toFixed(2) : 0,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      textures: renderer.info.memory.textures,
      geometries: renderer.info.memory.geometries,
    }
  },
  __ohTypes: (designator?: string) => ({
    loaded: aircraftTypesLoaded(),
    count: aircraftTypeCount(),
    ...(designator ? { info: typeInfo(designator), parsed: parseDesc(typeInfo(designator).desc) } : {}),
  }),
  __ohTiles: (probeKey?: string) => tiles.debugImagery(probeKey),
  __ohReplay: () => {
    const p = buildReplayPlots(recorder.samples, 240)
    return {
      points: p.plan.length,
      touchdownIdx: p.touchdownIdx,
      totalDistM: Math.round(p.totalDistM),
      firstAltFt: p.profile[0] ? Math.round(p.profile[0].altFt) : null,
      lastAltFt: p.profile.length ? Math.round(p.profile[p.profile.length - 1]!.altFt) : null,
      viewerOpen: replayView.isOpen,
    }
  },
  __ohJoy: () => ({
    connected: [...(navigator.getGamepads?.() ?? [])].filter(Boolean).map((g) => ({ id: g!.id.slice(0, 48), axes: g!.axes.length })),
    map: gamepadMap,
    capturing: joyCapture?.fn ?? null,
  }),
  __ohAi: () => aiShips.map((s) => ({ cs: s.pilot.callsign, phase: s.pilot.phase, gsKt: Math.round(s.pilot.plane.gsKt), altFt: Math.round(s.pilot.plane.altFt) })),
  __ohTraffic: () => ({
    on: liveTrafficOn,
    count: liveTraffic.targets.size,
    pollCount: trafficPollCount,
    lastErr: trafficLastErr,
    payloadAgeS: lastTrafficPayloadTs ? +((Date.now() - lastTrafficPayloadTs) / 1000).toFixed(1) : null,
    sample: [...liveTraffic.targets.values()].slice(0, 6).map((t) => ({
      id: t.id, cs: t.cs, t: t.t, altFt: Math.round(t.altFt), gsKt: t.gsKt, gnd: t.gnd,
      lat: +t.lat.toFixed(4), lon: +t.lon.toFixed(4),
    })),
  }),
  __ohImagery: (on: boolean) => tiles.setImagery(on),
  __ohPapi: () => airports.nearestPapi(mesh.group.position.x, mesh.group.position.y, mesh.group.position.z),
  __ohFleet: () => ({ key: fleetKey, label: FLEET_ACTIVE.label, jet: !!aircraft.P.jet, n1: aircraft.data.n1Pct, gearPos: aircraft.gearPos, gearCmd: aircraft.gearDownCommanded }),
  __ohGearCmd: (down: boolean) => { if (aircraft.P.gearRetractable) aircraft.gearDownCommanded = down },
  /** Speedbrake lever (types with a spoilers block): set 0..1 / read state. */
  __ohIls: () => ({ loaded: ilsLoaded, count: ilsCount }),
  __ohReverse: (cmd?: boolean) => { if (cmd !== undefined && aircraft.P.reversers) aircraft.reverseCmd = cmd; return { cmd: aircraft.reverseCmd, pos: aircraft.reversePos, armedSpoilers: aircraft.spoilerArmed } },
  __ohSpoiler: (cmd?: number) => {
    // Numeric-guard the boundary: a stray string here once NaN-poisoned
    // the entire physics state (Math.min(1,'FLIGHT') → NaN → forces →
    // NaN g). Non-finite input is ignored; non-finite stored state heals
    // to 0.
    const n = Number(cmd)
    if (cmd !== undefined && Number.isFinite(n) && aircraft.P.spoilers) aircraft.spoilerCmd = Math.max(0, Math.min(1, n))
    if (!Number.isFinite(aircraft.spoilerCmd)) aircraft.spoilerCmd = 0
    if (!Number.isFinite(aircraft.spoilerPos)) aircraft.spoilerPos = 0
    return { cmd: aircraft.spoilerCmd, pos: aircraft.spoilerPos, fitted: !!aircraft.P.spoilers }
  },
  __ohCarbHeat: (on: boolean) => { carbHeatOn = on },
  __ohHandProp: () => { handPropRequested = true },
  __ohCarb: () => ({ ice: carbIceState.iceFraction, heat: carbHeatOn, intake: aircraft.intakePowerFactor, spreadC: wxTempDewSpreadC }),
  __ohEngineCut: () => {
    systemsControls.magneto = 'off'
  },
  __ohMags: (pos: 'off' | 'both') => {
    systemsControls.magneto = pos
  },
  __ohSave: () => { saveSnapshot(); try { return localStorage.getItem('oh-save') } catch { return null } },
  __ohLoad: () => loadSnapshot(),
  __ohDebrief: () => ({ debriefLine, samples: recorder.samples.length }),
  __ohLogbook: () => logbook,
  __ohChallenges: () => ({ best: challengeBest, active: challengeActive, list: Object.keys(CHALLENGES) }),
  /** Verification-only AP master engage (mirrors the physical `sw_apMaster`
   *  switch path — same hook pattern as `__ohApMode`). */
  __ohApMaster: (on: boolean) => {
    systemsControls.apMaster = on
  },
  /** Switch the MFD's active page (no physical softkey wiring this task —
   *  the softkey regions remain functionally inert per `mfd.ts`'s own doc
   *  comment, unchanged from Phase 3). Defaults to 'map' at boot so the
   *  airspace/glide-ring wiring (Phase 4 Tasks 5/6) is visible without
   *  needing this hook at all. */
  __ohMfdPage: (page: 'map' | 'lean' | 'fpl' | 'wb') => {
    if (page === 'map' || page === 'lean' || page === 'fpl' || page === 'wb') mfdPage = page
  },
  /** Verification-only camera-mode switch (mirrors pressing 'C' repeatedly)
   *  — useful for headless/automated cockpit-camera checks where dispatching
   *  a real keyboard event isn't reliable. */
  __ohCam: (mode: 'chase' | 'orbit' | 'free' | 'cockpit') => {
    if (mode === 'chase' || mode === 'orbit' || mode === 'free' || mode === 'cockpit') cameraMode = mode
  },
  __ohSpawn: (q: string) => { if (typeof q === 'string') handleSearch(q) },
  __ohAtc: (kindOrIndex?: string | number) => {
    if (typeof kindOrIndex === 'number') {
      const it = atcMenuItems()[kindOrIndex]
      if (it) it.run()
      return { ran: it?.label ?? null }
    }
    return {
      nearest: activeAtc?.ident ?? null,
      activeRunway: activeAtc?.atis.activeRunway ?? null,
      freqs: activeAtc ? { twr: activeAtc.twrF, gnd: activeAtc.gndF, atis: activeAtc.atisF } : null,
      com1: radios.com1.activeMhz,
      options: atcMenuItems().map((i) => i.label),
      transcript: [...transcript],
    }
  },
  __ohHold: (on: boolean) => {
    holdWingsLevel = on
  },
  /** Verification-only sim-rate control (mirrors Space/1/2/3). Synthetic
   *  keyboard events are only polled on real rAF frames, which automation
   *  suspends — scripted flights need a synchronous pause between tool
   *  calls or the plane flies unattended on stale targets (found by the
   *  §27 flight). */
  __ohRate: (r: 0 | 1 | 2 | 4) => {
    // Strict whitelist: a NaN here poisons the loop accumulator and no
    // later value heals it — the sim freezes for good.
    if (r === 0 || r === 1 || r === 2 || r === 4) loop.setRate(r)
  },
  __ohCtl: (c?: Record<string, number> | null) => {
    if (c === undefined) return ctlOverride ? { ...ctlOverride } : null // no-arg = read back
    if (c === null) { ctlOverride = null; return }
    // Same NaN-guard as __ohSpoiler: drop non-finite fields instead of
    // letting them poison the physics through the override path.
    const clean: Record<string, number> = { ...(ctlOverride ?? {}) }
    for (const [k, v] of Object.entries(c)) {
      const n = Number(v)
      if (Number.isFinite(n)) clean[k] = n
    }
    ctlOverride = clean
  },
  /** Manual cloud slabs (13e acceptance): same manual-weather pattern as
   *  `__ohWind` — live METAR application stops so it can't overwrite. */
  __ohSlabs: (slabs: Array<{ cover: string; baseMslFt: number; topMslFt: number }>) => {
    liveWeatherOn = false
    wxSlabs = slabs as typeof wxSlabs
  },
  __ohWind: (dirDeg: number, kt: number) => {
    const d = finiteOr(dirDeg)
    const k = finiteOr(kt)
    if (d === null || k === null) return
    dirDeg = d
    kt = k
    // Manual weather: live METAR application stops so it can't overwrite.
    liveWeatherOn = false
    wxDesc = ''
    wxStations = []
    wxSlabs = []
    wxBlended = null
    aircraft.isaTempOffsetC = 0
    wind.setSteady(dirDeg, kt)
  },
  __ohWx: () => ({
    on: liveWeatherOn, desc: wxDesc, stations: wxStations.length,
    isaOffsetC: aircraft.isaTempOffsetC, slabs: wxSlabs,
    baroSetInHg, qnhInHg,
    radar: (() => {
      const ll = frame.fromLocal(aircraft.posNed.x, aircraft.posNed.y)
      return {
        cells: nexradMfdCells.length,
        here: nexrad.intensityAt(ll.lat, ll.lon),
        ageMin: nexrad.ageMin(performance.now()),
      }
    })(),
    inCloud: inCloudFactor(wxSlabs, aircraft.data.altitudeFt),
    blended: wxBlended,
  }),
  /** Inject a synthetic METAR at the aircraft's position (manual weather —
   *  live fetching stops). Verification + future manual-weather UI both
   *  ride the exact same blend/apply path as live data. */
  __ohSetWx: (raw: string) => {
    liveWeatherOn = false
    const ll = frame.fromLocal(aircraft.posNed.x, aircraft.posNed.y)
    const elevFt = (aircraft.groundElevAt?.(aircraft.posNed.x, aircraft.posNed.y) ?? 0) / 0.3048
    wxStations = [{ metar: parseMetar(raw), lat: ll.lat, lon: ll.lon, elevFt }]
    applyBlendedWeather(blendWeather(wxStations, ll.lat, ll.lon))
  },
  __ohLiveWx: (on: boolean) => {
    liveWeatherOn = on
    if (on) lastWxFetchAt = -Infinity
  },
  __ohTime: (hours: number) => {
    const h = finiteOr(hours)
    if (h !== null) scrubSeconds += h * 3600
  },
  /** Debug hook (Phase 3 §8 plan) to trigger a systems failure for
   *  verification, ahead of a real failures-menu UI (Phase 9). Recognized
   *  names: 'alternator', 'icing', 'staticBlock'; any other name (or a
   *  falsy `on`) clears/no-ops. */
  __ohFail: (name: string, on = true) => {
    if (name === 'alternator') failures.alternatorFailed = on
    else if (name === 'icing') failures.icingConditions = on
    else if (name === 'staticBlock') failures.staticBlocked = on
  },
  __ohSystems: () => ({
    electrical: { ...electricalState },
    fuel: { ...fuelState },
    engineStart: { ...engineStartState },
    engineTemps: { ...engineTemps },
    controls: { ...systemsControls },
    failures: { ...failures },
  }),
})

void distanceM
