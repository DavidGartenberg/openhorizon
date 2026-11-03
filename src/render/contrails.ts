import * as THREE from 'three'
import { SKY_LOOKUP } from './atmosphere-shader'

/**
 * Condensation trails and wingtip vapour.
 *
 * Formation (pure functions, unit-tested):
 *  - Contrails follow the Schmidt–Appleman criterion in Schumann's (1996)
 *    form: exhaust mixing produces liquid saturation when the ambient
 *    temperature is below T_LM = −46.46 + 9.43·ln(G − 0.053) + 0.72·ln²(G − 0.053)
 *    (°C), with the mixing-line slope G = EI_H2O·c_p·p / (ε·Q·(1 − η)) Pa/K.
 *    For kerosene (EI 1.25, Q 43.2 MJ/kg) and propulsion efficiency η ≈ 0.3,
 *    that is about −40 °C at airliner cruise. The trail lasts seconds in dry
 *    air and minutes in moist air near a cloud layer.
 *  - Wingtip and flap-edge vortex vapour: the low pressure in a tip vortex
 *    core cools the air adiabatically; in humid air (dewpoint spread a few
 *    °C, or in cloud) at high lift it condenses into a short-lived white
 *    trail.
 *
 * Rendering: each emitter keeps a ring of world-space samples. Every frame
 * they are built into camera-facing ribbons that widen with age (turbulent
 * diffusion) and fade. The shader lights them with forward-scattering sun
 * (Henyey–Greenstein, g = 0.65) over the HDR sky's ambient, so a trail
 * glows when it is between the camera and the sun.
 */

/** Schmidt–Appleman threshold temperature (°C) at a static pressure (Pa). */
export function contrailThresholdC(pressurePa: number, propulsionEfficiency = 0.3): number {
  const EI = 1.25, cp = 1004, eps = 0.622, Q = 43.2e6
  const G = (EI * cp * pressurePa) / (eps * Q * (1 - propulsionEfficiency))
  const x = Math.log(Math.max(G - 0.053, 1e-6))
  return -46.46 + 9.43 * x + 0.72 * x * x
}

/** Contrail strength 0..1 (fades in over the last 3 °C below threshold). */
export function contrailStrength(ambientC: number, pressurePa: number): number {
  const margin = contrailThresholdC(pressurePa) - ambientC
  return Math.max(0, Math.min(1, margin / 3))
}

/** Tip-vortex vapour strength 0..1 from humidity proxy and lift. */
export function vaporStrength(dewpointSpreadC: number, inCloud: number, liftCoefficient: number, loadFactorG: number): number {
  const humid = Math.max(inCloud, Math.max(0, Math.min(1, (4 - dewpointSpreadC) / 3)))
  const lift = Math.max(0, Math.min(1, (liftCoefficient - 0.75) / 0.5)) + Math.max(0, Math.min(1, (loadFactorG - 1.6) / 1.2))
  return Math.max(0, Math.min(1, humid * lift))
}

interface Emitter {
  /** Offset in the airplane's group frame (x right, y up, z aft). */
  offset: THREE.Vector3
  kind: 'contrail' | 'vapor'
  pts: Float32Array // xyz
  born: Float32Array
  /** Strength each sample formed with. */
  str: Float32Array
  head: number
  count: number
  last: THREE.Vector3
  hasLast: boolean
}

const MAX_PTS = 200

export class Trails {
  private readonly emitters: Emitter[] = []
  private readonly geometry = new THREE.BufferGeometry()
  private readonly material: THREE.ShaderMaterial
  readonly mesh: THREE.Mesh
  private readonly pos: Float32Array
  private readonly attr: Float32Array // (across, alpha)
  private readonly idx: Uint32Array
  private readonly tmp = new THREE.Vector3()
  /** Seconds a trail sample lives (contrails); vapour is fixed short. */
  contrailLifeS = 40
  /** Distance between contrail samples (m). The sim sets it from speed ×
   *  lifetime so a trail spans its whole life within the sample ring. */
  contrailSpacingM = 20

  constructor(scene: THREE.Scene, sky: THREE.Texture, maxEmitters = 8) {
    const verts = maxEmitters * MAX_PTS * 2
    this.pos = new Float32Array(verts * 3)
    this.attr = new Float32Array(verts * 2)
    this.idx = new Uint32Array(maxEmitters * (MAX_PTS - 1) * 6)
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('trail', new THREE.BufferAttribute(this.attr, 2).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setIndex(new THREE.BufferAttribute(this.idx, 1).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setDrawRange(0, 0)
    this.material = new THREE.ShaderMaterial({
      uniforms: { uSky: { value: sky }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uDayness: { value: 1 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute vec2 trail;
        varying vec2 vTrail;
        varying vec3 vWorld;
        void main() {
          vTrail = trail;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uSky;
        uniform vec3 uSunDir;
        uniform float uDayness;
        varying vec2 vTrail;
        varying vec3 vWorld;
        ${SKY_LOOKUP}
        void main() {
          float across = vTrail.x;
          float a = exp(-3.2 * across * across) * vTrail.y;
          if (a < 0.003) discard;
          vec3 v = normalize(vWorld - cameraPosition);
          float mu = dot(v, normalize(uSunDir));
          float g = 0.65;
          float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) / 12.566;
          vec3 ambient = skyRadiance(uSky, vec3(0.0, 1.0, 0.0)) * 0.9 + skyRadiance(uSky, normalize(vec3(v.x, 0.05, v.z))) * 0.4;
          vec3 sun = vec3(1.0, 0.97, 0.92) * (0.55 + 6.0 * hg) * uDayness;
          gl_FragColor = vec4(ambient + sun, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    })
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 5
    scene.add(this.mesh)
  }

  /** Replace the emitter set (airplane change). */
  setEmitters(list: Array<{ offset: THREE.Vector3; kind: 'contrail' | 'vapor' }>): void {
    this.emitters.length = 0
    for (const e of list) {
      this.emitters.push({ offset: e.offset.clone(), kind: e.kind, pts: new Float32Array(MAX_PTS * 3), born: new Float32Array(MAX_PTS), str: new Float32Array(MAX_PTS), head: 0, count: 0, last: new THREE.Vector3(), hasLast: false })
    }
  }

  /** Standard emitter layout: engine exhausts and wingtips for a span
   *  (`tipAftM`: how far aft of the CG a swept wing's tips sit). */
  static layoutFor(spanM: number, engines: number, tipAftM = 0): Array<{ offset: THREE.Vector3; kind: 'contrail' | 'vapor' }> {
    const out: Array<{ offset: THREE.Vector3; kind: 'contrail' | 'vapor' }> = []
    const lats = engines >= 4 ? [-0.33, -0.19, 0.19, 0.33] : engines === 3 ? [-0.16, 0, 0.16] : engines === 2 ? [-0.145, 0.145] : [0]
    for (const l of lats) out.push({ offset: new THREE.Vector3(l * spanM, -1.0, 4), kind: 'contrail' })
    for (const s of [-1, 1]) out.push({ offset: new THREE.Vector3(s * spanM * 0.5, 0.3, tipAftM), kind: 'vapor' })
    return out
  }

  /** Floating-origin rebase: render x/z moved by (dx, dz). */
  onRebase(dx: number, dz: number): void {
    for (const e of this.emitters) {
      for (let i = 0; i < e.count; i++) { e.pts[i * 3] = e.pts[i * 3]! + dx; e.pts[i * 3 + 2] = e.pts[i * 3 + 2]! + dz }
      if (e.hasLast) { e.last.x += dx; e.last.z += dz }
    }
  }

  clear(): void {
    for (const e of this.emitters) { e.count = 0; e.head = 0; e.hasLast = false }
  }

  /**
   * Sample emitters and rebuild ribbons.
   * @param group the airplane's render group (world transform)
   * @param contrail / vapor strengths 0..1
   */
  update(timeS: number, group: THREE.Object3D, camera: THREE.Camera, contrail: number, vapor: number, sunDir: THREE.Vector3, dayness: number): void {
    group.updateMatrixWorld()
    const u = this.material.uniforms
    ;(u.uSunDir!.value as THREE.Vector3).copy(sunDir)
    u.uDayness!.value = dayness
    for (const e of this.emitters) {
      const strength = e.kind === 'contrail' ? contrail : vapor
      const p = this.tmp.copy(e.offset).applyMatrix4(group.matrixWorld)
      const spacing = e.kind === 'contrail' ? this.contrailSpacingM : 2
      if (strength > 0.02 && (!e.hasLast || p.distanceToSquared(e.last) > spacing * spacing)) {
        const k = e.head
        e.pts[k * 3] = p.x; e.pts[k * 3 + 1] = p.y; e.pts[k * 3 + 2] = p.z
        e.born[k] = timeS
        e.str[k] = strength
        e.head = (e.head + 1) % MAX_PTS
        e.count = Math.min(e.count + 1, MAX_PTS)
        e.last.copy(p)
        e.hasLast = true
      } else if (strength <= 0.02) {
        e.hasLast = false
      }
    }
    this.rebuild(timeS, camera)
  }

  private rebuild(timeS: number, camera: THREE.Camera): void {
    const camPos = camera.getWorldPosition(new THREE.Vector3())
    let v = 0, ii = 0
    const c = new THREE.Vector3(), prev = new THREE.Vector3(), next = new THREE.Vector3(), t = new THREE.Vector3(), toCam = new THREE.Vector3(), side = new THREE.Vector3()
    for (const e of this.emitters) {
      const life = e.kind === 'contrail' ? this.contrailLifeS : 1.6
      const n = e.count
      if (n < 2) continue
      // Oldest → newest.
      for (let j = 0; j < n; j++) {
        const k = (e.head - n + j + MAX_PTS) % MAX_PTS
        const age = timeS - e.born[k]!
        c.set(e.pts[k * 3]!, e.pts[k * 3 + 1]!, e.pts[k * 3 + 2]!)
        const kp = (e.head - n + Math.max(j - 1, 0) + MAX_PTS) % MAX_PTS
        const kn = (e.head - n + Math.min(j + 1, n - 1) + MAX_PTS) % MAX_PTS
        prev.set(e.pts[kp * 3]!, e.pts[kp * 3 + 1]!, e.pts[kp * 3 + 2]!)
        next.set(e.pts[kn * 3]!, e.pts[kn * 3 + 1]!, e.pts[kn * 3 + 2]!)
        t.subVectors(next, prev)
        if (t.lengthSq() < 1e-6) t.set(0, 0, 1)
        toCam.subVectors(camPos, c)
        side.crossVectors(t, toCam).normalize()
        const trueWidth = e.kind === 'contrail' ? 3 + 2.5 * Math.sqrt(Math.max(age, 0)) : 0.35 + 1.2 * Math.max(age, 0)
        // Never narrower than ~1.5 px: a sub-pixel ribbon aliases into dots.
        // Widen it and fade it in proportion so its brightness is conserved.
        const minWidth = toCam.length() * 0.0016
        const width = Math.max(trueWidth, minWidth)
        const coverage = trueWidth / width
        // Fade in just behind the source, out with age; trail ends taper.
        const fadeIn = e.kind === 'contrail' ? Math.min(1, age / 0.6) : Math.min(1, age / 0.08)
        const fadeOut = Math.max(0, 1 - age / life)
        const alpha = (e.kind === 'contrail' ? 0.75 : 0.5) * fadeIn * fadeOut * fadeOut * e.str[k]! * coverage
        side.multiplyScalar(width / 2)
        this.pos.set([c.x - side.x, c.y - side.y, c.z - side.z, c.x + side.x, c.y + side.y, c.z + side.z], v * 3)
        this.attr.set([-1, alpha, 1, alpha], v * 2)
        if (j > 0) {
          const a = v - 2, b = v - 1, d = v, f = v + 1
          this.idx.set([a, b, d, b, f, d], ii)
          ii += 6
        }
        v += 2
      }
    }
    this.geometry.setDrawRange(0, ii)
    ;(this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(this.geometry.getAttribute('trail') as THREE.BufferAttribute).needsUpdate = true
    this.geometry.index!.needsUpdate = true
  }
}
