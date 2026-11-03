import * as THREE from 'three'

/**
 * Weather on the airframe itself, shaded into the exterior materials:
 *  - rime ice on the surfaces facing the airflow (leading edges, nose,
 *    struts), from the physics model's ice thickness;
 *  - snow settling on the upward-facing surfaces of a parked airplane;
 *  - rain-wet paint: darker and glossier.
 * One set of shared uniforms drives every patched material. The patch goes
 * in after the normal is known (so placement follows the lit surface) and
 * chains any onBeforeCompile hook the material already had.
 */
export interface AirframeWeatherUniforms {
  uAwIce: { value: number }
  uAwSnow: { value: number }
  uAwWet: { value: number }
  /** The airframe's forward direction, world frame. */
  uAwFwd: { value: THREE.Vector3 }
}

export function makeAirframeWeatherUniforms(): AirframeWeatherUniforms {
  return { uAwIce: { value: 0 }, uAwSnow: { value: 0 }, uAwWet: { value: 0 }, uAwFwd: { value: new THREE.Vector3(0, 0, -1) } }
}

export const AIRFRAME_WEATHER_GLSL = /* glsl */ `
  {
    vec3 awUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    vec3 awFwd = normalize((viewMatrix * vec4(uAwFwd, 0.0)).xyz);
    float awSnow = uAwSnow * smoothstep(0.35, 0.8, dot(normal, awUp));
    float awIce = uAwIce * smoothstep(0.5, 0.92, dot(normal, awFwd));
    float awWet = uAwWet * (1.0 - awSnow);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.98), awSnow);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.89, 0.95), awIce * 0.85);
    diffuseColor.rgb *= 1.0 - 0.12 * awWet;
    roughnessFactor = mix(roughnessFactor, 0.85, max(awSnow, awIce * 0.7));
    roughnessFactor *= 1.0 - 0.55 * awWet;
    metalnessFactor *= 1.0 - max(awSnow, awIce);
  }
`

/** Patch one material (Standard / Physical). Returns false if skipped:
 *  glass, already patched, or a material other airframes share
 *  (userData.sharedMaterial: one airplane's ice must not show on another). */
export function patchAirframeMaterial(mat: THREE.Material, u: AirframeWeatherUniforms): boolean {
  const m = mat as THREE.MeshStandardMaterial
  if (!(m as unknown as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial) return false
  if (m.transparent || m.userData.airframeWeather || m.userData.sharedMaterial) return false
  m.userData.airframeWeather = true
  const prev = m.onBeforeCompile
  const prevKey = m.customProgramCacheKey
  m.onBeforeCompile = (shader, renderer) => {
    prev?.call(m, shader, renderer)
    Object.assign(shader.uniforms, u)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uAwIce, uAwSnow, uAwWet;\nuniform vec3 uAwFwd;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + AIRFRAME_WEATHER_GLSL)
  }
  m.customProgramCacheKey = () => `${prevKey ? prevKey.call(m) : ''}|airframe-weather`
  m.needsUpdate = true
  return true
}

/** Patch every exterior material under `root`, skipping the `skip` subtree
 *  (the flight deck / cabin: no snow indoors) and any group named for an
 *  interior (the seats seen through a light aircraft's windows). Returns
 *  the count patched. */
export function applyAirframeWeather(root: THREE.Object3D, u: AirframeWeatherUniforms, skip?: THREE.Object3D): number {
  const skipped = new Set<THREE.Object3D>()
  skip?.traverse((o) => skipped.add(o))
  root.traverse((o) => { if (o !== root && /interior/i.test(o.name)) o.traverse((c) => skipped.add(c)) })
  let n = 0
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || skipped.has(o)) return
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (mat && patchAirframeMaterial(mat, u)) n++
  })
  return n
}

/**
 * Snow load on a parked airframe (0..1): builds while it snows on a
 * stationary airplane (fully white in ≈20 min of moderate snow), melts above
 * freezing, and blows off once the airplane moves fast.
 */
export function stepAirframeSnow(snow: number, dtS: number, snowing: number, groundSpeedMs: number, oatC: number): number {
  let s = snow
  if (snowing > 0 && groundSpeedMs < 8) s += (dtS / 1200) * snowing * 2
  if (oatC > 1) s -= (dtS / 900) * (oatC / 5)
  if (groundSpeedMs > 25) s -= (dtS / 6) * ((groundSpeedMs - 25) / 25)
  return Math.min(Math.max(s, 0), 1)
}

/** Wet skin (0..1): wets within a minute in rain, dries over ~5 minutes. */
export function stepAirframeWet(wet: number, dtS: number, rain: number): number {
  const target = Math.min(1, rain * 1.5)
  const tau = target > wet ? 40 : 300
  return wet + (target - wet) * (1 - Math.exp(-dtS / tau))
}
