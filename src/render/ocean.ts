import * as THREE from 'three'

/**
 * Phase 0 ocean: a single large plane with analytic wave normals in the
 * fragment shader — fresnel toward the horizon plus sun glint. Real water
 * (land-cover masked, §6.2) comes with Phase 2's world.
 */
export class Ocean {
  private readonly material: THREE.ShaderMaterial

  constructor(scene: THREE.Scene) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uDayness: { value: 1 },
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
        varying vec3 vWorldPos;

        // Sum of three directional gerstner-ish waves; returns d(height)/d(x,z).
        vec2 waveSlope(vec2 p, float t) {
          vec2 slope = vec2(0.0);
          // wave: direction, wavelength (m), amplitude (m), speed
          slope += 0.28 * vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 0.11 + t * 1.1);
          slope += 0.18 * vec2(-0.5, 0.9) * cos(dot(p, vec2(-0.5, 0.9)) * 0.23 + t * 1.7);
          slope += 0.10 * vec2(0.2, -1.0) * cos(dot(p, vec2(0.2, -1.0)) * 0.71 + t * 2.9);
          return slope;
        }

        void main() {
          vec2 slope = waveSlope(vWorldPos.xz, uTime);
          // Fade wave slope out with distance: per-pixel phase of ~10-60 m
          // waves aliases into moiré bands beyond ~2 km (glaring from
          // altitude). Full METAR sea state is 13e; this only detunes far
          // detail the eye couldn't resolve anyway.
          float wDist = length(cameraPosition - vWorldPos);
          slope *= 1.0 / (1.0 + wDist * wDist * 2.5e-6);
          vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
          vec3 viewDir = normalize(cameraPosition - vWorldPos);

          float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);

          vec3 deep = vec3(0.016, 0.072, 0.120) * (0.15 + 0.85 * uDayness);
          vec3 horizon = mix(vec3(0.02, 0.03, 0.05), vec3(0.45, 0.62, 0.78), uDayness);
          vec3 color = mix(deep, horizon, fresnel * 0.9);

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

  update(timeSeconds: number, sunDir: THREE.Vector3, dayness: number): void {
    this.material.uniforms.uTime!.value = timeSeconds
    ;(this.material.uniforms.uSunDir!.value as THREE.Vector3).copy(sunDir)
    this.material.uniforms.uDayness!.value = dayness
  }
}
