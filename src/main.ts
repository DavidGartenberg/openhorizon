import { FixedTimestepLoop, type SimRate } from './sim/loop'
import { Aircraft } from './sim/aircraft'
import { WindModel } from './sim/wind'
import { createScene } from './render/scene'
import { SkyDome } from './render/sky'
import { Ocean } from './render/ocean'
import { FlyCamera } from './render/camera'
import { ChaseCamera } from './render/chase-camera'
import { buildC172, updateProp } from './render/aircraft-mesh'
import { buildTestField } from './render/ground'
import { Input } from './input/input'
import { Hud } from './ui/hud'

// Phase 1 test field lives at KHAF's latitude for correct sun geometry.
const SPAWN = { latDeg: 37.46, lonDeg: -122.75 }

const app = document.getElementById('app')
if (!app) throw new Error('missing #app element')

const { renderer, scene, camera } = createScene(app)
const input = new Input(renderer.domElement)
const sky = new SkyDome(scene)
const ocean = new Ocean(scene)
buildTestField(scene)
const hud = new Hud()
const loop = new FixedTimestepLoop(120)

const aircraft = new Aircraft()
aircraft.spawnOnGround(0, 0, 0) // south end of the runway, heading north
const mesh = buildC172()
scene.add(mesh.group)

const wind = new WindModel()
const chase = new ChaseCamera(camera)
const freeCam = new FlyCamera(camera)
let cameraMode: 'chase' | 'free' = 'chase'

// ---- keyboard control shaping (the sim takes clean [-1,1] inputs) ----
const shaped = { pitch: 0, roll: 0, yaw: 0 }
function shapeAxis(current: number, held: number, dt: number, attack = 2.2, recenter = 3.0): number {
  if (held !== 0) {
    const next = current + held * attack * dt
    return Math.min(Math.max(next, -1), 1)
  }
  const mag = Math.max(Math.abs(current) - recenter * dt, 0)
  return Math.sign(current) * mag
}

const baseDate = new Date()
let scrubSeconds = 0
let lastFrame = performance.now()

function handleDiscreteKeys(): void {
  const c = aircraft.controls
  if (input.wasPressed('Space')) loop.setRate(loop.paused ? 1 : 0)
  for (const [key, rate] of [['Digit1', 1], ['Digit2', 2], ['Digit3', 4]] as const) {
    if (input.wasPressed(key)) loop.setRate(rate as SimRate)
  }
  if (input.wasPressed('KeyC')) cameraMode = cameraMode === 'chase' ? 'free' : 'chase'
  if (input.wasPressed('KeyF')) c.flapsIndex = Math.min(c.flapsIndex + 1, 3)
  if (input.wasPressed('KeyG')) c.flapsIndex = Math.max(c.flapsIndex - 1, 0)
  if (input.wasPressed('KeyR')) {
    aircraft.spawnOnGround(0, 0, 0)
    c.throttle = 0
    c.trim = 0
    c.flapsIndex = 0
  }
}

function pollControls(dt: number): void {
  const c = aircraft.controls

  // Primary axes: arrows (pitch/roll), A/D rudder — shaped with recentering.
  shaped.pitch = shapeAxis(shaped.pitch, input.axis('ArrowDown', 'ArrowUp'), dt)
  shaped.roll = shapeAxis(shaped.roll, input.axis('ArrowRight', 'ArrowLeft'), dt)
  shaped.yaw = shapeAxis(shaped.yaw, input.axis('KeyD', 'KeyA'), dt, 2.5, 4)

  // Throttle/trim are positional (no recentering).
  c.throttle = Math.min(Math.max(c.throttle + input.axis('KeyW', 'KeyS') * 0.5 * dt, 0), 1)
  c.trim = Math.min(Math.max(c.trim + input.axis('Period', 'Comma') * 0.25 * dt, -1), 1)
  c.brakeLeft = c.brakeRight = input.isHeld('KeyB') ? 1 : 0

  // Gamepad overrides keyboard when deflected.
  const pad = input.gamepad()
  if (pad) {
    const dead = (v: number) => (Math.abs(v) > 0.08 ? v : 0)
    const gr = dead(pad.axes[0] ?? 0)
    const gp = dead(pad.axes[1] ?? 0)
    const gy = dead(pad.axes[2] ?? 0)
    if (gr !== 0) shaped.roll = gr
    if (gp !== 0) shaped.pitch = gp
    if (gy !== 0) shaped.yaw = gy
    if (pad.buttons[7]?.value) c.throttle = Math.min(c.throttle + pad.buttons[7].value * dt * 0.6, 1)
    if (pad.buttons[6]?.value) c.throttle = Math.max(c.throttle - pad.buttons[6].value * dt * 0.6, 0)
  }

  c.pitch = shaped.pitch
  c.roll = shaped.roll
  c.yaw = shaped.yaw

  // Time-of-day scrub.
  const scrub = input.axis('BracketRight', 'BracketLeft')
  if (scrub !== 0) scrubSeconds += scrub * dt * 3600
}

function advanceFrame(elapsed: number, now: number): void {
  handleDiscreteKeys()
  pollControls(elapsed)

  // Long gaps (hidden tab) are consumed in ≤0.25 s chunks so the sim keeps
  // real time instead of being clamped to a single max frame.
  let remaining = elapsed
  while (remaining > 1e-6) {
    const chunk = Math.min(remaining, 0.25)
    loop.advance(chunk, (dt) => {
      wind.step(dt, aircraft.windNed)
      aircraft.step(dt)
    })
    remaining -= chunk
  }

  // ---- render sync (NED → render: x=east, y=up, z=south) ----
  const p = aircraft.posNed
  mesh.group.position.set(p.y, -p.z, -p.x)
  const d = aircraft.data
  mesh.group.rotation.order = 'YXZ'
  mesh.group.rotation.y = (-d.headingDeg * Math.PI) / 180
  mesh.group.rotation.x = (d.pitchDeg * Math.PI) / 180
  mesh.group.rotation.z = (-d.rollDeg * Math.PI) / 180
  updateProp(mesh, d.rpm, elapsed)

  if (cameraMode === 'chase') {
    chase.update(elapsed, mesh.group.position, (d.headingDeg * Math.PI) / 180)
  } else {
    freeCam.update(elapsed, input)
  }

  const simDate = new Date(baseDate.getTime() + (loop.simTime + scrubSeconds) * 1000)
  const sunDir = sky.update(simDate, SPAWN.latDeg, SPAWN.lonDeg)
  const dayness = Math.min(Math.max((sky.elevationDeg + 6) / 16, 0), 1)
  ocean.update(now / 1000, sunDir, dayness)

  hud.update(
    {
      simDate,
      simRate: loop.getRate(),
      flight: aircraft.data,
      throttlePct: aircraft.controls.throttle,
      trimPct: aircraft.controls.trim,
      cameraMode,
    },
    loop.ticks,
  )

  renderer.render(scene, camera)
  input.endFrame()
}

let lastRafAt = 0

function frame(now: number): void {
  lastRafAt = now
  const elapsed = (now - lastFrame) / 1000
  lastFrame = now
  advanceFrame(elapsed, now)
  requestAnimationFrame(frame)
}

// Hidden/occluded tabs suspend requestAnimationFrame — a watchdog keeps the
// simulation (and screenshot rendering) alive whenever rAF stalls.
setInterval(() => {
  const now = performance.now()
  if (now - lastRafAt < 400) return // rAF is healthy
  const elapsed = (now - lastFrame) / 1000
  if (elapsed < 0.2) return
  lastFrame = now
  advanceFrame(elapsed, now)
}, 250)

requestAnimationFrame(frame)

// Deterministic hooks for automated browser verification (PROGRESS.md):
// advance the sim synchronously regardless of rAF/timer throttling, and
// read flight data directly. Not used by gameplay.
Object.assign(window as unknown as Record<string, unknown>, {
  __ohStep: (seconds: number) => {
    const now = performance.now()
    lastFrame = now
    lastRafAt = now
    advanceFrame(Math.max(seconds, 1 / 120), now)
  },
  __ohData: () => ({
    ias: aircraft.data.kias,
    alt: aircraft.data.altitudeFt,
    vs: aircraft.data.verticalSpeedFpm,
    rpm: aircraft.data.rpm,
    aoa: aircraft.data.alphaDeg,
    hdg: aircraft.data.headingDeg,
    pitch: aircraft.data.pitchDeg,
    roll: aircraft.data.rollDeg,
    gnd: aircraft.data.onGround,
    throttle: aircraft.controls.throttle,
    trim: aircraft.controls.trim,
  }),
})
