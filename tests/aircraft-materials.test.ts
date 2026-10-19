import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { aircraftPaint, aircraftMetal, aircraftRubber, aircraftFabric } from '../src/render/aircraft-materials'
import { liveryMaterial } from '../src/render/livery'

function compileFinish(material: THREE.MeshPhysicalMaterial) {
  const shader = {
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    uniforms: {},
  }
  material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], {} as THREE.WebGLRenderer)
  return shader
}

describe('aircraft surface materials', () => {
  it('retains paint color and caller material settings', () => {
    const material = aircraftPaint(0xd02020, { side: THREE.DoubleSide, roughness: 0.42 })
    expect(material.color.getHex()).toBe(0xd02020)
    expect(material.roughness).toBe(0.42)
    expect(material.side).toBe(THREE.DoubleSide)
    expect(aircraftMetal().metalness).toBeGreaterThan(0.8)
    expect(aircraftRubber().roughness).toBeGreaterThan(0.8)
    expect(aircraftFabric(0xffff00).clearcoat).toBe(0)
  })
  it('can construct a livery in a headless builder without a DOM', () => {
    const material = liveryMaterial('B738', 28, 1.88)
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial)
  })
  it('keeps brushed metal, paint, and fabric in separate shader programs', () => {
    const finishes = [aircraftPaint(0xffffff), aircraftMetal(), aircraftFabric(0xffff00)]
    expect(new Set(finishes.map(material => material.customProgramCacheKey())).size).toBe(3)
    expect(aircraftMetal(0x778899, 0.37).roughness).toBe(0.37)
  })
  it('adds filtered directional metal grain to both relief and roughness without requiring UVs', () => {
    const { fragmentShader, vertexShader } = compileFinish(aircraftMetal())
    expect(fragmentShader).toContain('float skinFilteredWave(')
    expect(fragmentShader).toMatch(/fwidth\(phase\)/)
    expect(fragmentShader).toMatch(/float skinGrain = skinBrushedGrain\(vAircraftSkinPosition\.yz\)/)
    expect(fragmentShader).toMatch(/skinHeight \+= [\d.]+ \* skinGrain/)
    expect(fragmentShader).toMatch(/roughnessFactor = clamp\([^;]+skinGrain/)
    expect(fragmentShader).not.toMatch(/texture2D\(|texture\(/)
    expect(vertexShader).toContain('vAircraftSkinPosition = position;')
    expect(vertexShader).toContain('#include <project_vertex>')
  })
  it('adds smooth paint finish variation while keeping fabric rib tapes and material maps', () => {
    const paint = compileFinish(aircraftPaint(0xffffff)).fragmentShader
    expect(paint).toMatch(/float skinPatina = /)
    expect(paint).toMatch(/roughnessFactor = clamp\([^;]+skinPatina/)
    expect(paint).toMatch(/diffuseColor\.rgb \*= [^;]+skinPatina/)
    expect(paint).not.toContain('float skinGrain = skinBrushedGrain(')
    for (const material of [aircraftPaint(0xffffff), aircraftMetal(), aircraftFabric(0xffff00)]) {
      const shader = compileFinish(material).fragmentShader
      expect(shader).toContain('#include <map_fragment>')
      expect(shader).toContain('#include <roughnessmap_fragment>')
      expect(shader).toContain('#include <normal_fragment_maps>')
    }
    const fabric = compileFinish(aircraftFabric(0xffff00)).fragmentShader
    expect(fabric).toContain('float fabricTape =')
    expect(fabric).not.toContain('float skinGrain = skinBrushedGrain(')
  })
})
