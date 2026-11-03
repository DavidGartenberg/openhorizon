import * as THREE from 'three'

/** Instanced soft puffs for touchdown tyre smoke: they grow, drift with the
 *  wind, rise a little and fade over ~2.5 s. Fixed pool, no per-frame allocation. */
const MAX = 96
const LIFE_MS = 2500

export class TireSmoke {
  private readonly mesh: THREE.InstancedMesh
  private readonly born = new Float64Array(MAX).fill(-Infinity)
  private readonly pos = new Float32Array(MAX * 3)
  private readonly size = new Float32Array(MAX)
  private next = 0
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly v = new THREE.Vector3()
  private readonly s = new THREE.Vector3()
  private readonly opacity: THREE.InstancedBufferAttribute

  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(1, 1)
    this.opacity = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1)
    geo.setAttribute('aOpacity', this.opacity)
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uLight: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aOpacity;
        varying vec2 vUv;
        varying float vOpacity;
        void main() {
          vUv = uv;
          vOpacity = aOpacity;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uLight;
        varying vec2 vUv;
        varying float vOpacity;
        void main() {
          float r = length(vUv - 0.5);
          float a = vOpacity * smoothstep(0.5, 0.1, r);
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.82, 0.82, 0.8) * (0.3 + 0.7 * uLight), a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    })
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.mesh.renderOrder = 6
    scene.add(this.mesh)
  }

  /** Emit puffs at world points (the main wheels) with strength 0..1. */
  emit(points: THREE.Vector3[], strength: number, nowMs: number): void {
    if (strength <= 0) return
    const per = Math.max(2, Math.round(6 * strength))
    for (const p of points) for (let k = 0; k < per; k++) {
      const i = this.next
      this.next = (this.next + 1) % MAX
      this.born[i] = nowMs + k * 25
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * 0.6
      this.pos[i * 3 + 1] = p.y + 0.2
      this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.6
      this.size[i] = (0.8 + Math.random() * 0.6) * (0.6 + strength)
    }
  }

  /** Billboard toward the camera, drift with `wind` (render frame, m/s). */
  update(nowMs: number, camera: THREE.Camera, wind: THREE.Vector3, light: number): void {
    ;(this.mesh.material as THREE.ShaderMaterial).uniforms.uLight!.value = light
    camera.getWorldQuaternion(this.q)
    let n = 0
    for (let i = 0; i < MAX; i++) {
      const age = nowMs - this.born[i]!
      if (age < 0 || age > LIFE_MS) continue
      const t = age / 1000
      this.v.set(this.pos[i * 3]! + wind.x * t, this.pos[i * 3 + 1]! + 0.4 * t, this.pos[i * 3 + 2]! + wind.z * t)
      const grow = this.size[i]! * (1 + 2.2 * Math.sqrt(t))
      this.s.setScalar(grow)
      this.m.compose(this.v, this.q, this.s)
      this.mesh.setMatrixAt(n, this.m)
      this.opacity.setX(n, 0.55 * (1 - age / LIFE_MS) ** 1.5)
      n++
    }
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
    this.opacity.needsUpdate = true
  }
}
