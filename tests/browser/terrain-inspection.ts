import * as THREE from 'three'
import { TileManager, WorldFrame } from '../../src/world/tiles'
import { Airports } from '../../src/world/airports'

const output = document.querySelector<HTMLPreElement>('#state')!
const button = document.querySelector<HTMLButtonElement>('#start')!
const cpu = document.querySelector<HTMLButtonElement>('#cpu')!
const prepare = document.querySelector<HTMLButtonElement>('#prepare')!
const measure = document.querySelector<HTMLButtonElement>('#measure')!
const stop = document.querySelector<HTMLButtonElement>('#stop')!
let cleanup = () => {}

/** Read the depth produced by the unmodified production terrain shaders.
 * Packing a depth texture through a second pass avoids treating CPU visibility
 * or a mock raycast as evidence that the GPU actually discarded fragments. */
function gpuProbe(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  const near = 0.1, far = 20000, altitude = 10000
  const camera = new THREE.OrthographicCamera(-0.02, 0.02, 0.02, -0.02, near, far)
  camera.up.set(0, 0, -1)
  const target = new THREE.WebGLRenderTarget(1, 1)
  target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType)
  const packed = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false })
  const packingScene = new THREE.Scene()
  const packingMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { depth: { value: target.depthTexture } },
    depthTest: false, depthWrite: false,
    vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: `uniform sampler2D depth;
      void main(){float d=texture2D(depth,vec2(0.5)).r;
      if(d>=1.0){gl_FragColor=vec4(1.0);return;}
      float n=floor(d*16777215.0+0.5);
      vec3 b=vec3(floor(n/65536.0),floor(mod(n,65536.0)/256.0),mod(n,256.0));
      gl_FragColor=vec4(b/255.0,1.0);}`,
  }))
  packingScene.add(packingMesh)
  const pixel = new Uint8Array(4)
  const read = (north: number, east: number): number | null => {
    camera.position.set(east, altitude, -north)
    camera.lookAt(east, 0, -north)
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    renderer.setRenderTarget(packed)
    renderer.render(packingScene, new THREE.Camera())
    renderer.readRenderTargetPixels(packed, 0, 0, 1, 1, pixel)
    renderer.setRenderTarget(null)
    const depth = (pixel[0]! * 65536 + pixel[1]! * 256 + pixel[2]!) / 16777215
    return depth >= 1 ? null : altitude - (near + depth * (far - near))
  }
  return { read, dispose: () => {
    target.dispose(); packed.dispose(); packingMesh.geometry.dispose(); packingMesh.material.dispose()
  } }
}

button.onclick = async () => {
  button.disabled = true
  stop.disabled = false
  let active = true
  let timer: ReturnType<typeof setInterval> | undefined
  let tiles: TileManager | undefined
  let renderer: THREE.WebGLRenderer | undefined
  let probe: ReturnType<typeof gpuProbe> | undefined
  cleanup = () => {
    active = false
    if (timer) clearInterval(timer)
    tiles?.dispose()
    probe?.dispose()
    renderer?.dispose()
    renderer?.forceContextLoss()
    document.querySelector('#view')!.replaceChildren()
    measure.disabled = cpu.disabled = prepare.disabled = true
    stop.disabled = true
    button.disabled = false
  }
  output.textContent = 'Loading airport runway data and terrain…'
  try {
    const scene = new THREE.Scene(), frame = new WorldFrame({ lat: 37.5092, lon: -122.4959 })
    if (document.querySelector<HTMLInputElement>('#gpu-first')!.checked) {
      renderer = new THREE.WebGLRenderer({ antialias: false })
      renderer.setSize(768, 432)
      document.querySelector('#view')!.appendChild(renderer.domElement)
      probe = gpuProbe(renderer, scene)
      output.textContent = 'GPU initialized before asset streaming'
    }
    const airports = new Airports(scene, frame)
    await airports.load()
    if (!active) return
    tiles = new TileManager(scene, frame, (s, n, w, e) => airports.runwaysInBounds(s, n, w, e))
    const terrain = tiles
    terrain.setImagery(false)
    terrain.setDetailEnabled(false)
    terrain.update(0, 0)
    const shaderErrors: string[] = []
    const probes: Record<string, unknown>[] = []
    let phase = renderer ? 'Terrain streaming; GPU initialized before assets' : 'CPU terrain streaming; no GPU initialized'
    const locations = [[0, 0], [100, 0], [-100, 0], [0, 100], [0, -100], [250, 250], [-250, -250]]
    const report = () => {
      output.textContent = JSON.stringify({ phase, stream: terrain.debugImagery(), shaderErrors, probes,
        note: 'Separate CPU, GPU initialization, and depth-readback actions isolate failures. Production shader is unchanged. Stop releases all test resources.' }, null, 2)
    }
    const progress = () => { report(); cpu.disabled = terrain.readyCount === 0; prepare.disabled = !!renderer || terrain.readyCount === 0; measure.disabled = !renderer || terrain.readyCount === 0 }
    progress()
    timer = setInterval(progress, 1000)
    cpu.onclick = async () => {
      if (timer) clearInterval(timer)
      cpu.disabled = true
      probes.length = 0
      try {
        const ray = new THREE.Raycaster(new THREE.Vector3(0, 10000, 0), new THREE.Vector3(0, -1, 0), 0, 12000)
        for (const [n, e] of locations) {
          phase = `CPU intersection north=${n}, east=${e}`; report()
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
          if (!active) return
          scene.updateMatrixWorld(true)
          const ll = frame.fromLocal(n!, e!)
          ray.ray.origin.set(e!, 10000, -n!)
          const hits = ray.intersectObjects(scene.children, false)
          const layers = new Map<number, number>()
          for (const hit of hits) if (!layers.has(hit.object.renderOrder)) layers.set(hit.object.renderOrder, hit.point.y)
          const raw = terrain.elevationAt(ll.lat, ll.lon), physics = airports.flattenElevation(raw, ll.lat, ll.lon)
          const visible = hits.find(hit => terrain.isSurfaceVisible(hit.object, ll.lat, ll.lon))?.point.y
          probes.push({ north: n, east: e, physicsM: physics, sampledM: raw,
            rawTopMeshM: hits[0]?.point.y, visibleMeshM: visible,
            layers: [...layers].map(([zoom, height]) => ({ zoom, heightM: height })) })
        }
        phase = 'CPU intersections complete'
      } catch (error) { shaderErrors.push(String(error)); phase = 'CPU intersection failed' }
      finally { report(); if (active) cpu.disabled = false }
    }
    prepare.onclick = () => {
      if (timer) clearInterval(timer)
      prepare.disabled = true
      phase = 'Initializing WebGL context and depth targets'; report()
      try {
        renderer = new THREE.WebGLRenderer({ antialias: false })
        renderer.setSize(768, 432)
        document.querySelector('#view')!.appendChild(renderer.domElement)
        renderer.debug.onShaderError = (gl, _program, vertex, fragment) => {
          shaderErrors.push(gl.getShaderInfoLog(vertex) ?? '', gl.getShaderInfoLog(fragment) ?? '')
        }
        probe = gpuProbe(renderer, scene)
        phase = 'GPU initialized; no scene rendered or pixels read'
        measure.disabled = false
      } catch (error) { shaderErrors.push(String(error)); phase = 'GPU initialization failed' }
      report()
    }
    measure.onclick = async () => {
      if (timer) clearInterval(timer)
      measure.disabled = true
      try {
        renderer!.debug.onShaderError = (gl, _program, vertex, fragment) => {
          shaderErrors.push(gl.getShaderInfoLog(vertex) ?? '', gl.getShaderInfoLog(fragment) ?? '')
        }
        for (const [n, e] of locations) {
          phase = `GPU depth north=${n}, east=${e}`; report()
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
          if (!active) return
          const ll = frame.fromLocal(n!, e!), raw = terrain.elevationAt(ll.lat, ll.lon)
          const physics = airports.flattenElevation(raw, ll.lat, ll.lon)
          const gpu = probe!.read(n!, e!)
          const record = probes.find(item => item.north === n && item.east === e)
            ?? (() => { const item = { north: n, east: e }; probes.push(item); return item })()
          Object.assign(record, { gpuHeightM: gpu, gpuMinusSampleM: gpu == null ? null : gpu - raw,
            gpuMinusPhysicsM: gpu == null ? null : gpu - physics })
        }
        phase = 'GPU depth measurements complete'; report()
      } catch (error) { shaderErrors.push(String(error)); phase = 'GPU measurement failed'; report() }
      finally { if (active) measure.disabled = false }
    }
  } catch (error) {
    output.textContent = String(error)
    cleanup()
  }
}
stop.onclick = () => { cleanup(); output.textContent += '\nStopped; resources released.' }
window.addEventListener('pagehide', () => cleanup())
