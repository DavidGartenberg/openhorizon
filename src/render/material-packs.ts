import * as THREE from 'three'

export const MATERIAL_PACK_SIDE = 256
export const MATERIAL_PACKS = {
  paint: { tileM: .42, bumpM: .00006, tone: .025, roughness: .055, seed: 3 },
  metal: { tileM: .29, bumpM: .00009, tone: .038, roughness: .11, seed: 7 },
  rubber: { tileM: .13, bumpM: .00038, tone: .055, roughness: .075, seed: 11 },
  fabric: { tileM: .12, bumpM: .00028, tone: .05, roughness: .07, seed: 17 },
  cockpit: { tileM: .18, bumpM: .00017, tone: .035, roughness: .08, seed: 23 },
  asphalt: { tileM: 1.8, bumpM: .0016, tone: .095, roughness: .08, seed: 29 },
  concrete: { tileM: 2.4, bumpM: .0011, tone: .07, roughness: .065, seed: 31 },
} as const
export type MaterialPack = keyof typeof MATERIAL_PACKS
export type MaterialDetailQuality = 'performance' | 'high' | 'ultra'
export type MaterialFinishPreset = 'factory' | 'in-service' | 'weathered'

const finishState = { quality: 'high' as MaterialDetailQuality, finish: 'in-service' as MaterialFinishPreset }
export const materialFinishUniforms = { uOhFinishQuality: { value: 1 }, uOhFinishWear: { value: .35 } }
export const materialDetailSettings = () => ({ ...finishState })
export function setMaterialDetailQuality(quality: MaterialDetailQuality): void {
  finishState.quality = quality
  materialFinishUniforms.uOhFinishQuality.value = quality === 'performance' ? 0 : quality === 'ultra' ? 2 : 1
}
export function setMaterialFinishPreset(finish: MaterialFinishPreset): void {
  finishState.finish = finish
  materialFinishUniforms.uOhFinishWear.value = finish === 'factory' ? 0 : finish === 'weathered' ? 1 : .35
}

/** Original periodic material data: albedo modulation, roughness, height and
 * wear mask. Integer frequencies ensure that every mip level tiles cleanly. */
export function generateMaterialPack(kind: MaterialPack, side = MATERIAL_PACK_SIDE): Uint8Array {
  const out = new Uint8Array(side * side * 4), seed = MATERIAL_PACKS[kind].seed
  const tau = 2 * Math.PI
  const byte = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255)
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const u = x / side, v = y / side
    let n = 0, fine = 0
    for (let octave = 0; octave < 5; octave++) {
      const f = 2 ** octave
      n += Math.sin(tau * (u * f + v * (f + 1)) + seed * 1.7 + octave) / (2 ** (octave * .7) * 2.5)
      fine += Math.cos(tau * (u * (f * 3 + 1) - v * (f * 2 + 3)) + seed * .37) / (2 ** (octave * .6) * 3)
    }
    const directional = kind === 'metal' ? Math.sin(v * tau * 57 + Math.sin(u * tau * 3) * .5)
      : kind === 'fabric' ? Math.sin(u * tau * 32) * Math.sin(v * tau * 32) : fine
    const grain = .55 * n + .45 * directional, i = (y * side + x) * 4
    out[i] = byte(.5 + grain * .35)
    out[i + 1] = byte(.5 + fine * .34 + directional * .12)
    out[i + 2] = byte(.5 + grain * .3 + fine * .19)
    out[i + 3] = byte(.5 + n * .32 - fine * .18)
  }
  return out
}

const textures = new Map<MaterialPack, THREE.DataTexture>()
export function materialPackTexture(kind: MaterialPack): THREE.DataTexture {
  let texture = textures.get(kind)
  if (!texture) {
    texture = new THREE.DataTexture(generateMaterialPack(kind), MATERIAL_PACK_SIDE, MATERIAL_PACK_SIDE, THREE.RGBAFormat)
    texture.name = `original-material-pack:${kind}`
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = true; texture.colorSpace = THREE.NoColorSpace
    texture.needsUpdate = true; textures.set(kind, texture)
  }
  return texture
}
