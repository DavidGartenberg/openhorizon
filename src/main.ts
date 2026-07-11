import { FixedTimestepLoop, type SimRate } from './sim/loop'
import { createScene } from './render/scene'
import { SkyDome } from './render/sky'
import { Ocean } from './render/ocean'
import { FlyCamera } from './render/camera'
import { Input } from './input/input'
import { Hud } from './ui/hud'

// Phase 0 spawn: over the Pacific, west of Half Moon Bay (KHAF) — Phase 2's
// first acceptance flight starts here.
const SPAWN = { latDeg: 37.46, lonDeg: -122.75 }

const app = document.getElementById('app')
if (!app) throw new Error('missing #app element')

const { renderer, scene, camera } = createScene(app)
const input = new Input(renderer.domElement)
const fly = new FlyCamera(camera)
const sky = new SkyDome(scene)
const ocean = new Ocean(scene)
const hud = new Hud()
const loop = new FixedTimestepLoop(120)

// Sim clock: wall-clock start plus simulated elapsed time; [ and ] scrub the
// clock by hours to inspect the full sun cycle.
const baseDate = new Date()
let scrubSeconds = 0

let lastFrame = performance.now()

function frame(now: number): void {
  const elapsed = (now - lastFrame) / 1000
  lastFrame = now

  // --- sim ---
  loop.advance(elapsed, () => {
    // Phase 0: no aircraft yet; the fixed-step loop drives only the sim clock.
    // The flight model steps here from Phase 1 on.
  })

  // --- controls (frame-rate domain) ---
  if (input.wasPressed('Space')) loop.setRate(loop.paused ? 1 : 0)
  for (const [key, rate] of [
    ['Digit1', 1],
    ['Digit2', 2],
    ['Digit3', 4],
  ] as const) {
    if (input.wasPressed(key)) loop.setRate(rate as SimRate)
  }
  const scrub = input.axis('BracketRight', 'BracketLeft')
  if (scrub !== 0) scrubSeconds += scrub * elapsed * 3600 // 1 h per held second

  // --- world ---
  const simDate = new Date(baseDate.getTime() + (loop.simTime + scrubSeconds) * 1000)
  const sunDir = sky.update(simDate, SPAWN.latDeg, SPAWN.lonDeg)
  const dayness = Math.min(1, Math.max(0, (sky.elevationDeg + 6) / 16))
  ocean.update(now / 1000, sunDir, dayness)
  fly.update(elapsed, input)

  hud.update(
    {
      simDate,
      simRate: loop.getRate(),
      cameraAltM: fly.position.y,
      cameraSpeedMs: fly.speedMs,
      sunElevationDeg: sky.elevationDeg,
    },
    loop.ticks,
  )

  renderer.render(scene, camera)
  input.endFrame()
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
