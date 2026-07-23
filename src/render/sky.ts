import * as THREE from 'three'
import { sunPosition, sunDirectionENU } from '../math/solar'

/**
 * Custom scattering sky (§7, Phase 5 step 3 — replaces the three.js Sky
 * addon that stood in since Phase 0). Single-scattering Rayleigh+Mie
 * raymarch (Nishita-style, 8×4 samples) on an inverted dome: correct
 * day/golden-hour/twilight from the same solar geometry the sim uses, plus
 * a procedural star field and a moon disc at night.
 *
 * Documented approximations: the moon is placed at the sun's antipode (a
 * permanent full moon) — real lunar ephemeris is §28 roadmap; stars are a
 * stable hash field, not a catalog (real star map is §28).
 */

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 pos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = pos.xyww; // pin to the far plane
  }
`

const FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  varying vec3 vDir;

  const float PI = 3.141592653589793;
  const float R_PLANET = 6371e3;
  const float R_ATMOS = 6471e3;
  const vec3 BETA_R = vec3(5.5e-6, 13.0e-6, 22.4e-6);
  const float BETA_M = 21e-6;
  const float H_R = 8500.0;
  const float H_M = 1200.0;

  // Ray-sphere exit distance from origin at planet surface.
  float atmosDist(vec3 ro, vec3 rd) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - R_ATMOS * R_ATMOS;
    return -b + sqrt(b * b - c);
  }

  vec3 scatter(vec3 dir, vec3 sun) {
    vec3 ro = vec3(0.0, R_PLANET + 500.0, 0.0);
    float tMax = atmosDist(ro, dir);
    const int STEPS = 8;
    const int LSTEPS = 4;
    float ds = tMax / float(STEPS);
    float mu = dot(dir, sun);
    float phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
    float g = 0.76;
    float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) /
      ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
    vec3 sumR = vec3(0.0);
    vec3 sumM = vec3(0.0);
    float odR = 0.0;
    float odM = 0.0;
    for (int i = 0; i < STEPS; i++) {
      vec3 p = ro + dir * (ds * (float(i) + 0.5));
      float h = length(p) - R_PLANET;
      float hr = exp(-h / H_R) * ds;
      float hm = exp(-h / H_M) * ds;
      odR += hr;
      odM += hm;
      float lMax = atmosDist(p, sun);
      float dl = lMax / float(LSTEPS);
      float lodR = 0.0;
      float lodM = 0.0;
      for (int j = 0; j < LSTEPS; j++) {
        vec3 q = p + sun * (dl * (float(j) + 0.5));
        float hq = length(q) - R_PLANET;
        lodR += exp(-hq / H_R) * dl;
        lodM += exp(-hq / H_M) * dl;
      }
      vec3 tau = BETA_R * (odR + lodR) + BETA_M * 1.1 * (odM + lodM);
      vec3 att = exp(-tau);
      sumR += hr * att;
      sumM += hm * att;
    }
    return 75.0 * (sumR * BETA_R * phaseR + sumM * BETA_M * phaseM);
  }

  // Stable hash star field on the view direction.
  float hash13(vec3 p) {
    p = fract(p * 443.8975);
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec3 dir = normalize(vDir);
    vec3 sun = normalize(uSunDir);
    vec3 dayCol = scatter(dir, sun);

    // Sun disc (angular radius ~0.27°) with a soft edge.
    float mu = dot(dir, sun);
    if (mu > 0.4999) {
      dayCol += vec3(18.0) * smoothstep(0.99988, 0.99997, mu);
    }

    float nightness = smoothstep(1.0, -7.0, degrees(asin(sun.y))); // 0 day → 1 night

    // Stars: only above the horizon, fading in through dusk.
    vec3 nightCol = vec3(0.002, 0.003, 0.006);
    if (dir.y > 0.0 && nightness > 0.15) {
      vec3 cell = floor(dir * 220.0);
      float h = hash13(cell);
      if (h > 0.995) {
        float mag = (h - 0.995) / 0.005;
        nightCol += vec3(0.8, 0.85, 1.0) * mag * mag * 1.4 * nightness;
      }
    }
    // Full-moon approximation at the solar antipode (§28 for real ephemeris).
    vec3 moon = -sun;
    float mmu = dot(dir, moon);
    if (moon.y > -0.1 && mmu > 0.4999) {
      nightCol += vec3(0.9, 0.92, 0.95) * smoothstep(0.99985, 0.99996, mmu) * nightness;
      nightCol += vec3(0.04, 0.045, 0.06) * smoothstep(0.9995, 0.99985, mmu) * nightness;
    }

    vec3 col = mix(dayCol, nightCol + dayCol * 0.15, nightness);
    gl_FragColor = vec4(col, 1.0);
  }
`

export class SkyDome {
  readonly sunDir = new THREE.Vector3(0, 1, 0)

  private readonly material: THREE.ShaderMaterial
  private readonly sunLight = new THREE.DirectionalLight(0xffffff, 3)
  private readonly hemiLight = new THREE.HemisphereLight(0x8fb4dd, 0x1c2a38, 0.5)

  /** Current sun elevation in degrees, for HUD/debug. */
  elevationDeg = 0

  /** Shadow frustum half-extent (m): tight box around the aircraft. */
  private static readonly SHADOW_HALF = 120
  private readonly shadowTarget = new THREE.Vector3()

  constructor(scene: THREE.Scene) {
    // 13a: the sun casts real shadows onto MeshStandardMaterial receivers
    // (aircraft/runways/catcher). The custom terrain shader does NOT
    // receive shadow maps — recorded deviation; the catcher approximates.
    this.sunLight.castShadow = true
    this.sunLight.shadow.mapSize.set(2048, 2048)
    const half = SkyDome.SHADOW_HALF
    const cam = this.sunLight.shadow.camera
    cam.left = -half
    cam.right = half
    cam.top = half
    cam.bottom = -half
    cam.near = 50
    cam.far = 1400
    this.sunLight.shadow.bias = -0.0004
    this.sunLight.shadow.normalBias = 0.5
    scene.add(this.sunLight.target)

    this.material = new THREE.ShaderMaterial({
      uniforms: { uSunDir: { value: new THREE.Vector3(0, 1, 0) } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
    })
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material)
    dome.scale.setScalar(900_000)
    dome.frustumCulled = false
    dome.renderOrder = -10
    scene.add(dome, this.sunLight, this.hemiLight)
  }

  /** Position the sun for `date` at (lat, lon); returns the sun direction. */
  update(date: Date, latDeg: number, lonDeg: number): THREE.Vector3 {
    const angles = sunPosition(date, latDeg, lonDeg)
    this.elevationDeg = angles.elevationDeg
    const d = sunDirectionENU(angles)
    this.sunDir.set(d.x, d.y, d.z)

    ;(this.material.uniforms.uSunDir!.value as THREE.Vector3).copy(this.sunDir)
    // Directional lights use only direction; sit the light 600 m sunward of
    // the tracked target so the shadow depth range stays tight.
    this.sunLight.position.copy(this.shadowTarget).addScaledVector(this.sunDir, 600)
    this.sunLight.target.position.copy(this.shadowTarget)

    // Ramp direct light through twilight (-6° civil twilight → +10° full day).
    const dayness = smoothstep(-6, 10, angles.elevationDeg)
    this.sunLight.intensity = 3 * dayness
    // Moonlit floor at night (matches the shader's permanent full moon).
    this.hemiLight.intensity = 0.06 + 0.5 * dayness

    return this.sunDir
  }

  /** Track the shadow frustum on the aircraft, snapped to shadow-map
   *  texels in the light's plane so the shadow doesn't shimmer as the
   *  aircraft moves (standard cascaded-shadow trick, single cascade). */
  setShadowTarget(worldPos: THREE.Vector3): void {
    const texel = (2 * SkyDome.SHADOW_HALF) / 2048
    // Build the light-plane basis (right/up ⊥ sunDir).
    const up = Math.abs(this.sunDir.y) > 0.95 ? _X_AXIS : _Y_AXIS
    _right.crossVectors(up, this.sunDir).normalize()
    _up2.crossVectors(this.sunDir, _right)
    const r = worldPos.dot(_right)
    const u = worldPos.dot(_up2)
    const rs = Math.round(r / texel) * texel
    const us = Math.round(u / texel) * texel
    this.shadowTarget
      .copy(worldPos)
      .addScaledVector(_right, rs - r)
      .addScaledVector(_up2, us - u)
  }
}

const _X_AXIS = new THREE.Vector3(1, 0, 0)
const _Y_AXIS = new THREE.Vector3(0, 1, 0)
const _right = new THREE.Vector3()
const _up2 = new THREE.Vector3()

function smoothstep(lo: number, hi: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}
