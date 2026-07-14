import { FixedTimestepLoop, type SimRate } from './sim/loop'
import { Aircraft } from './sim/aircraft'
import { WindModel } from './sim/wind'
import { trim } from './sim/trim'
import { FT, KT, kcasFromKias } from './sim/atmosphere'
import { bearingDeg, distanceM } from './math/geo'
import { createScene } from './render/scene'
import { SkyDome } from './render/sky'
import { Ocean } from './render/ocean'
import { FlyCamera } from './render/camera'
import { ChaseCamera } from './render/chase-camera'
import { OrbitCamera } from './render/orbit-camera'
import { buildC172, updateProp } from './render/aircraft-mesh'
import { Input } from './input/input'
import { Hud } from './ui/hud'
import { WorldFrame, TileManager } from './world/tiles'
import { Airports, type AirportData, type RunwayData } from './world/airports'

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

const wind = new WindModel()
const chase = new ChaseCamera(camera)
const orbit = new OrbitCamera(camera)
const freeCam = new FlyCamera(camera)
let cameraMode: 'chase' | 'orbit' | 'free' = 'chase'
let parkingBrake = false
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
  if (input.wasPressed('KeyC')) {
    cameraMode = cameraMode === 'chase' ? 'orbit' : cameraMode === 'orbit' ? 'free' : 'chase'
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
  shaped.pitch = shapeAxis(shaped.pitch, input.axis('ArrowDown', 'ArrowUp'), dt)
  shaped.roll = shapeAxis(shaped.roll, input.axis('ArrowRight', 'ArrowLeft'), dt)
  shaped.yaw = shapeAxis(shaped.yaw, input.axis('KeyD', 'KeyA'), dt, 2.5, 4)
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
  c.pitch = shaped.pitch
  c.roll = shaped.roll
  c.yaw = shaped.yaw
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
  else freeCam.update(elapsed, input)

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
})

void distanceM
