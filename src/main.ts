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
import { inRunwayApproach } from './sim/safety-approach'
import { SafetySpeechController } from './audio/safety-speech'
import { BrowserSpeechDriver } from './audio/browser-speech'
import { makeSurfaceSmoother } from './render/surface-smoother'
import { boeingAurals, makeAuralLatches } from './sim/boeing-aurals'
import { makeAutothrottle, stepAutothrottle } from './sim/autothrottle'
import { drawBoeingNd, drawBoeingEicas, drawIsfd, boeingFma, egtFromN1, drawSquareFitted, drawMfdWithEngines, type BoeingEicasInput, type BoeingNdInput, type BoeingPfdInput } from './cockpit/boeing-displays'
import { animate737, update737Live } from './render/cockpit-737'
import { BoeingAuralsAudio } from './audio/boeing-aurals-audio'
import { loadCustomPack } from './audio/custom-audio-pack'
import { LocalVoiceClient } from './voice/client'
import { PushToTalk } from './voice/ptt'
import { captureMicrophone } from './voice/recorder'
import { bindPushToTalk } from './voice/bindings'
import { FlightRecorder, analyzeLanding, type RunwayRef } from './sim/recorder'
import { buildAtis } from './sim/atc/atis'
import { TowerController, pilotPhrase, type PilotRequestKind, type TrafficView } from './sim/atc/tower'
import { GroundController } from './sim/atc/ground'
import { trim } from './sim/trim'
import { FT, KT, isa, kcasFromKias, indicatedAltitudeFt } from './sim/atmosphere'
import { C172S, flapInterp } from './sim/aircraft/c172s'
import { bearingDeg, distanceM, windDirFromNed, type LatLon } from './math/geo'
import { createScene } from './render/scene'
import { SkyDome } from './render/sky'
import { Ocean } from './render/ocean'
import { FlyCamera } from './render/camera'
import { ChaseCamera } from './render/chase-camera'
import { OrbitCamera } from './render/orbit-camera'
import { CockpitCamera, EYE_BY_LAYOUT } from './render/cockpit-camera'
import { buildC172, buildCub, buildB738, updateProp, type AircraftMesh } from './render/aircraft-mesh'
import { planeMenuEntries } from './render/plane-menu'
import { Shell } from './ui/shell/shell'
import { applyApFeedback, apEnvelopeFault, disconnectAp, makeApPanel, pressAlt, pressAp, pressApr, pressFlc, pressHdg, pressNav, pressVs, toApTargets, turnKnob, type ApAvailability, type ApPanel, type ApSnapshot, type Knob } from './sim/ap-panel'
import type { ApAction, ApReadout, IlsChoice } from './ui/shell/ap-window'
import { KNOWN_ILS_FREQUENCIES } from './sim/nav/tuning'
import { Launcher, launchCommand, parsePendingLaunch, PENDING_LAUNCH_KEY, type LaunchChoice, type LauncherAirport } from './ui/shell/launcher'
import { loadIls, ilsLoaded, ilsCount } from './world/ils'
import { osmIdentSegs } from './world/osm-layout'
import { routeIdents } from './sim/atc/ground'
import { interpretTransmission } from './sim/atc/freetext'
import { ApproachController, HANDOFF_GATE_M } from './sim/atc/approach'
import { buildPlayerAircraft } from './render/player-aircraft'
import { upgradePlayerAircraft } from './render/local-aircraft'
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
import { buildCockpit, updateCockpitControls, updateCockpitDisplays, CockpitInteraction, type SwitchId } from './render/cockpit'
import { vSpeedArcs, type PfdInput } from './cockpit/pfd'
import { airspaceStrokeStyle, filterAirspaceInRange, glideRangeRadiusM } from './cockpit/mfd'
import { drawGaBoeingNd, drawGaBoeingPfd, drawBoeingEngineColumn } from './cockpit/boeing-ga-displays'
import { cockpitProfile } from './render/cockpit-profile'
import { OIL_TEMP_MAX_C, OIL_PRESS_MAX_PSI, OIL_PRESS_MIN_GREEN_PSI, CHT_MAX_C } from './sim/systems/engine-temps'
import { egtC as pistonEgtC } from './sim/systems/mixture'
import { kgToGal, TANK_CAPACITY_GAL } from './sim/systems/fuel'
import { Input } from './input/input'
import { EngineSound } from './audio/engine-sound'
import { Hud } from './ui/hud'
import { PostFx, sunScreenPosition } from './render/post-fx'
import { InstrumentOverlay, type OverlayState } from './ui/instrument-overlay'
import { GraphicsPanel, type GraphicsActions } from './ui/graphics-panel'
import { LoadingPanel } from './ui/loading-panel'
import { sunPosition } from './math/solar'
import { WorldFrame, TileManager } from './world/tiles'
import { Airports, type AirportData, type RunwayData } from './world/airports'
import { makeElectricalState, stepElectrical } from './sim/systems/electrical'
import { c172WeightBalance, C172S_ENVELOPE } from './sim/weight-balance'
import { applyDeadzone, leverWithReverse, parseGamepadMap, serializeGamepadMap, tcaPresetFor, HELD_ALIASES, readAxis, readButton, readAlias, calibratedUnipolar, mergePreset, combineLevers, type BindableAxis, type BindableButton, type GamepadMap } from './sim/gamepad-map'
import { ControllerPanel } from './ui/controller-panel'
import { ControllerRuntime } from './input/controller-runtime'
import { armSpeedbrake, cycleSpeedbrake } from './input/speedbrake-control'
import { createCaptainSystems, stepCaptainSystems, type CaptainSystemsInput } from './sim/captain-systems'
import { makeFuelState, stepFuel, type FuelSelector, negativeGToleranceS } from './sim/systems/fuel'
import { applyLoading, defaultLoading, loadingFromSnapshot, preferenceFor, setPreference, type LoadingSelection, type MassUnit } from './sim/loading'
import { PitotStaticSystem } from './sim/systems/pitot'
import { stepEngineStart, type EngineStartState, type MagnetoPosition } from './sim/systems/engine-start'
import { makeEngineTemps, stepEngineTemps } from './sim/systems/engine-temps'
import { NavaidsIndex } from './sim/nav/navaids'
import { FlightPlan, gpsCdiDeflection, determinePhase, activeLegProgress } from './sim/nav/gps'
import { airspacesContaining, AirspaceKind, type AirspacePolygon } from './sim/nav/airspace'
import { makeAutopilotState, stepAutopilot, disconnect as disconnectAutopilot, type LateralMode, type VerticalMode } from './sim/autopilot'
import {
  findTunedVor, vorCdiFraction, ilsRefFromRunwayThreshold, runwayOffsets, localizerFraction, glideslopeFraction, findKnownIls,
  ilsOnFinal, NO_NAV_RESULT, type TunedNavResult,
} from './sim/nav/tuning'
import { finiteOr } from './sim/guards'
import { copilotCallouts, copilotSpeedsFor, makeCopilotLatches, type CopilotObs } from './sim/copilot'

const KHAF = { lat: 37.5134, lon: -122.5011 }

const app = document.getElementById('app')
if (!app) throw new Error('missing #app element')

const { renderer, scene, camera } = createScene(app)
const postFx = new PostFx(renderer)
let postStrength = { bloom: 0.3, rays: 0.25, vignette: 0.3 }
/** Sun direction + elevation of the last frame (post-processing). */
let lastSunDir = new THREE.Vector3(0, 1, 0)
let lastSunElevationDeg = 45
const input = new Input(renderer.domElement)
const engineSound = new EngineSound()
// Browsers gate audio behind a user gesture; unlock() is idempotent so the
// listeners stay attached (they also resume a tab-suspended context).
window.addEventListener('pointerdown', () => engineSound.unlock())
window.addEventListener('keydown', () => engineSound.unlock())
/** 737NG aural-alert system (bell / wailer / horns / clacker / shaker /
 *  altitude chime) — synthesized, on Boeing-panel types only. */
const boeingAuralsAudio = new BoeingAuralsAudio()
const auralLatches = makeAuralLatches()
let apDisconnectPressedFlag = false
let auralFireTest = false
let auralHornCutout = false
let negGCutAnnounced = false
/** 737NG autothrottle (sim/autothrottle.ts): A/T ARM switch + one-frame
 *  button edges from the MCP / thrust levers / A/T P/RST light. */
const autothrottle = makeAutothrottle()
let atArmSwitch = false
let atSpeedPressed = false
let atDisconnectPressed = false
let atResetPressed = false
/** Hardware-lever position frozen while the A/T drives the levers: the
 *  physical lever only overrides (and disconnects) once the pilot moves it. */
let atHwRef = NaN
/** Published type-certificate Mmo (rounded) for the jets whose figure is
 *  well documented; the rest get the Vmo clacker only — no Mach limit is
 *  invented. */
const MMO_BY_TYPE: Record<string, number> = {
  '737': 0.82, B736: 0.82, B737: 0.82, B738: 0.82, B739: 0.82, B38M: 0.82, B39M: 0.82,
  B752: 0.86, B753: 0.86, B762: 0.86, B763: 0.86, B764: 0.86,
  B772: 0.89, B77L: 0.89, B77W: 0.89, B744: 0.92, B748: 0.9, B742: 0.9, B788: 0.9, B789: 0.9, B78X: 0.9,
  A318: 0.82, A319: 0.82, A320: 0.82, A321: 0.82, A20N: 0.82, A21N: 0.82, BCS3: 0.82,
  A332: 0.86, A333: 0.86, A339: 0.86, A343: 0.86, A359: 0.89, A35K: 0.89, A388: 0.89,
  MD88: 0.84, MD11: 0.95, CRJ2: 0.85, CRJ7: 0.85, CRJ9: 0.85, CRJX: 0.85,
  E170: 0.82, E190: 0.82, E195: 0.82, GLF4: 0.88, GLF5: 0.885, GLF6: 0.925, GLEX: 0.9, GL5T: 0.9, FA7X: 0.9,
}
const sky = new SkyDome(scene)
const ocean = new Ocean(scene, sky.radianceTexture)
const clouds = new Clouds(scene)
const hud = new Hud()
const instruments = new InstrumentOverlay()
let instrumentsOn = true
try { instrumentsOn = localStorage.getItem('oh-instruments') !== 'off' } catch { /* storage unavailable */ }
/** Selected course of the tuned nav source, for the compass course pointer. */
let lastCourseDeg: number | undefined
const loop = new FixedTimestepLoop(120)

const frame = new WorldFrame(KHAF)
const airports = new Airports(scene, frame)
const tiles = new TileManager(scene, frame, (s, n, w, e) => airports.runwaysInBounds(s, n, w, e))
tiles.setSky(sky.radianceTexture)
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
  // DG80 final explicitly selects +13°, leaving L a deliberate landing selection.
  const lastIdx = params.flaperons ? params.flapDetentsDeg.indexOf(13) : entry.spec.flapDetentsDeg.length - 1
  return {
    params,
    label: `${entry.spec.label} (Tier B)`,
    build: () => buildPlayerAircraft(fleetKey, params),
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
void upgradePlayerAircraft(mesh, fleetKey)
// Aircraft selection lives in the free-flight start screen (M or N opens
// it); a new aircraft reloads, carrying the launch across (launcher.ts).
let launcher: Launcher | null = null
let shell: Shell | null = null
window.addEventListener('keydown', (e) => {
  if (launcher?.isOpen) return
  if ((e.code === 'KeyM' || e.code === 'KeyN') && document.activeElement?.tagName !== 'INPUT') {
    launcher?.open()
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
/** This airplane's cockpit, tailored per type (render/cockpit-profile.ts):
 *  the transport deck dressed for its family, or the G1000 panel fitted
 *  with its own controls and hardware. */
const COCKPIT_PROFILE = cockpitProfile(fleetKey, FLEET_ACTIVE.params, {
  label: FLEET_ACTIVE.label,
  powerplant: ROSTER.find((r) => r.spec.designator === fleetKey)?.spec.powerplant
    ?? (fleetKey === '737' ? { kind: 'jet', count: 2 } : { kind: 'piston', count: 1 }),
})
const cockpitLayout = COCKPIT_PROFILE.layout
const DECK_PROFILE = COCKPIT_PROFILE.deck
const engineCount = DECK_PROFILE?.engines ?? COCKPIT_PROFILE.ga?.engines ?? 1
const cockpit = buildCockpit(mesh.group, COCKPIT_PROFILE, FLEET_ACTIVE.params.flapDetentsDeg, { speedbrake: !!FLEET_ACTIVE.params.spoilers })
// Exteriors previously cast onto runways but never received their own
// shadows. Light aircraft now get a tightly fitted shadow map as well.
mesh.group.traverse(o => {
  if (!(o instanceof THREE.Mesh)) return
  const materials = Array.isArray(o.material) ? o.material : [o.material]
  if (materials.every(m => m instanceof THREE.MeshStandardMaterial && !m.transparent)) {
    o.castShadow = true
    o.receiveShadow = true
  }
})
sky.setShadowSize(FLEET_ACTIVE.params.spanM)
// The interior supplies its own glazing/frame; avoid drawing the exterior
// trim a second time across the pilot's windshield.
const exteriorCabin: THREE.Object3D[] = []
mesh.group.traverse(o => { if (o.userData.exteriorCabin) exteriorCabin.push(o) })
const cockpitInteraction = new CockpitInteraction(camera)

const wind = new WindModel()
const chase = new ChaseCamera(camera)
// Chase camera terrain clamp: render x = east, z = south → NED n = −z, e = x.
chase.setGroundProbe((x, z) => aircraft.groundElevAt?.(-z, x) ?? 0)
chase.setSizeScale(Math.max(FLEET_ACTIVE.params.spanM / 11, 1))
const orbit = new OrbitCamera(camera)
orbit.setSizeScale(Math.max(FLEET_ACTIVE.params.spanM / 11, 1))
const freeCam = new FlyCamera(camera)
const cockpitCam = new CockpitCamera(camera)
// Per-layout eyepoint (Slice 3): GA eye under the C172 cabin top;
// transport eye above the re-seated 737/Airbus glareshield.
if (DECK_PROFILE) {
  // The deck scales about the airplane origin; the design eye scales with it.
  const e = EYE_BY_LAYOUT.boeing737, k = DECK_PROFILE.scale
  cockpitCam.setEyePoint({ x: e.x * k, y: e.y * k, up: e.up * k })
} else cockpitCam.setEye('ga')
let cameraMode: 'chase' | 'orbit' | 'free' | 'cockpit' = 'chase'
const DEFAULT_NEAR = camera.near // 0.5 m (scene.ts) — correct for exterior views
/** Rudder as drawn: pedal demand through a slew-limited actuator (±1 = full
 *  deflection, ≈2.6 full-throws/s) so it sweeps instead of snapping. */
const rudderVisual = makeSurfaceSmoother(2.6, 0.07)
const COCKPIT_NEAR = 0.08 // nearest cockpit geometry (yoke hub) is ~0.2 m from the eye; 0.02 wrecked far-field depth precision (see scene.ts)

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
const LOADING_PREFERENCES_KEY = 'oh-loading-preferences'
let loadingUnit: MassUnit = 'kg'
let selectedLoading: LoadingSelection = defaultLoading(FLEET_ACTIVE.params)
try {
  const stored = preferenceFor(localStorage.getItem(LOADING_PREFERENCES_KEY), fleetKey, FLEET_ACTIVE.params)
  if (stored) { selectedLoading = stored.selection; loadingUnit = stored.unit }
} catch { /* private mode */ }
applyLoading(selectedLoading, FLEET_ACTIVE.params, aircraft, fuelState, true)
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
let captainSystems = createCaptainSystems()
let captainCommands: Partial<CaptainSystemsInput> = {}
const controllerRuntime = new ControllerRuntime()
let keyboardReverse = false
let hardwareReverseOwned = false
let pilotBrake = 0

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
/** Armed-capture underlying mode fed to the control laws (ap-panel.ts). */
let apUnderlying: 'PIT' | 'VS' | 'FLC' = 'VS'
/** The flight-guidance panel: the pilot's side of the autopilot. */
let apPanel: ApPanel = makeApPanel()
let apMessage = ''
let knobHoldAt = 0
let knobHoldStart = 0
let apMessageUntil = 0
let lastTunedNavResult: TunedNavResult | undefined
let lastGpsLegCourse: number | undefined

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
  Object.assign(autothrottle, makeAutothrottle())
  atArmSwitch = false
  // A respawn uses this aircraft's saved loading selection. Snapshot loading
  // is restored after respawn and therefore has explicit higher priority.
  Object.assign(fuelState, makeFuelState(selectedLoading.leftKg, selectedLoading.rightKg))
  applyLoading(selectedLoading, FLEET_ACTIVE.params, aircraft, fuelState, true)
  Object.assign(electricalState, makeElectricalState())
  Object.assign(engineStartState, ENGINE_START_BOOT_RUNNING)
  Object.assign(engineTemps, makeEngineTemps())
  Object.assign(systemsControls, SYSTEMS_CONTROLS_DEFAULT)
  captainSystems = createCaptainSystems()
  captainCommands = {}
  controllerRuntime.reset()
  keyboardReverse = hardwareReverseOwned = false
  aircraft.jetPowerFactor = 1
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
// Stability assist modes (user: "dampen the C172 — it glides to the
// side"): 'sas' = the VERIFIED lateral subset (ground heading hold, yaw
// damper, gentle wing leveler on untouched axes) and is the default —
// the airplane's real hands-off tendencies (rig-vs-power drift, the
// full-power left roll) are honest physics, but a real pilot's
// subconscious foot/hand pressure isn't in the loop here. 'full' adds
// the pitch-attitude hold, which stays opt-in (see the note above).
// Gating reads the SHAPED axes so a sidestick counts as pilot input —
// the old keyboard-only gate would have fought a joystick roll.
let assistMode: 'off' | 'sas' | 'full' = 'sas'
/** Runway heading captured at the start of the takeoff roll (ground assist
 *  holds it — a pure yaw-rate damper can't null the P-factor/torque bias,
 *  it only slows the turn, so heading still drifts under constant torque). */
let groundHeadingLockDeg: number | null = null
/** Climb pitch attitude captured when the pilot releases pitch control
 *  airborne (assist holds it — see the airborne assist branch below). */
let airbornePitchLockDeg: number | null = null
/** Airborne SAS heading lock: captured when both yaw and roll are
 *  untouched, released the moment the pilot touches either. */
let airborneHeadingLockDeg: number | null = null
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

/** Every discontinuous flight restore starts fresh advisory and speech state. */
let voicePtt:PushToTalk | undefined
let flightVoiceEpoch=0
function resetFlightSafety(): void {
  ++flightVoiceEpoch;voicePtt?.reset('New flight — previous transmission cancelled')
  tcas.reset(); taws.reset(); safetySpeech.reset()
  liftoffSimS = null; safetyWasGrounded = false; lastSafetyAt = -Infinity
  safetyLine = ''; trafficDots = []; copilotLine = ''; copilotUntil = 0
  // Copilot latches reset with the flight (Slice 4) — a respawn is a new
  // leg; without this the callouts stay spent from the previous one.
  copilotLatches = makeCopilotLatches()
  copilotPrev = null
  // 9A: pending controller replies die with the flight they answered.
  cancelAtcTimers()
  lastTcasDebug = { level: 'NONE', trackLevels: [] }
}

function spawnAtAirport(ap: AirportData, rwyIdent?: string, onFinal = false): void {
  aircraft.crashed = false
  resetSystemsState()
  resetFlightSafety()
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
    if (aircraft.P.flaperons) { aircraft.spoilerCmd = 0; aircraft.spoilerPos = 0; aircraft.spoilerArmed = false }
    aircraft.resetFlaps(fin.flapsIndex)
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
    aircraft.resetFlaps()
    aircraft.controls.pitch = aircraft.controls.roll = aircraft.controls.yaw = 0
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
  aircraftId?: string; flapSchema?: 1; flapCommandDeg?: number
  lat: number; lon: number; altFt: number; hdgDeg: number; kias: number
  flapsIndex: number; fuelKg: number; payloadKg: number
  fuelLeftKg?: number; fuelRightKg?: number
  simMs: number; onGround: boolean; spawn: string
}

/** Messages raised before the shell exists (boot) wait for it. */
const earlyToasts: string[] = []
function toast(msg: string): void {
  if (shell) shell.notifier.push(msg)
  else earlyToasts.push(msg)
}

function saveSnapshot(): void {
  const d = aircraft.data
  const ll = frame.fromLocal(aircraft.posNed.x, aircraft.posNed.y)
  const snap: Snapshot = {
    v: 1, aircraftId: fleetKey, flapSchema: 1, flapCommandDeg: aircraft.P.flapDetentsDeg[aircraft.controls.flapsIndex], lat: ll.lat, lon: ll.lon, altFt: d.altitudeFt, hdgDeg: d.headingDeg,
    kias: d.kias, flapsIndex: aircraft.controls.flapsIndex, fuelKg: aircraft.fuelKg,
    fuelLeftKg: fuelState.leftKg, fuelRightKg: fuelState.rightKg,
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
  if (snap.aircraftId !== undefined && snap.aircraftId !== fleetKey) { toast('SAVE AIRCRAFT MISMATCH'); return false }
  if (![snap.lat,snap.lon,snap.altFt,snap.hdgDeg,snap.kias,snap.simMs].every(Number.isFinite) || typeof snap.spawn !== 'string') { toast('INVALID SAVE'); return false }
  const snapshotLoading = loadingFromSnapshot(snap, FLEET_ACTIVE.params)
  aircraft.payloadKg = snapshotLoading.payloadKg
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
    resetFlightSafety()
    // Reset installed the per-aircraft preference; snapshot loading must be
    // complete before trim because both payload and fuel determine mass.
    applyLoading(snapshotLoading, FLEET_ACTIVE.params, aircraft, fuelState, true)
    frame.anchor = { lat: snap.lat, lon: snap.lon }
    tiles.onRebase()
    airports.positionAll()
    const altM = snap.altFt * FT
    // 9A: the airborne restore used to trim EVERY type as a C172 —
    // hardcoded detents, default params, default pitot cal.
    // Trimmed-flight restoration deliberately clears actuator/linkage history.
    let index = aircraft.P.flapDefaultIndex ?? 0
    if (snap.flapSchema === 1 && Number.isFinite(snap.flapCommandDeg)) {
      const found = aircraft.P.flapDetentsDeg.findIndex(deg => Math.abs(deg-snap.flapCommandDeg!) < 1e-6)
      if (found >= 0) index = found
    } else if (!aircraft.P.flaperons && snap.flapSchema === undefined) index = snap.flapsIndex
    if (aircraft.P.flaperons) { aircraft.spoilerCmd = 0; aircraft.spoilerPos = 0; aircraft.spoilerArmed = false }
    aircraft.resetFlaps(index)
    const flapsDeg = aircraft.flapsDeg
    aircraft.fuelKg = snapshotLoading.leftKg + snapshotLoading.rightKg // before trim: mass affects the solve
    const tas = kcasFromKias(Math.max(snap.kias, 55), flapsDeg, aircraft.P.pitotCal) * KT * Math.sqrt(1.225 / isa(altM).densityKgM3)
    const t = trim({ tasMs: tas, altM, massKg: aircraft.massKg, flapsDeg, gammaRad: 0, params: aircraft.P, isaTempOffsetC: aircraft.isaTempOffsetC })
    aircraft.applyTrimState(tas, t.alphaRad, altM, (snap.hdgDeg * Math.PI) / 180, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
    parkingBrake = false
    spawnDesc = snap.spawn
    tiles.update(aircraft.posNed.x, aircraft.posNed.y)
    airports.updateVisuals(frame.anchor.lat, frame.anchor.lon)
  }
  applyLoading(snapshotLoading, FLEET_ACTIVE.params, aircraft, fuelState, true)
  scrubSeconds = (snap.simMs - baseDate.getTime()) / 1000 - loop.simTime
  toast(`LOADED — ${snap.spawn || 'airborne'} ${Math.round(snap.altFt)} ft`)
  return true
}

function currentLoading(): LoadingSelection {
  return { payloadKg: aircraft.payloadKg, leftKg: fuelState.leftKg, rightKg: fuelState.rightKg }
}

function applyAndSaveLoading(selection: LoadingSelection, unit: MassUnit) {
  const stationaryOnGround = aircraft.data.onGround && aircraft.data.groundSpeedKt < 1
  const result = applyLoading(selection, FLEET_ACTIVE.params, aircraft, fuelState, stationaryOnGround)
  if (result.applied) {
    selectedLoading = { ...selection }
    loadingUnit = unit
    try {
      const raw = localStorage.getItem(LOADING_PREFERENCES_KEY)
      localStorage.setItem(LOADING_PREFERENCES_KEY, setPreference(raw, fleetKey, selectedLoading, loadingUnit))
    } catch { /* private mode */ }
  }
  return result
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
    // Compatibility command: payload in lb, routed through the same loading
    // validation, ground guard and persistence as the visible panel.
    const lb = Number(parts[1])
    if (Number.isFinite(lb)) {
      const result = applyAndSaveLoading({ ...currentLoading(), payloadKg: lb * 0.45359237 }, 'lb')
      toast(result.message)
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
searchBox.className = 'oh-search oh-ui'
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
  voicePtt?.reset()
  input.enabled = false
  input.clearHeld()
  clearControllerTransient()
  shaped.pitch = 0
  shaped.roll = 0
  shaped.yaw = 0
  if (!parkingBrake) {
    aircraft.controls.brakeLeft = 0
    aircraft.controls.brakeRight = 0
  }
}

function restoreSimInputIfNoEditorFocused(): void {
  const active = document.activeElement
  const editing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement || (active instanceof HTMLElement && active.isContentEditable)
  if (!editing) input.enabled = true
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
const controllerPanel = new ControllerPanel(()=>gamepadMap, map=>{gamepadMap=map;saveJoyMap();controllerRuntime.reset()},()=>{clearControllerTransient();voicePtt?.reset();shell?.open('controls')})
let lastPadIdentity = ''
function startBtnCapture(queue: BindableButton[]): void { controllerPanel.start('button',queue) }
function startJoyCapture(queue: BindableAxis[]): void { controllerPanel.start('axis',queue) }
function saveJoyMap(): void {
  try { localStorage.setItem('oh-gamepad-map',serializeGamepadMap(gamepadMap)) } catch { /* private mode */ }
}
function clearControllerTransient(): void {
  controllerRuntime.reset()
  captainCommands = {}
  shaped.pitch=shaped.roll=shaped.yaw=0
  aircraft.controls.pitch=aircraft.controls.roll=aircraft.controls.yaw=0
  pilotBrake=parkingBrake?1:0
  for(const code of HELD_ALIASES)input.setVirtualHeld(code,false)
  if(hardwareReverseOwned){aircraft.reverseCmd=keyboardReverse;hardwareReverseOwned=false}
  if(!parkingBrake)aircraft.controls.brakeLeft=aircraft.controls.brakeRight=0
}
window.addEventListener('blur',clearControllerTransient)
document.addEventListener('focusin',e=>{const el=e.target;if(el instanceof HTMLElement && el.matches('input,textarea,select,[contenteditable=true]'))disableSimInput()})
document.addEventListener('focusout',()=>queueMicrotask(restoreSimInputIfNoEditorFocused))
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearControllerTransient()})
window.addEventListener('gamepaddisconnected',()=>{clearControllerTransient();voicePtt?.reset('Controller disconnected — transmission cancelled')})
function joyRead(fn: BindableAxis): number | null {return readAxis(gamepadMap,fn,navigator.getGamepads?.()??[])}
/** Runs even when the controls are paused/focused elsewhere: first-load discovery
 * and identity remapping must not depend on a future connected event. */
function updateControllers():void {
  const pads=navigator.getGamepads?.()??[]
  const signature=pads.filter(Boolean).map(p=>`${p!.id}:${p!.index}:${p!.axes.length}:${p!.buttons.length}`).join('|')
  if(signature!==lastPadIdentity){
    lastPadIdentity=signature;clearControllerTransient();voicePtt?.reset()
    const preset=tcaPresetFor(pads.filter((p):p is Gamepad=>!!p).map(p=>({id:p.id,index:p.index,axes:p.axes.length})))
    if(preset){gamepadMap=mergePreset(gamepadMap,preset);saveJoyMap()}
  }
  controllerPanel.update(pads,`SIM · thrust ${Math.round(aircraft.controls.throttle*100)}% · ${loop.paused?'PAUSED':'RUNNING'} · ${document.hasFocus()?'FOCUSED':'BACKGROUND'}\nKeyboard W ${input.isHeld('KeyW')?'DOWN':'up'} / S ${input.isHeld('KeyS')?'DOWN':'up'} · override ${ctlOverride?JSON.stringify(ctlOverride):'none'}\nSIM · flaps ${aircraft.P.flapLabels?.[aircraft.controls.flapsIndex] ?? aircraft.controls.flapsIndex}${aircraft.P.flaperons ? ` · actual ${aircraft.flapsDeg.toFixed(1)}° · lever 1..5: -9° / 0° / +5° / +13° / L (flaps0 = first lever position); steps/axis: all 7` : ''} · speedbrake ${Math.round(aircraft.spoilerCmd*100)}% ${aircraft.spoilerArmed?'ARM':''}\nParking ${parkingBrake?'ON':'OFF'} · TX ${voicePtt?.state.phase??'idle'} · trigger ${physicalPttState()===true?'held':'released / unavailable'}\n${aircraft.P.spoilers?.groundAutoDeploy === false ? 'UNPOWERED · airbrakes' : `Engines ${captainSystems.engine1Running?'1 RUN':'1 STOP'} / ${captainSystems.engine2Running?'2 RUN':'2 STOP'} · ignition ${captainSystems.ignitionMode}`}\nAutobrake ${captainSystems.autobrakeMode} ${captainSystems.autobrakeActive?'ACTIVE':captainSystems.autobrakeDisarmed?'DISARMED':'armed / waiting'} · rudder trim ${captainSystems.rudderTrim.toFixed(2)}`)
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
  if (input.wasPressed('Backquote')) {
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
  if (input.wasPressed('KeyY')) apPress('ap')
  if (input.wasPressed('KeyJ')) { if (shell) shell.windows.get('controls')?.toggle(); else controllerPanel.toggle() }
  if (input.wasPressed('KeyX')) {
    assistMode = assistMode === 'sas' ? 'full' : assistMode === 'full' ? 'off' : 'sas'
    toast(assistMode === 'sas' ? 'STABILITY ASSIST: SAS (yaw damper + wing leveler)' : assistMode === 'full' ? 'STABILITY ASSIST: FULL (adds pitch hold)' : 'STABILITY ASSIST: OFF')
  }
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
  if (input.wasPressed('KeyF')) aircraft.selectFlaps(c.flapsIndex + 1)
  if (input.wasPressed('KeyG')) aircraft.selectFlaps(c.flapsIndex - 1)
  if (input.wasPressed('KeyR')) {
    // 9A: reset returns to YOUR runway — the no-ident call re-picked the
    // airport's longest/default runway instead.
    const parts = spawnDesc.split(' ')
    const ap = airports.find(parts[0] || 'KHAF')
    if (ap) spawnAtAirport(ap, parts[1])
    aircraft.crashed = false
    c.throttle = 0
    c.trim = 0
    aircraft.resetFlaps()
  }
}

function pollControls(dt: number): void {
  if (!input.enabled || document.hidden || !document.hasFocus() || controllerPanel.capturing) {clearControllerTransient();return}
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
  const pads=navigator.getGamepads?.()??[]
  const latchedParking=readButton(gamepadMap,'parkingBrake',pads)
  if(latchedParking!==null)parkingBrake=latchedParking
  if (latchedParking===null && !gamepadMap.btn?.parkingBrake && parkingBrake && c.throttle > 0.15) parkingBrake = false
  c.brakeLeft = c.brakeRight = input.isHeld('KeyB') || parkingBrake ? 1 : 0
  if (input.wasPressed('KeyV')) {
    toast(cycleSpeedbrake(aircraft))
  }
  if (input.wasPressed('KeyZ')) {
    if (aircraft.P.reversers) {
      keyboardReverse = !keyboardReverse
      aircraft.reverseCmd = keyboardReverse
      toast(aircraft.reverseCmd ? 'REVERSE THRUST (deploys on ground)' : 'REVERSERS STOWED')
    } else {
      toast('NO REVERSERS ON THIS TYPE')
    }
  }
  const runtime=controllerRuntime.poll(gamepadMap,pads,true)
  const down=runtime.held,pressed=runtime.pressed
  const jr=joyRead('roll'),jp=joyRead('pitch'),jy=joyRead('yaw')
  if(jr!==null)shaped.roll=applyDeadzone(jr)
  if(jp!==null)shaped.pitch=applyDeadzone(jp)
  if(jy!==null)shaped.yaw=applyDeadzone(jy)
  const levers:ReturnType<typeof leverWithReverse>[]=[]
  for(const [axis,button] of [['throttle','reverse'],['throttle2','reverse2']] as const){
    const value=joyRead(axis)
    if(value!==null){const lever=leverWithReverse(value,gamepadMap[axis]?.calibration);if(down(button))lever.reverse=true;levers.push(lever)}
  }
  const aggregate=combineLevers(levers)
  if(levers.length){
    const hw=aggregate.reverse&&!aircraft.data.onGround?0:aggregate.power
    // A/T engaged: an unmotorized hardware lever must not fight the servo —
    // it takes over (and disconnects the A/T) only when actually moved.
    if(!autothrottle.engaged||!Number.isFinite(atHwRef)||Math.abs(hw-atHwRef)>0.04||aggregate.reverse){c.throttle=hw;atHwRef=hw}
  }else atHwRef=NaN
  const heldReverse=down('reverse')||down('reverse2')
  const ownsReverse=aggregate.reverse||aggregate.mixed||heldReverse
  if(aircraft.P.reversers && (ownsReverse||hardwareReverseOwned))aircraft.reverseCmd=ownsReverse?aggregate.reverse&&!aggregate.mixed || heldReverse&&!aggregate.mixed:keyboardReverse
  hardwareReverseOwned=ownsReverse
  const jm=joyRead('mixture');if(jm!==null)c.mixture=calibratedUnipolar(jm,gamepadMap.mixture)
  const jb=joyRead('brakes');if(jb!==null)c.brakeLeft=c.brakeRight=Math.max(c.brakeLeft,calibratedUnipolar(jb,gamepadMap.brakes))
  const jf=joyRead('flaps');if(jf!==null)aircraft.selectFlaps(Math.round(calibratedUnipolar(jf,gamepadMap.flaps)*(aircraft.P.flapDetentsDeg.length-1)),false)
  const js=joyRead('speedbrake');if(js!==null && aircraft.P.spoilers){aircraft.spoilerCmd=calibratedUnipolar(js,gamepadMap.speedbrake);aircraft.spoilerArmed=false}
  const latched=(fn:BindableButton):boolean|null=>readButton(gamepadMap,fn,pads)
  if(pressed('gear') && aircraft.P.gearRetractable)aircraft.gearDownCommanded=!aircraft.gearDownCommanded
  if(aircraft.P.gearRetractable){if(latched('gearDown')===true)aircraft.gearDownCommanded=true;else if(latched('gearUp')===true)aircraft.gearDownCommanded=false}
  if(pressed('flapsDown'))aircraft.selectFlaps(c.flapsIndex+1)
  if(pressed('flapsUp'))aircraft.selectFlaps(c.flapsIndex-1)
  for(const [i,fn] of (['flaps0','flaps1','flaps2','flaps3','flapsFull'] as const).entries())if(latched(fn)===true)aircraft.selectFlaps(Math.round(i/4*(aircraft.P.flapDetentsDeg.length-1)),false)
  if(aircraft.P.spoilers){
    if(latched('speedbrakeDown')===true){aircraft.spoilerCmd=0;aircraft.spoilerArmed=false}
    if(latched('speedbrakeFull')===true){aircraft.spoilerCmd=1;aircraft.spoilerArmed=false}
    if(latched('speedbrakeArm')===true)armSpeedbrake(aircraft)
  }
  if(down('trimUp'))c.trim=Math.max(-1,c.trim-.25*dt)
  if(down('trimDown'))c.trim=Math.min(1,c.trim+.25*dt)
  if(pressed('apDisconnect')){systemsControls.apMaster=false;apDisconnectPressedFlag=true}
  if(down('brakes'))c.brakeLeft=c.brakeRight=1
  captainCommands={trimLeft:down('rudderTrimLeft'),trimRight:down('rudderTrimRight'),trimReset:down('rudderTrimReset')}
  for(const fn of ['engineMaster1','engineMaster2'] as const){const v=latched(fn);if(v!==null)captainCommands[fn]=v}
  if(latched('ignitionCrank')===false && latched('ignitionStart')===false)captainCommands.ignitionMode='norm'
  for(const [fn,mode] of [['ignitionCrank','crank'],['ignitionNorm','norm'],['ignitionStart','start']] as const)if(latched(fn)===true)captainCommands.ignitionMode=mode
  for(const [fn,mode] of [['autobrakeOff','off'],['autobrakeLow','low'],['autobrakeMedium','medium'],['autobrakeMax','max'],['autobrakeRto','rto']] as const)if(latched(fn)===true)captainCommands.autobrakeMode=mode
  const heldCodes=new Set<string>()
  for(const [key,state] of runtime.aliases){const code=gamepadMap.btnKeys![key]!;if(HELD_ALIASES.has(code)){if(state.held)heldCodes.add(code)}else if(state.pressed)input.injectPress(code)}
  for(const code of HELD_ALIASES)input.setVirtualHeld(code,heldCodes.has(code))
  pilotBrake=Math.max(c.brakeLeft,c.brakeRight)
  // Expo curve: fine control near center, full authority at the stops.
  const expo = (v: number) => v * Math.abs(v) * 0.65 + v * 0.35
  c.pitch = expo(shaped.pitch)
  c.roll = expo(shaped.roll)
  c.yaw = expo(shaped.yaw)
  // Flight assist (X toggles): untouched axes get stability help — wing
  // leveler, pitch-rate damping, auto-coordinated rudder. Pilot-side aid;
  // the flight model itself is untouched.
  if (assistMode !== 'off' && aircraft.data.onGround && Math.abs(shaped.yaw) < 0.04) {
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
  if (assistMode !== 'off' && !aircraft.data.onGround) {
    const rollRad = (aircraft.data.rollDeg * Math.PI) / 180
    const betaRad = (aircraft.data.betaDeg * Math.PI) / 180
    if (Math.abs(shaped.roll) < 0.04) {
      // SAS: a GENTLE leveler (it must never feel like an autopilot);
      // FULL keeps the firmer original gains.
      const kPhi = assistMode === 'sas' ? 0.6 : 0.9
      const kP = assistMode === 'sas' ? 0.3 : 0.35
      const cap = assistMode === 'sas' ? 0.35 : 0.5
      c.roll = Math.min(Math.max(-kPhi * rollRad - kP * aircraft.rates.x, -cap), cap)
    }
    // Pitch: hold the attitude captured the moment the pilot lets go, not
    // just damp rate — a pure rate damper has no target, so releasing the
    // stick after rotation let the aircraft sink back toward its trimmed
    // (near-level) attitude and settle back onto the runway instead of
    // sustaining the climb. Re-locks fresh each time the pilot takes pitch
    // control back (or after a fresh liftoff — see the on-ground branch).
    if (assistMode === 'full' && Math.abs(shaped.pitch) < 0.04) {
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
    if (Math.abs(shaped.yaw) < 0.04 && Math.abs(shaped.roll) < 0.04) {
      // Heading HOLD on the rudder, not just a yaw damper: a damper only
      // slows the residual turn a steady prop/rig moment produces (the
      // headless survey still drifted 78° in 40 s at full power with
      // wings held level). Lock the heading the moment the pilot lets go
      // of yaw AND roll; re-lock when either is touched. Bounded rudder
      // (0.4 SAS / 0.6 FULL) — never an autopilot's authority.
      if (airborneHeadingLockDeg === null) airborneHeadingLockDeg = aircraft.data.headingDeg
      let errDeg = aircraft.data.headingDeg - airborneHeadingLockDeg
      errDeg = ((errDeg + 180) % 360 + 360) % 360 - 180
      const errRad = (errDeg * Math.PI) / 180
      const cap = assistMode === 'sas' ? 0.4 : 0.6
      c.yaw = Math.min(Math.max(-2.0 * errRad - 0.8 * aircraft.rates.z, -cap), cap)
    } else {
      airborneHeadingLockDeg = null
    }
    void betaRad
  } else {
    airbornePitchLockDeg = null
    airborneHeadingLockDeg = null
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

// In-cloud extinction is distance-dependent in the world. The old DOM
// whiteout also erased nearby cockpit instruments, which is not how fog works.
const cloudFog = new THREE.FogExp2(0xc8ccd2, 0)
scene.fog = cloudFog

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
const tcas = new TcasComputer({ taOnly: !(aircraft.P.jet || aircraft.P.mtowKg > 5700) })
const taws = new TawsComputer()
let lastSafetyAt = -Infinity
let liftoffSimS: number | null = null
let safetyWasGrounded = false
let safetyLine = ''
let trafficDots: Array<{ dNorthM: number; dEastM: number; relAltFt: number; alerted: boolean }> = []
let lastTcasDebug: { level: string; trackLevels: string[] } = { level: 'NONE', trackLevels: [] }

let safetyAudioFailure = ''
let safetyAudioFailureUntil = 0
/** Single playback owner; standard warnings are preloaded PCM clips. */
const localVoice = new LocalVoiceClient()
const browserSpeech = new BrowserSpeechDriver({
  // Boeing flight decks carry a male EGPWS/TCAS voice; others keep Samantha.
  ...(cockpitLayout === 'boeingNG' ? {
    manifestUrl: '/audio/safety-boeing/manifest.json',
    // A user-supplied licensed pack (custom-audio-pack.ts) overrides
    // individual phrases; everything else keeps the built-in voice.
    resolveManifest: async () => {
      const r = await fetch('/audio/safety-boeing/manifest.json')
      if (!r.ok) throw new Error(`manifest HTTP ${r.status}`)
      const base = await r.json() as Record<string, string>
      return { ...base, ...(await loadCustomPack()).voice }
    },
  } : {}),
  resolveDynamic: (message,signal) => localVoice.resolveSpeech(message,signal),
  onStart: message => {
    if (message.priority === 0) radioSquelch()
    else if (voicePtt?.state.phase === 'listening' || voicePtt?.state.phase === 'requesting') voicePtt.cancel('Safety callout interrupted capture — please transmit again')
  },
  onFailure: (message, reason) => {
    safetyAudioFailure = `AUDIO ${message.text}: ${reason}`
    safetyAudioFailureUntil = performance.now() + 5000
    console.warn(`[speech] ${message.text}: ${reason}`)
  },
})
const safetySpeech = new SafetySpeechController(browserSpeech)
// Next-stage PTT integration: this never mutes critical cockpit warnings.
function setRadioListening(listening: boolean): void { safetySpeech.setRadioSuspended(listening) }

// ---- Slice 4: copilot (pure engine in src/sim/copilot.ts) ----
const copilotSpeeds = FLEET_ACTIVE.params.spoilers?.groundAutoDeploy === false ? {vrKt:0,v1Kt:0,flapsUpKt:0} : copilotSpeedsFor({
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
function speakCopilot(text: string): void { safetySpeech.copilot(text) }

function stepCopilot(): void {
  const d = aircraft.data
  const o: CopilotObs = {
    kias: d.kias,
    aglFt: d.aglFt,
    vsFpm: d.verticalSpeedFpm,
    onGround: d.onGround,
    gearDown: aircraft.P.gearRetractable ? aircraft.gearDownCommanded : true,
    flapsIndex: aircraft.controls.flapsIndex,
    flapsDeg: aircraft.flapsDeg,
    glider: aircraft.P.spoilers?.groundAutoDeploy === false,
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
  else if (safetyWasGrounded) liftoffSimS = loop.simTime
  safetyWasGrounded = d.onGround

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
  const tc = tcas.step(0.5, { altFt: d.altitudeFt, aglFt: d.aglFt, vsFpm: d.verticalSpeedFpm, onGround: d.onGround }, tracks)
  lastTcasDebug = { level: tc.level, trackLevels: tc.tracks.filter((t) => t.level !== 'NONE').map((t) => `${t.id}:${t.level}@${Math.round(t.rangeM)}m/${Math.round(t.relAltFt)}ft`) }
  trafficDots = tc.tracks.map((t) => ({
    dNorthM: 0, dEastM: 0, relAltFt: t.relAltFt, alerted: t.level === 'TA' || t.level === 'RA',
  }))
  // Fill dot offsets from the same track list (index-aligned).
  tracks.forEach((t, i) => {
    trafficDots[i]!.dNorthM = t.relNorthM
    trafficDots[i]!.dEastM = t.relEastM
  })

  // TAWS.
  const nav = computeTunedNav(ll0, d.altitudeFt)
  const tw = taws.step(0.5, {
    onGround: d.onGround, aglFt: d.aglFt, altFt: d.altitudeFt, vsFpm: d.verticalSpeedFpm, gsKt: d.groundSpeedKt,
    headingDeg: d.headingDeg, rollDeg: d.rollDeg, flapsDeg: d.flapsDeg,
    landingFlapWarning: aircraft.P.spoilers?.groundAutoDeploy !== false,
    sinceTakeoffS: liftoffSimS === null ? Infinity : loop.simTime - liftoffSimS,
    terrainAheadFt: (la) => {
      const elevM = aircraft.groundElevAt?.(pos.x + Math.cos(trackRad) * gsMs * la, pos.y + Math.sin(trackRad) * gsMs * la) ?? 0
      return elevM / 0.3048
    },
    nearRunwayFinal: inRunwayApproach(ll0, d.trackDeg, d.altitudeFt, airports.near(ll0.lat, ll0.lon, 6 * 1852).flatMap(ap => ap.r)),
    // 15a Mode-5 gate: only a receivable ILS we're actually established on
    // — a stale tuned ILS from another field fired spurious GLIDESLOPE.
    gsDeviation:
      nav.hasGlideslope && nav.courseDeg !== undefined && ilsOnFinal(nav.deflectionFraction ?? 2, d.headingDeg, nav.courseDeg)
        ? nav.glideslopeFraction ?? null
        : null,
    jetProfile: !!aircraft.P.jet,
    gearDown: aircraft.gearDownCommanded && aircraft.gearPos >= 1,
  })
  safetySpeech.setMuted(engineSound.muted)
  safetySpeech.update(now,
    tw.level !== 'NONE' && tw.aural ? { text: tw.aural, priority: tw.level === 'WARNING' ? 4 : 2 } : undefined,
    tc.aural && !tc.clearedRa ? { text: tc.aural, priority: tc.level === 'RA' ? 3 : 2 } : undefined,
    tw.callout && tw.newAural ? tw.aural : tc.clearedRa ? tc.aural : undefined,
  )

  const parts: string[] = []
  if (tc.level === 'TA' || tc.level === 'RA') parts.push(`⚠ ${tc.advisory}`)
  if (tw.level !== 'NONE' && tw.aural) parts.push(`${tw.level === 'WARNING' ? '⛰' : '△'} ${tw.aural}`)
  if (performance.now() < safetyAudioFailureUntil) parts.push(safetyAudioFailure)
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
  voicePtt?.cancel('ATC facility changed — previous transmission cancelled')
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
transcriptDiv.id = 'atc-transcript'
transcriptDiv.style.cssText =
  'position:fixed;left:8px;bottom:140px;max-width:520px;z-index:12;font:12px/1.5 ui-monospace,monospace;' +
  'color:#cfe;padding:8px 10px;border-radius:3px;white-space:pre-wrap;display:none;background:rgba(255,255,255,.04)'
document.body.appendChild(transcriptDiv)
const atcMenuDiv = document.createElement('div')
atcMenuDiv.id = 'atc-menu'
atcMenuDiv.style.cssText = 'position:fixed;right:8px;bottom:140px;z-index:12;display:none'
document.body.appendChild(atcMenuDiv)
const transcript: string[] = []
// Free-text ATC (goal: type anything, they respond — emergencies included).
const atcTypeBox = document.createElement('input')
atcTypeBox.placeholder = 'transmit to ATC — type anything, Enter to send (` menu)'
atcTypeBox.style.cssText =
  'position:fixed;left:8px;bottom:104px;width:504px;z-index:13;font:12px ui-monospace,monospace;' +
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
/** Read physical buttons even when Input is cleared for blur/menu/pad resync.
 * A missing device is unknown, never evidence that the trigger was released. */
function physicalPttState():boolean|null {
  if(controllerPanel.capturing)return null
  const pads=navigator.getGamepads?.()??[]
  const values=[readButton(gamepadMap,'ptt',pads),...Object.entries(gamepadMap.btnKeys??{}).filter(([,code])=>code==='KeyT').map(([key])=>readAlias(gamepadMap,key,pads))]
  if(values.some(v=>v===true))return true
  return values.some(v=>v===false)?false:null
}

// PTT shares sendFreeTextAtc and its ground/tower/approach strip authority.
const voicePanel=document.createElement('div')
voicePanel.id='atc-voice-panel'
voicePanel.style.cssText='position:fixed;left:8px;bottom:8px;z-index:14;max-width:520px;padding:8px 10px;border-radius:6px;background:rgba(0,16,26,.92);color:#dff;font:12px/1.4 ui-monospace,monospace'
const talkButton=document.createElement('button');talkButton.textContent='Hold to talk · T';talkButton.id='atc-push-to-talk';talkButton.style.touchAction='none'
const menuButton=document.createElement('button');menuButton.textContent='ATC menu · `';menuButton.onclick=()=>{if(!activeAtc){toast('NO ATC IN RANGE');return}atcMenuOpen=!atcMenuOpen;renderAtcMenu()}
const cancelVoice=document.createElement('button');cancelVoice.textContent='Cancel';cancelVoice.onclick=()=>voicePtt?.cancel()
const retryVoice=document.createElement('button');retryVoice.textContent='Check local voice';retryVoice.onclick=()=>{void refreshVoice()}
const voiceStatus=document.createElement('div');voiceStatus.id='atc-voice-status';voiceStatus.setAttribute('role','status');voiceStatus.textContent='Checking local speech…'
const voiceHelp=document.createElement('div');voiceHelp.textContent='Microphone only while held · local Whisper · max 20 seconds · typed ATC in menu'
voicePanel.append(talkButton,menuButton,cancelVoice,retryVoice,voiceStatus,voiceHelp);document.body.append(voicePanel)
voicePtt=new PushToTalk({capture:captureMicrophone,transcribe:(audio,signal)=>localVoice.transcribe(audio,signal),send:sendFreeTextAtc,suspend:setRadioListening,context:()=>`${flightVoiceEpoch}:${activeAtc?.ident}:${radios.com1.activeMhz}`,allowed:()=>document.hasFocus()&&!document.hidden&&localVoice.status.transcription&&!!activeAtc&&!loop.paused&&input.enabled&&!safetySpeech.captureBlocked,onState:state=>{voiceStatus.textContent=state.message;talkButton.setAttribute('aria-pressed',String(state.phase==='listening'));voicePanel.dataset.phase=state.phase}})
const unbindVoice=bindPushToTalk(voicePtt,talkButton,window,()=>input.enabled&&!loop.paused)
window.addEventListener('pagehide',()=>{unbindVoice();browserSpeech.cancel()},{once:true})
async function refreshVoice():Promise<void>{
  retryVoice.disabled=true
  try{const status=await localVoice.refresh();voiceStatus.textContent=status.transcription?'Local Whisper ready — hold T to talk':'Local Whisper unavailable — use typed ATC; see docs/voice-atc.md';voiceHelp.textContent=`Mic only while held · local processing · max 20s · ${status.synthesis?'local spoken replies':'browser spoken replies (may be unsupported)'}`}
  catch{voiceStatus.textContent='Local speech service unavailable — use typed ATC; see docs/voice-atc.md'}
  finally{retryVoice.disabled=false}
}
void refreshVoice()

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
  safetySpeech.radio(t.text, performance.now(), t.from)
}

comms.subscribe((t) => {
  if (!isAudible(t.freqMhz, radios.com1.activeMhz)) return // wrong freq = silence
  transcript.push(`[${t.freqMhz.toFixed(2)}] ${t.from}: ${t.text}`)
  if (transcript.length > 7) transcript.shift()
  transcriptDiv.style.display = 'block'
  transcriptDiv.textContent = transcript.join('\n')
  if (t.from !== CALLSIGN) { speak(t); shell?.notifier.push(`${t.from}: ${t.text}`, 7000) }
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
  atcMenuDiv.textContent = ''
  const head = document.createElement('div')
  head.className = 'oh-label'
  head.style.marginTop = '0'
  head.textContent = `${activeAtc.ident} · ATIS ${activeAtc.atisF.toFixed(2)}`
  atcMenuDiv.appendChild(head)
  items.forEach((it, i) => {
    const row = document.createElement('button')
    row.className = 'oh-row'
    const n = document.createElement('span'); n.className = 'oh-num'; n.textContent = String(i + 1)
    const t = document.createElement('span'); t.textContent = it.label
    row.append(n, t)
    row.onclick = () => { it.run(); atcMenuOpen = false; renderAtcMenu() }
    atcMenuDiv.appendChild(row)
  })
  shell?.open('atc')
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
      stationRangeM: distanceM(aircraftLL, ils.locAntenna ?? { lat: threshold.lat, lon: threshold.lon }),
      courseDeg: ils.courseDeg,
      runway: { ...runwayOffsets(ils, aircraftLL), lengthM: distanceM({ lat: threshold.lat, lon: threshold.lon }, opposite) },
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

/** 737NG deck per frame (cockpit view only): Boeing PFD/ND/engine/ISFD
 *  formats, the live glareshield/aisle/stand/gear panels and the control
 *  rig. Every value is the sim's own state. */
let boeingTrendIas = NaN, boeingTrendT = 0, boeingTrend = 0

/** The Boeing PFD's inputs from the sim's own state — shared by the 737
 *  deck and the Boeing skin on the GA panels. Types without a radio
 *  altimeter (everything that is not a jet) pass null, so none is drawn;
 *  types that publish V-speed arcs (non-jets) get them on the tape. */
function makeBoeingPfdInput(d: typeof aircraft.data, nav: ReturnType<typeof computeTunedNav>, iasKt: number, altFt: number, vsFpm: number): BoeingPfdInput {
  const t = performance.now() / 1000
  if (Number.isFinite(boeingTrendIas) && t > boeingTrendT) {
    const raw = ((iasKt - boeingTrendIas) / (t - boeingTrendT)) * 10
    boeingTrend += (raw - boeingTrend) * Math.min(1, (t - boeingTrendT) / 1.2)
  }
  boeingTrendIas = iasKt; boeingTrendT = t
  const P = aircraft.P
  const maxFlap = P.flapDetentsDeg[P.flapDetentsDeg.length - 1] || 1
  // Stall-warning speed: clean Vs1 → landing Vs0 by flap (no weight
  // scheduling — recorded approximation).
  const stallKt = P.vSpeeds.vs1 + (P.vSpeeds.vs0 - P.vSpeeds.vs1) * Math.min(1, aircraft.flapsDeg / maxFlap)
  const mach = (d.ktas * KT) / isa(Math.max(d.altitudeFt, 0) * FT).speedOfSoundMs
  const fdOn = apState.masterEnabled || apState.lateralMode !== 'ROL' || apState.verticalMode !== 'PIT'
  const atMode = autothrottle.mode
  const arcs = P.jet ? undefined : vSpeedArcs(P.vSpeeds)
  return {
    iasKt, trendKt10s: boeingTrend, mach, selSpeedKt: apTargets.iasTargetKt, vmoKt: P.vSpeeds.vne, stallKt,
    pitchDeg: d.pitchDeg, rollDeg: d.rollDeg, slipDeg: d.betaDeg,
    fd: { pitchDeg: apState.fdPitchDeg, bankDeg: apState.fdBankDeg },
    altFt, selAltFt: apTargets.altitudeBugFt, baroInHg: baroSetInHg, vsFpm,
    hdgDeg: d.headingDeg, selHdgDeg: apTargets.headingBugDeg, trackDeg: d.trackDeg,
    radioAltFt: P.jet ? d.aglFt : null, onGround: d.onGround,
    ...(arcs ? { vArcs: { whiteLow: arcs.whiteLowKt, whiteHigh: arcs.whiteHighKt, greenLow: arcs.greenLowKt, greenHigh: arcs.greenHighKt, yellowLow: arcs.yellowLowKt, yellowHigh: arcs.yellowHighKt } } : {}),
    ...(nav.source === 'LOC' ? { loc: nav.deflectionFraction * 2 } : {}),
    ...(nav.hasGlideslope && nav.glideslopeFraction !== undefined ? { gs: nav.glideslopeFraction * 2 } : {}),
    fma: boeingFma({ master: apState.masterEnabled, fdOn, lateral: apState.lateralMode, lateralArmed: apState.lateralArmed, vertical: apState.verticalMode, verticalArmed: apState.verticalArmed, speedMode: atMode === 'MCP SPD', atMode, onGround: d.onGround }),
  }
}

/** The Boeing ND's inputs (heading-up MAP): route, airports, TCAS, weather
 *  radar and wind; with `ga`, also the airspace outlines and the best-glide
 *  ring the G1000 map carries. */
function makeBoeingNdInput(d: typeof aircraft.data, ll: { lat: number; lon: number }, rangeNm: number, ga: boolean): BoeingNdInput {
  const nm = (lat: number, lon: number): { nN: number; nE: number } => ({ nN: (lat - ll.lat) * 60, nE: (lon - ll.lon) * 60 * Math.cos((ll.lat * Math.PI) / 180) })
  const legs = flightPlan.legs()
  const prog = legs.length ? activeLegProgress(legs, ll) : undefined
  const wps = flightPlan.all
  const activeIdx = prog ? prog.legIndex + 1 : -1
  const activeWp = activeIdx >= 0 ? wps[activeIdx] : undefined
  const etaZ = (distM: number): string => {
    const gs = Math.max(d.groundSpeedKt, 1)
    const when = new Date(baseDate.getTime() + (loop.simTime + scrubSeconds) * 1000 + (distM / 1852 / gs) * 3600_000)
    return `${String(when.getUTCHours()).padStart(2, '0')}${String(when.getUTCMinutes()).padStart(2, '0')}.${Math.floor(when.getUTCSeconds() / 6)}`
  }
  const windKt = Math.hypot(aircraft.windNed.x, aircraft.windNed.y) / KT
  return {
    hdgDeg: d.headingDeg, trackDeg: d.trackDeg, selHdgDeg: apTargets.headingBugDeg,
    gsKt: d.groundSpeedKt, tasKt: d.ktas, windDirDeg: windDirFromNed(aircraft.windNed), windKt, rangeNm,
    airports: airports.near(ll.lat, ll.lon, (rangeNm + 5) * 1852).map((a) => ({ id: a.i, ...nm(a.la, a.lo) })),
    route: wps.map((w, i) => ({ id: w.ident, ...nm(w.lat, w.lon), active: i === activeIdx })),
    ...(activeWp && prog ? { activeWpt: { id: activeWp.ident, distNm: prog.distanceRemainingM / 1852, etaZ: etaZ(prog.distanceRemainingM) } } : {}),
    traffic: trafficDots.map((t) => ({ nN: t.dNorthM / 1852, nE: t.dEastM / 1852, relAltFt: t.relAltFt, alerted: t.alerted })),
    wx: nexradMfdCells.map((c) => ({ nN: c.dNorthM / 1852, nE: c.dEastM / 1852, intensity: c.intensity })),
    ...(ga ? {
      airspace: filterAirspaceInRange(ll, currentAirspace, rangeNm * 1852).flatMap((poly) => {
        const ring = poly.r[0]
        if (!ring || ring.length < 3) return []
        const st = airspaceStrokeStyle(poly.k)
        return [{ ring: ring.map(([lon, lat]) => nm(lat, lon)), color: st.color, dash: st.dash, ...(poly.k === AirspaceKind.ClassD ? { label: `${Math.round(poly.ce / 100)}/${Math.round(poly.fl / 100)}` } : {}) }]
      }),
      glideRingNm: glideRangeRadiusM(d.aglFt) / 1852,
    } : {}),
  }
}

/** 737NG deck per frame (cockpit view only): Boeing PFD/ND/engine/ISFD
 *  formats, the live glareshield/aisle/stand/gear panels and the control
 *  rig. Every value is the sim's own state. */
function update737Deck(d: typeof aircraft.data, nav: ReturnType<typeof computeTunedNav>, ll: { lat: number; lon: number }, iasKt: number, altFt: number, vsFpm: number): void {
  const deck = cockpit.deck737!
  const P = aircraft.P
  const oatC = isa(Math.max(d.altitudeFt, 0) * FT).temperatureK - 273.15 + aircraft.isaTempOffsetC
  const mach = (d.ktas * KT) / isa(Math.max(d.altitudeFt, 0) * FT).speedOfSoundMs
  const fdOn = apState.masterEnabled || apState.lateralMode !== 'ROL' || apState.verticalMode !== 'PIT'
  const atMode = autothrottle.mode
  const speedMode = atMode === 'MCP SPD'
  const pfdC = cockpit.pfdCanvas, ndC = cockpit.mfdCanvas
  const windKt = Math.hypot(aircraft.windNed.x, aircraft.windNed.y) / KT
  drawGaBoeingPfd(cockpit.pfdCtx, pfdC.width, pfdC.height, makeBoeingPfdInput(d, nav, iasKt, altFt, vsFpm), {
    com1: radios.com1, nav1: radios.nav1, squawk: '1200', oatC, ktas: d.ktas, groundSpeedKt: d.groundSpeedKt,
    windDirDeg: windDirFromNed(aircraft.windNed), windKt, alerts: [],
  })
  cockpit.pfdTexture.needsUpdate = true
  const wps = flightPlan.all
  const legs = flightPlan.legs()
  const prog = legs.length ? activeLegProgress(legs, ll) : undefined
  const activeIdx = prog ? prog.legIndex + 1 : -1
  const etaZ = (distM: number): string => {
    const gs = Math.max(d.groundSpeedKt, 1)
    const when = new Date(baseDate.getTime() + (loop.simTime + scrubSeconds) * 1000 + (distM / 1852 / gs) * 3600_000)
    return `${String(when.getUTCHours()).padStart(2, '0')}${String(when.getUTCMinutes()).padStart(2, '0')}.${Math.floor(when.getUTCSeconds() / 6)}`
  }
  const activeWp = activeIdx >= 0 ? wps[activeIdx] : undefined
  // Engine states: jets use the Captain systems' two banks (3/4 engines map
  // inboard/outboard onto them); turboprops share the one engine model.
  const running: boolean[] = Array.from({ length: engineCount }, (_, i) => (P.jet ? (i < Math.ceil(engineCount / 2) ? captainSystems.engine1Running : captainSystems.engine2Running) : aircraft.engineRunning))
  const n1 = d.n1Pct, ffPer = (aircraft.prop.fuelFlowKgS * 3600) / Math.max(1, running.filter(Boolean).length)
  const jet = P.jet
  const tatC = (oatC + 273.15) * (1 + 0.2 * mach * mach) - 273.15
  // Turboprop engine display: torque % (shaft power over prop speed) and NP.
  const npPct = (d.rpm / Math.max(1, P.redlineRpm)) * 100
  const trqPct = (Math.max(0, d.shaftPowerW / Math.max(1, P.ratedPowerW)) / Math.max(0.05, npPct / 100)) * 100
  const eng: BoeingEicasInput = DECK_PROFILE?.turboprop
    ? {
        n1Pct: running.map((r) => (r ? trqPct : 0)), n1RedlinePct: 100, n1CommandPct: aircraft.controls.throttle * 100,
        egtC: running.map((r) => (r ? npPct : 0)), ffKgH: running.map((r) => (r ? ffPer : 0)),
        fuelKg: [fuelState.leftKg, fuelState.rightKg], tatC, reverse: false,
        labels: { primary: 'TRQ', secondary: 'NP', secondaryMax: 110, secondaryRed: 104 },
      }
    : {
        n1Pct: running.map((r) => (r ? n1 : 0)),
        n1RedlinePct: jet?.n1MaxPct ?? 104,
        n1CommandPct: jet ? jet.n1IdlePct + aircraft.controls.throttle * (jet.n1MaxPct - jet.n1IdlePct) : 0,
        egtC: running.map((r) => egtFromN1(r ? n1 : 0, oatC)),
        ffKgH: running.map((r) => (r ? ffPer : 0)),
        fuelKg: [fuelState.leftKg, fuelState.rightKg], tatC,
        reverse: aircraft.reversePos > 0.05,
      }
  const ndIn = makeBoeingNdInput(d, ll, 40, false)
  if (deck.style.layout.ndEngines) drawMfdWithEngines(cockpit.mfdCtx, ndC.width, ndC.height, ndIn, eng)
  else drawSquareFitted(cockpit.mfdCtx, 0, 0, ndC.width, ndC.height, (c, S) => drawBoeingNd(c, S, ndIn))
  cockpit.mfdTexture.needsUpdate = true
  if (cockpit.boeingScreens) {
    const ec = cockpit.boeingScreens.eicas.ctx
    drawSquareFitted(ec, 0, 0, ec.canvas.width, ec.canvas.height, (c, S) => drawBoeingEicas(c, S, eng))
    cockpit.boeingScreens.eicas.texture.needsUpdate = true
    drawIsfd(cockpit.boeingScreens.isfd.ctx, 256, { iasKt, altFt, pitchDeg: d.pitchDeg, rollDeg: d.rollDeg, baroInHg: baroSetInHg })
    cockpit.boeingScreens.isfd.texture.needsUpdate = true
  }
  const gearPos = aircraft.P.gearRetractable ? aircraft.gearPos : 1
  const fireTest = auralFireTest || cockpitInteraction.heldDeckControl === 'fireTest'
  const destWp = wps.length ? wps[wps.length - 1] : undefined
  const nextWp = activeIdx >= 0 ? wps[activeIdx + 1] : undefined
  update737Live(deck, {
    mcp: {
      iasKt: apTargets.iasTargetKt, hdgDeg: apTargets.headingBugDeg, altFt: apTargets.altitudeBugFt, vsFpm: apTargets.vsTargetFpm,
      vsActive: apState.verticalMode === 'VS', courseDeg: radios.obs1Deg, cmdA: apState.masterEnabled,
      lateral: apState.lateralMode, lateralArmed: apState.lateralArmed, vertical: apState.verticalMode, verticalArmed: apState.verticalArmed,
      speedMode, n1Mode: atMode === 'N1', fdOn, atArm: atArmSwitch,
    },
    fireWarn: fireTest,
    prst: { ap: auralLatches.wailerUntilS > performance.now() / 1000, at: autothrottle.disconnectLight },
    masterCaution: fireTest,
    aisle: { nav1: radios.nav1, nav2: radios.nav2, com1: radios.com1, com2: radios.com2, squawk: '1200', rudderTrim: captainSystems.rudderTrim, fireTest },
    gear: { left: gearPos, nose: gearPos, right: gearPos },
    flapsDeg: aircraft.flapsDeg,
    // Stab trim units: the sim's ±1 trim mapped onto the 737's 0–17 unit
    // scale, nose-down at 0 (recorded mapping).
    trimUnits: 8.5 - aircraft.controls.trim * 8.5,
    parkingBrake,
    speedbrakeArmed: aircraft.spoilerArmed,
    cduLines: [
      ['', 'ACT PROGRESS 1/3'],
      [' TO', 'DTG      ETA'],
      [activeWp?.ident ?? '-----', prog ? `${(prog.distanceRemainingM / 1852).toFixed(0)}   ${etaZ(prog.distanceRemainingM)}Z` : ''],
      [' NEXT', ''],
      [nextWp?.ident ?? '-----', ''],
      [' DEST', ''],
      [destWp?.ident ?? '-----', ''],
      [' GS', 'FUEL QTY'],
      [`${Math.round(d.groundSpeedKt)}KT`, `${((fuelState.leftKg + fuelState.rightKg) / 1000).toFixed(1)}`],
      [' WIND', 'TAS'],
      [`${String(Math.round(windDirFromNed(aircraft.windNed)) % 360).padStart(3, '0')}°/${Math.round(windKt)}`, `${Math.round(d.ktas)}`],
      ['', ''],
      ['<POS REPORT', 'POS REF>'],
    ],
    landingLights: aircraftLights.landingOn,
    powered: true, // jets count as powered (no jet electrical model — see lightsPowered)
    ambient: Math.max(0, Math.min(1, (sky.sunDir.y + 0.05) / 0.3)),
  })
  animate737(deck, {
    pitch: aircraft.controls.pitch, roll: aircraft.controls.roll, yaw: aircraft.controls.yaw,
    throttle: aircraft.controls.throttle, reverse: aircraft.reversePos, flapsDeg: aircraft.flapsDeg,
    speedbrake: aircraft.spoilerCmd, speedbrakeArmed: aircraft.spoilerArmed, trim: aircraft.controls.trim,
    gearDown: !aircraft.P.gearRetractable || aircraft.gearDownCommanded, parkingBrake, enginesRunning: running,
  })
}

function advanceFrame(elapsed: number, now: number): void {
  const perfT0 = performance.now()
  updateControllers()
  handleDiscreteKeys()
  pollControls(elapsed)
  voicePtt?.checkContext()
  voicePtt?.poll('gamepad', physicalPttState())
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
  lastCourseDeg = tunedNav.source ? tunedNav.courseDeg : undefined
  lastTunedNavResult = tunedNav
  {
    const legsNow = flightPlan.legs()
    const prog = legsNow.length ? activeLegProgress(legsNow, preStepLL) : undefined
    lastGpsLegCourse = prog ? legsNow[prog.legIndex]!.courseDeg : undefined
    // Route complete: reaching the last waypoint drops NAV to heading hold.
    if (prog && prog.legIndex === legsNow.length - 1 && prog.distanceRemainingM < 926 && apPanel.lateral === 'NAV' && apPanel.master) {
      apPanel = { ...apPanel, sel: { ...apPanel.sel, headingDeg: Math.round(aircraft.data.headingDeg) || 360 }, touched: { ...apPanel.touched, heading: true }, lateral: 'HDG' }
      toast('ROUTE COMPLETE — HDG HOLD')
    }
  }
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

      // Flight-guidance panel → control-law targets.
      if (systemsControls.apMaster && !apPanel.master) apPanel = pressAp(apPanel, apSnapshot()).panel
      else if (!systemsControls.apMaster && apPanel.master) apPanel = disconnectAp(apPanel)
      if (!apPanel.direct) {
        apPanel = applyApFeedback(apPanel, { altsCaptured: apState.altsCaptured })
        const t = toApTargets(apPanel, apSnapshot())
        apTargets.lateralMode = t.lateralMode
        apTargets.verticalMode = t.verticalMode
        apUnderlying = t.underlyingVerticalMode
        apTargets.altitudeBugFt = t.altitudeBugFt
        apTargets.vsTargetFpm = t.vsTargetFpm
        apTargets.iasTargetKt = t.iasTargetKt
        // The course datum for tracking modes: the localizer course once
        // APR is tracking (pinned below), the flight-plan leg for NAV, the
        // OBS course for a VOR; otherwise the pilot's heading bug.
        const pinned = !apState.lateralArmed && (t.lateralMode === 'APR') && lastTunedNavResult?.courseDeg !== undefined
        if (!pinned) {
          apTargets.headingBugDeg = t.lateralMode === 'NAV'
            ? (lastGpsLegCourse ?? (lastTunedNavResult?.source === 'VOR' ? radios.obs1Deg : t.headingBugDeg))
            : t.headingBugDeg
        }
      }

      stepAutopilot(apState, dt, {
        underlyingVerticalMode: apUnderlying,
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
      if (systemsControls.apMaster) {
        const fault = apEnvelopeFault({ rollDeg: aircraft.data.rollDeg, pitchDeg: aircraft.data.pitchDeg, kias: aircraft.data.kias, vneKt: aircraft.P.vSpeeds.vne, stallFraction: aircraft.data.stallFraction, onGround: aircraft.data.onGround })
        if (fault) {
          systemsControls.apMaster = false
          apPanel = disconnectAp(apPanel)
          disconnectAutopilot(apState)
          apDisconnectPressedFlag = false
          toast(fault === 'ON THE GROUND' ? 'AUTOPILOT OFF — TOUCHDOWN' : `AUTOPILOT DISCONNECT — ${fault}`)
        }
      }
      if (DECK_PROFILE?.autothrottle) {
        const atCmd = stepAutothrottle(autothrottle, dt, {
          armSwitch: atArmSwitch, speedPressed: atSpeedPressed, disconnectPressed: atDisconnectPressed, resetLight: atResetPressed,
          iasKt: aircraft.data.kias, targetKt: apTargets.iasTargetKt, verticalMode: apTargets.verticalMode,
          pitchModeActive: apState.masterEnabled && apTargets.verticalMode !== 'PIT',
          altitudeFt: aircraft.data.altitudeFt, selectedAltFt: apTargets.altitudeBugFt, onGround: aircraft.data.onGround,
          lever: aircraft.controls.throttle,
        })
        atSpeedPressed = atDisconnectPressed = atResetPressed = false
        if (atCmd !== null && !aircraft.reverseCmd) aircraft.controls.throttle = atCmd
      }
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

      const untrimmedYaw=aircraft.controls.yaw
      aircraft.controls.yaw=Math.min(1,Math.max(-1,untrimmedYaw+captainSystems.rudderTrim))
      aircraft.controls.brakeLeft=Math.max(pilotBrake,captainSystems.autobrakeDemand)
      aircraft.controls.brakeRight=Math.max(pilotBrake,captainSystems.autobrakeDemand)
      aircraft.step(dt)
      aircraft.controls.yaw=untrimmedYaw

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
        // Negative g / inverted: gravity-fed fuel and oil starve the engine
        // (fuel.ts). Fuel-less gliders have nothing to starve.
        loadFactorG: aircraft.data.loadFactorG,
        negGToleranceS: aircraft.P.fuelCapacityKg < 1 ? Infinity : negativeGToleranceS(aircraft.P),
      })
      if (fuelState.negGCut && !negGCutAnnounced) {
        negGCutAnnounced = true
        if (aircraft.engineRunning) toast('ENGINE QUIT — inverted/negative-g starved the fuel + oil feed. Roll upright, then restart.')
      } else if (!fuelState.negGCut) negGCutAnnounced = false
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
      captainSystems=stepCaptainSystems(captainSystems,{
        fuelAvailable:fuelState.fuelFlowing,electricalPower:systemsControls.masterBattery,
        onGround:aircraft.data.onGround,groundSpeedKt:aircraft.data.groundSpeedKt,
        throttle:aircraft.controls.throttle,manualBrake:pilotBrake,...captainCommands,
      },dt)
      if(aircraft.P.jet){aircraft.jetPowerFactor=captainSystems.enginePowerFraction;aircraft.engineRunning=captainSystems.enginePowerFraction>0}
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
      if(!aircraft.P.jet)aircraft.engineRunning = engineStartState.status === 'running'
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
  tiles.updateDetail(pos.x, pos.y, aircraft.data.aglFt*FT, now)
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
    flapFrac: Math.max(0,Math.min(1,aircraft.flapsDeg / Math.max(FLEET_ACTIVE.params.flapDetentsDeg[FLEET_ACTIVE.params.flapDetentsDeg.length - 1] ?? 1, 1))),
    flapsDeg: aircraft.appliedControlSurfaces.flapsDeg,
    ...(aircraft.P.flaperons ? {flaperonLeftRad: aircraft.appliedControlSurfaces.flaperonLeftRad, flaperonRightRad: aircraft.appliedControlSurfaces.flaperonRightRad} : {}),
    spoilerFrac: aircraft.spoilerPos,
    roll: aircraft.appliedControlSurfaces.roll,
    pitch: aircraft.appliedControlSurfaces.pitch,
    yaw: rudderVisual(aircraft.appliedControlSurfaces.yaw),
    trim: aircraft.appliedControlSurfaces.trim,
    elevatorRad: aircraft.appliedControlSurfaces.elevatorSurfaceRad,
    stabilizerRad: aircraft.appliedControlSurfaces.stabilizerRad,
    elevatorCommandRad: aircraft.appliedControlSurfaces.elevatorCommandRad,
    trimRad: aircraft.appliedControlSurfaces.trimRad,
    rudderTrim: captainSystems.rudderTrim,
    gearPos: aircraft.gearPos,
    reverseFrac: aircraft.reversePos,
  })

  if (cockpitLayout === 'boeingNG') {
    if (engineSound.unlocked) boeingAuralsAudio.unlock()
    boeingAuralsAudio.muted = engineSound.muted
    const altM = d.altitudeFt * 0.3048
    const aurals = boeingAurals({
      onGround: d.onGround, kias: d.kias, vmoKt: aircraft.P.vSpeeds.vne,
      mach: (d.ktas * KT) / isa(altM).speedOfSoundMs, ...(MMO_BY_TYPE[fleetKey] ? { mmo: MMO_BY_TYPE[fleetKey] } : {}),
      stallFraction: d.stallFraction, alphaDeg: d.alphaDeg, throttle: aircraft.controls.throttle, flapsDeg: aircraft.flapsDeg,
      gearDownLocked: aircraft.gearPos >= 0.999, gearRetractable: !!aircraft.P.gearRetractable, radioAltFt: d.aglFt,
      speedbrakeStowed: aircraft.spoilerCmd < 0.02, parkingBrake,
      // Green band needs a CG-scheduled trim limit this sim doesn't model:
      // reported as in-band rather than inventing one (recorded).
      stabInGreenBand: true,
      apEngaged: systemsControls.apMaster, altitudeFt: d.altitudeFt, selectedAltFt: apTargets.altitudeBugFt,
      apDisconnectPressed: apDisconnectPressedFlag, hornCutout: auralHornCutout, fireTest: auralFireTest || cockpitInteraction.heldDeckControl === 'fireTest',
    }, auralLatches, performance.now() / 1000)
    apDisconnectPressedFlag = false
    auralHornCutout = false
    boeingAuralsAudio.update(loop.paused || aircraft.crashed ? new Set() : aurals.continuous, loop.paused ? [] : aurals.oneShots)
  }
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
  for (const o of exteriorCabin) o.visible = cameraMode !== 'cockpit'
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
    const deckClick = cockpitInteraction.consumeDeckClick()
    // Held guidance-panel knob halves auto-repeat (faster the longer held).
    const held = cockpitInteraction.heldDeckControl
    if (held?.startsWith('apKnob:') && !deckClick && performance.now() > knobHoldAt) {
      const [, k, d] = held.split(':')
      const sinceFirst = performance.now() - knobHoldStart
      apTurn(k as Knob, Number(d) * (sinceFirst > 1500 ? 10 : 1))
      knobHoldAt = performance.now() + (sinceFirst > 1500 ? 160 : 110)
    }
    if (!held) knobHoldStart = performance.now()
    // Turboprop decks have no G1000 starter button: holding an overhead
    // ENGINE START selector cranks the engine.
    if (DECK_PROFILE?.turboprop) systemsControls.starterEngaged = cockpitInteraction.heldDeckControl === 'engStart'
    if (deckClick === 'hornCutout') auralHornCutout = true
    else if (deckClick === 'mcpDisengage') { systemsControls.apMaster = false; apDisconnectPressedFlag = true }
    else if (deckClick === 'apBtn:speedBtn') atSpeedPressed = true
    else if (deckClick?.startsWith('apBtn:')) apPress(deckClick.slice(6) as ApAction)
    else if (deckClick?.startsWith('apKnob:')) { const [, k, d] = deckClick.split(':'); apTurn(k as Knob, Number(d)); knobHoldAt = performance.now() + 450 }
    else if (deckClick === 'atDisconnect') atDisconnectPressed = true
    else if (deckClick === 'atReset') atResetPressed = true
    else if (deckClick === 'apReset') apDisconnectPressedFlag = true
    else if (deckClick === 'landingLights') {
      aircraftLights.landingOn = !aircraftLights.landingOn
      toast(aircraftLights.landingOn ? 'LANDING LIGHTS ON' : 'LANDING LIGHTS OFF')
    }
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
  // GA panels (piston / turboprop / glider) wear the Boeing display skin:
  // the PFD, the MAP page and the engine strip use the 737 formats inside
  // the G1000 panel's canvases (boeing-ga-displays.ts). Cockpit view only.
  const gaSkin = !cockpit.deck737 && cameraMode === 'cockpit'
  const gaIndAlt = indicatedAltitudeFt(pitotReadings.altFt, baroSetInHg, qnhInHg)
  const gaOatC = isa(Math.max(d.altitudeFt, 0) * FT).temperatureK - 273.15 + aircraft.isaTempOffsetC
  const gaPfdSkin = gaSkin
    ? (() => {
        const pfdIn = makeBoeingPfdInput(d, tunedNav, pitotReadings.iasKt, gaIndAlt, pitotReadings.vsiFpm)
        return (ctx: CanvasRenderingContext2D, w: number, h: number): void => drawGaBoeingPfd(ctx, w, h, pfdIn, {
          com1: radios.com1, nav1: radios.nav1, squawk: '1200', oatC: gaOatC, ktas: d.ktas, groundSpeedKt: d.groundSpeedKt,
          windDirDeg: windDirFromNed(aircraft.windNed), windKt: Math.hypot(aircraft.windNed.x, aircraft.windNed.y) / KT, alerts: annunciations,
        })
      })()
    : undefined
  const gaMfdSkin = gaSkin
    ? {
        eis: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void => drawBoeingEngineColumn(ctx, x, y, w, h, {
          hasEngine: COCKPIT_PROFILE.ga?.hasEngine ?? aircraft.P.fuelCapacityKg >= 1,
          kind: COCKPIT_PROFILE.ga?.turboprop ? 'turboprop' : 'piston', engines: COCKPIT_PROFILE.ga?.engines ?? 1,
          torquePct: (Math.max(0, d.shaftPowerW / Math.max(1, aircraft.P.ratedPowerW)) / Math.max(0.05, d.rpm / Math.max(1, aircraft.P.redlineRpm))) * 100,
          hasElectrical: COCKPIT_PROFILE.ga?.hasElectrical ?? true,
          rpm: d.rpm, redlineRpm: aircraft.P.redlineRpm, egtC: pistonEgtC(aircraft.controls.mixture),
          chtC: engineTemps.chtC, chtMaxC: CHT_MAX_C, oilTempC: engineTemps.oilTempC, oilTempMaxC: OIL_TEMP_MAX_C,
          oilPressPsi: engineTemps.oilPressPsi, oilPressMaxPsi: OIL_PRESS_MAX_PSI, oilPressMinGreenPsi: OIL_PRESS_MIN_GREEN_PSI,
          fuelFlowGph: d.fuelFlowGph, fuelLGal: kgToGal(fuelState.leftKg), fuelRGal: kgToGal(fuelState.rightKg),
          tankCapGal: aircraft.P.fuelCapacityKg > 1 ? kgToGal(aircraft.P.fuelCapacityKg / 2) : TANK_CAPACITY_GAL,
          volts: electricalState.busVoltage, ampsAlt: electricalState.alternatorAmps, ampsBat: electricalState.batteryAmps,
        }),
        map: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void => drawGaBoeingNd(ctx, x, y, w, h, makeBoeingNdInput(d, ll, 20, true)),
      }
    : undefined
  if (!cockpit.deck737 && cameraMode === 'cockpit') updateCockpitDisplays(
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
      ...(gaMfdSkin ? { skin: gaMfdSkin } : {}),
    },
    gaPfdSkin,
  )

  if (cockpit.deck737 && cameraMode === 'cockpit') update737Deck(d, tunedNav, ll, pitotReadings.iasKt, indicatedAltitudeFt(pitotReadings.altFt, baroSetInHg, qnhInHg), pitotReadings.vsiFpm)
  const simDate = new Date(baseDate.getTime() + (loop.simTime + scrubSeconds) * 1000)
  sky.setShadowTarget(mesh.group.position)
  shadowCatcher.update(
    mesh.group.position.x,
    (aircraft.groundElevAt?.(pos.x, pos.y) ?? 0),
    mesh.group.position.z,
  )
  const cloudCoverage = { FEW: 0.15, SCT: 0.35, BKN: 0.75, OVC: 1, VV: 1 }
  sky.setCloudCover(wxSlabs.reduce((cover, slab) => camera.position.y < slab.topMslFt*FT
    ? Math.max(cover, cloudCoverage[slab.cover] ?? 0) : cover, 0))
  const sunDir = sky.update(simDate, ll.lat, ll.lon)
  lastSunDir = sunDir
  lastSunElevationDeg = sky.elevationDeg
  sky.updateEnvironment(renderer, scene, camera.position)
  const dayness = Math.min(Math.max((sky.elevationDeg + 6) / 16, 0), 1)
  // 13e: METAR surface wind drives the sea state; sun-position dusk factor
  // (peaks with the sun at the horizon) warms the cloud decks.
  ocean.update(loop.simTime, sunDir, dayness, wind.steadyMs, wind.steadyTowardRad,
    worldShift.e, worldShift.n, tiles.fogDensity, sky.directTransmission)
  const dusk = Math.min(Math.max(1 - Math.abs(sky.elevationDeg) / 8, 0), 1)
  const lowSunT = Math.min(1, Math.max(0, 1 - sky.elevationDeg / 25))
  tiles.setWorldOffset(worldShift.e, worldShift.n)
  tiles.setLight(sunDir, dayness, lowSunT * lowSunT * (3 - 2 * lowSunT), sky.directTransmission)
  clouds.update(wxSlabs, camera.position, worldShift.e, worldShift.n, dayness, sunDir, dusk)
  // 13c night lights: airport layer + aircraft exterior lights.
  const night = Math.min(Math.max(1 - dayness * 1.6, 0), 1)
  airports.updateNight(loop.simTime, night)
  airports.updateServices(loop.simTime, camera.position.x, camera.position.z)
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
    dayness,
  )
  // Local rendered density keeps clear gaps clear, including sparse METAR layers.
  // FogExp2 approximates immersion; the volumes integrate the visible cloud path.
  cloudFog.density = clouds.extinctionAt(camera.position)
  cloudFog.color.setHex(dayness > 0.4 ? 0xc8ccd2 : 0x14161a)
  tiles.setCloudFog(cloudFog)
  ocean.setCloudFog(cloudFog)

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
      safety: safetyLine || (performance.now() < debriefUntil ? debriefLine : '') || undefined,
      copilot: performance.now() < copilotUntil ? copilotLine : undefined,
      assist: assistMode === 'off' ? undefined : assistMode === 'sas' ? 'SAS' : 'ASSIST FULL',
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
  // On-screen flight instruments (external views; the cockpit has its own).
  instruments.visible = instrumentsOn && cameraMode !== 'cockpit'
  if (instruments.visible) {
    const f = aircraft.data, P = aircraft.P
    const arcs = vSpeedArcs(P.vSpeeds)
    const jetN = P.jet?.engines
    const nEng = jetN ?? Math.max(1, COCKPIT_PROFILE.ga?.engines ?? engineCount)
    const redline = P.jet ? P.jet.n1MaxPct : 100
    const power = P.jet ? f.n1Pct : Math.min(120, Math.max(0, (f.shaftPowerW / Math.max(1, P.ratedPowerW)) * 100))
    const lever = aircraft.controls.throttle * 100
    const hasEngine = P.fuelCapacityKg >= 1
    // Stall-onset angle of attack for the current flap setting — the same
    // lift-curve arithmetic the aero model uses (clMax − cl0 over the slope).
    const stallDeg = (((P.clMaxClean + flapInterp(P.flapDClMax, aircraft.flapsDeg, P.flapDetentsDeg)) - (P.cl0 + flapInterp(P.flapDCl0, aircraft.flapsDeg, P.flapDetentsDeg))) / P.clAlpha) * (180 / Math.PI)
    const olState: OverlayState = {
      headingDeg: f.headingDeg,
      headingBugDeg: apTargets.headingBugDeg,
      ...(lastCourseDeg !== undefined ? { courseDeg: lastCourseDeg } : {}),
      iasKt: f.kias,
      ...(apState.masterEnabled && (apTargets.verticalMode === 'FLC' || autothrottle.engaged) ? { selSpeedKt: apTargets.iasTargetKt } : {}),
      tasKt: f.ktas,
      groundSpeedKt: f.groundSpeedKt,
      altitudeFt: f.altitudeFt,
      ...(apState.masterEnabled && apTargets.altitudeBugFt > 0 ? { selAltFt: apTargets.altitudeBugFt } : {}),
      baroInHg: baroSetInHg,
      verticalSpeedFpm: f.verticalSpeedFpm,
      engines: hasEngine ? Array.from({ length: nEng }, () => ({ lever, value: power, redline })) : [],
      ...(hasEngine ? { fuelPct: Math.min(100, Math.max(0, (aircraft.fuelKg / Math.max(1, P.fuelCapacityKg)) * 100)) } : {}),
      aoaDeg: f.alphaDeg,
      aoaStallDeg: stallDeg,
      ...(P.flapDetentsDeg.length > 1 ? { flapsFrac: Math.min(1, aircraft.flapsDeg / Math.max(1, P.flapDetentsDeg[P.flapDetentsDeg.length - 1]!)), flapsDeg: aircraft.flapsDeg } : {}),
      ...(P.trimMaxRad > 0 ? { trim: aircraft.controls.trim } : {}),
      greenLowKt: arcs.greenLowKt, greenHighKt: arcs.greenHighKt, yellowHighKt: arcs.yellowHighKt,
      ...((safetyLine || f.stallFraction > 0.35) ? { alert: safetyLine || 'STALL', alertRed: !!safetyLine ? /PULL UP|TERRAIN|CRASH/i.test(safetyLine) : true } : {}),
      ...(performance.now() < copilotUntil ? { callout: copilotLine } : {}),
    }
    instruments.update(olState)
  }

  {
    const sun = sunScreenPosition(camera, lastSunDir, lastSunElevationDeg)
    postFx.render(scene, camera, {
      sunScreen: sun.screen, sunVisibility: sun.visibility, sunElevationDeg: lastSunElevationDeg,
      bloomStrength: postStrength.bloom, rayStrength: postStrength.rays, vignette: postStrength.vignette,
    })
  }
  graphicsPanel.update(now, cameraMode, performance.now()-perfT0, renderer)
  shell?.refresh()
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
    // A free-flight launch that needed a new aircraft arrives here after
    // the reload; otherwise start at KHAF 30 behind the start screen
    // (skip it with ?launcher=0 for automation).
    let pending: LaunchChoice | null = null
    try { pending = parsePendingLaunch(sessionStorage.getItem(PENDING_LAUNCH_KEY)); sessionStorage.removeItem(PENDING_LAUNCH_KEY) } catch { /* storage unavailable */ }
    if (pending && pending.aircraft === fleetKey) { applyLaunch(pending); return }
    const khaf = airports.find('KHAF')
    if (khaf) spawnAtAirport(khaf, '30')
    if (new URLSearchParams(location.search).get('launcher') !== '0') launcher?.open()
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
    // The hook owns the targets until the next panel press (automation).
    apPanel = { ...apPanel, direct: true }
  },
  __ohApPanel: () => ({ ...apPanel, sel: { ...apPanel.sel } }),
  __ohApPress: (a: ApAction) => { if (typeof a === 'string') { apPanel = { ...apPanel, direct: false }; apPress(a) } },
  __ohApTurn: (k: Knob, steps: number) => { const n = finiteOr(steps); if (n !== null && (k === 'heading' || k === 'altitude' || k === 'vs' || k === 'ias')) { apPanel = { ...apPanel, direct: false }; apTurn(k, n) } },
  __ohApState: () => ({ ...apState }),
  __ohSetRadioListening: setRadioListening,
  __ohSafety: () => ({ safetyLine, dots: trafficDots, tcas: lastTcasDebug }),
  /** 737 autothrottle: read state, or set the ARM switch / press SPEED. */
  __ohAt: (o?: { arm?: boolean; speed?: boolean; disconnect?: boolean }) => {
    if (o?.arm !== undefined) atArmSwitch = o.arm
    if (o?.speed) atSpeedPressed = true
    if (o?.disconnect) atDisconnectPressed = true
    return { arm: atArmSwitch, ...autothrottle }
  },
  /** Post-processing controls (verification): enable, strengths. */
  __ohPost: (o?: { enabled?: boolean; bloom?: number; rays?: number; vignette?: number }) => {
    if (o?.enabled !== undefined) postFx.enabled = !!o.enabled
    for (const k of ['bloom', 'rays', 'vignette'] as const) { const v = finiteOr(o?.[k]); if (v !== null) postStrength[k] = v }
    return { enabled: postFx.enabled, ...postStrength }
  },
  /** Open / close the free-flight start screen (verification). */
  __ohLauncher: (open: boolean) => { if (open) launcher?.open(); else launcher?.close() },
  /** Cockpit look direction (radians) for verification screenshots. */
  __ohLook: (yaw: number, pitch: number) => cockpitCam.setLook(yaw, pitch),
  /** 737NG aurals: inspect, or drive the FIRE WARN test / HORN CUTOUT. */
  __ohAurals: (o?: { fireTest?: boolean; hornCutout?: boolean }) => {
    if (o?.fireTest !== undefined) auralFireTest = o.fireTest
    if (o?.hornCutout) auralHornCutout = true
    return { layout: cockpitLayout, fireTest: auralFireTest, ...boeingAuralsAudio.inspect() }
  },
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
  __ohGraphics: () => ({
    sunElevation: sky.elevationDeg,
    detailedImagery: tiles.debugImagery().detailed,
    cloudFogDensity: cloudFog.density,
    directTransmission: sky.directTransmission,
    fogDensity: tiles.fogDensity,
    reversedDepth: renderer.capabilities.reversedDepthBuffer,
    pixelRatio: renderer.getPixelRatio(),
    exposure: renderer.toneMappingExposure,
    width: renderer.domElement.width,
    height: renderer.domElement.height,
  }),
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
    captain: { ...captainSystems },
    appliedControlSurfaces: { ...aircraft.appliedControlSurfaces },
    parkingBrake,
    capturing: controllerPanel.capturing,
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
  __ohLoading: (selection?: LoadingSelection) => selection
    ? applyAndSaveLoading(selection, loadingUnit)
    : { ...currentLoading(), grossKg: aircraft.massKg, mtowKg: aircraft.P.mtowKg, unit: loadingUnit },
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
  /** Park the free camera at a world offset from the aircraft (east, up, south metres) looking along yaw/pitch degrees (0 = north). */
  __ohFreeCam: (o: { e?: number; u?: number; s?: number; yaw?: number; pitch?: number }) => {
    const g = mesh.group.position
    const d = (v: unknown): number => finiteOr(v as number) ?? 0
    freeCam.setPose(g.x + d(o?.e), g.y + d(o?.u), g.z + d(o?.s), (d(o?.yaw) * Math.PI) / 180, (d(o?.pitch) * Math.PI) / 180)
    cameraMode = 'free'
  },
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
  /** Stability-assist mode (mirrors X): 'off' | 'sas' | 'full'. */
  __ohAssist: (m?: 'off' | 'sas' | 'full') => {
    if (m === 'off' || m === 'sas' || m === 'full') assistMode = m
    return assistMode
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


const graphicsActions: GraphicsActions = {
  clearInput: () => input.clearHeld(),
  quality: mode => { clouds.setQuality(mode); tiles.setDetailEnabled(mode !== 'performance'); postFx.setQuality(mode) },
  camera: mode => { cameraMode = mode },
  lighting: mode => {
    const ll = frame.fromLocal(aircraft.posNed.x,aircraft.posNed.y)
    const noon = new Date(baseDate)
    noon.setUTCHours(0,0,0,0)
    noon.setTime(noon.getTime()+(12-ll.lon/15)*3600_000)
    let target = noon.getTime()
    if (mode === 'night') target += 10*3600_000
    if (mode === 'sunset') {
      let bestError = Infinity
      for (let minutes=0; minutes<=720; minutes+=2) {
        const candidate = noon.getTime()+minutes*60_000
        const error = Math.abs(sunPosition(new Date(candidate),ll.lat,ll.lon).elevationDeg-3)
        if (error<bestError) { bestError=error; target=candidate }
      }
    }
    scrubSeconds = (target-baseDate.getTime())/1000-loop.simTime
  },
  weather: mode => {
    if (mode === 'live') { liveWeatherOn = true; lastWxFetchAt = -Infinity; return }
    liveWeatherOn = false
    const ll = frame.fromLocal(aircraft.posNed.x,aircraft.posNed.y)
    const elevFt = (aircraft.groundElevAt?.(aircraft.posNed.x,aircraft.posNed.y) ?? 0)/FT
    const cloud = mode === 'scattered' ? 'SCT025' : mode === 'overcast' ? 'OVC018' : 'SKC'
    const date = new Date(baseDate.getTime()+(loop.simTime+scrubSeconds)*1000)
    const stamp = [date.getUTCDate(),date.getUTCHours(),date.getUTCMinutes()].map(n=>String(n).padStart(2,'0')).join('')
    wxStations = [{ metar: parseMetar(`KHAF ${stamp}Z 30008KT 10SM ${cloud} 18/12 A2992`),lat:ll.lat,lon:ll.lon,elevFt }]
    applyBlendedWeather(blendWeather(wxStations,ll.lat,ll.lon))
    wxDesc = `MANUAL ${mode.toUpperCase()} · 300@8 10SM`
  },
}
const graphicsPanel = new GraphicsPanel(renderer, graphicsActions)

new LoadingPanel(FLEET_ACTIVE.params, {
  current: currentLoading,
  onGround: () => aircraft.data.onGround && aircraft.data.groundSpeedKt < 1,
  apply: applyAndSaveLoading,
  disableInput: disableSimInput,
  enableInput: restoreSimInputIfNoEditorFocused,
}, loadingUnit)


// ---- autopilot operation (flight-guidance panel: sim/ap-panel.ts) ----
function apSnapshot(): ApSnapshot {
  const d = aircraft.data
  return { headingDeg: d.headingDeg, altitudeFt: d.altitudeFt, verticalSpeedFpm: d.verticalSpeedFpm, iasKt: d.kias, rollDeg: d.rollDeg }
}
function apAvailability(): ApAvailability {
  const n = lastTunedNavResult
  return { gps: lastGpsLegCourse !== undefined, nav: !!n?.source, loc: n?.source === 'LOC', gs: !!n?.hasGlideslope }
}
function apSay(msg: string | undefined): void {
  if (!msg) return
  apMessage = msg
  apMessageUntil = performance.now() + 6000
  toast(msg)
}
/** One press on the guidance panel (window, deck MCP, or key). */
function apPress(a: ApAction): void {
  apPanel = { ...apPanel, direct: false }
  const snap = apSnapshot()
  if (a === 'at') {
    if (!DECK_PROFILE?.autothrottle) { apSay('NO AUTOTHROTTLE ON THIS AIRPLANE'); return }
    atArmSwitch = !atArmSwitch
    apSay(atArmSwitch ? 'AUTOTHROTTLE ARMED' : 'AUTOTHROTTLE OFF')
    return
  }
  if (a === 'ap') {
    if (!apPanel.master && aircraft.data.onGround) { apSay('AUTOPILOT NOT AVAILABLE ON THE GROUND'); return }
    const r = pressAp(apPanel, snap)
    apPanel = r.panel
    systemsControls.apMaster = r.panel.master
    if (!r.panel.master) disconnectAutopilot(apState)
    apSay(r.message)
    return
  }
  const r = a === 'hdg' ? pressHdg(apPanel, snap)
    : a === 'nav' ? pressNav(apPanel, apAvailability())
      : a === 'apr' ? pressApr(apPanel, snap, apAvailability())
        : a === 'alt' ? pressAlt(apPanel, snap)
          : a === 'vs' ? pressVs(apPanel, snap)
            : pressFlc(apPanel, snap)
  apPanel = r.panel
  apSay(r.message)
}
function apTurn(k: Knob, steps: number): void {
  apPanel = turnKnob(apPanel, k, steps, apSnapshot())
}
const AP_LAT_TEXT: Record<string, string> = { ROL: 'ROL', HDG: 'HDG', NAV: 'NAV', APR: 'LOC', BC: 'B/C' }
function apReadout(): ApReadout {
  const lat = apState.lateralMode, ver = apState.verticalMode
  const vText = ver === 'ALTS' ? (apPanel.vertical === 'FLC' ? 'FLC' : 'VS') : ver === 'PIT' ? 'PIT' : ver
  return {
    master: systemsControls.apMaster,
    lateral: systemsControls.apMaster ? (apState.lateralArmed && lat !== 'ROL' ? 'ROL' : AP_LAT_TEXT[lat] ?? lat) : '—',
    lateralArmed: systemsControls.apMaster && apState.lateralArmed ? `${AP_LAT_TEXT[lat] ?? lat} ARM` : '',
    vertical: systemsControls.apMaster ? (apState.verticalArmed && ver === 'GS' ? 'PIT' : vText) : '—',
    verticalArmed: systemsControls.apMaster && apState.verticalArmed ? (ver === 'GS' ? 'GS ARM' : 'ALT ARM') : '',
    lit: {
      ap: apPanel.master, hdg: apPanel.lateral === 'HDG', nav: apPanel.lateral === 'NAV', apr: apPanel.lateral === 'APR',
      alt: apPanel.vertical === 'ALT', vs: apPanel.vertical === 'VS', flc: apPanel.vertical === 'FLC', at: atArmSwitch,
    },
    hasAutothrottle: !!DECK_PROFILE?.autothrottle,
    atText: autothrottle.mode,
    sel: { heading: apPanel.sel.headingDeg, altitude: apPanel.sel.altitudeFt, vs: apPanel.sel.vsFpm, ias: apPanel.sel.iasKt },
    nav1: radios.nav1.activeMhz,
    ...(performance.now() < apMessageUntil ? { message: apMessage } : {}),
  }
}
function ilsChoices(): IlsChoice[] {
  const ll = frame.fromLocal(aircraft.posNed.x, aircraft.posNed.y)
  const out: IlsChoice[] = []
  for (const ap of airports.near(ll.lat, ll.lon, 30 * 1852)) {
    for (const e of KNOWN_ILS_FREQUENCIES) if (e.icao === ap.i) out.push({ ident: ap.i, runway: e.runway, freqMhz: e.freqMhz })
  }
  return out.sort((a, b) => a.ident.localeCompare(b.ident) || a.runway.localeCompare(b.runway)).slice(0, 24)
}
function directTo(ident: string): string | null {
  if (!ident) return 'Enter an airport identifier.'
  if (!airports.loaded) return 'Airport data still loading.'
  const ap = airports.find(ident)
  if (!ap) return `No airport "${ident}".`
  const ll = frame.fromLocal(aircraft.posNed.x, aircraft.posNed.y)
  flightPlan.setWaypoints([{ ident: 'PPOS', lat: ll.lat, lon: ll.lon }, { ident: ap.i, lat: ap.la, lon: ap.lo }])
  toast(`DIRECT TO ${ap.i}`)
  return null
}

// ---- shell: free-flight start screen, toolbar, windows, notifications ----
const toLauncherAirport = (a: AirportData): LauncherAirport => ({
  ident: a.i, name: a.n, size: a.t,
  runways: a.r.flatMap((r) => [r.li, r.hi]).filter((id) => /^[0-9]{1,2}[LCR]?$/.test(id)),
})
/** Apply a free-flight choice to the airplane already loaded. */
function applyLaunch(c: LaunchChoice): void {
  handleSearch(launchCommand(c))
  if (c.time !== 'keep') graphicsActions.lighting(c.time === 'day' ? 'day' : c.time)
  graphicsActions.weather(c.weather)
  try { localStorage.setItem('oh-last-departure', c.airport) } catch { /* storage unavailable */ }
}
let rateBeforeLauncher: SimRate = 1
launcher = new Launcher({
  aircraft: planeMenuEntries().map((e) => ({ key: e.key, label: e.label, group: e.group })),
  currentAircraft: fleetKey,
  defaultAirport: (() => { try { return localStorage.getItem('oh-last-departure') ?? 'KHAF' } catch { return 'KHAF' } })(),
  search: (q) => (airports.loaded ? airports.search(q).map(toLauncherAirport) : []),
  airport: (ident) => {
    if (!airports.loaded) return undefined
    const hit = airports.search(ident, 1)[0]
    return hit && hit.i === ident.toUpperCase() ? toLauncherAirport(hit) : undefined
  },
  fly: (c) => {
    if (c.aircraft !== fleetKey) {
      // The airframe is built at boot: carry the launch across a reload.
      try { sessionStorage.setItem(PENDING_LAUNCH_KEY, JSON.stringify(c)); localStorage.setItem('oh-aircraft', c.aircraft) } catch { /* storage unavailable */ }
      location.reload()
      return
    }
    applyLaunch(c)
  },
  onVisible: (open) => {
    if (open) { rateBeforeLauncher = loop.paused ? 1 : loop.getRate(); loop.setRate(0); disableSimInput() }
    else { loop.setRate(rateBeforeLauncher); input.enabled = true }
  },
})
shell = new Shell({
  launcher,
  flightInfo: hud,
  ap: { read: apReadout, press: apPress, turn: apTurn, ils: ilsChoices, tune: (f) => { radios.nav1.activeMhz = f; radios.nav1.standbyMhz = f; toast(`NAV1 ${f.toFixed(2)}`) } },
  directTo,
  clearPlan: () => { flightPlan.setWaypoints([]); toast('FLIGHT PLAN CLEARED') },
  instruments: { get visible() { return instruments.visible }, get on() { return instrumentsOn }, set: (v) => { instrumentsOn = v; try { localStorage.setItem('oh-instruments', v ? 'on' : 'off') } catch { /* storage unavailable */ } } },
  camera: { get: () => cameraMode, set: (m) => { cameraMode = m } },
  assist: { get: () => assistMode, set: (m) => { assistMode = m } },
  pause: { paused: () => loop.paused, toggle: () => loop.setRate(loop.paused ? 1 : 0) },
  navLog: () => {
    const wps = flightPlan.all
    const legs = flightPlan.legs()
    const ll = frame.fromLocal(aircraft.posNed.x, aircraft.posNed.y)
    const prog = legs.length ? activeLegProgress(legs, ll) : undefined
    const active = prog ? prog.legIndex + 1 : -1
    return wps.map((w, i) => ({ ident: w.ident, active: i === active, ...(i === active && prog ? { distNm: prog.distanceRemainingM / 1852 } : {}) }))
  },
  panels: {
    conditions: document.getElementById('graphics-panel'),
    fuel: document.getElementById('loading-panel'),
    controls: controllerPanel.root,
  },
  atc: [transcriptDiv, atcMenuDiv, atcTypeBox, voicePanel],
  keys: [
    ['↑ ↓ ← →', 'Pitch and roll'], ['A / D', 'Rudder'], ['W / S', 'Throttle'], ['F / G', 'Flaps down / up'],
    [', / .', 'Trim'], ['B', 'Brakes'], ['U', 'Gear'], ['V', 'Spoilers / speedbrake'], ['Z', 'Reverse thrust'],
    ['C', 'Change camera'], ['X', 'Stability assistance'], ['T (hold)', 'Talk to ATC'], ['`', 'ATC menu'],
    ['/', 'Quick airport search'], ['M', 'Free flight (aircraft & departure)'], ['Space', 'Pause'], ['1 / 2 / 3', 'Sim rate'],
    ['[ / ]', 'Time of day'], ['R', 'Reset to runway'], ['O / P', 'Save / load flight'], ['L', 'Landing lights'],
    ['Q', 'Mute'], ['J', 'Controller setup'],
  ],
})
for (const m of earlyToasts.splice(0)) shell.notifier.push(m)
