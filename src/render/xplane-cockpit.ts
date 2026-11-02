import * as THREE from 'three'
import { applyObj8Anim, applyObj8Visibility, loadObj8, type DatarefReader, type LoadedObj8 } from './xplane-obj8'
import { disposeAircraftGeometry } from './local-aircraft'

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
 * dataref reader and lights them.
 */

export interface XpCockpitModel {
  folder: string
  /** In draw order: opaque shell first, glass and fuzz last. */
  objs: string[]
  /** ACF datum → CG, feet (x right, y up, z aft). */
  cgFt: [number, number, number]
  /** Captain's eye in OBJ/ACF metres (x right, y up, z aft). */
  eyeObj: [number, number, number]
}

export const XP_COCKPIT_B738: XpCockpitModel = {
  folder: 'Boeing 737-800',
  objs: [
    'objects/738_cockpit_floor.obj', 'objects/738_cockpit_roof.obj', 'objects/738_cockpit_main.obj',
    'objects/738_cockpit_ovhd1.obj', 'objects/738_cockpit_ovhd2.obj', 'objects/738_cockpit_pdstl.obj',
    'objects/738_cockpit_seats.obj', 'objects/738_cockpit_CBpnls.obj', 'objects/738_cockpit_yokes.obj',
    'objects/738_cockpit_switch.obj', 'objects/738_cockpit_ind.obj', 'objects/FMS_screens.obj',
    'objects/738_cockpit_fuzz.obj', 'objects/738_cockpit_glass.obj',
  ],
  cgFt: [0, -2, 59.5],
  eyeObj: [-0.536, 0.71, 2.59],
}

const FT = 0.3048

type V3 = readonly [number, number, number]

/** One glass display opening in the instrument panel, as three corners in
 *  OBJ metres (top-left, top-right, bottom-left). Found by projecting every
 *  piece of geometry in front of the panel's blank black recess onto the
 *  recess plane (its TRUE geometric normal, ~(0, 0.29, 0.96) — not the mesh's shading normals): what is left uncovered is where the screens are. */
export interface XpScreenRect { id: string; kind: 'pfd' | 'nd' | 'eicas'; tl: V3; tr: V3; bl: V3 }
export const XP_B738_SCREENS: readonly XpScreenRect[] = [
  { id: 'capt-pfd', kind: 'pfd', tl: [-0.603, 0.351, 1.820], tr: [-0.425, 0.351, 1.820], bl: [-0.603, 0.184, 1.871] },
  { id: 'capt-nd', kind: 'nd', tl: [-0.388, 0.351, 1.820], tr: [-0.210, 0.351, 1.820], bl: [-0.388, 0.184, 1.871] },
  { id: 'center-eicas', kind: 'eicas', tl: [-0.067, 0.351, 1.820], tr: [0.111, 0.351, 1.820], bl: [-0.067, 0.184, 1.871] },
  { id: 'fo-nd', kind: 'nd', tl: [0.209, 0.351, 1.820], tr: [0.388, 0.351, 1.820], bl: [0.209, 0.184, 1.871] },
  { id: 'fo-pfd', kind: 'pfd', tl: [0.424, 0.351, 1.820], tr: [0.603, 0.351, 1.820], bl: [0.424, 0.184, 1.871] },
]

/** Where a plane showing a screen goes: centre, orientation (+z of the plane facing the pilot) and size. Pure. */
export function screenPlacement(r: XpScreenRect, proud = 0.0008): { center: THREE.Vector3; quaternion: THREE.Quaternion; width: number; height: number } {
  const tl = new THREE.Vector3(...r.tl), tr = new THREE.Vector3(...r.tr), bl = new THREE.Vector3(...r.bl)
  const right = tr.clone().sub(tl), down = bl.clone().sub(tl)
  const width = right.length(), height = down.length()
  const u = right.clone().normalize(), v = down.clone().multiplyScalar(-1).normalize()
  const n = new THREE.Vector3().crossVectors(u, v).normalize() // points toward the pilot (+z aft)
  const center = tl.clone().addScaledVector(right, 0.5).addScaledVector(down, 0.5).addScaledVector(n, proud)
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, n))
  return { center, quaternion, width, height }
}

/** The textures this cockpit shows on its glass: the app's own live displays. */
export interface XpScreenTextures { pfd: THREE.Texture; nd: THREE.Texture; eicas: THREE.Texture }

export interface XpCockpit {
  group: THREE.Group
  parts: LoadedObj8[]
  /** Re-pose every animated node from this reader. */
  pose(read: DatarefReader): void
  /** The captain's eye as the cockpit camera wants it: forward / lateral / up from the airplane origin, metres. */
  eyePoint(): { x: number; y: number; up: number }
  /** Put the app's live PFD / ND / EICAS on the glass display openings. */
  mountScreens(textures: XpScreenTextures): void
  /** 0 = day, 1 = full night: how strongly the LIT maps glow. */
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

export interface LoadXpCockpitOptions { signal?: AbortSignal; /** Shown on both CDU screens (X-Plane's `CDU739_n` device quads). */ cduTexture?: THREE.Texture }

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
  group.position.set(...model.cgFt.map((cg) => -cg * FT) as [number, number, number])
  const parts: LoadedObj8[] = []
  const textureCache = new Map<string, Promise<THREE.Texture | null>>()
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    disposeAircraftGeometry(group)
    group.removeFromParent(); group.clear()
    void Promise.all(textureCache.values()).then((maps) => new Set(maps).forEach((m) => m?.dispose()))
  }
  try {
    for (const path of model.objs) {
      signal?.throwIfAborted()
      const rel = `${model.folder}/${path}`
      const url = '/xp/aircraft/' + rel.split('/').map(encodeURIComponent).join('/')
      const cdu = /FMS_screens/.test(path) && opts.cduTexture
        ? new THREE.MeshBasicMaterial({ map: opts.cduTexture, toneMapped: false }) : undefined
      const part = await loadObj8(url, { textureBase: url.slice(0, url.lastIndexOf('/') + 1), textureCache, ...(cdu ? { cockpitMaterial: cdu } : {}) })
      signal?.throwIfAborted()
      if (!part.parsed.draws.length || !part.parsed.vertices.every(Number.isFinite)) throw new Error(`Invalid cockpit object ${path}`)
      if (part.parsed.albedo && !part.material.map) throw new Error(`Missing cockpit texture for ${path}`)
      const see = /glass|fuzz/i.test(path)
      if (see) { part.material.transparent = true; part.material.depthWrite = false }
      part.material.emissiveIntensity = 0
      part.group.name = path.replace(/^objects\/|\.obj$/g, '')
      part.group.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = !see; o.receiveShadow = !see; o.frustumCulled = false } })
      parts.push(part); group.add(part.group)
    }
  } catch (error) { dispose(); throw error }

  const animated = parts.flatMap((p) => p.animated)
  const datarefs = [...new Set(parts.flatMap((p) => p.parsed.anims.flatMap((n) => n.specs.map((s) => s.dataref))))]
  const eye = eyeFromObj(model)
  return {
    group, parts, dispose,
    evidence: {
      objects: parts.length,
      triangles: parts.reduce((n, p) => n + p.parsed.draws.filter((d) => d.lod === 0).reduce((m, d) => m + d.count / 3, 0), 0),
      datarefs, warnings: parts.flatMap((p) => p.warnings),
    },
    pose(read) { for (const node of animated) { applyObj8Anim(node, read); applyObj8Visibility(node, read) } },
    eyePoint: () => eye,
    mountScreens(textures) {
      for (const r of XP_B738_SCREENS) {
        const p = screenPlacement(r)
        const m = new THREE.Mesh(new THREE.PlaneGeometry(p.width, p.height), new THREE.MeshBasicMaterial({ map: textures[r.kind], toneMapped: false }))
        m.name = `screen:${r.id}`; m.position.copy(p.center); m.quaternion.copy(p.quaternion)
        m.frustumCulled = false
        group.add(m)
      }
    },
    setLit(level) {
      const v = THREE.MathUtils.clamp(level, 0, 1)
      for (const p of parts) p.material.emissiveIntensity = v
    },
  }
}
