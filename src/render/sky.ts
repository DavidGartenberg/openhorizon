import * as THREE from 'three'
import { sunPosition, sunDirectionENU } from '../math/solar'
import { equatorialMatrix, moonDirection } from '../math/lunar'
import { SKY_INTEGRATION, SKY_LOOKUP } from './atmosphere-shader'

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    // Actual projection includes reversed-Z. xyww incorrectly pins to the
    // near plane on EXT_clip_control.
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const FRAG = /* glsl */ `
  uniform sampler2D uSky;
  uniform vec3 uSunDir;
  // Night sky (math/lunar.ts): the Moon's direction, the render→equatorial
  // rotation (stars turn about the celestial pole), a clock for twinkling,
  // and the rainbow's strength (rain with the sun out behind the viewer).
  uniform vec3 uMoonDir;
  uniform mat3 uEquatorial;
  uniform float uTime;
  uniform float uRainbow;
  varying vec3 vDir;
  ${SKY_LOOKUP}
  float hash(vec3 p) {
    p = fract(p * 443.8975);
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
  }
  // Spectral colour (approximate) across a rainbow band: t = 0 violet → 1 red.
  vec3 spectrum(float t) {
    vec3 c = vec3(
      smoothstep(0.45, 0.85, t) + 0.35*(1.0-smoothstep(0.0, 0.18, t)),
      smoothstep(0.15, 0.5, t) * (1.0 - smoothstep(0.62, 0.92, t)),
      1.0 - smoothstep(0.2, 0.52, t));
    return c * smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.88, 1.0, t));
  }
  void main() {
    vec3 dir = normalize(vDir);
    vec3 color = skyRadiance(uSky, dir);
    float day = smoothstep(-0.02, 0.08, uSunDir.y);
    float low = 1.0 - smoothstep(0.0, 0.4, uSunDir.y);
    // True ~0.53 degree solar diameter, pixel-width antialiased edge.
    float mu = dot(dir, uSunDir);
    float edge = max(fwidth(mu), 0.000001);
    color += vec3(18.0, 16.0-8.0*low, 13.0-10.0*low) * day *
      smoothstep(0.999989-edge, 0.999989+edge, mu);
    float night = 1.0 - smoothstep(-0.12, 0.02, uSunDir.y);
    // ---- the Moon: a sphere lit by the real sun (phase and terminator
    // orientation follow), faint earthshine on the dark limb; pale by day.
    vec3 m = normalize(uMoonDir);
    float mm = dot(dir, m);
    if (mm > 0.99996 && m.y > -0.02) {
      vec3 off = (dir - m * mm) / 0.00454; // offset in moon radii
      float r2 = dot(off, off);
      if (r2 < 1.0) {
        vec3 n = off - m * sqrt(1.0 - r2);
        float lit = max(dot(n, normalize(uSunDir)), 0.0);
        float rim = smoothstep(1.0, 0.92, r2);
        vec3 albedo = vec3(0.47, 0.47, 0.5) * (0.85 + 0.3 * vnoise(off * 3.0 + 7.0));
        vec3 moon = albedo * (lit * 1.1 + 0.012) * rim;
        color += moon * mix(0.35, 1.0, night);
      }
    }
    if (dir.y > 0.0 && night > 0.01) {
      vec3 eq = uEquatorial * dir;
      // Extinction toward the horizon (more air), and twinkling that grows there.
      float airmass = 1.0 / max(dir.y + 0.025, 0.05);
      float ext = exp(-0.12 * (airmass - 1.0));
      // ---- stars: fixed on the celestial sphere, a realistic spread of
      // magnitudes (few bright, many faint) and colour temperatures. Each is
      // drawn at least a pixel wide (fwidth), so none alias away.
      vec3 g = eq * 300.0;
      vec3 cell = floor(g);
      float h = hash(cell);
      if (h > 0.9935) {
        vec3 point = fract(g) - 0.5 - 0.3 * (vec3(hash(cell + 3.1), hash(cell + 5.7), hash(cell + 9.3)) - 0.5);
        float mag = pow((h - 0.9935) / 0.0065, 5.0); // brightness: heavy-tailed
        float pix = max(max(fwidth(g.x), fwidth(g.y)), fwidth(g.z));
        float rad = max(mix(0.04, 0.12, mag), 0.75 * pix);
        float core = 1.0 - smoothstep(rad * 0.35, rad, length(point));
        float tint = hash(cell + 1.7);
        vec3 starCol = mix(vec3(0.62, 0.75, 1.0), vec3(1.0, 0.78, 0.55), smoothstep(0.35, 0.95, tint));
        float twinkle = 1.0 + (0.18 + 0.5 * (1.0 - dir.y)) * sin(uTime * (9.0 + 13.0 * hash(cell + 4.4)) + h * 60.0);
        color += starCol * core * (0.05 + 1.6 * mag) * twinkle * ext * night;
      }
      // ---- the Milky Way: the galactic plane (pole RA 192.86°, Dec 27.13°),
      // brightest toward the centre in Sagittarius, mottled by dust lanes.
      vec3 gnp = vec3(-0.8676, -0.1981, 0.4560);
      vec3 gc = vec3(-0.0549, -0.8734, -0.4838);
      float b = asin(clamp(dot(eq, gnp), -1.0, 1.0));
      float band = exp(-pow(b / 0.16, 2.0)) + 0.4 * exp(-pow(b / 0.42, 2.0));
      float bulge = 1.0 + 2.2 * exp(-pow(acos(clamp(dot(eq, gc), -1.0, 1.0)) / 0.55, 2.0));
      float dust = 0.55 + 0.45 * vnoise(eq * 9.0) - 0.35 * exp(-pow(b / 0.04, 2.0)) * vnoise(eq * 23.0);
      color += vec3(0.010, 0.011, 0.014) * band * bulge * max(dust, 0.0) * ext * night * night;
    }
    // ---- rainbow: primary 40.6–42.4° around the antisolar point (red
    // outside), secondary 50.3–53.5° (reversed, ~0.43×), Alexander's dark
    // band between, a little extra light just inside the primary.
    if (uRainbow > 0.001 && dir.y > -0.02) {
      float th = degrees(acos(clamp(dot(dir, -normalize(uSunDir)), -1.0, 1.0)));
      vec3 bow = spectrum((th - 40.6) / 1.8) + 0.43 * spectrum(1.0 - (th - 50.3) / 3.2);
      float alexander = smoothstep(42.0, 43.0, th) * (1.0 - smoothstep(49.8, 50.8, th));
      float inside = (1.0 - smoothstep(37.0, 40.8, th)) * smoothstep(20.0, 34.0, th);
      float horizonFade = smoothstep(-0.02, 0.06, dir.y);
      vec3 skyLum = vec3(dot(color, vec3(0.2126, 0.7152, 0.0722)));
      color = color * (1.0 - 0.22 * alexander * uRainbow * horizonFade) +
        (bow * 0.55 * skyLum + vec3(0.06) * inside * skyLum) * uRainbow * horizonFade;
    }
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** One HDR atmosphere shared by the visible sky, PBR lighting and water.
 * Scattering integration runs only when the sun or observer altitude changes. */
export class SkyDome {
  readonly sunDir = new THREE.Vector3(0, 1, 0)
  /** The Moon's direction (render frame) and the render→equatorial rotation. */
  readonly moonDir = new THREE.Vector3(0, -1, 0)
  readonly equatorial = new THREE.Matrix3()
  elevationDeg = 0
  private cloudCover = 0
  get directTransmission(): number { return Math.exp(-this.cloudCover * 2.7) }
  setCloudCover(cover: number): void { this.cloudCover = Math.max(0, Math.min(1, cover)) }
  private readonly lookup = new THREE.WebGLRenderTarget(512, 256, {
    type: THREE.HalfFloatType, depthBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
  })
  get radianceTexture(): THREE.Texture { return this.lookup.texture }
  private readonly integration: THREE.ShaderMaterial
  private readonly lookupScene = new THREE.Scene()
  private readonly lookupCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly material: THREE.ShaderMaterial
  private readonly dome: THREE.Mesh
  private readonly envScene = new THREE.Scene()
  private pmrem: THREE.PMREMGenerator | null = null
  private envRT: THREE.WebGLRenderTarget | null = null
  private readonly lastSun = new THREE.Vector3()
  private lastAltitude = Infinity
  private readonly sunLight = new THREE.DirectionalLight(0xffffff, 3)
  private readonly hemiLight = new THREE.HemisphereLight(0xadc7e6, 0x4b4840, 0.5)
  private readonly shadowTarget = new THREE.Vector3()
  private shadowHalf = 120

  /** Shadow-map resolution by graphics quality (1024 / 2048 / 4096 texels). */
  setShadowQuality(quality: 'performance' | 'high' | 'ultra'): void {
    const size = quality === 'performance' ? 1024 : quality === 'ultra' ? 4096 : 2048
    const shadow = this.sunLight.shadow
    if (shadow.mapSize.x === size) return
    shadow.mapSize.set(size, size)
    // Reallocated on the next render at the new size.
    shadow.map?.dispose()
    shadow.map = null
  }

  /** Spend shadow texels on the selected airframe, not an empty 240m box. */
  setShadowSize(spanM: number): void {
    this.shadowHalf = THREE.MathUtils.clamp(spanM*1.4, 24, 120)
    const c = this.sunLight.shadow.camera
    c.left = c.bottom = -this.shadowHalf
    c.right = c.top = this.shadowHalf
    c.updateProjectionMatrix()
    this.sunLight.shadow.normalBias = this.shadowHalf/1000
  }

  constructor(scene: THREE.Scene) {
    this.lookup.texture.name = 'Atmospheric radiance (linear HDR)'
    this.integration = new THREE.ShaderMaterial({
      uniforms: { uSunDir: { value: this.sunDir }, uAltitude: { value: 20 } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader: SKY_INTEGRATION,
      depthTest: false, depthWrite: false, toneMapped: false,
    })
    this.lookupScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.integration))
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uSky: { value: this.lookup.texture }, uSunDir: { value: this.sunDir },
        uMoonDir: { value: this.moonDir }, uEquatorial: { value: this.equatorial },
        uTime: { value: 0 }, uRainbow: { value: 0 },
      },
      vertexShader: VERT, fragmentShader: FRAG,
      side: THREE.BackSide, depthWrite: false,
    })
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material)
    this.dome.scale.setScalar(900_000)
    this.dome.frustumCulled = false
    this.dome.renderOrder = -10
    scene.add(this.dome, this.sunLight, this.hemiLight, this.sunLight.target)
    const envDome = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), this.material)
    const ground = new THREE.Mesh(new THREE.CircleGeometry(990, 32),
      new THREE.MeshBasicMaterial({ color: 0x353a30 }))
    ground.rotation.x = -Math.PI/2
    ground.position.y = -5
    this.envScene.add(envDome, ground)

    this.sunLight.castShadow = true
    this.sunLight.shadow.mapSize.set(2048, 2048)
    const half = this.shadowHalf
    const cam = this.sunLight.shadow.camera
    Object.assign(cam, { left: -half, right: half, top: half, bottom: -half, near: 10, far: 1600 })
    this.sunLight.shadow.bias = -0.00002
    this.sunLight.shadow.normalBias = 0.12
    scene.environmentIntensity = 0.75
  }

  /** Direction (not just elevation) invalidates reflections after travel. */
  updateEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene, observer?: THREE.Vector3): void {
    if (observer) this.dome.position.copy(observer)
    const altitude = Math.max(20, Math.min(25000, observer?.y ?? 20))
    if (this.lastSun.dot(this.sunDir) > Math.cos(0.35*Math.PI/180) &&
        Math.abs(altitude-this.lastAltitude) < 200) return
    this.integration.uniforms.uAltitude!.value = altitude
    const previous = renderer.getRenderTarget()
    try {
      renderer.setRenderTarget(this.lookup)
      renderer.render(this.lookupScene, this.lookupCamera)
      this.pmrem ??= new THREE.PMREMGenerator(renderer)
      const rt = this.pmrem.fromScene(this.envScene, 0.04, 0.1, 2000)
      scene.environment = rt.texture
      this.envRT?.dispose()
      this.envRT = rt
      this.lastSun.copy(this.sunDir)
      this.lastAltitude = altitude
    } finally {
      renderer.setRenderTarget(previous)
    }
  }

  /** Rainbow strength 0..1 (rain falling with the sun out, below 42°). */
  setRainbow(strength: number): void {
    this.material.uniforms.uRainbow!.value = Math.max(0, Math.min(1, strength))
  }

  update(date: Date, latDeg: number, lonDeg: number): THREE.Vector3 {
    const md = moonDirection(date, latDeg, lonDeg)
    this.moonDir.set(md.x, md.y, md.z)
    const em = equatorialMatrix(date, latDeg, lonDeg)
    this.equatorial.set(em[0]!, em[1]!, em[2]!, em[3]!, em[4]!, em[5]!, em[6]!, em[7]!, em[8]!)
    this.material.uniforms.uTime!.value = (date.getTime() / 1000) % 3600
    const angles = sunPosition(date, latDeg, lonDeg)
    this.elevationDeg = angles.elevationDeg
    const d = sunDirectionENU(angles)
    this.sunDir.set(d.x, d.y, d.z)
    this.sunLight.position.copy(this.shadowTarget).addScaledVector(this.sunDir, 700)
    this.sunLight.target.position.copy(this.shadowTarget)
    const dayness = THREE.MathUtils.smoothstep(angles.elevationDeg, -4, 10)
    const low = 1-THREE.MathUtils.smoothstep(angles.elevationDeg, 0, 25)
    this.sunLight.intensity = 3.2*dayness*this.directTransmission
    this.sunLight.color.setRGB(1, 1-0.35*low, 1-0.65*low)
    this.hemiLight.intensity = 0.025+(0.45+0.15*this.cloudCover)*dayness
    return this.sunDir
  }

  setShadowTarget(worldPos: THREE.Vector3): void {
    const texel = (2*this.shadowHalf)/2048
    const up = Math.abs(this.sunDir.y)>0.95 ? _X : _Y
    _right.crossVectors(up, this.sunDir).normalize()
    _up.crossVectors(this.sunDir, _right)
    const r = worldPos.dot(_right), u = worldPos.dot(_up)
    this.shadowTarget.copy(worldPos)
      .addScaledVector(_right, Math.round(r/texel)*texel-r)
      .addScaledVector(_up, Math.round(u/texel)*texel-u)
  }
}
const _X = new THREE.Vector3(1,0,0), _Y = new THREE.Vector3(0,1,0)
const _right = new THREE.Vector3(), _up = new THREE.Vector3()
