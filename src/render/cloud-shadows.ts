import * as THREE from 'three'
import { CLOUD_DENSITY_GLSL, type Clouds } from './clouds'

/**
 * Cloud shadows on the ground. Each cloud mass is drawn into a top-down transmittance map (32 km across, centred on
 * the camera): for every ground point the sun ray is marched through that mass with the same density function the
 * visible clouds use, so a shadow has the shape of its cloud and lies where the sun puts it. Masses multiply.
 *
 * The map is computed on the plane y = 0 (sea level). A surface at height h samples it where its own sun ray crosses
 * that plane, which is exact as long as no cloud lies between the plane and the surface, i.e. below the cloud base.
 * Above the lowest base the map is not used: there the sun light's own scale applies, which is the transmission at
 * the aircraft (computed on the CPU along the same ray), so a plane above the clouds is never shaded by them.
 * Beyond the map, and when cloud shadows are off, surfaces get the old uniform dimming by cloud cover.
 */

/** Shared uniform objects: every receiver references these, so one write updates them all. */
export const cloudShadowUniforms = {
  uCloudShadowMap: { value: null as THREE.Texture | null },
  /** Render-frame x, z of the map centre, and half its width in metres. */
  uCloudShadowCenter: { value: new THREE.Vector2() },
  uCloudShadowHalf: { value: 16000 },
  /** Sun direction with its height clamped as the map was drawn. */
  uCloudShadowSun: { value: new THREE.Vector3(0, 1, 0) },
  /** 0 = map unused (off, night, sun too low), 1 = fully used. */
  uCloudShadowStrength: { value: 0 },
  /** Uniform transmission by cloud cover: beyond the map, and everywhere when the map is unused. */
  uCloudShadowFar: { value: 1 },
  /** The factor already applied to the scene's sun light (transmission at the aircraft), divided out by lit materials. */
  uCloudShadowLight: { value: 1 },
  /** Lowest cloud base, metres: surfaces above it take uCloudShadowLight instead of the map. */
  uCloudShadowBase: { value: 1e9 },
}

/** Receiver side: transmission of direct sunlight at a render-frame position. */
export const CLOUD_SHADOW_GLSL = /* glsl */ `
uniform sampler2D uCloudShadowMap;
uniform vec2 uCloudShadowCenter;
uniform float uCloudShadowHalf, uCloudShadowStrength, uCloudShadowFar, uCloudShadowLight, uCloudShadowBase;
uniform vec3 uCloudShadowSun;
float cloudShadowAt(vec3 p) {
  if (uCloudShadowStrength <= 0.0) return uCloudShadowFar;
  vec2 q = p.xz - uCloudShadowSun.xz * (p.y / uCloudShadowSun.y);
  vec2 uv = (q - uCloudShadowCenter) / (2.0 * uCloudShadowHalf) + 0.5;
  float inside = smoothstep(0.0, 0.06, min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y)));
  float t = mix(uCloudShadowFar, texture2D(uCloudShadowMap, clamp(uv, 0.0, 1.0)).r, inside);
  t = mix(t, uCloudShadowLight, smoothstep(uCloudShadowBase - 150.0, uCloudShadowBase, p.y));
  return mix(uCloudShadowFar, t, uCloudShadowStrength);
}
`

const LIGHTS_WITH_CLOUD_SHADOW = THREE.ShaderChunk.lights_fragment_begin.replace(
  'getDirectionalLightInfo( directionalLight, directLight );',
  'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= cloudShadowAt( vCloudShadowWorld ) / max( uCloudShadowLight, 1e-3 );',
)

/** Give a built-in lit material's shader (inside onBeforeCompile) cloud shadows on its directional lights. A no-op
 * for shaders without the standard lighting chunk. */
export function patchCloudShadow(shader: THREE.WebGLProgramParametersWithUniforms): void {
  if (!shader.fragmentShader.includes('#include <lights_fragment_begin>') || !shader.vertexShader.includes('#include <project_vertex>')) return
  if (shader.fragmentShader.includes('cloudShadowAt(')) return
  Object.assign(shader.uniforms, cloudShadowUniforms)
  shader.vertexShader = 'varying vec3 vCloudShadowWorld;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  {
    vec4 cloudShadowP = vec4( transformed, 1.0 );
    #ifdef USE_BATCHING
      cloudShadowP = batchingMatrix * cloudShadowP;
    #endif
    #ifdef USE_INSTANCING
      cloudShadowP = instanceMatrix * cloudShadowP;
    #endif
    vCloudShadowWorld = ( modelMatrix * cloudShadowP ).xyz;
  }`)
  shader.fragmentShader = 'varying vec3 vCloudShadowWorld;\n' + CLOUD_SHADOW_GLSL + shader.fragmentShader.replace('#include <lights_fragment_begin>', LIGHTS_WITH_CLOUD_SHADOW)
}

const SHADOW_VERT = /* glsl */ `
  attribute vec3 offset;
  attribute vec3 radii;
  attribute float seed;
  uniform vec3 uSun;
  uniform vec2 uCenter;
  uniform float uHalf;
  varying vec2 vGround;
  varying vec3 vCenter, vRadii;
  varying float vSeed;
  void main() {
    vCenter = offset; vRadii = radii; vSeed = seed;
    vec2 slant = uSun.xz / uSun.y;
    // The mass's box, cast along the sun onto y = 0.
    vec2 ground = offset.xz - slant * offset.y;
    vec2 halfSize = radii.xz + abs(slant) * radii.y;
    vGround = ground + position.xy * halfSize;
    gl_Position = vec4((vGround - uCenter) / uHalf, 0.0, 1.0);
  }
`
const SHADOW_FRAG = /* glsl */ `
  precision highp sampler3D;
  uniform sampler3D uNoise;
  uniform float uCoverage;
  uniform vec3 uSun;
  varying vec2 vGround;
  varying vec3 vCenter, vRadii;
  varying float vSeed;
  ${CLOUD_DENSITY_GLSL}
  void main() {
    vec3 s = normalize(uSun);
    vec3 o = (vec3(vGround.x, 0.0, vGround.y) - vCenter) / vRadii;
    vec3 d = s / vRadii;
    vec3 safeDir = mix(vec3(1e-8), d, greaterThan(abs(d), vec3(1e-8)));
    vec3 a = (-vec3(1.0) - o) / safeDir, b = (vec3(1.0) - o) / safeDir;
    vec3 nearT = min(a, b), farT = max(a, b);
    float entry = max(max(max(nearT.x, nearT.y), nearT.z), 0.0);
    float exitT = min(min(farT.x, farT.y), farT.z);
    if (exitT <= entry) discard;
    float stepM = (exitT - entry) / 10.0;
    float optical = 0.0;
    for (int i = 0; i < 10; i++) optical += cloudDensity(o + d * (entry + (float(i) + 0.5) * stepM), vSeed, uCoverage);
    optical *= stepM * mix(0.0042, 0.007, uCoverage);
    float t = exp(-optical);
    if (t > 0.998) discard;
    gl_FragColor = vec4(t, t, t, 1.0);
  }
`

/** Size of the map, texels, and half its width, metres (the cloud field reaches 14 km). */
const MAP_SIZE = 1024
const HALF_M = 16000

export class CloudShadows {
  enabled = true
  private readonly target = new THREE.WebGLRenderTarget(MAP_SIZE, MAP_SIZE, {
    format: THREE.RedFormat, type: THREE.UnsignedByteType, depthBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
  })
  private readonly scene = new THREE.Scene()
  /** The vertex shader writes clip space itself; the renderer (reversed depth) still wants a real camera object. */
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly quad = new THREE.PlaneGeometry(2, 2)
  private readonly passes = new Map<THREE.InstancedBufferGeometry, { mesh: THREE.Mesh; geometry: THREE.InstancedBufferGeometry; material: THREE.ShaderMaterial }>()
  private drawnKey = ''
  private readonly clear = new THREE.Color()

  constructor() {
    cloudShadowUniforms.uCloudShadowMap.value = this.target.texture
    cloudShadowUniforms.uCloudShadowHalf.value = HALF_M
  }

  /**
   * Per frame, after the clouds have been updated. `farTransmission` is the old uniform dimming by cloud cover;
   * `aircraft` is where the scene's sun light is evaluated. Returns the factor for the sun light's intensity.
   */
  update(renderer: THREE.WebGLRenderer, clouds: Clouds, sunDir: THREE.Vector3, camera: THREE.Vector3, aircraft: THREE.Vector3, farTransmission: number): number {
    const u = cloudShadowUniforms
    u.uCloudShadowFar.value = farTransmission
    const layers = clouds.shadowLayers().filter((l) => l.geometry.instanceCount > 0)
    // Shadows fade in between about 12 and 22 degrees of sun elevation: lower, a cloud's shadow lands farther from it than the
    // cloud field reaches, so the map would show shadows of clouds that are not there and miss those of clouds that are.
    const strength = this.enabled && layers.length ? THREE.MathUtils.smoothstep(sunDir.y, 0.2, 0.38) : 0
    u.uCloudShadowStrength.value = strength
    if (strength <= 0) { u.uCloudShadowLight.value = farTransmission; u.uCloudShadowBase.value = 1e9; return farTransmission }

    const sun = u.uCloudShadowSun.value.set(sunDir.x, Math.max(sunDir.y, 0.08), sunDir.z)
    u.uCloudShadowBase.value = Math.min(...layers.map((l) => l.baseM))
    // Centred on the camera, snapped to the texel grid so the shadows hold still while the map follows.
    const texel = (2 * HALF_M) / MAP_SIZE
    const cx = Math.round(camera.x / texel) * texel
    const cz = Math.round(camera.z / texel) * texel
    const key = `${cx}|${cz}|${sun.x.toFixed(3)}|${sun.y.toFixed(3)}|${sun.z.toFixed(3)}|${clouds.version}`
    if (key !== this.drawnKey) {
      this.draw(renderer, clouds, layers, cx, cz, sun)
      this.drawnKey = key
    }
    const local = clouds.sunTransmissionAt(aircraft, sun)
    const light = farTransmission + (local - farTransmission) * strength
    u.uCloudShadowLight.value = light
    return light
  }

  private draw(renderer: THREE.WebGLRenderer, clouds: Clouds, layers: ReturnType<Clouds['shadowLayers']>, cx: number, cz: number, sun: THREE.Vector3): void {
    const live = new Set(layers.map((l) => l.geometry))
    for (const [source, pass] of this.passes) if (!live.has(source)) { this.scene.remove(pass.mesh); pass.geometry.dispose(); pass.material.dispose(); this.passes.delete(source) }
    for (const layer of layers) {
      let pass = this.passes.get(layer.geometry)
      if (!pass) {
        const geometry = new THREE.InstancedBufferGeometry()
        geometry.index = this.quad.index
        geometry.setAttribute('position', this.quad.getAttribute('position'))
        for (const name of ['offset', 'radii', 'seed']) geometry.setAttribute(name, layer.geometry.getAttribute(name))
        const material = new THREE.ShaderMaterial({
          uniforms: { uNoise: { value: clouds.noiseTexture }, uCoverage: { value: layer.coverage }, uSun: { value: new THREE.Vector3() }, uCenter: { value: new THREE.Vector2() }, uHalf: { value: HALF_M } },
          vertexShader: SHADOW_VERT, fragmentShader: SHADOW_FRAG,
          depthTest: false, depthWrite: false,
          // dst = dst × src: overlapping masses multiply their transmissions.
          blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
        })
        const mesh = new THREE.Mesh(geometry, material)
        mesh.frustumCulled = false
        this.scene.add(mesh)
        pass = { mesh, geometry, material }
        this.passes.set(layer.geometry, pass)
      }
      pass.geometry.instanceCount = layer.geometry.instanceCount
      pass.material.uniforms.uCoverage!.value = layer.coverage
      ;(pass.material.uniforms.uSun!.value as THREE.Vector3).copy(sun)
      ;(pass.material.uniforms.uCenter!.value as THREE.Vector2).set(cx, cz)
    }
    cloudShadowUniforms.uCloudShadowCenter.value.set(cx, cz)
    const previousTarget = renderer.getRenderTarget()
    renderer.getClearColor(this.clear)
    const previousAlpha = renderer.getClearAlpha()
    const previousAutoClear = renderer.autoClear
    renderer.setRenderTarget(this.target)
    renderer.setClearColor(0xffffff, 1)
    renderer.clear(true, false, false)
    renderer.autoClear = false
    renderer.render(this.scene, this.camera)
    renderer.autoClear = previousAutoClear
    renderer.setClearColor(this.clear, previousAlpha)
    renderer.setRenderTarget(previousTarget)
  }

  /** What the map holds right now (verification): the share of ground it darkens, its darkest value, and how many masses were drawn. */
  stats(renderer: THREE.WebGLRenderer): { shadowed: number; darkest: number; masses: number; texels: number; centre: number[]; sketch: string[] } {
    const data = new Uint8Array(MAP_SIZE * MAP_SIZE)
    renderer.readRenderTargetPixels(this.target, 0, 0, MAP_SIZE, MAP_SIZE, data)
    let dark = 0, min = 255
    for (const v of data) { if (v < 250) dark++; if (v < min) min = v }
    // 32 × 32 sketch, north (negative z) at the top, east to the right: ' ' lit, '.', ':', '#' darker.
    const cell = MAP_SIZE / 32, sketch: string[] = []
    for (let row = 31; row >= 0; row--) {
      let line = ''
      for (let col = 0; col < 32; col++) {
        let lo = 255
        for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) lo = Math.min(lo, data[(row * cell + y) * MAP_SIZE + col * cell + x]!)
        line += lo > 245 ? ' ' : lo > 170 ? '.' : lo > 80 ? ':' : '#'
      }
      sketch.push(line)
    }
    const c = cloudShadowUniforms.uCloudShadowCenter.value
    return { shadowed: dark / data.length, darkest: min / 255, masses: [...this.passes.values()].reduce((n, p) => n + p.geometry.instanceCount, 0), texels: data.length, centre: [c.x, c.y], sketch }
  }

  dispose(): void {
    for (const pass of this.passes.values()) { pass.geometry.dispose(); pass.material.dispose() }
    this.passes.clear()
    this.target.dispose()
    this.quad.dispose()
  }
}
