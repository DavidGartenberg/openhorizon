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
import { buildC172, updateProp } from './render/aircraft-mesh'
import { buildCockpit, updateCockpitControls, updateCockpitDisplays, CockpitInteraction, type SwitchId } from './render/cockpit'
import type { PfdInput } from './cockpit/pfd'
import { Input } from './input/input'
import { Hud } from './ui/hud'
import { WorldFrame, TileManager } from './world/tiles'
import { Airports, type AirportData, type RunwayData } from './world/airports'
import { makeElectricalState, stepElectrical } from './sim/systems/electrical'
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
  NO_NAV_RESULT, type TunedNavResult,
} from './sim/nav/tuning'

const KHAF = { lat: 37.5134, lon: -122.5011 }

const app = document.getElementById('app')
if (!app) throw new Error('missing #app element')

const { renderer, scene, camera } = createScene(app)
const input = new Input(renderer.domElement)
const sky = new SkyDome(scene)
const ocean = new Ocean(scene)
const clouds = new Clouds(scene)
const hud = new Hud()
const loop = new FixedTimestepLoop(120)

const frame = new WorldFrame(KHAF)
const airports = new Airports(scene, frame)
const tiles = new TileManager(scene, frame, (s, n, w, e) => airports.runwaysInBounds(s, n, w, e))

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

const aircraft = new Aircraft()
aircraft.groundElevAt = (n, e) => {
  const ll = frame.fromLocal(n, e)
  return airports.flattenElevation(tiles.elevationAt(ll.lat, ll.lon), ll.lat, ll.lon)
}
const mesh = buildC172()
scene.add(mesh.group)
const cockpit = buildCockpit(mesh.group)
const cockpitInteraction = new CockpitInteraction(camera)

const wind = new WindModel()
const chase = new ChaseCamera(camera)
const orbit = new OrbitCamera(camera)
const freeCam = new FlyCamera(camera)
const cockpitCam = new CockpitCamera(camera)
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
const fuelState = makeFuelState()
const pitotSystem = new PitotStaticSystem()
// Boot default: engine already running (see comment above) rather than the
// cold-and-dark default `makeEngineStartState()` would give. Shared with
// `resetSystemsState` below so respawn seeds the exact same values instead
// of a second, hand-maintained "normal" state.
const ENGINE_START_BOOT_RUNNING: EngineStartState = { status: 'running', rpm: 700, crankTimeS: 0 }
const engineStartState: EngineStartState = { ...ENGINE_START_BOOT_RUNNING }
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
  Object.assign(fuelState, makeFuelState())
  Object.assign(electricalState, makeElectricalState())
  Object.assign(engineStartState, ENGINE_START_BOOT_RUNNING)
  Object.assign(engineTemps, makeEngineTemps())
  Object.assign(systemsControls, SYSTEMS_CONTROLS_DEFAULT)
  failures.alternatorFailed = false
  failures.icingConditions = false
  failures.staticBlocked = false
  disconnectAutopilot(apState)
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
    // 3 nm final at ~900 ft AGL, 70 KIAS, trimmed on a -3° path.
    const distM = 3 * 1852
    const hRad = (hdg * Math.PI) / 180
    const p = frame.toLocal(thr.lat, thr.lon)
    const n = p.n - Math.cos(hRad) * distM
    const e = p.e - Math.sin(hRad) * distM
    const altM = thr.e * FT + 275
    // TAS from 70 KIAS at the FIELD's density, flaps-10 calibration — a
    // sea-level conversion spawned ~8 kt slow at Tahoe (7,100 ft) and the
    // aircraft stalled into a mush on AP engage (found by the Phase-7
    // Tahoe TAWS acceptance run).
    const tas = kcasFromKias(70, 10) * KT * Math.sqrt(1.225 / isa(altM).densityKgM3)
    const t = trim({ tasMs: tas, altM, massKg: aircraft.massKg, flapsDeg: 10, gammaRad: -0.052 })
    aircraft.flapsDeg = 10
    aircraft.controls.flapsIndex = 1
    aircraft.applyTrimState(tas, t.alphaRad, altM, hRad, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
    aircraft.posNed.x = n
    aircraft.posNed.y = e
  }
  aircraft.controls.brakeLeft = aircraft.controls.brakeRight = 0
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

function handleSearch(query: string): void {
  const parts = query.trim().toUpperCase().split(/\s+/)
  if (parts.length === 0 || !parts[0]) return
  if (parts[0] === 'CHALLENGE' && parts[1] && CHALLENGES[parts[1]]) {
    const ch = CHALLENGES[parts[1]]!
    const ap = airports.find(ch.icao)
    if (ap) {
      challengeActive = parts[1]
      spawnAtAirport(ap, ch.rwy, true)
    }
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

// ---- controls ----
const shaped = { pitch: 0, roll: 0, yaw: 0 }
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
    input.enabled = false
    return
  }
  if (input.wasPressed('KeyT')) {
    atcMenuOpen = !atcMenuOpen
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
  if (input.wasPressed('KeyX')) assistOn = !assistOn
  if (input.wasPressed('KeyC')) {
    cameraMode =
      cameraMode === 'chase' ? 'orbit' : cameraMode === 'orbit' ? 'free' : cameraMode === 'free' ? 'cockpit' : 'chase'
  }
  if (input.wasPressed('KeyF')) c.flapsIndex = Math.min(c.flapsIndex + 1, 3)
  if (input.wasPressed('KeyG')) c.flapsIndex = Math.max(c.flapsIndex - 1, 0)
  if (input.wasPressed('KeyR')) {
    const ap = airports.find(spawnDesc.split(' ')[0] || 'KHAF')
    if (ap) spawnAtAirport(ap)
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
  const pad = input.gamepad()
  if (pad) {
    const dead = (v: number) => (Math.abs(v) > 0.08 ? v : 0)
    const gr = dead(pad.axes[0] ?? 0)
    const gp = dead(pad.axes[1] ?? 0)
    const gy = dead(pad.axes[2] ?? 0)
    if (gr !== 0) shaped.roll = gr
    if (gp !== 0) shaped.pitch = gp
    if (gy !== 0) shaped.yaw = gy
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
  atis: ReturnType<typeof buildAtis>
  twrF: number
  gndF: number
  atisF: number
}
let activeAtc: ActiveAtc | null = null
let atisPlayedFor = ''
/** AI pattern traffic at the active ATC field (Phase 6d/6e wiring). */
let aiPilots: AiPatternPilot[] = []

// ---- Phase 8c: flight recorder + auto-debrief + logbook (§18/§19) ----
const recorder = new FlightRecorder()
let lastOnGround = true
let flightStartSimS: number | null = null
let flightFrom = ''
let debriefLine = ''
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

/** Non-radio cockpit annunciation (TCAS/TAWS aurals) — spoken urgently,
 *  never logged to the comms transcript (they aren't transmissions). */
function annunciate(text: string): void {
  try {
    const u = new SpeechSynthesisUtterance(text.toLowerCase())
    u.rate = 1.25
    u.pitch = 0.9
    window.speechSynthesis.speak(u)
  } catch {
    // no speech available — HUD/PFD annunciation still shows it
  }
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

  // TCAS from airborne AI traffic.
  const tracks = aiPilots
    .filter((p) => p.phase === 'pattern' && !p.onGround)
    .map((p) => {
      const hRad = (p.plane.headingDeg * Math.PI) / 180
      const v = p.plane.gsKt * KT
      return {
        id: 'AI', relNorthM: (p.plane.lat - ll0.lat) * mLat, relEastM: (p.plane.lon - ll0.lon) * mLon,
        relVnMs: Math.cos(hRad) * v - ownVn, relVeMs: Math.sin(hRad) * v - ownVe,
        altFt: p.plane.altFt, vsFpm: 0,
      }
    })
  const tc = tcas.step(0.5, { altFt: d.altitudeFt, aglFt: d.aglFt, vsFpm: d.verticalSpeedFpm }, tracks)
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
    gsDeviation: nav.hasGlideslope ? nav.glideslopeFraction ?? null : null,
  })
  if (tw.newAural && tw.aural) annunciate(tw.aural)

  const parts: string[] = []
  if (tc.level === 'TA' || tc.level === 'RA') parts.push(`⚠ ${tc.aural}`)
  if (tw.level !== 'NONE' && tw.aural) parts.push(`${tw.level === 'WARNING' ? '⛰' : '△'} ${tw.aural}`)
  safetyLine = parts.join('  ')
}
let aiMeshes: ReturnType<typeof buildC172>[] = []
let lastAtcScanAt = -Infinity
let lastTowerTickAt = -Infinity
let atcMenuOpen = false

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
  synth.speak(u)
}

comms.subscribe((t) => {
  if (!isAudible(t.freqMhz, radios.com1.activeMhz)) return // wrong freq = silence
  transcript.push(`[${t.freqMhz.toFixed(2)}] ${t.from}: ${t.text}`)
  if (transcript.length > 7) transcript.shift()
  transcriptDiv.style.display = 'block'
  transcriptDiv.textContent = transcript.join('\n')
  if (t.from !== CALLSIGN) speak(t)
})

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
      const atis = buildAtis(name, wxBlended, runwayHeadings, Math.floor(now / 3_600_000) % 26)
      activeAtc = {
        ident: nearest.i,
        ll: { lat: nearest.la, lon: nearest.lo },
        tower: new TowerController({ facility: `${name} Tower`, freqMhz: twrF, activeRunway: atis.activeRunway }),
        ground: new GroundController({ facility: `${name} Ground`, freqMhz: gndF, activeRunway: atis.activeRunway }),
        atis, twrF, gndF, atisF,
      }
      atisPlayedFor = ''
      // Rebuild AI pattern traffic for the new field's active runway end.
      for (const m of aiMeshes) scene.remove(m.group)
      aiMeshes = []
      aiPilots = []
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
        for (const [cs, delay] of [['N77GA', 25], ['N42PK', 210]] as const) {
          aiPilots.push(new AiPatternPilot({
            callsign: cs, runway: patternRwy, runwayIdent: act,
            tower: activeAtc.tower, bus: comms, freqMhz: twrF, startDelayS: loop.simTime + delay,
          }))
          const m = buildC172()
          scene.add(m.group)
          aiMeshes.push(m)
        }
      }
    } else if (!nearest) {
      activeAtc = null
      for (const m of aiMeshes) scene.remove(m.group)
      aiMeshes = []
      aiPilots = []
    }
  }
  if (activeAtc) {
    // ATIS broadcast on tune-in.
    const key = `${activeAtc.ident}-${activeAtc.atis.letter}`
    if (isAudible(activeAtc.atisF, radios.com1.activeMhz) && atisPlayedFor !== key) {
      atisPlayedFor = key
      comms.transmit({ freqMhz: activeAtc.atisF, from: `${activeAtc.ident} ATIS`, text: activeAtc.atis.text, atSimS: loop.simTime })
    }
    if (now - lastTowerTickAt > 5000) {
      lastTowerTickAt = now
      for (const t of activeAtc.tower.tick(loop.simTime, [{ callsign: CALLSIGN, view: playerAtcView() }])) comms.transmit(t)
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
    comms.transmit({ freqMhz: radios.com1.activeMhz, from: CALLSIGN, text: pilotPhrase(CALLSIGN, kind, a.atis.activeRunway), atSimS: loop.simTime })
    if (isAudible(freq, radios.com1.activeMhz)) {
      const replies = handle()
      setTimeout(() => replies.forEach((r) => comms.transmit({ ...r, atSimS: loop.simTime })), 700)
    }
  }
  if (view.onGround && a.ground.awaitingReadback(CALLSIGN)) {
    items.push({
      label: 'Read back taxi clearance',
      run: () => {
        comms.transmit({
          freqMhz: radios.com1.activeMhz, from: CALLSIGN,
          text: `runway ${a.atis.activeRunway}, taxi via the parallel, hold short ${a.atis.activeRunway}, ${CALLSIGN}`,
          atSimS: loop.simTime,
        })
        if (isAudible(a.gndF, radios.com1.activeMhz)) {
          const replies = a.ground.readback(CALLSIGN, 'taxiOut', loop.simTime)
          setTimeout(() => replies.forEach((r) => comms.transmit({ ...r, atSimS: loop.simTime })), 700)
        }
      },
    })
  } else if (view.onGround) {
    items.push({ label: `Request taxi (Ground ${a.gndF.toFixed(2)})`, run: () => sendPilot('taxiOut', a.gndF, () => a.ground.request(CALLSIGN, 'taxiOut', loop.simTime)) })
    items.push({ label: `Ready for departure (Tower ${a.twrF.toFixed(2)})`, run: () => sendPilot('readyTakeoff', a.twrF, () => a.tower.request(CALLSIGN, 'readyTakeoff', playerAtcView(), loop.simTime)) })
  } else {
    items.push({ label: `Inbound for landing (Tower ${a.twrF.toFixed(2)})`, run: () => sendPilot('inboundLanding', a.twrF, () => a.tower.request(CALLSIGN, 'inboundLanding', playerAtcView(), loop.simTime)) })
    items.push({ label: 'Going around', run: () => sendPilot('goAround', a.twrF, () => a.tower.request(CALLSIGN, 'goAround', playerAtcView(), loop.simTime)) })
  }
  return items
}

function renderAtcMenu(): void {
  if (!atcMenuOpen || !activeAtc) {
    atcMenuDiv.style.display = 'none'
    return
  }
  const items = atcMenuItems()
  atcMenuDiv.style.display = 'block'
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

let mfdPage: 'map' | 'lean' | 'fpl' = 'map'
/** Last computed in-airspace result (Phase 4 Task 5 wiring) — updated once
 *  per frame in `advanceFrame`, exposed via `__ohAirspace` for a later
 *  acceptance task to verify "the sim knows when the aircraft is inside the
 *  Bravo shelf" without needing its own polygon math. */
let currentAirspace: AirspacePolygon[] = []

function advanceFrame(elapsed: number, now: number): void {
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
      })
      aircraft.engineRunning = engineStartState.status === 'running'
      stepElectrical(electricalState, dt, {
        masterBattery: systemsControls.masterBattery,
        masterAlternator: systemsControls.masterAlternator,
        avionicsSwitch: systemsControls.avionicsSwitch,
        alternatorFailed: failures.alternatorFailed,
        engineRunning: aircraft.engineRunning,
      })
      const oatC = isa(Math.max(aircraft.data.altitudeFt, 0) * FT).temperatureK - 273.15
      stepEngineTemps(engineTemps, dt, aircraft.data.rpm, C172S.redlineRpm, aircraft.engineRunning, oatC)
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
  updateRadar(ll.lat, ll.lon, now)
  scanAtc(ll.lat, ll.lon, now)
  updateSafety(now)
  updateRecorder(ll)
  if (atcMenuOpen) renderAtcMenu()
  for (let i = 0; i < aiPilots.length; i++) {
    const p = aiPilots[i]!
    p.step(Math.min(elapsed, 0.25), loop.simTime)
    const m = aiMeshes[i]!
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
  }
  updateCockpitControls(
    cockpit,
    switchStates,
    aircraft.controls.throttle,
    aircraft.controls.mixture,
    aircraft.controls.flapsIndex,
    aircraft.controls.trim,
    d.pitchDeg,
    d.rollDeg,
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
      mixture: aircraft.controls.mixture,
      engineTemps,
      fuelLeftKg: fuelState.leftKg,
      fuelRightKg: fuelState.rightKg,
      electrical: {
        busVoltage: electricalState.busVoltage,
        alternatorAmps: electricalState.alternatorAmps,
        batteryAmps: electricalState.batteryAmps,
      },
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

  const simDate = new Date(baseDate.getTime() + (loop.simTime + scrubSeconds) * 1000)
  const sunDir = sky.update(simDate, ll.lat, ll.lon)
  const dayness = Math.min(Math.max((sky.elevationDeg + 6) / 16, 0), 1)
  ocean.update(now / 1000, sunDir, dayness)
  tiles.setLight(sunDir, dayness)
  clouds.update(wxSlabs, camera.position, worldShift.e, worldShift.n, dayness)
  const obscuration = inCloudFactor(wxSlabs, aircraft.data.altitudeFt)
  whiteout.style.opacity = String(obscuration)
  whiteout.style.background = dayness > 0.4 ? '#c8ccd2' : '#14161a'

  hud.update(
    {
      simDate,
      simRate: loop.getRate(),
      flight: aircraft.data,
      throttlePct: aircraft.controls.throttle,
      trimPct: aircraft.controls.trim,
      cameraMode,
      tilesReady: tiles.readyCount,
      wx: wxDesc || undefined,
      safety: safetyLine || debriefLine || undefined,
      spawnDesc,
      lat: ll.lat,
      lon: ll.lon,
    },
    loop.ticks,
  )

  renderer.render(scene, camera)
  input.endFrame()
}

let lastRafAt = 0
function frame_(now: number): void {
  lastRafAt = now
  const elapsed = (now - lastFrame) / 1000
  lastFrame = now
  advanceFrame(elapsed, now)
  requestAnimationFrame(frame_)
}

setInterval(() => {
  const now = performance.now()
  if (now - lastRafAt < 400) return
  const elapsed = (now - lastFrame) / 1000
  if (elapsed < 0.2) return
  lastFrame = now
  advanceFrame(elapsed, now)
}, 250)

// ---- boot ----
airports
  .load()
  .then(() => {
    const khaf = airports.find('KHAF')
    if (khaf) spawnAtAirport(khaf, '30')
  })
  .catch((err) => console.error('airport data failed to load:', err))

requestAnimationFrame(frame_)

// Deterministic verification hooks (see PROGRESS.md).
Object.assign(window as unknown as Record<string, unknown>, {
  __ohStep: (seconds: number) => {
    const now = performance.now()
    lastFrame = now
    lastRafAt = now
    advanceFrame(Math.max(seconds, 1 / 120), now)
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
    if (freqs.nav1Active !== undefined) radios.nav1.activeMhz = freqs.nav1Active
    if (freqs.nav1Standby !== undefined) radios.nav1.standbyMhz = freqs.nav1Standby
    if (freqs.com1Active !== undefined) radios.com1.activeMhz = freqs.com1Active
    if (freqs.com1Standby !== undefined) radios.com1.standbyMhz = freqs.com1Standby
    if (freqs.obs1Deg !== undefined) radios.obs1Deg = freqs.obs1Deg
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
    if (lateral) apTargets.lateralMode = lateral
    if (vertical) apTargets.verticalMode = vertical
    if (targets) Object.assign(apTargets, targets)
  },
  __ohApState: () => ({ ...apState }),
  __ohSafety: () => ({ safetyLine, dots: trafficDots }),
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
  __ohMfdPage: (page: 'map' | 'lean' | 'fpl') => {
    mfdPage = page
  },
  /** Verification-only camera-mode switch (mirrors pressing 'C' repeatedly)
   *  — useful for headless/automated cockpit-camera checks where dispatching
   *  a real keyboard event isn't reliable. */
  __ohCam: (mode: 'chase' | 'orbit' | 'free' | 'cockpit') => {
    cameraMode = mode
  },
  __ohSpawn: (q: string) => handleSearch(q),
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
  __ohCtl: (c: Record<string, number> | null) => {
    ctlOverride = c === null ? null : { ...(ctlOverride ?? {}), ...c }
  },
  __ohWind: (dirDeg: number, kt: number) => {
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
    scrubSeconds += hours * 3600
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
