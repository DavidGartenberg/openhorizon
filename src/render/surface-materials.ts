import * as THREE from 'three'

/** Pavement detail in geometry-local metres: survives floating-origin moves.
 * No texture requests or extra passes. Fine detail fades at its pixel footprint
 * instead of turning into a sparkling pattern at a grazing approach angle. */
export function pavementMaterial(color: number, plane: 'xy' | 'xz', kind: 'asphalt' | 'concrete' | 'runway' = 'asphalt'): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.91, metalness: 0, envMapIntensity: 0.4 })
  material.customProgramCacheKey = () => `pavement-v2-${plane}-${kind}`
  material.onBeforeCompile = shader => {
    const runway = kind === 'runway'
    shader.vertexShader = `varying vec2 vPavement;
${runway ? 'attribute vec2 runwayEnds; attribute vec2 runwayLat; varying vec2 vRunwayEnds; varying vec2 vRunwayLat;' : ''}
` + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
vPavement = position.${plane};
${runway ? 'vRunwayEnds = runwayEnds; vRunwayLat = runwayLat;' : ''}`)
    shader.fragmentShader = `varying vec2 vPavement;
${runway ? 'varying vec2 vRunwayEnds; varying vec2 vRunwayLat;' : ''}
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
// ---- Runway wear: measured from each actual threshold / pavement edge. ----
float endDistance = min(vRunwayEnds.x, vRunwayEnds.y);
float edgeDistance = (1.0 - abs(vRunwayLat.x)) * vRunwayLat.y;
float footprint = max(length(dFdx(pavementP)), length(dFdy(pavementP)));
float detailFade = 1.0 - smoothstep(0.25, 1.2, footprint);

// Rubber: main-gear tracks leave dark bands, heavy in the touchdown zone,
// plus a smear on the first few hundred feet where tyres spin up.
float touchdown = smoothstep(90.0, 230.0, endDistance) * (1.0 - smoothstep(420.0, 850.0, endDistance));
float spinup = smoothstep(0.0, 40.0, endDistance) * (1.0 - smoothstep(110.0, 260.0, endDistance));
float ax = abs(pavementP.x);
float trackA = exp(-pow((ax - 3.3) / 1.7, 2.0));
float trackB = exp(-pow((ax - 7.4) / 2.6, 2.0)) * 0.7;
float streak = pavementFiltered(vec2(pavementP.x * 2.7, pavementP.y * 0.09));
float streakB = pavementFiltered(vec2(pavementP.x * 1.3 + 9.0, pavementP.y * 0.05));
float rubber = touchdown * (trackA * (0.16 + 0.55 * streak * streak) + trackB * (0.08 + 0.35 * streakB * streakB)) + spinup * trackA * 0.18;
pavementTone *= 1.0 - clamp(rubber, 0.0, 0.62);

// Repair patches: a few rectangular panels a shade lighter/darker than the field.
vec2 patchCell = floor(vec2(pavementP.x / 9.0, pavementP.y / 38.0));
float patchR = pavementHash(patchCell + 17.0);
vec2 patchF = fract(vec2(pavementP.x / 9.0, pavementP.y / 38.0));
vec2 patchEdge = min(patchF, 1.0 - patchF) * vec2(9.0, 38.0);
float patchLine = 1.0 - smoothstep(0.0, 0.07 + footprint, min(patchEdge.x, patchEdge.y));
float isPatch = step(0.78, patchR);
pavementTone *= 1.0 + isPatch * ((patchR - 0.78) * 0.9 * (pavementHash(patchCell + 3.0) > 0.5 ? 1.0 : -1.2));
pavementTone *= 1.0 - isPatch * patchLine * 0.22 * detailFade;

// Paving-lane joints every 7.62 m (25 ft) along the runway, hairline dark seams.
float laneEdge = abs(fract(pavementP.x / 7.62 + 0.5) - 0.5) * 7.62;
float lane = 1.0 - smoothstep(0.015, 0.04 + footprint * 1.4, laneEdge);
pavementTone *= 1.0 - lane * 0.14 * detailFade;

// Hairline cracks: contour lines of a stretched noise field, kept away from bands of patch repair.
float crackN = pavementNoise(pavementP * vec2(0.55, 0.22) + vec2(3.1, 8.7));
float crack = 1.0 - smoothstep(0.0, 0.010 + footprint * 0.02, abs(crackN - 0.5));
float crackN2 = pavementNoise(pavementP * vec2(1.9, 1.3) + vec2(41.0, 5.0));
float crack2 = 1.0 - smoothstep(0.0, 0.012 + footprint * 0.03, abs(crackN2 - 0.5));
pavementTone *= 1.0 - (crack * 0.35 + crack2 * 0.18 * step(0.55, pavementWeather)) * detailFade;

// Oil / jet-blast staining along the centreline, lighter bleached edges.
float oil = exp(-pow(pavementP.x / 1.6, 2.0)) * (0.45 + 0.55 * pavementFiltered(vec2(pavementP.x * 3.0, pavementP.y * 0.12)));
pavementTone *= 1.0 - 0.14 * oil * smoothstep(60.0, 300.0, endDistance);
float edgeBleach = 1.0 - smoothstep(0.0, 4.5, edgeDistance);
pavementTone *= 1.0 + 0.16 * edgeBleach * (0.6 + 0.4 * pavementMottle);
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
