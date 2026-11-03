import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { AERIAL_PERSPECTIVE_GLSL, aerialUniforms, installAtmosphereMaterials, patchAtmosphere } from '../../src/render/atmosphere-materials'
import { cloudShadowUniforms } from '../../src/render/cloud-shadows'

const lit = () => ({
  uniforms: {} as Record<string, { value: unknown }>,
  vertexShader: 'void main() {\n#include <begin_vertex>\n#include <project_vertex>\n}',
  fragmentShader: 'void main() {\n#include <lights_fragment_begin>\n#include <opaque_fragment>\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
})

describe('aerial perspective on lit materials', () => {
  it('mixes toward the sky before tone mapping, in the world position the shadow patch already supplies, with shared uniforms', () => {
    const shader = lit()
    patchAtmosphere(shader as never)
    const f = shader.fragmentShader
    expect(f).toContain('gl_FragColor.rgb = aerialHaze( gl_FragColor.rgb, vCloudShadowWorld );\n#include <tonemapping_fragment>')
    expect(f).toContain('vec3 aerialHaze(vec3 color, vec3 worldPos)')
    expect(f.indexOf('aerialHaze( gl_FragColor.rgb')).toBeLessThan(f.indexOf('#include <colorspace_fragment>'))
    expect(shader.uniforms.uAerialSky).toBe(aerialUniforms.uAerialSky)
    expect(shader.uniforms.uAerialDensity).toBe(aerialUniforms.uAerialDensity)
    expect(shader.uniforms.uCloudShadowMap).toBe(cloudShadowUniforms.uCloudShadowMap)   // the cloud shadows come with it
  })

  it('uses the terrain shader\'s formula: height-integrated density, distance, sky colour toward the view direction', () => {
    expect(AERIAL_PERSPECTIVE_GLSL).toContain('float meanDensity = abs(dh) < 0.01 ? exp(-0.5 * (h0 + h1)) : (exp(-h0) - exp(-h1)) / dh;')
    expect(AERIAL_PERSPECTIVE_GLSL).toContain('float fog = 1.0 - exp(-distance * uAerialDensity * meanDensity);')
    expect(AERIAL_PERSPECTIVE_GLSL).toContain('normalize(vec3(direction.x, max(direction.y, 0.015), direction.z))')
    expect(AERIAL_PERSPECTIVE_GLSL).toContain('if (distance < 20.0) return color;')           // the cockpit and the aircraft itself are never hazed
  })

  it('leaves unlit shaders alone and does not patch twice', () => {
    const unlit = { uniforms: {}, vertexShader: 'void main() {\n#include <project_vertex>\n}', fragmentShader: 'void main() {\n#include <tonemapping_fragment>\n}' }
    patchAtmosphere(unlit as never)
    expect(unlit.fragmentShader).toBe('void main() {\n#include <tonemapping_fragment>\n}')
    const once = lit()
    patchAtmosphere(once as never)
    const first = once.fragmentShader
    patchAtmosphere(once as never)
    expect(once.fragmentShader).toBe(first)
  })

  it('becomes every built-in material\'s default compile hook, once', () => {
    const before = THREE.Material.prototype.onBeforeCompile
    installAtmosphereMaterials()
    const hook = THREE.Material.prototype.onBeforeCompile
    expect(hook).not.toBe(before)
    installAtmosphereMaterials()
    expect(THREE.Material.prototype.onBeforeCompile).toBe(hook)
    const shader = lit()
    new THREE.MeshStandardMaterial().onBeforeCompile(shader as never, undefined as never)
    expect(shader.fragmentShader).toContain('aerialHaze(')
  })
})
