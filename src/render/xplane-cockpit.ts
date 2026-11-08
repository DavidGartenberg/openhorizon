import * as THREE from 'three'
import { applyObj8Anim, applyObj8Lights, applyObj8Visibility, loadObj8, type DatarefReader, type LightLevelGroup, type LoadedObj8 } from './xplane-obj8'
import { disposeAircraftGeometry } from './local-aircraft'
import { XpPanel } from './xplane-panel'

/**
 * The real X-Plane 12 Boeing 737-800 flight deck, loaded at run time from the
 * user's own X-Plane install (the same read-only `/xp/` route the exterior
 * models use — nothing is copied into this repository). When X-Plane is not
 * installed the loader answers null and the procedural deck stays.
 *
 * The cockpit objects share the airplane's ACF frame, so they are placed with
 * exactly the same rule as the exterior: group.position = (attachment − CG)·0.3048
 * per axis. Geometry, textures (incl. the LIT night maps) and every animation
 * come straight from the OBJ8 files; this module only poses them from a
 * dataref reader and lights them. The glass displays, MCP windows and the
 * rest of the instrument art live in one panel bitmap (xplane-panel.ts) that
 * the airplane's own panel mesh (`b738_cockpit.obj`) puts in place.
 */

export interface XpCockpitObj { path: string; glass?: boolean }

export interface XpCockpitModel {
  folder: string
  /** In draw order: opaque shell first, glass and fuzz last. */
  objs: ReadonlyArray<string | XpCockpitObj>
  /** The panel mesh: the one draw under ATTR_cockpit_lit_only, sampling the panel bitmap. */
  panelObj: string
  /** ACF datum → CG, feet (x right, y up, z aft). */
  cgFt: [number, number, number]
  /** Captain's eye in OBJ/ACF metres (x right, y up, z aft). */
  eyeObj: [number, number, number]
  /**
   * A light airplane (xplane-ga-cockpits.ts): there is no 737 panel bitmap. Panel-texture draws show X-Plane's own
   * panel art (null: none), avionics screens show the textures given to the loader, and the objects sit at
   * `offsetFt` from the datum.
   */
  ga?: { panelBackground: string | null; offsetFt: [number, number, number] }
}

export const XP_COCKPIT_B738 = {
  folder: 'Boeing 737-800',
  objs: [
    'objects/738_cockpit_floor.obj', 'objects/738_cockpit_roof.obj', 'objects/738_cockpit_main.obj',
    'objects/738_cockpit_ovhd1.obj', 'objects/738_cockpit_ovhd2.obj', 'objects/738_cockpit_pdstl.obj',
    'objects/738_cockpit_seats.obj', 'objects/738_cockpit_CBpnls.obj', 'objects/738_cockpit_yokes.obj',
    'objects/738_cockpit_switch.obj', 'objects/738_cockpit_ind.obj', 'objects/FMS_screens.obj',
    'objects/738_cockpit_fuzz.obj', 'objects/738_cockpit_glass.obj',
  ],
  panelObj: 'objects/b738_cockpit.obj',
  cgFt: [0, -2, 59.5],
  eyeObj: [-0.536, 0.71, 2.59],
} satisfies XpCockpitModel

/** Share of its own colour a surface glows with in full daylight. */
const CABIN_DAYLIGHT_FILL = 0.3
const FT = 0.3048

/**
 * Daylight reaching the cabin from the windows: the sun-lit surfaces get the real shadow-casting sun, but a flight
 * deck's shaded parts (the overhead, the pedestal's sides) are still lit by light bouncing in through the glass.
 * Three has no per-room lighting, so the opaque cockpit materials add a share of their own albedo, scaled by one
 * shared uniform (0 at night, when the panel lights take over).
 */
function addCabinFill(m: THREE.MeshStandardMaterial, fill: { value: number }): void {
  const prevCompile = m.onBeforeCompile
  const prevKey = m.customProgramCacheKey
  m.onBeforeCompile = (shader, renderer) => {
    prevCompile.call(m, shader, renderer)
    shader.uniforms.uCabinFill = fill
    shader.fragmentShader = 'uniform float uCabinFill;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * uCabinFill;')
  }
  m.customProgramCacheKey = () => `${prevKey.call(m)}|cabin-fill`
}

export interface XpCockpit {
  group: THREE.Group
  parts: LoadedObj8[]
  /** The 737's panel bitmap behind every display and MCP window: draw into it, then commit(). Null in a light airplane. */
  panel: XpPanel | null
  /** Invisible hit boxes of every manipulator (button, knob, switch, lever), moving with the controls they sit on. */
  hits: THREE.Mesh[]
  /** Re-pose every animated node from this reader. */
  pose(read: DatarefReader): void
  /** The captain's eye as the cockpit camera wants it: forward / lateral / up from the airplane origin, metres. */
  eyePoint(): { x: number; y: number; up: number }
  /** 0 = day, 1 = full night: how strongly the LIT maps glow (and, inversely, how much daylight fills the cabin). */
  setLit(level: number): void
  dispose(): void
  evidence: { objects: number; triangles: number; datarefs: string[]; warnings: string[] }
}

/** The camera eye (forward/lateral/up from the airplane origin) for an eye given in OBJ metres. */
export function eyeFromObj(model: XpCockpitModel, eye: readonly [number, number, number] = model.eyeObj): { x: number; y: number; up: number } {
  return { x: -(eye[2] - model.cgFt[2] * FT), y: eye[0] - model.cgFt[0] * FT, up: eye[1] - model.cgFt[1] * FT }
}

let active = 0
const waiting: Array<() => void> = []

export interface LoadXpCockpitOptions {
  signal?: AbortSignal
  /** Shown on both CDU screens (X-Plane's `CDU739_n` device quads). */
  cduTexture?: THREE.Texture
  /** A light airplane's avionics screens by X-Plane device name (G1000_PFD1, GNS530_1 …); `*` serves any other. */
  screens?: Record<string, THREE.Texture>
  /**
   * Fly this deck in another airframe: put the captain's eye at `eye` (forward / lateral / up from the airplane
   * origin, metres, the cockpit camera's convention) and scale the deck by `scale` about it. Default: the deck's own
   * airplane, placed by its CG.
   */
  place?: { eye: { x: number; y: number; up: number }; scale: number }
}

const objEntry = (o: string | XpCockpitObj): XpCockpitObj => (typeof o === 'string' ? { path: o } : o)

export async function loadXpCockpit(model: XpCockpitModel = XP_COCKPIT_B738, opts: LoadXpCockpitOptions = {}): Promise<XpCockpit | null> {
  const signal = opts.signal
  if (active >= 1) await new Promise<void>((resolve) => waiting.push(resolve))
  else active++
  try { signal?.throwIfAborted(); return await loadInSlot(model, opts) }
  finally { const next = waiting.shift(); if (next) next(); else active-- }
}

async function loadInSlot(model: XpCockpitModel, opts: LoadXpCockpitOptions): Promise<XpCockpit | null> {
  const signal = opts.signal
  const manifest = await fetch('/xp/manifest.json', { signal: signal ?? null })
  if (!manifest.ok || !(await manifest.json() as { available?: boolean }).available) return null
  const group = new THREE.Group()
  group.name = 'xplane-cockpit'
  if (opts.place) {
    // The eye, in the airplane frame (x right, y up, z aft), lands on the requested point with the deck scaled about it.
    const k = opts.place.scale, e = opts.place.eye
    group.scale.setScalar(k)
    group.position.set(e.y - k * model.eyeObj[0], e.up - k * model.eyeObj[1], -e.x - k * model.eyeObj[2])
  } else group.position.set(...model.cgFt.map((cg) => -cg * FT) as [number, number, number])
  const parts: LoadedObj8[] = []
  const textureCache = new Map<string, Promise<THREE.Texture | null>>()
  const url = (rel: string): string => '/xp/aircraft/' + `${model.folder}/${rel}`.split('/').map(encodeURIComponent).join('/')
  const panel = model.ga ? null : new XpPanel(`/xp/aircraft/${encodeURIComponent(model.folder)}/`)
  const owned: Array<{ dispose(): void }> = []
  const panelMaterial = panel ? new THREE.MeshBasicMaterial({ map: panel.texture, toneMapped: false }) : new THREE.MeshStandardMaterial({ color: 0x2b2e31, roughness: 0.85 })
  owned.push(panelMaterial)
  const panelLoaded = panel ? panel.load() : Promise.resolve()
  if (model.ga?.panelBackground) {
    // X-Plane paints its 2D instruments into the clear parts of this art at run time; with none painted here they
    // show as dark, unlit faces rather than the bitmap's empty white.
    const img = await new THREE.ImageLoader().loadAsync(url(model.ga.panelBackground)).catch(() => null)
    if (img) {
      const canvas = document.createElement('canvas')
      canvas.width = img.width; canvas.height = img.height
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#0b0c0e'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0)
      const art = new THREE.CanvasTexture(canvas)
      art.colorSpace = THREE.SRGBColorSpace
      ;(panelMaterial as THREE.MeshStandardMaterial).map = art; (panelMaterial as THREE.MeshStandardMaterial).color.set(0xffffff); owned.push(art)
    }
  }
  // Light-airplane avionics: each screen its own live texture; one with no picture stays a dark, unpowered face.
  const screenMaterials = new Map<string, THREE.Material>()
  const screenFor = (device: string | undefined): THREE.Material => {
    if (!device) return panelMaterial
    let m = screenMaterials.get(device)
    if (!m) {
      const tex = opts.screens?.[device] ?? opts.screens?.['*']
      m = tex ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }) : new THREE.MeshBasicMaterial({ color: 0x050607 })
      screenMaterials.set(device, m); owned.push(m)
    }
    return m
  }
  const offset = (model.ga?.offsetFt ?? [0, 0, 0]).map((v) => v * FT) as [number, number, number]
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    disposeAircraftGeometry(group)
    group.removeFromParent(); group.clear()
    for (const o of owned) o.dispose()
    panel?.dispose()
    void Promise.all(textureCache.values()).then((maps) => new Set(maps).forEach((m) => m?.dispose()))
  }
  try {
    for (const entry of model.objs.map(objEntry)) {
      const path = entry.path
      signal?.throwIfAborted()
      const u = url(path)
      const cdu = /FMS_screens/.test(path) && opts.cduTexture
        ? new THREE.MeshBasicMaterial({ map: opts.cduTexture, toneMapped: false }) : undefined
      if (cdu) owned.push(cdu)
      const part = await loadObj8(u, { textureBase: u.slice(0, u.lastIndexOf('/') + 1), textureCache, lightLevels: true, ...(cdu ? { cockpitMaterial: cdu } : model.ga ? { cockpitMaterial: screenFor } : {}) })
      signal?.throwIfAborted()
      if (!part.parsed.draws.length || !part.parsed.vertices.every(Number.isFinite)) throw new Error(`Invalid cockpit object ${path}`)
      if (part.parsed.albedo && !part.material.map) throw new Error(`Missing cockpit texture for ${path}`)
      const see = entry.glass ?? /glass|fuzz/i.test(path)
      if (see) { part.material.transparent = true; part.material.depthWrite = false }
      part.material.emissiveIntensity = 0
      for (const l of part.lights) { l.material.transparent = part.material.transparent; l.material.depthWrite = part.material.depthWrite; l.material.emissiveIntensity = 0 }
      part.group.name = path.replace(/^objects\/|\.obj$/g, '')
      part.group.position.set(...offset)
      part.group.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = !see; o.receiveShadow = !see; o.frustumCulled = false } })
      parts.push(part); group.add(part.group)
    }
    // The panel mesh / click map. In the 737 its only enabled draw samples the panel bitmap; a light airplane's also
    // carries real geometry (the King Air's whole panel) with its own textures.
    signal?.throwIfAborted()
    const pu = url(model.panelObj)
    const panelPart = await loadObj8(pu, { textureBase: pu.slice(0, pu.lastIndexOf('/') + 1), textureCache, loadTextures: !!model.ga, cockpitMaterial: model.ga ? screenFor : panelMaterial, hitBoxes: true, ...(model.ga ? { lightLevels: true } : {}) })
    signal?.throwIfAborted()
    if (!panelPart.parsed.vertices.every(Number.isFinite) || (!model.ga && !panelPart.parsed.draws.some((d) => d.cockpit))) throw new Error(`Invalid panel mesh ${model.panelObj}`)
    panelPart.group.name = 'panel'
    panelPart.group.position.set(...offset)
    if (model.ga) panelPart.material.emissiveIntensity = 0
    panelPart.group.traverse((o) => { if (o instanceof THREE.Mesh) { o.frustumCulled = false; o.castShadow = !!model.ga; o.receiveShadow = !!model.ga } })
    parts.push(panelPart); group.add(panelPart.group)
    await panelLoaded
  } catch (error) { dispose(); throw error }

  // The panel mesh's animation nodes carry the manipulators' hit boxes, so they are posed too:
  // a lever's hit box follows the lever. (The drawn panel mesh itself sits at the root.)
  const animated = parts.flatMap((p) => p.animated)
  const hits = parts.flatMap((p) => p.hits)
  const lamps: LightLevelGroup[] = parts.flatMap((p) => p.lights)
  const cabinFill = { value: 0 }
  for (const p of parts) {
    if (/glass|fuzz/i.test(p.group.name) || (p.group.name === 'panel' && !model.ga)) continue
    addCabinFill(p.material, cabinFill)
    for (const l of p.lights) addCabinFill(l.material, cabinFill)
  }
  const datarefs = [...new Set(parts.filter((p) => p.group.name !== 'panel').flatMap((p) => p.parsed.anims.flatMap((n) => n.specs.map((s) => s.dataref))))]
  const eye = opts.place ? { ...opts.place.eye } : eyeFromObj(model)
  return {
    group, parts, panel, hits, dispose,
    evidence: {
      objects: parts.length,
      triangles: parts.reduce((n, p) => n + p.parsed.draws.filter((d) => d.lod === 0).reduce((m, d) => m + d.count / 3, 0), 0),
      datarefs, warnings: [...parts.flatMap((p) => p.warnings), ...(panel?.warnings ?? [])],
    },
    pose(read) { for (const node of animated) { applyObj8Anim(node, read); applyObj8Visibility(node, read) } applyObj8Lights(lamps, read) },
    eyePoint: () => eye,
    setLit(level) {
      const v = THREE.MathUtils.clamp(level, 0, 1)
      for (const p of parts) p.material.emissiveIntensity = v
      cabinFill.value = CABIN_DAYLIGHT_FILL * (1 - v)
    },
  }
}
