/**
 * Post-processing chain: the scene renders into an HDR (half-float) target
 * with a FLOAT depth texture — the renderer uses a reversed depth buffer
 * (scene.ts), whose precision benefit needs a float depth attachment — then
 *
 *   bright pass → downsample/upsample bloom chain
 *               → radial "god-ray" blur toward the sun (occluded by clouds
 *                 and terrain, because it blurs the bright pass)
 *               → composite: scene + bloom + rays + sun glare, warm grade
 *                 near sunrise/sunset, vignette, then the renderer's own
 *                 ACES tone mapping and sRGB output.
 *
 * Everything is a few fullscreen passes at reduced resolution; `enabled =
 * false` falls back to plain rendering (the "performance" quality mode).
 * Original shaders; no third-party effect code.
 */
import * as THREE from 'three'

export interface PostParams {
  /** Sun position in normalized screen space (0..1, y up) and how visible
   *  it is (0 = behind the camera / below the horizon, 1 = in view). */
  sunScreen: THREE.Vector2
  sunVisibility: number
  /** Sun elevation, degrees — drives glare strength and the warm grade. */
  sunElevationDeg: number
  bloomStrength: number
  rayStrength: number
  vignette: number
}

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

const BRIGHT_FRAG = /* glsl */ `
  uniform sampler2D tScene;
  uniform float uThreshold;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    float l = max(c.r, max(c.g, c.b));
    float knee = max(l - uThreshold, 0.0);
    // soft knee: smooth onset instead of a hard cut
    float w = knee * knee / (knee + 0.5 * uThreshold + 1e-4);
    gl_FragColor = vec4(c * (w / max(l, 1e-4)), 1.0);
  }
`

const DOWN_FRAG = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec3 a = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
    vec3 b = texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
    vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
    vec3 d = texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
    gl_FragColor = vec4((a + b + c + d) * 0.25, 1.0);
  }
`

const UP_FRAG = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
    s += texture2D(tSrc, vUv + uTexel * vec2( 1.0, 0.0)).rgb * 2.0;
    s += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 0.0)).rgb * 2.0;
    s += texture2D(tSrc, vUv + uTexel * vec2(0.0,  1.0)).rgb * 2.0;
    s += texture2D(tSrc, vUv + uTexel * vec2(0.0, -1.0)).rgb * 2.0;
    s += texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
    s += texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
    s += texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
    s += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
    gl_FragColor = vec4(s / 16.0, 1.0);
  }
`

const RAYS_FRAG = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uSun;
  uniform float uVisible;
  varying vec2 vUv;
  const int SAMPLES = 40;
  void main() {
    vec2 delta = (uSun - vUv) / float(SAMPLES) * 0.92;
    vec2 uv = vUv;
    float decay = 1.0, wsum = 0.0;
    vec3 acc = vec3(0.0);
    for (int i = 0; i < SAMPLES; i++) {
      uv += delta;
      acc += texture2D(tSrc, uv).rgb * decay;
      wsum += decay;
      decay *= 0.965;
    }
    gl_FragColor = vec4(acc / max(wsum, 1e-3) * uVisible, 1.0);
  }
`

const COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform sampler2D tRays;
  uniform vec2 uSun;
  uniform float uSunVisible;
  uniform float uSunElevation;
  uniform float uBloom;
  uniform float uRays;
  uniform float uVignette;
  uniform float uAspect;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    vec3 bloom = texture2D(tBloom, vUv).rgb;
    vec3 rays = texture2D(tRays, vUv).rgb;
    // Low sun → stronger, warmer glare; high sun → subtle.
    float low = 1.0 - smoothstep(2.0, 28.0, uSunElevation);
    vec3 warm = mix(vec3(1.0), vec3(1.0, 0.62, 0.34), low);
    c += bloom * uBloom;
    c += rays * warm * uRays * (0.35 + 0.65 * low);
    // Sun glare: a soft halo plus a faint anamorphic streak around the sun.
    vec2 d = vUv - uSun; d.x *= uAspect;
    float r = length(d);
    float halo = exp(-r * 6.5) * 0.30 + exp(-r * 22.0) * 0.55;
    float streak = exp(-abs(d.y) * 90.0) * exp(-abs(d.x) * 2.6) * 0.20;
    c += warm * (halo + streak) * uSunVisible * (0.4 + 0.9 * low);
    // Warm grade near the horizon: lift reds, ease blues a touch.
    c *= mix(vec3(1.0), vec3(1.05, 0.99, 0.90), low * 0.6);
    // Vignette (after the grade, before tone mapping so highlights keep detail).
    vec2 q = (vUv - 0.5) * vec2(uAspect * 0.78, 1.0);
    c *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(q));
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function fullscreenMaterial(frag: string, uniforms: Record<string, THREE.IUniform>, toneMapped = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT, fragmentShader: frag, uniforms,
    depthTest: false, depthWrite: false, toneMapped,
  })
}

export class PostFx {
  enabled = true
  private sceneRt: THREE.WebGLRenderTarget
  private readonly chain: THREE.WebGLRenderTarget[] = []
  private rays: THREE.WebGLRenderTarget
  private readonly quad: THREE.Mesh
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly scene = new THREE.Scene()
  private readonly bright: THREE.ShaderMaterial
  private readonly down: THREE.ShaderMaterial
  private readonly up: THREE.ShaderMaterial
  private readonly raysMat: THREE.ShaderMaterial
  private readonly composite: THREE.ShaderMaterial
  private levels = 5
  private w = 0
  private h = 0

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const mk = (): THREE.WebGLRenderTarget => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter })
    this.sceneRt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter })
    // ?postdepth=0 falls back to a plain depth renderbuffer (diagnostics).
    if (typeof location === 'undefined' || new URLSearchParams(location.search).get('postdepth') !== '0') this.sceneRt.depthTexture = new THREE.DepthTexture(4, 4, THREE.FloatType)
    this.rays = mk()
    for (let i = 0; i < 6; i++) this.chain.push(mk())
    this.bright = fullscreenMaterial(BRIGHT_FRAG, { tScene: { value: null }, uThreshold: { value: 1.1 } })
    this.down = fullscreenMaterial(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } })
    this.up = fullscreenMaterial(UP_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } })
    this.up.blending = THREE.AdditiveBlending
    this.raysMat = fullscreenMaterial(RAYS_FRAG, { tSrc: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uVisible: { value: 0 } })
    this.composite = fullscreenMaterial(COMPOSITE_FRAG, {
      tScene: { value: null }, tBloom: { value: null }, tRays: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) },
      uSunVisible: { value: 0 }, uSunElevation: { value: 30 }, uBloom: { value: 0.5 }, uRays: { value: 0.5 }, uVignette: { value: 0.3 }, uAspect: { value: 1.6 },
    }, true)
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bright)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)
  }

  /** Match the drawing buffer. */
  resize(): void {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    const w = Math.max(2, Math.floor(size.x)), h = Math.max(2, Math.floor(size.y))
    if (w === this.w && h === this.h) return
    this.w = w; this.h = h
    this.sceneRt.setSize(w, h)
    if (this.sceneRt.depthTexture) { this.sceneRt.depthTexture.image.width = w; this.sceneRt.depthTexture.image.height = h }
    let cw = Math.max(2, w >> 1), ch = Math.max(2, h >> 1)
    this.chain.forEach((rt) => { rt.setSize(cw, ch); cw = Math.max(2, cw >> 1); ch = Math.max(2, ch >> 1) })
    this.rays.setSize(Math.max(2, w >> 2), Math.max(2, h >> 2))
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null, clear = true): void {
    this.quad.material = mat
    this.renderer.setRenderTarget(target)
    if (clear) this.renderer.clear()
    this.renderer.render(this.scene, this.cam)
  }

  render(scene: THREE.Scene, camera: THREE.Camera, p: PostParams): void {
    const r = this.renderer
    if (!this.enabled) { r.setRenderTarget(null); r.render(scene, camera); return }
    this.resize()
    // 1. Scene → HDR target.
    r.setRenderTarget(this.sceneRt)
    r.clear()
    r.render(scene, camera)
    // 2. Bright pass into the first (half-res) bloom level.
    const autoClear = r.autoClear
    r.autoClear = false
    this.bright.uniforms.tScene!.value = this.sceneRt.texture
    this.pass(this.bright, this.chain[0]!)
    // 3. Downsample chain.
    const n = Math.min(this.levels, this.chain.length)
    for (let i = 1; i < n; i++) {
      this.down.uniforms.tSrc!.value = this.chain[i - 1]!.texture
      this.down.uniforms.uTexel!.value.set(1 / this.chain[i - 1]!.width, 1 / this.chain[i - 1]!.height)
      this.pass(this.down, this.chain[i]!)
    }
    // 4. Upsample, accumulating into each larger level.
    for (let i = n - 1; i > 0; i--) {
      this.up.uniforms.tSrc!.value = this.chain[i]!.texture
      this.up.uniforms.uTexel!.value.set(1 / this.chain[i]!.width, 1 / this.chain[i]!.height)
      this.pass(this.up, this.chain[i - 1]!, false)
    }
    // 5. God rays from the (half-res) bright pass toward the sun.
    this.raysMat.uniforms.tSrc!.value = this.chain[0]!.texture
    this.raysMat.uniforms.uSun!.value.copy(p.sunScreen)
    this.raysMat.uniforms.uVisible!.value = p.sunVisibility
    this.pass(this.raysMat, this.rays)
    // 6. Composite to the screen.
    const u = this.composite.uniforms
    u.tScene!.value = this.sceneRt.texture
    u.tBloom!.value = this.chain[0]!.texture
    u.tRays!.value = this.rays.texture
    u.uSun!.value.copy(p.sunScreen)
    u.uSunVisible!.value = p.sunVisibility
    u.uSunElevation!.value = p.sunElevationDeg
    u.uBloom!.value = p.bloomStrength
    u.uRays!.value = p.rayStrength
    u.uVignette!.value = p.vignette
    u.uAspect!.value = this.w / this.h
    this.pass(this.composite, null, true)
    r.autoClear = autoClear
  }

  /** Quality tiers: bloom depth. */
  setQuality(mode: 'performance' | 'high' | 'ultra'): void {
    this.enabled = mode !== 'performance'
    this.levels = mode === 'ultra' ? 6 : 5
  }

  dispose(): void {
    for (const t of [this.sceneRt, this.rays, ...this.chain]) t.dispose()
    for (const m of [this.bright, this.down, this.up, this.raysMat, this.composite]) m.dispose()
    this.quad.geometry.dispose()
  }
}

/** Project a world-space sun direction to normalized screen coordinates and
 *  a visibility factor (0 when behind the camera or well below the
 *  horizon). Pure given the camera — unit-tested. */
export function sunScreenPosition(camera: THREE.Camera, sunDir: THREE.Vector3, elevationDeg: number): { screen: THREE.Vector2; visibility: number } {
  camera.updateMatrixWorld()
  const v = sunDir.clone().multiplyScalar(1e6).add(camera.position).project(camera)
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
  const facing = forward.dot(sunDir)
  const inFront = THREE.MathUtils.smoothstep(facing, 0.0, 0.25)
  const above = THREE.MathUtils.smoothstep(elevationDeg, -4, 1.5)
  return { screen: new THREE.Vector2(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5), visibility: inFront * above }
}
