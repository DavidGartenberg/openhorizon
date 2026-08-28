import * as THREE from 'three'
import type { CloudSlab } from '../sim/weather/clouds-model'

/**
 * METAR-driven cloud layers (§11, Phase 5 step 4): each reported layer is a
 * field of soft billboard puffs at its MSL slab, coverage density by
 * FEW/SCT/BKN/OVC. Puff positions come from a deterministic hash on world
 * grid cells, so the field is stable as the aircraft flies (and across
 * floating-origin rebases — positions are recomputed from the same cells).
 * Raymarched volumetrics are §28 territory; these are honest impostors of
 * the layers the METAR actually reports.
 */

const PUFF_VERT = /* glsl */ `
  attribute vec3 offset;
  attribute float scale;
  attribute float seed;
  varying vec2 vUv;
  varying float vSeed;
  varying vec3 vCenterW;
  void main() {
    vUv = uv;
    vSeed = seed;
    vCenterW = offset; // instance center (render-frame world coords)
    // Billboard: face the camera.
    vec4 center = viewMatrix * modelMatrix * vec4(offset, 1.0);
    center.xy += position.xy * scale * vec2(1.0, 0.42); // flattened puffs
    gl_Position = projectionMatrix * center;
  }
`
const PUFF_FRAG = /* glsl */ `
  uniform float uDayness;
  uniform float uOpacity;
  uniform vec3 uSunDir;
  uniform float uDusk;
  uniform float uBaseDark;
  varying vec2 vUv;
  varying float vSeed;
  varying vec3 vCenterW;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    // Soft blob with a wobbly edge per puff.
    float wobble = 0.12 * sin(atan(p.y, p.x) * 5.0 + vSeed * 40.0);
    float alpha = smoothstep(1.0, 0.35 + wobble, r) * uOpacity;
    // 13e: forward scattering — how directly this puff sits between the
    // camera and the sun.
    vec3 viewDir = normalize(vCenterW - cameraPosition);
    float fwd = pow(max(dot(viewDir, normalize(uSunDir)), 0.0), 10.0);
    // Thick layers carry dark bases: darken the puff's lower half by the
    // layer's thickness/coverage factor.
    float baseShade = mix(1.0, 0.52, uBaseDark * smoothstep(0.15, -0.65, p.y));
    vec3 lit = mix(vec3(0.06, 0.07, 0.09), vec3(0.98), uDayness * (0.75 + 0.25 * smoothstep(1.0, 0.0, r)));
    lit *= baseShade;
    // Dusk tint: warm the cloud, strongest on the sunward side.
    lit *= mix(vec3(1.0), vec3(1.0, 0.62, 0.40), uDusk * (0.35 + 0.5 * fwd));
    // Silver lining: bright rim where the puff is backlit.
    lit += vec3(1.0, 0.97, 0.90) * (smoothstep(0.45, 0.95, r) * fwd * uDayness);
    gl_FragColor = vec4(lit, alpha);
  }
`

const COVERAGE: Record<string, number> = { FEW: 0.14, SCT: 0.35, BKN: 0.68, OVC: 1.0, VV: 1.0 }

function hash2(ix: number, iy: number, k: number): number {
  let h = (ix * 374761393 + iy * 668265263 + k * 2246822519) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

interface LayerField {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  slab: CloudSlab
}

const CELL_M = 2200
const RADIUS_CELLS = 11 // ~24 km field

export class Clouds {
  private layers: LayerField[] = []
  private layersKey = ''
  private lastCellX = Infinity
  private lastCellZ = Infinity

  constructor(private readonly scene: THREE.Scene) {}

  /** Rebuild/reposition for the current slabs and camera position (render
   *  frame coords). `worldOffsetE/N` map render coords to a stable world
   *  grid across floating-origin rebases. */
  update(
    slabs: CloudSlab[],
    cameraPos: THREE.Vector3,
    worldOffsetE: number,
    worldOffsetN: number,
    dayness: number,
    sunDir?: THREE.Vector3,
    dusk = 0,
  ): void {
    // topMslFt in the key (9C): a deck whose TOP moved kept its stale
    // dark-base shading until the base also changed.
    const key = slabs.map((s) => `${s.cover}${s.baseMslFt}-${s.topMslFt}`).join('|')
    const cellX = Math.floor((cameraPos.x + worldOffsetE) / CELL_M)
    const cellZ = Math.floor((-cameraPos.z + worldOffsetN) / CELL_M)
    const moved = cellX !== this.lastCellX || cellZ !== this.lastCellZ
    if (key !== this.layersKey) {
      this.dispose()
      this.layersKey = key
      for (const slab of slabs) this.layers.push(this.buildLayer(slab))
    }
    {
      // Reposition instances only when the camera crosses a grid cell.
      if (moved || this.layers.some((l) => l.mesh.userData.dirty)) {
        for (const l of this.layers) this.fillLayer(l, cellX, cellZ, worldOffsetE, worldOffsetN)
        this.lastCellX = cellX
        this.lastCellZ = cellZ
      }
    }
    for (const l of this.layers) {
      l.material.uniforms.uDayness!.value = dayness
      if (sunDir) (l.material.uniforms.uSunDir!.value as THREE.Vector3).copy(sunDir)
      l.material.uniforms.uDusk!.value = dusk
    }
  }

  private buildLayer(slab: CloudSlab): LayerField {
    const count = (RADIUS_CELLS * 2 + 1) ** 2
    const geo = new THREE.InstancedBufferGeometry()
    geo.copy(new THREE.PlaneGeometry(2, 2) as unknown as THREE.InstancedBufferGeometry)
    geo.instanceCount = count
    geo.setAttribute('offset', new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3))
    geo.setAttribute('scale', new THREE.InstancedBufferAttribute(new Float32Array(count), 1))
    geo.setAttribute('seed', new THREE.InstancedBufferAttribute(new Float32Array(count), 1))
    // 13e: thick, heavy layers carry darker bases (OVC 4,000 ft reads
    // near-black underneath; a thin FEW deck stays bright).
    const thickFt = slab.topMslFt - slab.baseMslFt
    const cover = COVERAGE[slab.cover] ?? 0.5
    const baseDark = Math.min(Math.max((thickFt / 3500) * (0.4 + 0.6 * cover), 0), 1)
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uDayness: { value: 1 }, uOpacity: { value: 0.88 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uDusk: { value: 0 },
        uBaseDark: { value: baseDark },
      },
      vertexShader: PUFF_VERT,
      fragmentShader: PUFF_FRAG,
      transparent: true,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(geo, material)
    mesh.frustumCulled = false
    mesh.renderOrder = 50
    mesh.userData.dirty = true
    this.scene.add(mesh)
    return { mesh, material, slab }
  }

  private fillLayer(l: LayerField, cellX: number, cellZ: number, offE: number, offN: number): void {
    const geo = l.mesh.geometry as THREE.InstancedBufferGeometry
    const offsets = geo.getAttribute('offset') as THREE.InstancedBufferAttribute
    const scales = geo.getAttribute('scale') as THREE.InstancedBufferAttribute
    const seeds = geo.getAttribute('seed') as THREE.InstancedBufferAttribute
    const cover = COVERAGE[l.slab.cover] ?? 0.5
    const baseM = l.slab.baseMslFt * 0.3048
    const thickM = (l.slab.topMslFt - l.slab.baseMslFt) * 0.3048
    let n = 0
    for (let dz = -RADIUS_CELLS; dz <= RADIUS_CELLS; dz++) {
      for (let dx = -RADIUS_CELLS; dx <= RADIUS_CELLS; dx++) {
        const gx = cellX + dx
        const gz = cellZ + dz
        const present = hash2(gx, gz, 1) < cover
        const idx = n++
        if (!present) {
          scales.setX(idx, 0)
          continue
        }
        const jx = (hash2(gx, gz, 2) - 0.5) * CELL_M
        const jz = (hash2(gx, gz, 3) - 0.5) * CELL_M
        // World-grid position → current render frame.
        offsets.setXYZ(
          idx,
          gx * CELL_M + CELL_M / 2 + jx - offE,
          baseM + thickM * (0.25 + 0.5 * hash2(gx, gz, 4)),
          -(gz * CELL_M + CELL_M / 2 + jz - offN),
        )
        scales.setX(idx, CELL_M * (0.75 + 0.65 * hash2(gx, gz, 5)))
        seeds.setX(idx, hash2(gx, gz, 6))
      }
    }
    offsets.needsUpdate = true
    scales.needsUpdate = true
    seeds.needsUpdate = true
    l.mesh.userData.dirty = false
  }

  /** Force reposition after a floating-origin rebase. */
  onRebase(): void {
    this.lastCellX = Infinity
    for (const l of this.layers) l.mesh.userData.dirty = true
  }

  private dispose(): void {
    for (const l of this.layers) {
      this.scene.remove(l.mesh)
      l.mesh.geometry.dispose()
      l.material.dispose()
    }
    this.layers = []
  }
}
