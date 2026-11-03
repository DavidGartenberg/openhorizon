/** Ice, snow and rain on the airframe's own paint. */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyAirframeWeather, makeAirframeWeatherUniforms, patchAirframeMaterial, stepAirframeSnow, stepAirframeWet, AIRFRAME_WEATHER_GLSL } from '../src/render/airframe-weather'

describe('airframe weather', () => {
  it('snow builds on a parked airplane in ~20 min, melts above freezing, blows off on the roll', () => {
    let s = 0
    for (let t = 0; t < 1200; t++) s = stepAirframeSnow(s, 1, 0.5, 0, -3)
    expect(s).toBeGreaterThan(0.95)
    let melt = s
    for (let t = 0; t < 1800; t++) melt = stepAirframeSnow(melt, 1, 0, 0, 5)
    expect(melt).toBe(0)
    let roll = 1
    for (let t = 0; t < 20; t++) roll = stepAirframeSnow(roll, 1, 0, 40, -3)
    expect(roll).toBeLessThan(0.1)
  })
  it('the skin wets in a minute of rain and dries over minutes', () => {
    let w = 0
    for (let t = 0; t < 60; t++) w = stepAirframeWet(w, 1, 0.7)
    expect(w).toBeGreaterThan(0.7)
    for (let t = 0; t < 300; t++) w = stepAirframeWet(w, 1, 0)
    expect(w).toBeLessThan(0.45)
  })
  it('patches exterior paint (not glass, not the cabin), once, chaining existing hooks', () => {
    const u = makeAirframeWeatherUniforms()
    const root = new THREE.Group(), cabin = new THREE.Group()
    const paint = new THREE.MeshStandardMaterial()
    let chained = 0
    paint.onBeforeCompile = () => { chained++ }
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), paint))
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhysicalMaterial({ transparent: true })))
    cabin.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()))
    root.add(cabin)
    expect(applyAirframeWeather(root, u, cabin)).toBe(1)
    expect(patchAirframeMaterial(paint, u)).toBe(false) // already patched
    const shader = { uniforms: {}, fragmentShader: '#include <common>\nvoid main(){\n#include <normal_fragment_maps>\n}', vertexShader: '' }
    paint.onBeforeCompile(shader as never, {} as never)
    expect(chained).toBe(1)
    expect(shader.fragmentShader).toContain('uniform float uAwIce')
    expect(shader.fragmentShader).toContain(AIRFRAME_WEATHER_GLSL.trim().slice(0, 40))
    expect(paint.customProgramCacheKey()).toContain('airframe-weather')
  })
  it('leaves shared materials and see-through interiors alone', () => {
    const u = makeAirframeWeatherUniforms()
    const root = new THREE.Group(), interior = new THREE.Group()
    interior.name = 'c172ExteriorInterior'
    const shared = new THREE.MeshStandardMaterial()
    shared.userData.sharedMaterial = true // e.g. every engine's fan metal
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), shared))
    interior.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()))
    root.add(interior)
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()))
    expect(applyAirframeWeather(root, u)).toBe(1)
    expect(shared.userData.airframeWeather).toBeUndefined()
  })
})
