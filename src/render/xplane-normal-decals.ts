import * as THREE from 'three'
import { materialFinishUniforms } from './material-packs'

export interface Obj8NormalDecal {
  slot: 0 | 1
  texture: string
  scale: number
  rgba: [number, number, number, number]
  modulator: number
  constant: number
  gloss: number
}

export interface LoadedObj8NormalDecal extends Obj8NormalDecal { map: THREE.Texture }

/** See Laminar's Standard Shading Options: non-projected decals repeat in
 * albedo UV space. This covers the constant, RGBA-keyed and six-weight forms.
 * https://developer.x-plane.com/?article=standard-shading-options-for-x-plane-10-scenery
 */
export function parseObj8NormalDecal(tokens: string[], slot: 0 | 1): Obj8NormalDecal | null {
  const param = tokens[0] === 'NORMAL_DECAL_PARAMS'
  const keyed = param || tokens[0] === 'NORMAL_DECAL_KEYED'
  const fileAt = param ? 8 : keyed ? 6 : 2
  if (tokens.length < fileAt + 2) return null
  const scale = Number(tokens[1]), gloss = Number(tokens.at(-1))
  const rgba = (keyed ? tokens.slice(2, 6).map(Number) : [0, 0, 0, 0]) as Obj8NormalDecal['rgba']
  const modulator = param ? Number(tokens[6]) : 0
  const constant = param ? Number(tokens[7]) : keyed ? 0 : 1
  const texture = tokens.slice(fileAt, -1).join(' ')
  if (!texture || !(scale > 0 && scale <= 65536) || !(gloss >= 0 && gloss <= 1)
    || ![...rgba, modulator, constant].every(v => Number.isFinite(v) && Math.abs(v) <= 65536)) return null
  return { slot, texture, scale, rgba, modulator, constant, gloss }
}

const tangentBlend = /* glsl */`
vec3 xpDecalPerturb(vec3 viewPoint, vec3 n, vec2 uv, vec2 slope) {
  vec3 dx = dFdx(viewPoint), dy = dFdy(viewPoint);
  vec2 du = dFdx(uv), dv = dFdy(uv);
  vec3 t = cross(dy, n) * du.x + cross(n, dx) * dv.x;
  vec3 b = cross(dy, n) * du.y + cross(n, dx) * dv.y;
  float metric = max(dot(t, t), dot(b, b));
  if (metric <= 0.0) return n;
  slope *= min(1.0, 0.99 / max(length(slope), 0.00001));
  float z = sqrt(max(1.0 - dot(slope, slope), 0.00001));
  return normalize(n * z + (t * slope.x + b * slope.y) * inversesqrt(metric));
}
`

/** Layer detail on top of the loaded albedo, normal and gloss maps. Shader
 * snippets go immediately after the stock chunks and before the procedural
 * finish, so neither replaces the other. Derive the decal tangent frame from
 * the raw OBJ UVs rather than inheriting a reflected DDS normal-map basis. */
export function patchObj8NormalDecals(shader: THREE.WebGLProgramParametersWithUniforms,
  decals: readonly LoadedObj8NormalDecal[], modulator?: THREE.Texture | null): void {
  if (!decals.length) return
  shader.uniforms.uXpDecalQuality = materialFinishUniforms.uOhFinishQuality
  let declarations = 'varying vec2 vXpDecalUv;\nuniform float uXpDecalQuality;\n'
  if (modulator) {
    if (modulator.matrixAutoUpdate) modulator.updateMatrix()
    shader.uniforms.uXpDecalModulator = { value: modulator }
    shader.uniforms.uXpDecalMaskMatrix = { value: modulator.matrix }
    declarations += 'uniform sampler2D uXpDecalModulator;\nuniform mat3 uXpDecalMaskMatrix;\n'
  }
  let weights = '', sample = '', roughness = ''
  for (const d of decals) {
    const i = d.slot
    if (d.map.matrixAutoUpdate) d.map.updateMatrix()
    Object.assign(shader.uniforms, {
      [`uXpDecalMap${i}`]: { value: d.map }, [`uXpDecalMatrix${i}`]: { value: d.map.matrix },
      [`uXpDecalRgba${i}`]: { value: new THREE.Vector4(...d.rgba) }, [`uXpDecalScale${i}`]: { value: d.scale },
      [`uXpDecalModulatorWeight${i}`]: { value: d.modulator }, [`uXpDecalConstant${i}`]: { value: d.constant },
      [`uXpDecalGloss${i}`]: { value: d.gloss },
    })
    declarations += `uniform sampler2D uXpDecalMap${i}; uniform mat3 uXpDecalMatrix${i};
uniform vec4 uXpDecalRgba${i}; uniform float uXpDecalScale${i}, uXpDecalModulatorWeight${i}, uXpDecalConstant${i}, uXpDecalGloss${i};\n`
    weights += `float xpDecalAmount${i} = 0.0;\n`
    // Slot order is the authored order, even when another tile did not load.
    sample += `xpDecalAmount${i} = clamp(dot(xpDecalAlbedo, uXpDecalRgba${i}) + xpDecalMask.${i === 0 ? 'r' : 'g'} * uXpDecalModulatorWeight${i} + uXpDecalConstant${i}, 0.0, 1.0);
vec2 xpDecalCoord${i} = (uXpDecalMatrix${i} * vec3(vXpDecalUv * uXpDecalScale${i}, 1.0)).xy;
xpDecalSlope += xpDecalAmount${i} * (texture2D(uXpDecalMap${i}, xpDecalCoord${i}).rg * 2.0 - 1.0);\n`
    roughness += `roughnessFactor = mix(roughnessFactor, clamp(1.0 - uXpDecalGloss${i}, 0.045, 1.0), xpDecalAmount${i});\n`
  }
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vXpDecalUv;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvXpDecalUv = uv;')
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${declarations}${tangentBlend}`)
    .replace('#include <map_fragment>', `#include <map_fragment>
${weights}vec2 xpDecalSlope = vec2(0.0);
if (uXpDecalQuality > 0.5) {
  #ifdef USE_MAP
    vec4 xpDecalAlbedo = sampledDiffuseColor;
  #else
    vec4 xpDecalAlbedo = vec4(1.0);
  #endif
  vec2 xpDecalMask = ${modulator ? 'texture2D(uXpDecalModulator, (uXpDecalMaskMatrix * vec3(vXpDecalUv, 1.0)).xy).rg' : 'vec2(0.0)'};
  ${sample}
}`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${roughness}`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (uXpDecalQuality > 0.5) normal = xpDecalPerturb(-vViewPosition, normal, vXpDecalUv, xpDecalSlope);`)
}
