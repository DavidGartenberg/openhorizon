import { FixedTimestepLoop, type SimRate } from './sim/loop'
import { Aircraft } from './sim/aircraft'
import { WindModel } from './sim/wind'
import { trim } from './sim/trim'
import { FT, KT, isa, kcasFromKias } from './sim/atmosphere'
import { C172S } from './sim/aircraft/c172s'
import { bearingDeg, distanceM } from './math/geo'
import { createScene } from './render/scene'
import { SkyDome } from './render/sky'
import { Ocean } from './render/ocean'
import { FlyCamera } from './render/camera'
import { ChaseCamera } from './render/chase-camera'
import { OrbitCamera } from './render/orbit-camera'
import { CockpitCamera } from './render/cockpit-camera'
import { buildC172, updateProp } from './render/aircraft-mesh'
import { buildCockpit, updateCockpitControls, updateCockpitDisplays, CockpitInteraction, type SwitchId } from './render/cockpit'
import { Input } from './input/input'
import { Hud } from './ui/hud'
import { WorldFrame, TileManager } from './world/tiles'
import { Airports, type AirportData, type RunwayData } from './world/airports'
import { makeElectricalState, stepElectrical } from './sim/systems/electrical'
import { makeFuelState, stepFuel, type FuelSelector } from './sim/systems/fuel'
import { PitotStaticSystem } from './sim/systems/pitot'
import { stepEngineStart, type EngineStartState, type MagnetoPosition } from './sim/systems/engine-start'
import { makeEngineTemps, stepEngineTemps } from './sim/systems/engine-temps'

const KHAF = { lat: 37.5134, lon: -122.5011 }

const app = document.getElementById('app')
if (!app) throw new Error('missing #app element')

const { renderer, scene, camera } = createScene(app)
const input = new Input(renderer.domElement)
const sky = new SkyDome(scene)
const ocean = new Ocean(scene)
const hud = new Hud()
const loop = new FixedTimestepLoop(120)

const frame = new WorldFrame(KHAF)
const airports = new Airports(scene, frame)
const tiles = new TileManager(scene, frame, (s, n, w, e) => airports.runwaysInBounds(s, n, w, e))

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
const engineStartState: EngineStartState = { status: 'running', rpm: 700, crankTimeS: 0 }
const engineTemps = makeEngineTemps()

/** Cockpit switch/knob/selector state — mirrors how `aircraft.controls`
 *  already works, but for systems that live outside `Aircraft` (§ plan:
 *  "a parallel SystemsControls lives with SystemsState"). Both the
 *  keyboard/mouse flight controls (`pollControls`) and the 3D cockpit
 *  click/drag (`cockpitInteraction`) write into this and `aircraft.controls`
 *  side by side — this task adds a second input path, it doesn't replace
 *  the first. */
const systemsControls: {
  masterBattery: boolean
  masterAlternator: boolean
  avionicsSwitch: boolean
  pitotHeat: boolean
  magneto: MagnetoPosition
  starterEngaged: boolean
  fuelSelector: FuelSelector
  boostPumpOn: boolean
} = {
  masterBattery: true,
  masterAlternator: true,
  avionicsSwitch: true,
  pitotHeat: false,
  magneto: 'both',
  starterEngaged: false,
  fuelSelector: 'BOTH',
  boostPumpOn: false,
}

/** Scenario/failure flags — the debug-hook side of the failures the phase
 *  plan calls out (`__ohFail`); no in-sim UI to trigger these yet (that's
 *  Phase 9 per the phase plan's recorded cuts). */
const failures = { alternatorFailed: false, icingConditions: false, staticBlocked: false }
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
}

/** Verification-only wings-leveler/coordinator (mirrors the headless test
 *  pilots) so scripted flights don't torque-spiral; toggled via __ohHold. */
let holdWingsLevel = false
/** Verification-only control overrides — applied AFTER keyboard polling
 *  (which writes the axes every frame), else scripts get wiped to zero. */
let ctlOverride: Record<string, number> | null = null

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

  let remaining = elapsed
  while (remaining > 1e-6) {
    const chunk = Math.min(remaining, 0.25)
    loop.advance(chunk, (dt) => {
      wind.step(dt, aircraft.windNed)
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
    cockpitInteraction.update(input, cockpit, systemsControls, aircraft.controls)
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
      headingBugDeg: d.headingDeg,
      windDirDeg: 0,
      windSpeedKt: Math.hypot(aircraft.windNed.x, aircraft.windNed.y) / KT,
      ktas: d.ktas,
      groundSpeedKt: d.groundSpeedKt,
      oatC: isa(Math.max(d.altitudeFt, 0) * FT).temperatureK - 273.15,
      nav1: { activeMhz: 110.0, standbyMhz: 115.0 },
      com1: { activeMhz: 118.0, standbyMhz: 121.5 },
      squawk: '1200',
      annunciations,
    },
    {
      page: 'lean',
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
    },
  )

  const simDate = new Date(baseDate.getTime() + (loop.simTime + scrubSeconds) * 1000)
  const sunDir = sky.update(simDate, ll.lat, ll.lon)
  const dayness = Math.min(Math.max((sky.elevationDeg + 6) / 16, 0), 1)
  ocean.update(now / 1000, sunDir, dayness)
  tiles.setLight(sunDir, dayness)

  hud.update(
    {
      simDate,
      simRate: loop.getRate(),
      flight: aircraft.data,
      throttlePct: aircraft.controls.throttle,
      trimPct: aircraft.controls.trim,
      cameraMode,
      tilesReady: tiles.readyCount,
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
    }
  },
  __ohSpawn: (q: string) => handleSearch(q),
  __ohHold: (on: boolean) => {
    holdWingsLevel = on
  },
  __ohCtl: (c: Record<string, number> | null) => {
    ctlOverride = c === null ? null : { ...(ctlOverride ?? {}), ...c }
  },
  __ohWind: (dirDeg: number, kt: number) => wind.setSteady(dirDeg, kt),
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
