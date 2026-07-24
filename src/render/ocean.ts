import * as THREE from 'three'
import { seaState } from '../sim/weather/sea-state'

/**
 * Ocean (Phase 0 plane, 13e sea state): a single large plane with
 * analytic wave normals — fresnel toward the horizon plus sun glint.
 * 13e drives it from the METAR surface wind: wave slope scales with
 * wind (glassy under light air), the wave field is rotated so the
 * primary set runs downwind, and whitecap foam patches appear above
 * ~15 kt, advecting with the wind. Wave slope and foam both fade with
 * distance — per-pixel phase of 10–60 m waves aliases into moiré from
 * altitude (13b finding). Real water masking stays §6.2/§28 territory.
 */
export class Ocean {
  private readonly material: THREE.ShaderMaterial

  constructor(scene: THREE.Scene) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uDayness: { value: 1 },
        uSlopeScale: { value: 0.6 },
        uWhitecap: { value: 0 },
        uWindX: { value: 1 }, // unit vector the wind blows TOWARD (render xz)
        uWindZ: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uSunDir;
        uniform float uDayness;
        uniform float uSlopeScale;
        uniform float uWhitecap;
        uniform float uWindX;
        uniform float uWindZ;
        varying vec3 vWorldPos;

        // Sum of three directional waves in wind-aligned coordinates;
        // returns d(height)/d(x,z). Direction 1 runs straight downwind.
        // The shortest (9 m) wave gets its own faster distance rolloff —
        // it shimmers into aliasing first from altitude.
        vec2 waveSlope(vec2 p, float t, float d2m) {
          mat2 R = mat2(uWindX, uWindZ, -uWindZ, uWindX);
          vec2 d1 = R * vec2(1.0, 0.0);
          vec2 d2 = R * vec2(0.55, 0.83);
          vec2 d3 = R * vec2(0.30, -0.95);
          vec2 slope = vec2(0.0);
          slope += 0.28 * d1 * cos(dot(p, d1) * 0.11 + t * 1.1);
          slope += 0.18 * d2 * cos(dot(p, d2) * 0.23 + t * 1.7);
          slope += (1.0 / (1.0 + d2m * 2.0e-5)) * 0.10 * d3 * cos(dot(p, d3) * 0.71 + t * 2.9);
          return slope * uSlopeScale;
        }

        void main() {
          float wDist = length(cameraPosition - vWorldPos);
          vec2 slope = waveSlope(vWorldPos.xz, uTime, wDist * wDist);
          // Global rolloff on top (13b): kills the remaining moiré band.
          float att = 1.0 / (1.0 + wDist * wDist * 2.5e-6);
          slope *= att;
          vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
          vec3 viewDir = normalize(cameraPosition - vWorldPos);

          float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);

          vec3 deep = vec3(0.016, 0.072, 0.120) * (0.15 + 0.85 * uDayness);
          vec3 horizon = mix(vec3(0.02, 0.03, 0.05), vec3(0.45, 0.62, 0.78), uDayness);
          vec3 color = mix(deep, horizon, fresnel * 0.9);

          // Whitecaps (13e): foam patches advecting downwind, gated on
          // wind (>~15 kt), sitting on the steeper parts of the swell.
          if (uWhitecap > 0.001) {
            vec2 adv = vWorldPos.xz - vec2(uWindX, uWindZ) * uTime * 1.6;
            float h = fract(sin(dot(floor(adv / 12.0), vec2(127.1, 311.7))) * 43758.5453);
            float slopeMag = length(slope);
            // Sparse flecks (top ~8% of cells) riding wave crests; att²
            // kills sub-pixel foam before it smears into a milky wash.
            float foam = uWhitecap
              * smoothstep(0.90, 0.97, h)
              * smoothstep(0.16, 0.30, slopeMag)
              * att * att;
            color = mix(color, vec3(0.90, 0.94, 0.97) * (0.25 + 0.75 * uDayness), clamp(foam, 0.0, 0.5));
          }

          // Sun glint
          vec3 reflected = reflect(-viewDir, n);
          float glint = pow(max(dot(reflected, normalize(uSunDir)), 0.0), 240.0);
          color += vec3(1.0, 0.9, 0.7) * glint * 2.0 * uDayness;

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    })

    const geometry = new THREE.PlaneGeometry(800_000, 800_000, 1, 1)
    const mesh = new THREE.Mesh(geometry, this.material)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = 0
    scene.add(mesh)
  }

  update(timeSeconds: number, sunDir: THREE.Vector3, dayness: number, windMs: number, windTowardRad: number): void {
    this.material.uniforms.uTime!.value = timeSeconds
    ;(this.material.uniforms.uSunDir!.value as THREE.Vector3).copy(sunDir)
    this.material.uniforms.uDayness!.value = dayness
    const s = seaState(windMs)
    this.material.uniforms.uSlopeScale!.value = s.slopeScale
    this.material.uniforms.uWhitecap!.value = s.whitecap
    // Bearing → render-frame xz unit vector (x = east, z = south).
    this.material.uniforms.uWindX!.value = Math.sin(windTowardRad)
    this.material.uniforms.uWindZ!.value = -Math.cos(windTowardRad)
  }
}
