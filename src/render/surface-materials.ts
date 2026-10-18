import * as THREE from 'three'

/** Pavement detail in geometry-local metres: survives floating-origin moves.
 * No texture requests or extra passes. Fine detail fades at its pixel footprint
 * instead of turning into a sparkling pattern at a grazing approach angle. */
export function pavementMaterial(color: number, plane: 'xy' | 'xz', kind: 'asphalt' | 'concrete' | 'runway' = 'asphalt'): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.91, metalness: 0, envMapIntensity: 0.4 })
  material.customProgramCacheKey = () => `pavement-v1-${plane}-${kind}`
  material.onBeforeCompile = shader => {
    const runway = kind === 'runway'
    shader.vertexShader = `varying vec2 vPavement;
${runway ? 'attribute vec2 runwayEnds; varying vec2 vRunwayEnds;' : ''}
` + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
vPavement = position.${plane};
${runway ? 'vRunwayEnds = runwayEnds;' : ''}`)
    shader.fragmentShader = `varying vec2 vPavement;
${runway ? 'varying vec2 vRunwayEnds;' : ''}
float pavementHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float pavementNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(pavementHash(i), pavementHash(i + vec2(1,0)), f.x),
             mix(pavementHash(i + vec2(0,1)), pavementHash(i + vec2(1,1)), f.x), f.y);
}
// Remove subpixel frequencies (including the normal perturbation).
float pavementFiltered(vec2 p) {
  float footprint = max(length(dFdx(p)), length(dFdy(p)));
  return mix(pavementNoise(p), 0.5, smoothstep(0.3, 1.5, footprint));
}
` + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
vec2 pavementP = vPavement;
float pavementGrain = pavementFiltered(pavementP * 19.0);
float pavementMottle = pavementFiltered(pavementP * 0.17 + vec2(13.7, 31.2));
float pavementWeather = pavementFiltered(pavementP * 0.035);
float pavementTone = 0.86 + 0.20 * pavementMottle + 0.15 * pavementWeather + 0.22 * (pavementGrain - 0.5);
${kind === 'concrete' ? `
// Six-metre poured slabs; derivative-softened narrow expansion joints.
vec2 jointCell = abs(fract(pavementP / 6.0 + 0.5) - 0.5) * 6.0;
vec2 jointAA = max(fwidth(pavementP), vec2(0.008));
vec2 joint = 1.0 - smoothstep(vec2(0.018), vec2(0.018) + jointAA, jointCell);
float jointFade = 1.0 - smoothstep(0.3, 2.0, max(jointAA.x, jointAA.y));
pavementTone *= 1.0 - 0.22 * max(joint.x, joint.y) * jointFade;
` : ''}
${runway ? `
// Procedural rubber deposits, measured from each actual threshold.
// Main-wheel bands leave the centerline readable; both landing directions.
float endDistance = min(vRunwayEnds.x, vRunwayEnds.y);
float touchdown = smoothstep(90.0, 230.0, endDistance) * (1.0 - smoothstep(420.0, 850.0, endDistance));
float wheelOffset = (abs(pavementP.x) - 3.2) / 2.0;
float wheelBand = exp(-wheelOffset * wheelOffset);
float streak = pavementFiltered(vec2(pavementP.x * 2.7, pavementP.y * 0.09));
pavementTone *= 1.0 - touchdown * wheelBand * (0.13 + 0.32 * streak);
` : ''}
diffuseColor.rgb *= pavementTone;`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + (pavementGrain - 0.5) * 0.1 + (pavementMottle - 0.5) * 0.08, 0.72, 1.0);`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
// Screen-space surface-gradient bump: works on both plane orientations and
// their grades without assuming a tangent attribute or allocating a map.
vec3 pavementDx = dFdx(-vViewPosition);
vec3 pavementDy = dFdy(-vViewPosition);
vec3 pavementR1 = cross(pavementDy, normal);
vec3 pavementR2 = cross(normal, pavementDx);
float pavementDet = dot(pavementDx, pavementR1);
float pavementHeight = pavementGrain * 0.0007;
normal = normalize(abs(pavementDet) * normal - sign(pavementDet) *
  (dFdx(pavementHeight) * pavementR1 + dFdy(pavementHeight) * pavementR2) + normal * 1e-10);`)
  }
  return material
}
