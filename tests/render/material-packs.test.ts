import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  MATERIAL_PACKS, MATERIAL_PACK_SIDE, generateMaterialPack, materialDetailSettings, materialPackTexture,
  setMaterialDetailQuality, setMaterialFinishPreset,
} from '../../src/render/material-packs'
import { withSurfaceFinish } from '../../src/render/material-finish'
import { aircraftPaint, aircraftRubber } from '../../src/render/aircraft-materials'
import { pavementMaterial } from '../../src/render/surface-materials'
import { makeObj8Material } from '../../src/render/xplane-obj8'

function compile(m: THREE.MeshStandardMaterial) {
  const shader = {
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    uniforms: {} as Record<string, THREE.IUniform>,
  }
  m.onBeforeCompile(shader as Parameters<typeof m.onBeforeCompile>[0], {} as THREE.WebGLRenderer)
  return shader
}

describe('shared material packs', () => {
  it('builds deterministic, distinct, bounded linear-data tiles with all four channels in use', () => {
    const kind = Object.keys(MATERIAL_PACKS) as Array<keyof typeof MATERIAL_PACKS>
    expect(kind.length).toBeGreaterThanOrEqual(7)
    const fingerprints = new Set<string>()
    for (const name of kind) {
      const a = generateMaterialPack(name, 32)
      expect(a).toEqual(generateMaterialPack(name, 32))
      const ranges = [0, 1, 2, 3].map(channel => {
        const values = a.filter((_, i) => i % 4 === channel)
        return Math.max(...values) - Math.min(...values)
      })
      expect(Math.min(...ranges)).toBeGreaterThan(9)
      fingerprints.add(a.slice(0, 32).join(','))
    }
    expect(fingerprints.size).toBe(kind.length)
    // RGBA8 and a complete mip chain, shared across every instance.
    expect(kind.length * MATERIAL_PACK_SIDE ** 2 * 4 * 4 / 3).toBeLessThanOrEqual(2.5 * 1024 ** 2)
    const texture = materialPackTexture('paint')
    expect(texture).toBe(materialPackTexture('paint'))
    expect(texture).not.toBe(materialPackTexture('metal'))
    expect(texture.colorSpace).toBe(THREE.NoColorSpace)
    expect(texture.wrapS).toBe(THREE.RepeatWrapping)
    expect(texture.wrapT).toBe(THREE.RepeatWrapping)
    expect(texture.generateMipmaps).toBe(true)
    expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter)
  })

  it('does not create a large seam between opposite edges of any tile', () => {
    const n = 64
    for (const name of Object.keys(MATERIAL_PACKS) as Array<keyof typeof MATERIAL_PACKS>) {
      const p = generateMaterialPack(name, n)
      let across = 0, inside = 0
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < 3; c++) {
          const at = (x: number, y: number) => p[(y * n + x) * 4 + c]!
          across += Math.abs(at(0, i) - at(n - 1, i)) + Math.abs(at(i, 0) - at(i, n - 1))
          for (let j = 1; j < n; j++) {
            inside += Math.abs(at(j, i) - at(j - 1, i)) + Math.abs(at(i, j) - at(i, j - 1))
          }
        }
      }
      expect(across, name).toBeLessThan(2.2 * inside / (n - 1))
    }
  })

  it('changes quality and wear on already compiled surfaces without rebuilding their programs', () => {
    const old = materialDetailSettings()
    const paint = aircraftPaint(0xffffff), rubber = aircraftRubber()
    const pavement = pavementMaterial(0x888888, 'xz', 'runway')
    const shaders = [paint, rubber, pavement].map(compile)
    const keys = [paint, rubber, pavement].map(m => m.customProgramCacheKey())
    const versions = [paint.version, rubber.version, pavement.version]
    try {
      setMaterialDetailQuality('performance'); setMaterialFinishPreset('factory')
      for (const s of shaders) {
        expect(s.uniforms.uOhFinishQuality!.value).toBe(0)
        expect(s.uniforms.uOhFinishWear!.value).toBe(0)
      }
      setMaterialDetailQuality('ultra'); setMaterialFinishPreset('weathered')
      for (const s of shaders) {
        expect(s.uniforms.uOhFinishQuality!.value).toBe(2)
        expect(s.uniforms.uOhFinishWear!.value).toBe(1)
      }
      expect([paint, rubber, pavement].map(m => m.customProgramCacheKey())).toEqual(keys)
      expect([paint.version, rubber.version, pavement.version]).toEqual(versions)
      expect(shaders[0]!.fragmentShader).toMatch(/if \(uOhFinishQuality > 0\.5\)/)
      expect(shaders[0]!.fragmentShader).toMatch(/if \(uOhFinishQuality > 1\.5\)/)
      expect(shaders[0]!.fragmentShader).toContain('clearcoatNormal = ohFinishPerturb(')
      expect(shaders[2]!.fragmentShader).toContain('wetAmount')
      expect(shaders[2]!.fragmentShader).toContain('aerialHaze(')
    } finally { setMaterialDetailQuality(old.quality); setMaterialFinishPreset(old.finish) }
  })

  it('composes with authored OBJ8 maps and does not install the detail hook twice', () => {
    const authored = new THREE.Texture()
    authored.repeat.y = -1
    const m = makeObj8Material({ map: authored, normalMap: authored }, { specular: 0.8, normalMetalness: true })
    const key = m.customProgramCacheKey()
    expect(withSurfaceFinish(m, 'authored-paint')).toBe(m)
    const once = m.customProgramCacheKey()
    expect(once).toContain(key)
    withSurfaceFinish(m, 'authored-paint')
    expect(m.customProgramCacheKey()).toBe(once)
    const s = compile(m)
    expect(s.fragmentShader).toContain('1.0 - texelRoughness.a * 0.8')
    expect(s.fragmentShader).toContain('mapN.z = sqrt')
    expect(s.fragmentShader).toContain('normal = ohFinishPerturb(')
    expect(s.fragmentShader.match(/uniform sampler2D uOhFinishMap;/g)).toHaveLength(1)
    expect(s.fragmentShader).toContain('#include <map_fragment>')
    expect(m.map).toBe(authored)
    expect(m.normalMap).toBe(authored)
    expect(m.normalScale.y).toBe(-1)
  })
})
