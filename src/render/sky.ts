import * as THREE from 'three'
import { sunPosition, sunDirectionENU } from '../math/solar'
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
  varying vec3 vDir;
  ${SKY_LOOKUP}
  float hash(vec3 p) {
    p = fract(p * 443.8975);
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
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
    if (dir.y > 0.0 && night > 0.01) {
      vec3 cell = floor(dir*420.0);
      float h = hash(cell);
      vec3 point = fract(dir*420.0)-0.5;
      float star = (1.0-smoothstep(0.05, 0.4, length(point))) * step(0.997, h);
      color += vec3(0.6, 0.72, 1.0)*star*night;
      // Retained approximation: permanent full moon at the solar antipode.
      float moon = smoothstep(0.999985-edge, 0.99999+edge, dot(dir, -uSunDir));
      color += vec3(0.45, 0.48, 0.55)*moon*night;
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
      uniforms: { uSky: { value: this.lookup.texture }, uSunDir: { value: this.sunDir } },
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

  update(date: Date, latDeg: number, lonDeg: number): THREE.Vector3 {
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
