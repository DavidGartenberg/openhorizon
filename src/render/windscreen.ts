import * as THREE from 'three'

/**
 * Windscreen weather: rain drops and frost on cockpit glazing.
 *
 * Drops live on a jittered cell lattice in flow-aligned coordinates. Each
 * cell holds at most one drop of random size and lifetime. Below ~20 kt the
 * drops bead and creep down under gravity. With airspeed they are blown
 * along the flow (up the windshield, aft along side windows), stretch into
 * streaks and move faster; columns run at different speeds so the pattern
 * never slides as one sheet. A drop is shaded like a tiny lens: a brighter
 * core, a darker meniscus rim and a highlight. Frost (unheated glazing below
 * freezing) grows from the frame inward as feathery, noise-broken crystals.
 * All panes share one uniform block, updated once per frame.
 */
export const WINDSCREEN_WEATHER = {
  uTime: { value: 0 },
  /** Rain intensity 0..1. */
  uRain: { value: 0 },
  /** Frost / ice coverage 0..1. */
  uIce: { value: 0 },
  /** True airspeed, m/s. */
  uSpeed: { value: 0 },
  /** Ambient light 0..1 (night dims the drops). */
  uLight: { value: 1 },
}

export function windscreenMaterial(flow: 'up' | 'aft', tint = 0x9fb4c4, baseOpacity = 0.12): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...WINDSCREEN_WEATHER,
      uTint: { value: new THREE.Color(tint) },
      uBase: { value: baseOpacity },
      // Airflow direction in UV space (u forward→aft / inboard→outboard, v up).
      uAir: { value: flow === 'up' ? new THREE.Vector2(0, 1) : new THREE.Vector2(1, 0.18).normalize() },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uRain, uIce, uSpeed, uLight, uBase;
      uniform vec3 uTint;
      uniform vec2 uAir;
      varying vec2 vUv;
      float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      vec2 h2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h1(i), h1(i + vec2(1, 0)), f.x), mix(h1(i + vec2(0, 1)), h1(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        vec3 color = uTint * (0.25 + 0.75 * uLight);
        float alpha = uBase;
        // ---- rain ----
        if (uRain > 0.001) {
          // Flow: gravity (down) at rest, the airflow above ~20 kt.
          float blow = smoothstep(8.0, 30.0, uSpeed);
          vec2 dir = normalize(mix(vec2(0.0, -1.0), uAir, blow));
          vec2 side = vec2(-dir.y, dir.x);
          float speed = mix(0.03, 0.04 + uSpeed * 0.012, blow); // uv/s
          float stretch = 1.0 + blow * clamp(uSpeed / 25.0, 0.0, 5.0);
          vec2 q = vec2(dot(vUv, side), dot(vUv, dir)) * vec2(26.0, 26.0 / stretch);
          float col = floor(q.x);
          q.y -= uTime * speed * (26.0 / stretch) * (0.55 + 0.9 * h1(vec2(col, 7.0)));
          vec2 cell = floor(q);
          vec2 f = fract(q) - 0.5;
          float present = step(1.0 - uRain * 0.85, h1(cell + 3.1));
          vec2 jit = (h2(cell) - 0.5) * 0.55;
          float r = mix(0.12, 0.34, h1(cell + 9.7)) * (0.7 + 0.3 * uRain);
          vec2 d = f - jit;
          float dist = length(vec2(d.x, d.y / (1.0 + 0.15 * stretch)));
          float drop = present * smoothstep(r, r * 0.55, dist);
          float rim = present * smoothstep(r * 0.55, r, dist) * smoothstep(r * 1.05, r * 0.85, dist);
          float spec = present * smoothstep(r * 0.35, 0.0, length(d - vec2(-0.25, 0.25) * r));
          vec3 water = vec3(0.82, 0.88, 0.93) * (0.3 + 0.7 * uLight);
          color = mix(color, water, drop * 0.55);
          color *= 1.0 - rim * 0.35;
          color += vec3(1.0) * spec * 0.6 * uLight;
          alpha = max(alpha, (drop * 0.42 + rim * 0.35 + spec * 0.5) * uRain + alpha);
          // A faint sheet of water when it really pours.
          alpha += uRain * uRain * 0.05;
        }
        // ---- frost from the frame inward ----
        if (uIce > 0.001) {
          float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
          float crystals = vnoise(vUv * 38.0) * 0.6 + vnoise(vUv * 110.0) * 0.4;
          float feather = abs(fract(vnoise(vUv * 14.0) * 6.0) - 0.5);
          float reach = uIce * 0.55;
          float frost = smoothstep(reach, reach - 0.18, edge - crystals * 0.18 + feather * 0.05);
          vec3 iceColor = vec3(0.86, 0.92, 0.97) * (0.35 + 0.65 * uLight);
          color = mix(color, iceColor, frost * 0.9);
          alpha = mix(alpha, 0.88, frost * clamp(uIce * 1.4, 0.0, 1.0));
        }
        gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.95));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
}
