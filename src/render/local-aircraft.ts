import * as THREE from 'three'
import type { AircraftMesh, SurfaceState } from './aircraft-mesh'
import { XP_MODELS, XP_PLACEMENT, XP_CONTROL_LIMITS, XP_SURFACE_CALIBRATION } from './xplane-manifest'
import { applyObj8Anim, applyObj8Visibility, loadObj8, type LoadedObj8 } from './xplane-obj8'

export interface LocalAircraftVisual {
  group: THREE.Group
  propDisc: THREE.Mesh
  surfaces: (s: SurfaceState) => void
  updateProp: (rpm: number, dt: number) => void
  dispose: () => void
}
const modelKey = (key: string): string => key === '172' ? 'C172' : key === '737' ? 'B738' : key
export function exactLocalModel(key: string) { return XP_MODELS[modelKey(key)] }
const signed = (v: number | undefined): number => Number.isFinite(v) ? THREE.MathUtils.clamp(v!, -1, 1) : 0
const unit = (v: number): number => Number.isFinite(v) ? THREE.MathUtils.clamp(v, 0, 1) : 0

/** Only inputs evidenced in the installed exterior OBJs. Degrees use the
 * authored dataref key range; unavailable doors/failures/vibration stay neutral. */
export function localDatarefReader(state: SurfaceState, angle: number, rpm: number, ranges: Map<string, number>, key?: string) {
  const calibration = key ? XP_SURFACE_CALIBRATION[modelKey(key)] : undefined
  const deflection = (input: number, limits: [number, number]): number => input === 0 ? 0 : input * (input < 0 ? limits[0] : limits[1])
  const degrees = (angle: number, limits: [number, number]): number => THREE.MathUtils.clamp(Number.isFinite(angle) ? angle * THREE.MathUtils.RAD2DEG : 0, -limits[0], limits[1])
  return (ref: string): number => {
    const control = ref.match(/\/(flap[12]|aileron[12]|speedbrake[12]|spoiler[12])_deg\[/)?.[1]
    const travel = (control ? ranges.get(control) : undefined) ?? ranges.get(ref) ?? 0
    if (/\/gear\/deploy_ratio\[/.test(ref)) return unit(state.gearPos)
    if (/\/(?:prop|engine)_rotation_angle_deg\[/.test(ref)) return Number.isFinite(angle) ? angle : 0
    if (/\/engine_rotation_speed_rad_sec\[/.test(ref)) return Number.isFinite(rpm) ? Math.max(0, rpm) * Math.PI / 30 : 0
    if (/\/prop_is_disc\[/.test(ref)) return rpm > 900 ? 1 : 0
    if (/\/thrust_reverser_deploy_ratio\[/.test(ref)) return unit(state.reverseFrac ?? 0)
    if (/\/flap[12]_deg\[/.test(ref)) return unit(state.flapFrac) * travel
    if (/\/slat[12]_deploy_ratio$/.test(ref) || ref === 'sim/flightmodel/controls/flaprat') return unit(state.flapFrac)
    if (/\/(speedbrake|spoiler)[12]_deg\[/.test(ref)) return unit(state.spoilerFrac) * travel
    if (ref === 'sim/flightmodel2/controls/elevator_trim' || ref === 'sim/cockpit2/controls/elevator_trim') return signed(state.trim)
    if (ref === 'sim/flightmodel2/controls/rudder_trim') return signed(state.rudderTrim)
    if (calibration) {
      if (/\/elevator[12]_deg\[/.test(ref) || /\/composite_elev[LR]$/.test(ref)) {
        const angle = calibration.stabilizer ? state.elevatorCommandRad ?? state.elevatorRad : state.elevatorRad
        return angle !== undefined ? degrees(angle, calibration.elevator) : deflection(-signed(state.pitch), calibration.elevator)
      }
      if (/\/rudder[12]_deg\[/.test(ref)) {
        const yaw = signed(state.yaw)
        return yaw * (ref.includes('rudder2') ? calibration.rudder2 ?? 0 : calibration.rudder[yaw < 0 ? 0 : 1])
      }
      if (ref === 'sim/flightmodel2/controls/stabilizer_deflection_degrees' && calibration.stabilizer) {
        const angle = state.trimRad ?? state.stabilizerRad
        const value = angle !== undefined ? degrees(angle, calibration.stabilizer) : deflection(-signed(state.trim), calibration.stabilizer)
        return value * (calibration.stabilizerSign ?? 1)
      }
      if (/\/aileron[12]_deg\[/.test(ref) || /\/composite_(inner|outer)[LR]_ail$/.test(ref)) {
        const index = Number(ref.match(/\[(\d+)\]/)?.[1] ?? -1)
        const side = calibration.leftAilerons.includes(index) || /L_ail$/.test(ref) ? -1 : calibration.rightAilerons.includes(index) || /R_ail$/.test(ref) ? 1 : 0
        return deflection(-signed(state.roll) * side, calibration.aileron)
      }
    }
    return 0
  }
}

/** Disposes geometry/materials only. Procedural atlas caches own their maps. */
export function disposeAircraftGeometry(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>()
  root.traverse(o => { if (o instanceof THREE.Mesh) {
    geometries.add(o.geometry)
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) materials.add(material)
  } })
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose())
}

// At most two aircraft can parse/fetch textures concurrently, including
// evicted requests whose current image decode is not abortable by Three.
let activeLoads = 0
const waitingLoads: Array<() => void> = []
export async function loadLocalAircraft(key: string, signal?: AbortSignal): Promise<LocalAircraftVisual | null> {
  if (!exactLocalModel(key)) return null
  if (activeLoads >= 2) await new Promise<void>(resolve => waitingLoads.push(resolve))
  else activeLoads++
  try { signal?.throwIfAborted(); return await loadLocalAircraftInSlot(key, signal) }
  finally {
    const next = waitingLoads.shift()
    if (next) next()
    else activeLoads--
  }
}

async function loadLocalAircraftInSlot(key: string, signal?: AbortSignal): Promise<LocalAircraftVisual | null> {
  const entry = exactLocalModel(key), placement = XP_PLACEMENT[modelKey(key)]
  if (!entry || !placement) return null
  const manifest = await fetch('/xp/manifest.json', {signal: signal ?? null})
  if (!manifest.ok || !(await manifest.json() as {available?: boolean}).available) return null
  const group = new THREE.Group()
  group.name = `local-aircraft:${modelKey(key)}`
  const offset = placement.attachmentFt ?? [0, 0, 0]
  group.position.set(...placement.cgFt.map((cg, i) => (offset[i]! - cg) * .3048) as [number, number, number])
  const parts: LoadedObj8[] = []
  const textureCache = new Map<string, Promise<THREE.Texture | null>>()
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    disposeAircraftGeometry(group)
    group.removeFromParent(); group.clear()
    // All promises have settled by publication (or the catch below). One
    // owner per aircraft; aliases across materials/OBJ parts dispose once.
    void Promise.all(textureCache.values()).then(maps => new Set(maps).forEach(map => map?.dispose()))
  }
  try {
    // Sequential parts bound parse/texture peak memory and share a per-model
    // texture cache (the Cessna gear/prop share the fuselage's 4K atlas).
    for (const path of entry.objs) {
      signal?.throwIfAborted()
      const url = '/xp/aircraft/' + path.split('/').map(encodeURIComponent).join('/')
      const part = await loadObj8(url, {textureBase: url.slice(0, url.lastIndexOf('/') + 1), textureCache})
      if (/\/[^/]*(?:cfm|trent|engine)[^/]*\.obj$/i.test(path)) part.group.name = 'engineNacelle'
      parts.push(part); group.add(part.group)
      signal?.throwIfAborted()
      if (!part.parsed.draws.length || !part.parsed.vertices.every(Number.isFinite)) throw new Error(`Invalid exterior ${path}`)
      if (part.parsed.albedo && !part.material.map) throw new Error(`Missing exterior texture ${path}`)
      // Alpha atlases carry window transparency. Opaque body parts retain
      // depth writing; glass layers use their own authored albedo alpha.
      if (/glass|alpha|blend/i.test(path)) {
        part.material.transparent = true
        part.material.depthWrite = false
      }
      part.material.emissiveIntensity = .12
      part.group.traverse(o => { if (o instanceof THREE.Mesh) {
        o.castShadow = !part.material.transparent
        o.receiveShadow = !part.material.transparent
      } })
    }
    const animated = parts.flatMap(p => p.animated)
    const ranges = new Map<string, number>(Object.entries(XP_CONTROL_LIMITS[modelKey(key)] ?? {}))
    for (const part of parts) for (const node of part.parsed.anims) for (const spec of node.specs) {
      if (spec.kind === 'rotate' || spec.kind === 'trans') {
        const max = Math.max(0, ...spec.keys.map(k => Math.abs(k[0])))
        ranges.set(spec.dataref, Math.max(ranges.get(spec.dataref) ?? 0, max))
      }
    }
    let state: SurfaceState = {flapFrac: 0, spoilerFrac: 0, gearPos: 1}, angle = 0, rpm = 0
    const surfaceRefs = [...new Set(parts.flatMap(p => p.parsed.anims.flatMap(n => n.specs.map(s => s.dataref))))]
      .filter(ref => /\/(?:aileron|elevator|rudder|flap|slat|spoiler|speedbrake)[12]_|\/composite_|\/stabilizer_deflection|\/controls\/(?:elevator|rudder)_trim/.test(ref))
    const pose = (): void => {
      const read = localDatarefReader(state, angle, rpm, ranges, key)
      for (const node of animated) { applyObj8Anim(node, read); applyObj8Visibility(node, read) }
      group.userData.surfaceValues = Object.fromEntries(surfaceRefs.map(ref => [ref, read(ref)]))
    }
    pose()
    group.userData.assetEvidence = {
      objects: parts.length,
      surfaceRefs,
      triangles: parts.reduce((sum, p) => sum + p.parsed.draws.filter(d => d.lod === 0).reduce((n, d) => n + d.count / 3, 0), 0),
      textureSets: textureCache.size,
      warnings: parts.flatMap(p => p.warnings),
    }
    const propNode = animated.find(node => (node.userData.anim as Array<{dataref: string}>).some(spec => /\/(?:prop|engine)_rotation_angle_deg\[/.test(spec.dataref)))
    let propDisc: THREE.Mesh | undefined
    ;(propNode ?? group.getObjectByName('engineNacelle') ?? group).traverse(o => { if (!propDisc && o instanceof THREE.Mesh) propDisc = o })
    if (!propDisc) throw new Error('Invalid OBJ8 exterior: no focus geometry')
    return {group, propDisc, dispose, surfaces: s => { state = {...s}; pose() }, updateProp: (nextRpm, dt) => {
      rpm = Number.isFinite(nextRpm) ? Math.max(0, nextRpm) : 0; angle = (angle + rpm * 6 * (Number.isFinite(dt) ? Math.max(0, dt) : 0)) % 360; pose()
    }}
  } catch (error) { dispose(); throw error }
}

/** Wrap immediately, swap only after success, preserve the public root and
 * attachments. Call once directly after the synchronous procedural build. */
export async function upgradePlayerAircraft(ship: AircraftMesh, key: string, load: (signal?: AbortSignal) => Promise<LocalAircraftVisual | null> = signal => loadLocalAircraft(key, signal)): Promise<void> {
  if (ship.group.userData.localUpgradeStarted) return
  ship.group.userData.localUpgradeStarted = true
  ship.group.userData.visualSource = 'procedural'
  const exterior = new THREE.Group()
  exterior.name = 'player-exterior'
  exterior.userData.exteriorCabin = true
  const original = [...ship.group.children]
  exterior.add(...original); ship.group.add(exterior)
  const fallbackSurfaces = ship.surfaces
  let state: SurfaceState = {flapFrac: 0, spoilerFrac: 0, gearPos: 1}
  let loaded: LocalAircraftVisual | null = null, disposed = false
  ship.surfaces = s => { state = {...s}; if (loaded) loaded.surfaces(s); else fallbackSurfaces?.(s) }
  const controller = new AbortController()
  const previousDispose = ship.group.userData.dispose as (() => void) | undefined
  ship.group.userData.dispose = () => {
    if (disposed) return
    disposed = true; controller.abort(); loaded?.dispose(); previousDispose?.()
  }
  try {
    const next = await load(controller.signal)
    if (!next) return
    if (disposed) { next.dispose(); return }
    next.surfaces(state)
    exterior.add(next.group)
    for (const child of original) { exterior.remove(child); disposeAircraftGeometry(child) }
    loaded = next
    ship.updateProp = next.updateProp
    ship.propDisc = next.propDisc
    delete ship.group.userData.propDiscs
    ship.group.userData.visualSource = 'local-xplane'
    ship.group.userData.assetEvidence = next.group.userData.assetEvidence
  } catch (error) {
    ship.group.userData.localAssetError = error instanceof Error ? error.message : String(error)
  }
}
