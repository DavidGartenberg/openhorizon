import * as THREE from 'three'
import { SKY_LOOKUP } from './atmosphere-shader'
import { patchCloudShadow } from './cloud-shadows'

/**
 * What the atmosphere does to a lit material beyond the lights: cloud shadows (cloud-shadows.ts) and aerial perspective.
 * Terrain, sea and clouds haze themselves; this gives aircraft, buildings and pavement the same haze, so a far airliner
 * or terminal fades into the distance the way the ground around it does instead of standing out crisp against it.
 * The formula is the terrain shader's: an exponential height-density integrated along the view segment, mixed toward the sky's
 * radiance in the view direction, in linear light before tone mapping.
 */

/** Shared uniform objects: the sky lookup (set once) and the haze density the terrain uses (written every frame). */
export const aerialUniforms = {
  uAerialSky: { value: null as THREE.Texture | null },
  uAerialDensity: { value: 9e-6 },
}

export const AERIAL_PERSPECTIVE_GLSL = /* glsl */ `
uniform sampler2D uAerialSky;
uniform float uAerialDensity;
${SKY_LOOKUP}
vec3 aerialHaze(vec3 color, vec3 worldPos) {
  vec3 toPoint = worldPos - cameraPosition;
  float distance = length(toPoint);
  if (distance < 20.0) return color;
  vec3 direction = toPoint / distance;
  vec3 hazeDir = normalize(vec3(direction.x, max(direction.y, 0.015), direction.z));
  float h0 = max(cameraPosition.y, 0.0) / 8000.0;
  float h1 = max(worldPos.y, 0.0) / 8000.0;
  float dh = h1 - h0;
  float meanDensity = abs(dh) < 0.01 ? exp(-0.5 * (h0 + h1)) : (exp(-h0) - exp(-h1)) / dh;
  float fog = 1.0 - exp(-distance * uAerialDensity * meanDensity);
  return mix(color, skyRadiance(uAerialSky, hazeDir), fog);
}
`

/** Cloud shadows and aerial perspective for a built-in lit material's shader (inside onBeforeCompile). A no-op for unlit shaders. */
export function patchAtmosphere(shader: THREE.WebGLProgramParametersWithUniforms): void {
  patchCloudShadow(shader)
  if (!shader.fragmentShader.includes('vCloudShadowWorld') || shader.fragmentShader.includes('aerialHaze(')) return
  if (!shader.fragmentShader.includes('#include <tonemapping_fragment>')) return
  Object.assign(shader.uniforms, aerialUniforms)
  shader.fragmentShader = shader.fragmentShader
    .replace('uniform sampler2D uCloudShadowMap;', `${AERIAL_PERSPECTIVE_GLSL}\nuniform sampler2D uCloudShadowMap;`)
    .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = aerialHaze( gl_FragColor.rgb, vCloudShadowWorld );\n#include <tonemapping_fragment>')
}

let installed = false
/** Every built-in lit material without its own onBeforeCompile gets the atmosphere; ones that patch their shader themselves call
 * patchAtmosphere at the end. Install before the first render. */
export function installAtmosphereMaterials(): void {
  if (installed) return
  installed = true
  THREE.Material.prototype.onBeforeCompile = function atmosphereDefault(shader: THREE.WebGLProgramParametersWithUniforms) { patchAtmosphere(shader) }
}
