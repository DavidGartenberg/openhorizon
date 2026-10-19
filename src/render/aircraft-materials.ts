import * as THREE from 'three'

// Native model geometries are expressed in meters. Triplanar skin coordinates
// follow each moving part, without UV seams, textures, or extra draw calls.
const skinGLSL = /* glsl */`
varying vec3 vAircraftSkinPosition;
varying vec3 vAircraftSkinNormal;
float skinHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// Smooth, mean-centered finish variation; unresolved patches converge to the
// base material instead of introducing distant speckle.
float skinNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float n = mix(mix(skinHash(cell), skinHash(cell + vec2(1.0, 0.0)), u.x),
                mix(skinHash(cell + vec2(0.0, 1.0)), skinHash(cell + vec2(1.0)), u.x), u.y);
  return (n - 0.5) * (1.0 - smoothstep(0.3, 1.0, length(fwidth(p))));
}
float skinFilteredWave(float phase) {
  // Fade before the phase spans half a cycle per pixel. Applying this per
  // frequency preserves the coarser grain as the finer scratches disappear.
  return sin(phase) * (1.0 - smoothstep(0.7, 2.8, fwidth(phase)));
}
float skinBrushedGrain(vec2 p) {
  // Micron relief runs along the first projection axis, with two nonharmonic
  // scratch pitches and slowly wandering strokes rather than a regular grid.
  float drift = sin(p.x * 7.0) + 0.4 * sin(p.x * 17.0);
  return 0.65 * skinFilteredWave(p.y * 1700.0 + drift)
       + 0.35 * skinFilteredWave(p.y * 3107.0 + drift * 1.7);
}
vec3 skinDetail(vec2 p) {
  vec2 pitch = vec2(0.73, 1.17);
  p.x += mod(floor(p.y / pitch.y), 2.0) * 0.365;
  vec2 cell = floor(p / pitch);
  vec2 q = mod(p, pitch);
  vec2 edge = min(q, pitch - q);
  float footprint = max(length(fwidth(p)), 0.0001);
  float visible = 1.0 - smoothstep(0.007, 0.045, footprint);
  float seam = (1.0 - smoothstep(0.00065, 0.00065 + footprint, min(edge.x, edge.y))) * visible;
  // Flush fasteners run beside joints, 9 cm apart and 4 mm in diameter.
  vec2 r = vec2(abs(edge.x - 0.014), abs(mod(p.y + 0.045, 0.09) - 0.045));
  vec2 s = vec2(abs(mod(p.x + 0.045, 0.09) - 0.045), abs(edge.y - 0.014));
  float rivet = (1.0 - smoothstep(0.0015, 0.0023 + footprint, min(length(r), length(s)))) * visible;
  return vec3(seam, rivet, skinHash(cell) - 0.5);
}
`;

function skin(material: THREE.MeshPhysicalMaterial, finish: 'paint' | 'metal' | 'fabric' = 'paint'): THREE.MeshPhysicalMaterial {
  const fabric = finish === 'fabric'
  const metal = finish === 'metal'
  material.customProgramCacheKey = () => `aircraft-${finish}-v3`
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vAircraftSkinPosition;
varying vec3 vAircraftSkinNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vAircraftSkinPosition = position;
vAircraftSkinNormal = normal;`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + skinGLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 skinWeights = pow(abs(normalize(vAircraftSkinNormal)), vec3(8.0));
skinWeights /= max(dot(skinWeights, vec3(1.0)), 0.001);
vec3 skinData = ${fabric ? 'vec3(0.0)' : `skinDetail(vAircraftSkinPosition.yz) * skinWeights.x
              + skinDetail(vAircraftSkinPosition.xz) * skinWeights.y
              + skinDetail(vAircraftSkinPosition.xy) * skinWeights.z`};
float skinWave = sin(vAircraftSkinPosition.x * 10.0 + vAircraftSkinPosition.y * 6.0) * sin(vAircraftSkinPosition.z * 11.0 + vAircraftSkinPosition.y * 3.0);
float skinHeight = ${fabric ? `0.000025 * sin(vAircraftSkinPosition.x * 1800.0) * sin(vAircraftSkinPosition.y * 1800.0)
  * (1.0 - smoothstep(0.001, 0.006, length(fwidth(vAircraftSkinPosition)))) + 0.000035` : '0.00010'} * skinWave - 0.00012 * skinData.x - 0.00005 * skinData.y;
${fabric ? '' : `float skinPatina = skinNoise(vAircraftSkinPosition.yz * 1.7) * skinWeights.x
                 + skinNoise(vAircraftSkinPosition.xz * 1.7) * skinWeights.y
                 + skinNoise(vAircraftSkinPosition.xy * 1.7) * skinWeights.z;
diffuseColor.rgb *= 1.0 + skinPatina * ${metal ? '0.035' : '0.018'};`}
${metal ? `float skinGrain = skinBrushedGrain(vAircraftSkinPosition.yz) * skinWeights.x
                + skinBrushedGrain(vAircraftSkinPosition.xz) * skinWeights.y
                + skinBrushedGrain(vAircraftSkinPosition.xy) * skinWeights.z;
skinHeight += 0.000009 * skinGrain;` : ''}
${fabric ? `// Rib tapes run chordwise, .46m apart across the wing span. Only
// horizontal fabric faces receive structure, fading around curved edges.
float fabricFootprint = max(fwidth(vAircraftSkinPosition.x), 0.0001);
float fabricRibPhase = vAircraftSkinPosition.x / 0.46;
float fabricRibDistance = abs(fract(fabricRibPhase + 0.5) - 0.5) * 0.46;
float fabricTape = (1.0 - smoothstep(0.010, 0.016 + fabricFootprint, fabricRibDistance))
  * (1.0 - smoothstep(0.012, 0.070, fabricFootprint)) * skinWeights.y;
float fabricSag = 0.5 - 0.5 * cos(fabricRibPhase * 6.28318530718);
float fabricSagFilter = 1.0 - smoothstep(0.10, 0.35, fabricFootprint);
skinHeight += 0.00035 * fabricTape - 0.0018 * fabricSag * fabricSagFilter * skinWeights.y;
diffuseColor.rgb *= 1.0 + fabricTape * 0.014;` : ''}
diffuseColor.rgb *= 1.0 - skinData.x * 0.12 - skinData.y * 0.15 + skinData.z * 0.018;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + skinData.z * 0.028 + skinData.x * 0.045 ${fabric ? '- fabricTape * 0.025' : `+ skinPatina * ${metal ? '0.12 + skinGrain * 0.045' : '0.085'}`}, 0.04, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
// Screen-space surface gradient: relief follows the curvature of the part.
vec3 skinDx = dFdx(-vViewPosition), skinDy = dFdy(-vViewPosition);
vec3 skinR1 = cross(skinDy, normal), skinR2 = cross(normal, skinDx);
float skinDet = dot(skinDx, skinR1);
vec3 skinGradient = sign(skinDet) * (dFdx(skinHeight) * skinR1 + dFdy(skinHeight) * skinR2);
normal = normalize(abs(skinDet) * normal - skinGradient + normal * 1e-10);`)
  }
  return material
}

/** Gloss-coated painted aluminum; caller overrides are preserved. */
export function aircraftPaint(color: number, parameters: THREE.MeshPhysicalMaterialParameters = {}): THREE.MeshPhysicalMaterial {
  return skin(new THREE.MeshPhysicalMaterial({ color, roughness: 0.31, metalness: 0.12, clearcoat: 0.48, clearcoatRoughness: 0.23, ...parameters }))
}

export function aircraftMetal(color = 0xbcc5cc, roughness = 0.24): THREE.MeshPhysicalMaterial {
  return skin(new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0.92, clearcoat: 0.15, clearcoatRoughness: 0.25 }), 'metal')
}

export function aircraftRubber(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color: 0x191c20, roughness: 0.91, metalness: 0, sheen: 0.08, sheenRoughness: 0.9 })
}

export function aircraftFabric(color: number): THREE.MeshPhysicalMaterial {
  return skin(new THREE.MeshPhysicalMaterial({ color, roughness: 0.64, metalness: 0, clearcoat: 0, sheen: 0.24, sheenRoughness: 0.85, sheenColor: 0xd5d4ce }), 'fabric')
}
