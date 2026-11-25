import * as THREE from 'three'
import { MATERIAL_PACKS, materialFinishUniforms, materialPackTexture, type MaterialPack } from './material-packs'

const declaration = /* glsl */`
uniform sampler2D uOhFinishMap;
uniform float uOhFinishQuality, uOhFinishWear, uOhFinishTile, uOhFinishBump, uOhFinishTone, uOhFinishRoughness;
varying vec3 vOhFinishPosition, vOhFinishNormal;
vec4 ohFinishSample(vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(6.0)); w /= max(w.x + w.y + w.z, 0.00001);
  return texture2D(uOhFinishMap, p.yz) * w.x + texture2D(uOhFinishMap, p.xz) * w.y + texture2D(uOhFinishMap, p.xy) * w.z;
}
vec3 ohFinishPerturb(vec3 n, float h) {
  vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
  vec3 r1 = cross(dy, n), r2 = cross(n, dx);
  float determinant = dot(dx, r1);
  vec3 gradient = sign(determinant) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(determinant) * n - gradient + n * 1e-12);
}
`

/** Adds a shared fine-detail layer, preserving authored maps, all earlier
 * shader patches, and the material's ownership of those existing resources. */
export function withSurfaceFinish<T extends THREE.MeshStandardMaterial>(material: T, kind: MaterialPack | 'authored-paint'): T {
  if (material.userData.surfaceFinish) return material
  const pack = kind === 'authored-paint' ? 'paint' : kind
  material.userData.surfaceFinish = pack
  const previousCompile = material.onBeforeCompile, previousKey = material.customProgramCacheKey
  material.onBeforeCompile = (shader, renderer) => {
    Object.assign(shader.uniforms, materialFinishUniforms, {
      uOhFinishMap: { value: materialPackTexture(pack) },
      uOhFinishTile: { value: MATERIAL_PACKS[pack].tileM }, uOhFinishBump: { value: MATERIAL_PACKS[pack].bumpM },
      uOhFinishTone: { value: MATERIAL_PACKS[pack].tone }, uOhFinishRoughness: { value: MATERIAL_PACKS[pack].roughness },
    })
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOhFinishPosition, vOhFinishNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOhFinishPosition = position; vOhFinishNormal = normal;')
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${declaration}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
vec4 ohFinish = vec4(0.5);
if (uOhFinishQuality > 0.5) {
  ohFinish = ohFinishSample(vOhFinishPosition / uOhFinishTile, normalize(vOhFinishNormal));
  if (uOhFinishQuality > 1.5) {
    vec4 fine = ohFinishSample(vOhFinishPosition / uOhFinishTile * 3.0 + vec3(0.23, 0.41, 0.17), normalize(vOhFinishNormal));
    ohFinish = mix(ohFinish, fine, 0.22);
  }
}
float ohFinishFootprint = length(fwidth(vOhFinishPosition / uOhFinishTile));
float ohFinishVisible = 1.0 - smoothstep(0.3, 1.3, ohFinishFootprint);
float ohFinishHeight = (ohFinish.b - 0.5) * uOhFinishBump * ohFinishVisible;
diffuseColor.rgb *= 1.0 + (ohFinish.r - 0.5) * uOhFinishTone * (0.6 + uOhFinishWear);
diffuseColor.rgb *= 1.0 - uOhFinishWear * 0.035 * ohFinish.a;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + (ohFinish.g - 0.5) * uOhFinishRoughness + uOhFinishWear * ohFinish.a * 0.045, 0.04, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = ohFinishPerturb(normal, ohFinishHeight);`)
      .replace('#include <clearcoat_normal_fragment_maps>', `#include <clearcoat_normal_fragment_maps>
#ifdef USE_CLEARCOAT
if (uOhFinishQuality > 1.5) clearcoatNormal = ohFinishPerturb(clearcoatNormal, ohFinishHeight * 0.25);
#endif`)
    // Earlier patches can expand include chunks (OBJ8 reconstructs normals and
    // gloss channels). Install our additions first so those patches retain them.
    previousCompile.call(material, shader, renderer)
  }
  material.customProgramCacheKey = () => `${previousKey.call(material)}|surface-finish:${pack}:v1`
  return material
}
