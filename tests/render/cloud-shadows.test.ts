import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { Clouds } from '../../src/render/clouds'
import { CLOUD_SHADOW_GLSL, cloudShadowUniforms, patchCloudShadow } from '../../src/render/cloud-shadows'
import { SkyDome } from '../../src/render/sky'

const sunHigh = new THREE.Vector3(0.3, 0.8, 0.2).normalize()

function overcast(cover: 'OVC' | 'SCT' = 'OVC') {
  const scene = new THREE.Scene()
  const clouds = new Clouds(scene)
  clouds.update([{ cover, baseMslFt: 2000, topMslFt: 5000 }], new THREE.Vector3(), 0, 0, 1)
  return clouds
}

describe('sun transmission through the cloud masses', () => {
  it('is 1 with no clouds, above the deck, and for a point whose sun ray never meets a mass', () => {
    const empty = new Clouds(new THREE.Scene())
    expect(empty.sunTransmissionAt(new THREE.Vector3(0, 100, 0), sunHigh)).toBe(1)
    const deck = overcast()
    expect(deck.sunTransmissionAt(new THREE.Vector3(0, 3000, 0), sunHigh)).toBe(1)          // above the top (1524 m)
    expect(deck.sunTransmissionAt(new THREE.Vector3(60000, 100, 60000), sunHigh)).toBe(1)   // far outside the field
  })

  it('is reduced under an overcast deck and for a point inside it, never below 0 or above 1', () => {
    const deck = overcast()
    const samples: number[] = []
    for (let x = -4000; x <= 4000; x += 800) for (let z = -4000; z <= 4000; z += 800) samples.push(deck.sunTransmissionAt(new THREE.Vector3(x, 50, z), sunHigh))
    expect(Math.min(...samples)).toBeLessThan(0.5)
    expect(samples.every((t) => t >= 0 && t <= 1)).toBe(true)
    // Inside the deck the rest of the ray is shorter, so more gets through than from the ground.
    const ground = deck.sunTransmissionAt(new THREE.Vector3(0, 50, 0), sunHigh)
    const inside = deck.sunTransmissionAt(new THREE.Vector3(0, 1400, 0), sunHigh)
    expect(inside).toBeGreaterThanOrEqual(ground)
  })

  it('leaves gaps between scattered masses lit and shades the ground under them', () => {
    const scattered = overcast('SCT')
    const t: number[] = []
    for (let x = -5000; x <= 5000; x += 250) for (let z = -5000; z <= 5000; z += 250) t.push(scattered.sunTransmissionAt(new THREE.Vector3(x, 0, z), sunHigh))
    expect(t.filter((v) => v === 1).length).toBeGreaterThan(t.length * 0.3)
    expect(t.filter((v) => v < 0.6).length).toBeGreaterThan(0)
  })

  it('treats a sun at the horizon like one a few degrees up rather than dividing by zero', () => {
    const deck = overcast()
    const flat = deck.sunTransmissionAt(new THREE.Vector3(0, 50, 0), new THREE.Vector3(1, 0, 0))
    expect(Number.isFinite(flat)).toBe(true)
    expect(flat).toBeGreaterThanOrEqual(0)
  })

  it('counts a version up whenever the masses are refilled, so the shadow map redraws', () => {
    const clouds = new Clouds(new THREE.Scene())
    const v0 = clouds.version
    clouds.update([{ cover: 'BKN', baseMslFt: 2000, topMslFt: 4000 }], new THREE.Vector3(), 0, 0, 1)
    const v1 = clouds.version
    expect(v1).toBeGreaterThan(v0)
    clouds.onRebase()
    clouds.update([{ cover: 'BKN', baseMslFt: 2000, topMslFt: 4000 }], new THREE.Vector3(), 0, 0, 1)
    expect(clouds.version).toBeGreaterThan(v1)
  })

  it('exposes one shadow entry per layer, with the lowest base for the receivers', () => {
    const scene = new THREE.Scene()
    const clouds = new Clouds(scene)
    clouds.update([{ cover: 'SCT', baseMslFt: 3000, topMslFt: 4000 }, { cover: 'BKN', baseMslFt: 8000, topMslFt: 10000 }], new THREE.Vector3(), 0, 0, 1)
    const layers = clouds.shadowLayers()
    expect(layers).toHaveLength(2)
    expect(Math.min(...layers.map((l) => l.baseM))).toBeCloseTo(914.4)
    expect(layers.every((l) => l.geometry.instanceCount > 0)).toBe(true)
  })
})

describe('receiving cloud shadows in a lit material', () => {
  const standard = () => ({
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: 'void main() {\n#include <begin_vertex>\n#include <project_vertex>\n}',
    fragmentShader: 'void main() {\n#include <lights_fragment_begin>\n}',
  })

  it('adds the world position, the lookup and the factor on the directional light, and shares the uniform objects', () => {
    const shader = standard()
    patchCloudShadow(shader as never)
    expect(shader.vertexShader).toContain('vCloudShadowWorld = ( modelMatrix * cloudShadowP ).xyz;')
    expect(shader.fragmentShader).toContain('float cloudShadowAt(vec3 p)')
    expect(shader.fragmentShader).toContain('directLight.color *= cloudShadowAt( vCloudShadowWorld ) / max( uCloudShadowLight, 1e-3 );')
    expect(shader.uniforms.uCloudShadowMap).toBe(cloudShadowUniforms.uCloudShadowMap)
    expect(shader.uniforms.uCloudShadowStrength).toBe(cloudShadowUniforms.uCloudShadowStrength)
  })

  it('does nothing to shaders without lighting, and does not patch twice', () => {
    const unlit = { uniforms: {}, vertexShader: 'void main() {\n#include <project_vertex>\n}', fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }' }
    patchCloudShadow(unlit as never)
    expect(unlit.fragmentShader).toBe('void main() { gl_FragColor = vec4(1.0); }')
    const once = standard()
    patchCloudShadow(once as never)
    const first = once.fragmentShader
    patchCloudShadow(once as never)
    expect(once.fragmentShader).toBe(first)
  })

  it('falls back to the uniform dimming whenever the map is unused, and fades to the light at the aircraft above the lowest base', () => {
    expect(CLOUD_SHADOW_GLSL).toContain('if (uCloudShadowStrength <= 0.0) return uCloudShadowFar;')
    expect(CLOUD_SHADOW_GLSL).toContain('smoothstep(uCloudShadowBase - 150.0, uCloudShadowBase, p.y)')
  })
})

describe('the sun light follows the measured transmission', () => {
  it('uses cloud cover until a measurement is set, then the measurement, then cloud cover again', () => {
    const sky = new SkyDome(new THREE.Scene())
    sky.setCloudCover(1)
    const cover = Math.exp(-2.7)
    expect(sky.directTransmission).toBeCloseTo(cover)
    expect(sky.coverTransmission).toBeCloseTo(cover)
    sky.setSunTransmission(0.5)
    expect(sky.directTransmission).toBe(0.5)
    expect(sky.coverTransmission).toBeCloseTo(cover)                 // the receivers' fallback never takes the measurement
    sky.setSunTransmission(null)
    expect(sky.directTransmission).toBeCloseTo(cover)
  })
})
