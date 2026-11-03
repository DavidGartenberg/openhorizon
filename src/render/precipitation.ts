import * as THREE from 'three'

/**
 * Falling rain and snow around the camera.
 *
 * A fixed set of particles lives in a box centred on the camera. Each has a
 * random seed; its position is that seed scaled to the box plus one shared
 * offset, wrapped modulo the box, all on the GPU. The CPU only integrates
 * the offset with the particles' velocity relative to the camera (fall
 * speed + wind − camera velocity), so the field is free of per-particle CPU
 * work and never runs out of drops however fast the airplane goes.
 *
 * Rain: line segments stretched along that relative velocity (a short
 * exposure, so at rest they fall as near-vertical streaks and at speed they
 * rush at the windscreen). Snow: soft, gently swaying flakes as points.
 * Intensity thins the particle count; drops fade toward the box faces so the
 * wrap is never seen; a cleared sphere around the eye keeps rain out of the
 * cockpit.
 */
const RAIN_N = 4000
const SNOW_N = 3000

export class Precipitation {
  private readonly rain: THREE.LineSegments
  private readonly snow: THREE.Points
  private readonly rainMat: THREE.ShaderMaterial
  private readonly snowMat: THREE.ShaderMaterial
  private readonly offset = new THREE.Vector3()
  private readonly rel = new THREE.Vector3()

  constructor(scene: THREE.Scene) {
    const box = new THREE.Vector3(60, 36, 60)
    const shared = { uOffset: { value: this.offset }, uBox: { value: box }, uCam: { value: new THREE.Vector3() }, uIntensity: { value: 0 }, uLight: { value: 1 }, uInner: { value: 0 } }

    // Rain: 2 vertices per drop (head, tail).
    const rg = new THREE.BufferGeometry()
    const rSeed = new Float32Array(RAIN_N * 2 * 3), rEnd = new Float32Array(RAIN_N * 2)
    for (let i = 0; i < RAIN_N; i++) {
      const s = [Math.random(), Math.random(), Math.random()]
      rSeed.set(s, i * 6); rSeed.set(s, i * 6 + 3)
      rEnd[i * 2 + 1] = 1
    }
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN_N * 2 * 3), 3))
    rg.setAttribute('aSeed', new THREE.BufferAttribute(rSeed, 3))
    rg.setAttribute('aEnd', new THREE.BufferAttribute(rEnd, 1))
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: { ...shared, uVel: { value: this.rel }, uStreak: { value: 0.03 } },
      transparent: true, depthWrite: false,
      vertexShader: /* glsl */ `
        uniform vec3 uOffset, uBox, uCam, uVel;
        uniform float uStreak, uIntensity, uInner;
        attribute vec3 aSeed;
        attribute float aEnd;
        varying float vAlpha;
        void main() {
          vec3 p = mod(aSeed * uBox + uOffset, uBox) - 0.5 * uBox;
          float keep = step(fract(aSeed.x * 7.13 + aSeed.y * 3.71 + aSeed.z * 1.37), uIntensity);
          vec3 q = p / uBox;
          float edge = 1.0 - smoothstep(0.32, 0.5, max(max(abs(q.x), abs(q.y)), abs(q.z)));
          float inner = smoothstep(uInner, uInner + 1.5, length(p));
          vAlpha = keep * edge * inner;
          vec3 wp = uCam + p - uVel * uStreak * aEnd;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uLight;
        varying float vAlpha;
        void main() {
          if (vAlpha < 0.01) discard;
          gl_FragColor = vec4(vec3(0.72, 0.76, 0.82) * (0.25 + 0.75 * uLight), vAlpha * 0.38);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    })
    this.rain = new THREE.LineSegments(rg, this.rainMat)
    this.rain.frustumCulled = false
    this.rain.visible = false
    this.rain.renderOrder = 6

    // Snow: points.
    const sg = new THREE.BufferGeometry()
    const sSeed = new Float32Array(SNOW_N * 3)
    for (let i = 0; i < SNOW_N * 3; i++) sSeed[i] = Math.random()
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SNOW_N * 3), 3))
    sg.setAttribute('aSeed', new THREE.BufferAttribute(sSeed, 3))
    this.snowMat = new THREE.ShaderMaterial({
      uniforms: { ...shared, uTime: { value: 0 }, uPixel: { value: 1 } },
      transparent: true, depthWrite: false,
      vertexShader: /* glsl */ `
        uniform vec3 uOffset, uBox, uCam;
        uniform float uIntensity, uInner, uTime, uPixel;
        attribute vec3 aSeed;
        varying float vAlpha;
        void main() {
          vec3 p = mod(aSeed * uBox + uOffset, uBox) - 0.5 * uBox;
          // Flakes sway as they fall.
          p.x += 0.35 * sin(uTime * (0.7 + aSeed.y) + aSeed.z * 31.0);
          p.z += 0.35 * cos(uTime * (0.6 + aSeed.x) + aSeed.y * 17.0);
          float keep = step(fract(aSeed.x * 7.13 + aSeed.y * 3.71 + aSeed.z * 1.37), uIntensity);
          vec3 q = p / uBox;
          float edge = 1.0 - smoothstep(0.32, 0.5, max(max(abs(q.x), abs(q.y)), abs(q.z)));
          float inner = smoothstep(uInner, uInner + 1.5, length(p));
          vAlpha = keep * edge * inner;
          vec4 mv = viewMatrix * vec4(uCam + p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uPixel * 26.0 / max(-mv.z, 0.5), 1.0, 14.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uLight;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = vAlpha * smoothstep(0.5, 0.15, length(c));
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * (0.25 + 0.75 * uLight), a * 0.85);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    })
    this.snow = new THREE.Points(sg, this.snowMat)
    this.snow.frustumCulled = false
    this.snow.visible = false
    this.snow.renderOrder = 6
    scene.add(this.rain, this.snow)
  }

  /**
   * @param kind which precipitation falls (or none)
   * @param intensity 0..1
   * @param camVel camera velocity (render frame, m/s); wind: air-mass velocity (render frame)
   * @param inCockpit clear a sphere around the eye so rain stays outside
   */
  update(dt: number, timeS: number, camera: THREE.Camera, kind: 'none' | 'rain' | 'snow', intensity: number,
    camVel: THREE.Vector3, wind: THREE.Vector3, light: number, inCockpit: boolean, pixelRatio = 1): void {
    const on = kind !== 'none' && intensity > 0.01
    this.rain.visible = on && kind === 'rain'
    this.snow.visible = on && kind === 'snow'
    if (!on) return
    const fall = kind === 'rain' ? -8 : -1.2
    // Particle velocity relative to the camera.
    this.rel.set(wind.x - camVel.x, fall + wind.y - camVel.y, wind.z - camVel.z)
    this.offset.addScaledVector(this.rel, Math.min(Math.max(dt, 0), 0.1))
    for (const m of [this.rainMat, this.snowMat]) {
      const u = m.uniforms
      ;(u.uCam!.value as THREE.Vector3).copy(camera.getWorldPosition(new THREE.Vector3()))
      u.uIntensity!.value = Math.min(1, intensity)
      u.uLight!.value = light
      u.uInner!.value = inCockpit ? 3 : 0
    }
    this.snowMat.uniforms.uTime!.value = timeS
    this.snowMat.uniforms.uPixel!.value = pixelRatio
    // Short exposure at speed so streaks stay streaks, not lines across the sky.
    this.rainMat.uniforms.uStreak!.value = Math.min(0.03, 1.2 / Math.max(this.rel.length(), 1))
  }

  /** Floating-origin rebase is irrelevant: the field is camera-relative. */
  onRebase(): void {}
}
