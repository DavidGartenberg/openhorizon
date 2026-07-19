import { FixedTimestepLoop, type SimRate } from './sim/loop'
import { Aircraft } from './sim/aircraft'
import { WindModel } from './sim/wind'
import { parseMetar } from './sim/weather/metar'
import { blendWeather, type StationWeather, type BlendedWeather } from './sim/weather/weather'
import { cloudSlabs, inCloudFactor, type CloudSlab } from './sim/weather/clouds-model'
import { Clouds } from './render/clouds'
import { trim } from './sim/trim'
import { FT, KT, isa, kcasFromKias } from './sim/atmosphere'
import { C172S } from './sim/aircraft/c172s'
import { bearingDeg, distanceM, windDirFromNed } from './math/geo'
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
    const tas = kcasFromKias(70, 0) * KT
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

function handleSearch(query: string): void {
  const parts = query.trim().toUpperCase().split(/\s+/)
  if (parts.length === 0 || !parts[0]) return
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
  if (input.wasPressed('Space')) loop.setRate(loop.paused ? 1 : 0)
  for (const [key, rate] of [['Digit1', 1], ['Digit2', 2], ['Digit3', 4]] as const) {
    if (input.wasPressed(key)) loop.setRate(rate as SimRate)
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
    if (distanceM(lastWxFetchLL, { lat, lon }) > 50_000) wxStations = []
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

function applyBlendedWeather(b: BlendedWeather | null): void {
  wxBlended = b
  if (!b) return
  wxSlabs = cloudSlabs(b.clouds, b.stationElevFt)
  wind.setSteady(b.windDirDeg, b.windKt, b.gustKt)
  wind.intensity = Math.min(Math.max((b.gustKt - b.windKt) / 8, 0), 2)
  aircraft.isaTempOffsetC = b.isaTempOffsetC
  tiles.setVisibilityM((b.visibilitySm >= 10 ? 45 : b.visibilitySm) * 1609)
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
      altitudeFt: pitotReadings.altFt,
      verticalSpeedFpm: pitotReadings.vsiFpm,
      baroInHg: 29.92,
      headingDeg: d.headingDeg,
      headingBugDeg: apTargets.headingBugDeg,
      windDirDeg: windDirFromNed(aircraft.windNed),
      windSpeedKt: Math.hypot(aircraft.windNed.x, aircraft.windNed.y) / KT,
      ktas: d.ktas,
      groundSpeedKt: d.groundSpeedKt,
      oatC: isa(Math.max(d.altitudeFt, 0) * FT).temperatureK - 273.15,
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
