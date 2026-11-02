import * as THREE from 'three'
import { DDSLoader } from 'three/examples/jsm/loaders/DDSLoader.js'

/**
 * X-Plane OBJ8 loader.
 *
 * Layers:
 *   parseObj8(text)            pure text → typed arrays + draw ranges +
 *                              animation tree. No three.js objects, no DOM,
 *                              no network — unit-testable in node.
 *   buildObj8(parsed, mat)     three.js scene graph from a parse (node-safe).
 *   loadObj8(url, opts)        fetch + parse + textures + build.
 *
 * Coordinate frame: OBJ8 is X right, Y up, Z aft (toward the tail), metres —
 * identical to our model frame (aircraft-mesh.ts: nose −z, up +y, right +x),
 * so vertices, normals and animation axes pass through untouched.
 *
 * Animation model: one THREE.Group per ANIM_begin block; the block's
 * ANIM_rotate / ANIM_trans / ANIM_hide / ANIM_show commands are recorded in
 * file order on group.userData.anim (AnimSpec[]). X-Plane evaluates an OBJ
 * like an OpenGL matrix stack — ANIM_begin pushes, each rotate/trans
 * multiplies the current matrix, TRIS draws with whatever is current,
 * ANIM_end pops — so a group's local matrix is M1 · M2 · … · Mn in command
 * order, and a transform listed AFTER some TRIS in the same block must not
 * move them; the parser opens an implicit child node in that case. The
 * static build poses every group at dataref value 0; applyObj8Anim() can
 * re-pose a group from live dataref values later.
 */

// ---------------------------------------------------------------- types --

export type Vec3 = [number, number, number]

export type AnimSpec =
  | {
      kind: 'rotate'
      /** Rotation axis in the block's local frame (not normalised). */
      axis: Vec3
      /** [datarefValue, degrees] pairs, ascending by value. */
      keys: Array<[number, number]>
      dataref: string
      /** ANIM_keyframe_loop period, when present. */
      loop?: number
    }
  | {
      kind: 'trans'
      /** [datarefValue, offset xyz] pairs, ascending by value. */
      keys: Array<[number, Vec3]>
      dataref: string
      loop?: number
    }
  | {
      /** hide: hidden while v1 <= value <= v2; show: the inverse. */
      kind: 'hide' | 'show'
      v1: number
      v2: number
      dataref: string
    }

/** One ANIM_begin block (or an implicit sub-block, see header comment). */
export interface AnimNode {
  id: number
  /** Index of the enclosing node, −1 at the root. Parents precede children. */
  parent: number
  specs: AnimSpec[]
}

/** ATTR_light_level: the brightness of the lit texture on the geometry that follows,
 *  `(dataref − v1) / (v2 − v1)` clamped to 0…1, at `nits` (null when the file gives none). */
export interface Obj8Light { v1: number; v2: number; dataref: string; nits: number | null }

/** An ATTR_manip_*: what a click or drag on the geometry that follows does in X-Plane. */
export interface Obj8Manip {
  /** The ATTR_manip_ suffix: command, command_knob, command_switch_up_down, axis_knob, toggle, drag_rotate, … */
  type: string
  cursor: string
  /** Command names (command, knob, switch types), in file order. */
  commands: string[]
  /** Dataref names (axis_knob, toggle, drag types), in file order. */
  datarefs: string[]
  tooltip: string
}

/** A maximal run of index-contiguous TRIS with no state change between. */
export interface Obj8Draw {
  /** Offset into `indices`. */
  start: number
  /** Index count (multiple of 3). */
  count: number
  /** Anim node ids from outermost to innermost; empty at the root. */
  animPath: number[]
  /** Index into `lods` (0 when the file has no ATTR_LOD). */
  lod: number
  /** Emitted under ATTR_cockpit: X-Plane draws it with the panel texture. */
  cockpit: boolean
  /** The ATTR_light_level in effect (a lamp, a backlight), when there is one. */
  light?: Obj8Light
  /** A hit box: disabled geometry under a manipulator, kept only when parsed with `hitBoxes`. */
  hidden?: boolean
  manip?: Obj8Manip
}

export interface ParsedObj8 {
  vertices: Float32Array
  normals: Float32Array
  uvs: Float32Array
  indices: Uint32Array
  draws: Obj8Draw[]
  anims: AnimNode[]
  /** Every texture file named (albedo, lit, normal), unique, file order. */
  textures: string[]
  albedo?: string
  lit?: string
  normal?: string
  materialGloss?: string
  gloss?: string
  splitNormal?: boolean
  /** GLOBAL_specular ratio, when present. */
  specular?: number
  /** GLOBAL_no_blend alpha cutoff, when present. */
  noBlend?: number
  /** NORMAL_METALNESS: normal map RG=normal, B=reflectance, A=gloss. */
  normalMetalness: boolean
  /** ATTR_LOD bands [near, far] in file order. */
  lods: Array<[number, number]>
  pointCounts?: { tris: number; lines: number; lights: number; indices: number }
  /** Unknown commands, malformed lines, structural oddities (deduplicated). */
  warnings: string[]
}

/** Number of leading numeric fields after the cursor, and how many dataref / command names follow, per manipulator type. */
const MANIP_SHAPE: Record<string, { numbers: number; commands: number; datarefs: number }> = {
  command: { numbers: 0, commands: 1, datarefs: 0 },
  command_axis: { numbers: 3, commands: 2, datarefs: 0 },
  command_knob: { numbers: 0, commands: 2, datarefs: 0 },
  command_switch_up_down: { numbers: 0, commands: 2, datarefs: 0 },
  command_switch_left_right: { numbers: 0, commands: 2, datarefs: 0 },
  axis_knob: { numbers: 4, commands: 0, datarefs: 1 },
  toggle: { numbers: 2, commands: 0, datarefs: 1 },
  drag_rotate: { numbers: 13, commands: 0, datarefs: 2 },
  drag_xy: { numbers: 6, commands: 0, datarefs: 2 },
  drag_axis: { numbers: 7, commands: 0, datarefs: 1 },
  push: { numbers: 2, commands: 0, datarefs: 1 },
  radio: { numbers: 1, commands: 0, datarefs: 1 },
  delta: { numbers: 4, commands: 0, datarefs: 1 },
  wheel: { numbers: 1, commands: 0, datarefs: 0 },
  noop: { numbers: 0, commands: 0, datarefs: 0 },
}

/** `ATTR_manip_<type> <cursor> <numbers…> <commands|datarefs…> <tooltip…>`; null for ATTR_manip_none / unknown shapes. */
function parseManip(cmd: string, t: string[]): Obj8Manip | null {
  const type = cmd.slice('ATTR_manip_'.length)
  const shape = MANIP_SHAPE[type]
  if (!shape) return null
  let i = 2 + shape.numbers
  const commands = t.slice(i, i + shape.commands); i += shape.commands
  const datarefs = t.slice(i, i + shape.datarefs); i += shape.datarefs
  return { type, cursor: t[1] ?? '', commands, datarefs, tooltip: t.slice(i).join(' ') }
}

function sameLight(a: Obj8Light | undefined, b: Obj8Light | null): boolean {
  if (!a || !b) return !a && !b
  return a.dataref === b.dataref && a.v1 === b.v1 && a.v2 === b.v2 && a.nits === b.nits
}

// ---------------------------------------------------------------- parse --

/** Growable typed array: one code path whether or not POINT_COUNTS is present. */
class Grow<T extends Float32Array | Uint32Array> {
  private buf: T
  private n = 0
  constructor(private readonly Ctor: new (n: number) => T, cap: number) {
    this.buf = new Ctor(Math.max(16, cap | 0))
  }
  reserve(cap: number): void {
    if (cap <= this.buf.length) return
    const b = new this.Ctor(cap)
    b.set(this.buf.subarray(0, this.n) as ArrayLike<number>)
    this.buf = b
  }
  push(v: number): void {
    if (this.n === this.buf.length) this.reserve(this.buf.length * 2)
    this.buf[this.n++] = v
  }
  get length(): number {
    return this.n
  }
  done(): T {
    return this.buf.slice(0, this.n) as T
  }
}

/** Commands we deliberately ignore without a warning (prefix match). */
const IGNORED = /^(ATTR_|LIGHT|GLOBAL_|TEXTURE|VLINE|VLIGHT|LINES|smoke_|PARTICLE|EMITTER|MAGNET|SLOPE_|TILTED|REQUIRE_|BLEND_|COCKPIT_|DECAL|NO_SHADOW|SLUNG|WAKE|THERMAL|EXPORT|SPECULAR|BUMP_LEVEL|NO_BLEND|ATTR_LOD|SHADOW|ATTR_layer_group|ATTR_draped|LOD)/

const byValue = <K extends [number, unknown]>(a: K, b: K): number => a[0] - b[0]

export function parseObj8(text: string, opts: { hitBoxes?: boolean } = {}): ParsedObj8 {
  const warnings = new Set<string>()
  const warn = (s: string): void => {
    warnings.add(s)
  }

  const pos = new Grow(Float32Array, 3 * 1024)
  const nrm = new Grow(Float32Array, 3 * 1024)
  const uv = new Grow(Float32Array, 2 * 1024)
  const idx = new Grow(Uint32Array, 3 * 1024)
  const draws: Obj8Draw[] = []
  const anims: AnimNode[] = []
  const textures: string[] = []
  const lods: Array<[number, number]> = []
  let albedo: string | undefined
  let lit: string | undefined
  let materialGloss: string | undefined
  let gloss: string | undefined
  let splitNormal = false
  let normal: string | undefined
  let specular: number | undefined
  let noBlend: number | undefined
  let normalMetalness = false
  let pointCounts: ParsedObj8['pointCounts']

  // Block stack: explicit entries come from ANIM_begin, implicit ones are
  // opened when a transform appears after draws in the same block.
  const stack: Array<{ id: number; explicit: boolean }> = []
  const nodeHasDraws: boolean[] = []
  let lastDraw: Obj8Draw | null = null
  let drawEnabled = true
  let cockpit = false
  let light: Obj8Light | null = null
  let manip: Obj8Manip | null = null
  let lodIndex = 0
  // Held in an object: it is assigned inside addSpec(), which TS's flow
  // analysis can't see, so a bare `let` would narrow to null at the read.
  const recent: { spec: AnimSpec | null } = { spec: null }
  let pending:
    | { kind: 'rotate'; axis: Vec3; keys: Array<[number, number]>; dataref: string }
    | { kind: 'trans'; keys: Array<[number, Vec3]>; dataref: string }
    | null = null

  const addTexture = (name: string): string => {
    const n = name.replace(/\\/g, '/')
    if (!textures.includes(n)) textures.push(n)
    return n
  }
  const top = (): { id: number; explicit: boolean } | null =>
    stack.length ? stack[stack.length - 1]! : null
  const pushNode = (explicit: boolean): number => {
    const id = anims.length
    anims.push({ id, parent: top()?.id ?? -1, specs: [] })
    nodeHasDraws.push(false)
    stack.push({ id, explicit })
    lastDraw = null
    return id
  }
  const addSpec = (spec: AnimSpec, cmd: string): void => {
    let t = top()
    if (!t) {
      warn(`${cmd} outside ANIM_begin (ignored)`)
      return
    }
    // Transforms only affect geometry that follows them: if this block has
    // already drawn, everything from here on lives in an implicit child.
    if (nodeHasDraws[t.id]) {
      pushNode(false)
      t = top()!
    }
    anims[t.id]!.specs.push(spec)
    recent.spec = spec
  }

  const lines = text.split(/\r?\n/)
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!.trim()
    if (!line || line.startsWith('#')) continue
    const t = line.split(/\s+/)
    const hashAt = t.findIndex((s) => s.startsWith('#'))
    if (hashAt > 0) t.length = hashAt
    const cmd = t[0]!
    let bad = false
    const n = (i: number): number => {
      const v = +t[i]!
      if (v !== v) {
        bad = true
        return 0
      }
      return v
    }
    const rest = (from: number): string => t.slice(from).join(' ')

    // Any command other than geometry data / TRIS ends the current TRIS run
    // (ATTR_*, LIGHT_*, ANIM_* … all change state X-Plane draws with).
    if (cmd !== 'TRIS' && cmd !== 'VT' && cmd !== 'IDX' && cmd !== 'IDX10') lastDraw = null

    switch (cmd) {
      case 'I':
      case 'A':
      case 'OBJ':
        break
      case 'VT':
        pos.push(n(1))
        pos.push(n(2))
        pos.push(n(3))
        nrm.push(n(4))
        nrm.push(n(5))
        nrm.push(n(6))
        uv.push(n(7))
        uv.push(n(8))
        break
      case 'IDX10':
      case 'IDX':
        for (let i = 1; i < t.length; i++) {
          const value = n(i)
          if (!Number.isInteger(value) || value < 0) warn(`invalid index at line ${li + 1}`)
          idx.push(value)
        }
        break
      case 'TRIS': {
        const start = n(1)
        const count = n(2)
        if (bad) break
        const hidden = !drawEnabled
        if (hidden && !(opts.hitBoxes && manip)) break
        if (lastDraw && lastDraw.start + lastDraw.count === start && lastDraw.cockpit === cockpit && sameLight(lastDraw.light, light) && !!lastDraw.hidden === hidden && lastDraw.manip === (hidden ? manip ?? undefined : undefined)) {
          lastDraw.count += count
        } else {
          lastDraw = { start, count, animPath: stack.map((e) => e.id), lod: lodIndex, cockpit, ...(light ? { light } : {}), ...(hidden && manip ? { hidden: true, manip } : {}) }
          draws.push(lastDraw)
        }
        // A hit box is not drawn, so it does not make its block a drawn one.
        if (!hidden) for (const e of stack) nodeHasDraws[e.id] = true
        break
      }
      case 'POINT_COUNTS':
        pointCounts = { tris: n(1), lines: n(2), lights: n(3), indices: n(4) }
        if (!bad) {
          pos.reserve(pointCounts.tris * 3)
          nrm.reserve(pointCounts.tris * 3)
          uv.reserve(pointCounts.tris * 2)
          idx.reserve(pointCounts.indices)
        }
        break
      case 'TEXTURE':
        albedo = addTexture(rest(1))
        break
      case 'TEXTURE_LIT':
        lit = addTexture(rest(1))
        break
      case 'TEXTURE_NORMAL':
        normal = addTexture(rest(1))
        break
      case 'TEXTURE_MAP':
        // XP12: TEXTURE_MAP <normal|material_gloss|gloss> <file>
        if (t[1] === 'normal') { normal = addTexture(rest(2)); splitNormal = true }
        if (t[1] === 'material_gloss') materialGloss = addTexture(rest(2))
        if (t[1] === 'gloss') gloss = addTexture(rest(2))
        break
      case 'GLOBAL_specular':
        specular = n(1)
        break
      case 'GLOBAL_no_blend':
        noBlend = t.length > 1 ? n(1) : 0.5
        break
      case 'NORMAL_METALNESS':
        normalMetalness = true
        break
      case 'ATTR_LOD':
        lods.push([n(1), n(2)])
        lodIndex = lods.length - 1
        break
      case 'ATTR_light_level':
        light = t[3] ? { v1: n(1), v2: n(2), dataref: t[3], nits: t.length > 4 && Number.isFinite(Number(t[4])) ? Number(t[4]) : null } : null
        break
      case 'ATTR_light_level_reset':
        light = null
        break
      case 'ATTR_draw_disable':
        drawEnabled = false
        break
      case 'ATTR_draw_enable':
        drawEnabled = true
        break
      case 'ATTR_cockpit':
      case 'ATTR_cockpit_region':
      case 'ATTR_cockpit_lit_only':
      case 'ATTR_cockpit_device':
        cockpit = true
        break
      case 'ATTR_no_cockpit':
        cockpit = false
        break
      case 'ANIM_begin':
        pushNode(true)
        break
      case 'ANIM_end': {
        if (!stack.length) {
          warn('ANIM_end without ANIM_begin')
          break
        }
        while (stack.length && !stack[stack.length - 1]!.explicit) stack.pop()
        stack.pop()
        break
      }
      case 'ANIM_rotate': {
        const keys: Array<[number, number]> = [[t.length === 6 ? 0 : n(6), n(4)], [t.length === 6 ? 0 : n(7), n(5)]]
        const spec: AnimSpec = { kind: 'rotate', axis: [n(1), n(2), n(3)], keys: keys.sort(byValue), dataref: t[8] ?? 'none' }
        if (!bad) addSpec(spec, cmd)
        break
      }
      case 'ANIM_trans': {
        const keys: Array<[number, Vec3]> = [
          [t.length === 7 ? 0 : n(7), [n(1), n(2), n(3)]],
          [t.length === 7 ? 0 : n(8), [n(4), n(5), n(6)]],
        ]
        const spec: AnimSpec = { kind: 'trans', keys: keys.sort(byValue), dataref: t[9] ?? 'none' }
        if (!bad) addSpec(spec, cmd)
        break
      }
      case 'ANIM_rotate_begin':
        pending = { kind: 'rotate', axis: [n(1), n(2), n(3)], keys: [], dataref: t[4] ?? 'none' }
        break
      case 'ANIM_rotate_key':
        if (pending?.kind === 'rotate') pending.keys.push([n(1), n(2)])
        else warn(`${cmd} outside ANIM_rotate_begin`)
        break
      case 'ANIM_rotate_end':
        if (pending?.kind === 'rotate') {
          pending.keys.sort(byValue)
          addSpec(pending, cmd)
        } else warn(`${cmd} without ANIM_rotate_begin`)
        pending = null
        break
      case 'ANIM_trans_begin':
        pending = { kind: 'trans', keys: [], dataref: t[1] ?? 'none' }
        break
      case 'ANIM_trans_key':
        if (pending?.kind === 'trans') pending.keys.push([n(1), [n(2), n(3), n(4)]])
        else warn(`${cmd} outside ANIM_trans_begin`)
        break
      case 'ANIM_trans_end':
        if (pending?.kind === 'trans') {
          pending.keys.sort(byValue)
          addSpec(pending, cmd)
        } else warn(`${cmd} without ANIM_trans_begin`)
        pending = null
        break
      case 'ANIM_keyframe_loop':
        if (recent.spec && (recent.spec.kind === 'rotate' || recent.spec.kind === 'trans')) recent.spec.loop = n(1)
        break
      case 'ANIM_hide':
      case 'ANIM_show': {
        const spec: AnimSpec = { kind: cmd === 'ANIM_hide' ? 'hide' : 'show', v1: n(1), v2: n(2), dataref: t[3] ?? 'none' }
        if (!bad) addSpec(spec, cmd)
        break
      }
      default:
        if (cmd === 'ATTR_manip_none') manip = null
        else if (cmd === 'ATTR_manip_keyframe') { /* belongs to the drag_rotate before it */ }
        else if (cmd.startsWith('ATTR_manip_')) manip = parseManip(cmd, t)
        else if (/^\d+$/.test(cmd)) {
          if (cmd !== '800') warn(`unsupported OBJ version ${cmd}`)
        } else if (!IGNORED.test(cmd)) {
          warn(`unknown command ${cmd}`)
        }
    }
    if (bad) warn(`malformed ${cmd} at line ${li + 1}`)
  }

  if (stack.length) warn(`${stack.filter((e) => e.explicit).length} ANIM_begin left open at end of file`)
  if (pending) warn('keyframe table left open at end of file')

  const indices = idx.done()
  for (const d of draws) {
    if (d.start + d.count > indices.length) {
      warn(`TRIS ${d.start} ${d.count} exceeds index stream (${indices.length})`)
      d.count = Math.max(0, indices.length - d.start)
    }
  }

  const out: ParsedObj8 = {
    vertices: pos.done(),
    normals: nrm.done(),
    uvs: uv.done(),
    indices,
    draws,
    anims,
    textures,
    normalMetalness,
    lods,
    warnings: [...warnings],
  }
  if (albedo !== undefined) out.albedo = albedo
  if (lit !== undefined) out.lit = lit
  if (normal !== undefined) out.normal = normal
  if (materialGloss !== undefined) out.materialGloss = materialGloss
  if (gloss !== undefined) out.gloss = gloss
  if (splitNormal) out.splitNormal = true
  if (specular !== undefined) out.specular = specular
  if (noBlend !== undefined) out.noBlend = noBlend
  if (pointCounts !== undefined) out.pointCounts = pointCounts
  return out
}

// ------------------------------------------------------------ animation --

/** Piecewise-linear lookup in an ascending key table
 *  with linear extrapolation outside the table (OBJ8 specification). Equal-valued neighbours
 *  behave as a step. Empty table → 0. */
export function evalObj8Keys(keys: ReadonlyArray<readonly [number, number]>, value: number): number {
  const last = keys.length - 1
  if (last < 0) return 0
  if (last === 0) return keys[0]![1]
  const segment = (a: readonly [number, number], b: readonly [number, number]): number =>
    b[0] === a[0] ? (value <= a[0] ? a[1] : b[1]) : a[1] + (b[1] - a[1]) * (value - a[0]) / (b[0] - a[0])
  if (value <= keys[0]![0]) return segment(keys[0]!, keys[1]!)
  if (value >= keys[last]![0]) return segment(keys[last - 1]!, keys[last]!)
  for (let i = 0; i < last; i++) {
    const [v0, a0] = keys[i]!
    const [v1, a1] = keys[i + 1]!
    if (value <= v1) {
      if (v1 === v0) return a1
      return a0 + ((a1 - a0) * (value - v0)) / (v1 - v0)
    }
  }
  return keys[last]![1]
}

function evalVec3Keys(keys: ReadonlyArray<readonly [number, Vec3]>, value: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(
    evalObj8Keys(keys.map((k) => [k[0], k[1][0]] as const), value),
    evalObj8Keys(keys.map((k) => [k[0], k[1][1]] as const), value),
    evalObj8Keys(keys.map((k) => [k[0], k[1][2]] as const), value),
  )
}

export type DatarefReader = (dataref: string) => number

/** Dataref reader for the static pose: everything reads 0. */
export const ZERO_DATAREFS: DatarefReader = () => 0

const _axis = new THREE.Vector3()
const _vec = new THREE.Vector3()
const _step = new THREE.Matrix4() // per-command scratch inside obj8AnimMatrix
const _acc = new THREE.Matrix4() // accumulator for applyObj8Anim (must not alias _step)

function animationValue(s: Extract<AnimSpec, {kind: 'rotate' | 'trans'}>, read: DatarefReader): number {
  const value = read(s.dataref)
  const start = s.keys[0]?.[0] ?? 0
  return s.loop && s.loop > 0 ? start + ((value - start) % s.loop + s.loop) % s.loop : value
}

/** Compose a block's transform commands (in file order, GL-stack style:
 *  M = M1 · M2 · … · Mn) at the given dataref values. */
export function obj8AnimMatrix(specs: ReadonlyArray<AnimSpec>, read: DatarefReader, out = new THREE.Matrix4()): THREE.Matrix4 {
  out.identity()
  for (const s of specs) {
    if (s.kind === 'rotate') {
      _axis.set(s.axis[0], s.axis[1], s.axis[2])
      if (_axis.lengthSq() === 0) continue
      const deg = evalObj8Keys(s.keys, animationValue(s, read))
      if (deg === 0) continue
      _step.makeRotationAxis(_axis.normalize(), deg * THREE.MathUtils.DEG2RAD)
      out.multiply(_step)
    } else if (s.kind === 'trans') {
      evalVec3Keys(s.keys, animationValue(s, read), _vec)
      _step.makeTranslation(_vec.x, _vec.y, _vec.z)
      out.multiply(_step)
    }
  }
  return out
}

/** Pose one animated group (built by buildObj8) from dataref values. Only
 *  transforms; visibility is a separate call so the static build can keep
 *  everything visible. */
export function applyObj8Anim(group: THREE.Object3D, read: DatarefReader): void {
  const specs = group.userData.anim as AnimSpec[] | undefined
  if (!specs) return
  obj8AnimMatrix(specs, read, _acc).decompose(group.position, group.quaternion, group.scale)
}

/** Apply ANIM_hide / ANIM_show for one group (later commands win). */
export function applyObj8Visibility(group: THREE.Object3D, read: DatarefReader): void {
  const specs = group.userData.anim as AnimSpec[] | undefined
  if (!specs) return
  let visible = true
  for (const s of specs) {
    if (s.kind !== 'hide' && s.kind !== 'show') continue
    const v = read(s.dataref)
    if (v >= s.v1 && v <= s.v2) visible = s.kind === 'show'
  }
  group.visible = visible
}

// ---------------------------------------------------------------- build --

/** One lamp / backlight: a draw group whose lit texture glows by its own dataref. */
export interface LightLevelGroup { material: THREE.MeshStandardMaterial; v1: number; v2: number; dataref: string; nits: number | null }

/** `(value − v1) / (v2 − v1)` clamped to 0…1; a degenerate range is a switch at v1. */
export function lightLevelValue(value: number, v1: number, v2: number): number {
  if (!Number.isFinite(value)) return 0
  if (v1 === v2) return value >= v1 ? 1 : 0
  return Math.min(1, Math.max(0, (value - v1) / (v2 - v1)))
}

/** The reference brightness (nits) that the cockpit's ordinary lit glow stands for. */
const LIT_REFERENCE_NITS = 500
/** No lamp is allowed to glow more than this many times the reference (ACES + bloom would flare the screen). */
const MAX_LIGHT_INTENSITY = 8

/** Set every lamp's glow from the datarefs: level × brightness ÷ 500 nits. */
export function applyObj8Lights(groups: readonly LightLevelGroup[], read: DatarefReader): void {
  for (const g of groups) {
    const level = lightLevelValue(read(g.dataref), g.v1, g.v2)
    g.material.emissiveIntensity = Math.min(MAX_LIGHT_INTENSITY, (level * (g.nits ?? LIT_REFERENCE_NITS)) / LIT_REFERENCE_NITS)
  }
}

export interface BuildObj8Options {
  /** Build the parsed hit boxes (parseObj8 with `hitBoxes`) as invisible, raycastable meshes carrying `userData.manip`. */
  hitBoxes?: boolean
  /** Give every distinct ATTR_light_level its own material so it can glow on its own dataref
   *  (cockpits). Off by default: exteriors keep their single shared material. */
  lightLevels?: boolean
  /** Which ATTR_LOD band to build (default 0 = nearest). Building every
   *  band would stack the LOD meshes on top of each other. */
  lod?: number
  /** Material for ATTR_cockpit geometry (X-Plane's panel texture); defaults
   *  to a plain untextured material so panel UVs don't sample the albedo. */
  cockpitMaterial?: THREE.Material
  name?: string
}

/** Validate before creating GPU resources or publishing a partial exterior. */
function validateObj8(parsed: ParsedObj8, lod: number): void {
  const count = parsed.vertices.length / 3
  const draws = parsed.draws.filter(d => d.lod === lod && d.count > 0)
  if (!Number.isInteger(count) || count === 0 || parsed.normals.length !== count * 3 || parsed.uvs.length !== count * 2
    || !parsed.vertices.every(Number.isFinite) || !parsed.normals.every(Number.isFinite) || !parsed.uvs.every(Number.isFinite)
    || !parsed.indices.every(index => index < count) || !draws.length
    || draws.some(d => !Number.isInteger(d.start) || !Number.isInteger(d.count) || d.start < 0 || d.count % 3 !== 0 || d.start + d.count > parsed.indices.length)
    || parsed.warnings.some(w => /malformed|invalid index|exceeds index stream/.test(w))) {
    throw new Error('Invalid OBJ8 geometry or selected LOD')
  }
}

function drawBounds(p: ParsedObj8, d: Obj8Draw): THREE.Box3 {
  const box = new THREE.Box3()
  const v = p.vertices
  const end = d.start + d.count
  for (let i = d.start; i < end; i++) {
    const vi = p.indices[i]! * 3
    _vec.set(v[vi]!, v[vi + 1]!, v[vi + 2]!)
    box.expandByPoint(_vec)
  }
  return box
}

/** Build the scene graph. Every mesh shares ONE set of BufferAttributes
 *  (one GPU upload per attribute); each draw is its own BufferGeometry with
 *  a drawRange into the shared index, so it can hang under its own anim
 *  group and cull with its own bounds. */
export function buildObj8(
  parsed: ParsedObj8,
  material: THREE.Material,
  opts: BuildObj8Options = {},
): { group: THREE.Group; animated: THREE.Group[]; lights: LightLevelGroup[]; hits: THREE.Mesh[] } {
  const lod = opts.lod ?? 0
  validateObj8(parsed, lod)
  const root = new THREE.Group()
  root.name = opts.name ?? 'obj8'

  const position = new THREE.BufferAttribute(parsed.vertices, 3)
  const normal = new THREE.BufferAttribute(parsed.normals, 3)
  const uv = new THREE.BufferAttribute(parsed.uvs, 2)
  // OBJ8 fronts are clockwise; Three's FrontSide uses counterclockwise.
  // Keep parser output faithful to the file; reverse only the GPU stream.
  const triangles = parsed.indices.slice()
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const second = triangles[i + 1]!
    triangles[i + 1] = triangles[i + 2]!
    triangles[i + 2] = second
  }
  const index = new THREE.BufferAttribute(triangles, 1)

  const animated: THREE.Group[] = []
  for (const node of parsed.anims) {
    const g = new THREE.Group()
    g.name = `anim:${node.id}`
    g.userData.anim = node.specs
    g.userData.animId = node.id
    ;(node.parent < 0 ? root : animated[node.parent]!).add(g)
    animated.push(g)
  }

  let propAlphaMaterial: THREE.Material | undefined
  let cockpitMaterial = opts.cockpitMaterial
  const hits: THREE.Mesh[] = []
  let hitMaterial: THREE.MeshBasicMaterial | undefined
  const lightGroups = new Map<string, LightLevelGroup>()
  const lightMaterial = (l: Obj8Light): THREE.Material => {
    const key = `${l.dataref}|${l.v1}|${l.v2}|${l.nits}`
    let g = lightGroups.get(key)
    if (!g) {
      const m = (material as THREE.MeshStandardMaterial).clone()
      m.onBeforeCompile = material.onBeforeCompile
      m.customProgramCacheKey = material.customProgramCacheKey
      g = { material: m, v1: l.v1, v2: l.v2, dataref: l.dataref, nits: l.nits }
      lightGroups.set(key, g)
    }
    return g.material
  }
  for (const d of parsed.draws) {
    if (d.lod !== lod || d.count <= 0) continue
    if (d.hidden && !opts.hitBoxes) continue
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', position)
    geo.setAttribute('normal', normal)
    geo.setAttribute('uv', uv)
    geo.setIndex(index)
    geo.setDrawRange(d.start, d.count)
    geo.boundingBox = drawBounds(parsed, d)
    geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere())
    if (d.hidden) {
      hitMaterial ??= new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, visible: false })
      const hit = new THREE.Mesh(geo, hitMaterial)
      hit.name = `hit:${d.manip?.tooltip ?? d.start}`
      hit.visible = false
      hit.userData.manip = d.manip
      const owner = d.animPath[d.animPath.length - 1]
      ;(owner === undefined ? root : animated[owner]!).add(hit)
      hits.push(hit)
      continue
    }
    if (d.cockpit && !cockpitMaterial) {
      cockpitMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.8, metalness: 0.1 })
    }
    const propDisc = d.animPath.some(id => parsed.anims[id]!.specs.some(s =>
      s.kind === 'hide' && s.dataref.includes('/prop_is_disc[') && s.v1 === 0 && s.v2 <= .5))
    if (propDisc && !propAlphaMaterial) {
      propAlphaMaterial = material.clone()
      propAlphaMaterial.onBeforeCompile = material.onBeforeCompile
      propAlphaMaterial.customProgramCacheKey = material.customProgramCacheKey
      propAlphaMaterial.transparent = true
      propAlphaMaterial.depthWrite = false
    }
    const lit = opts.lightLevels && d.light && !d.cockpit && !propDisc ? lightMaterial(d.light) : null
    const mesh = new THREE.Mesh(geo, d.cockpit ? cockpitMaterial! : propDisc ? propAlphaMaterial! : lit ?? material)
    mesh.name = `tris:${d.start}+${d.count}`
    const last = d.animPath[d.animPath.length - 1]
    ;(last === undefined ? root : animated[last]!).add(mesh)
  }

  // Static pose: every block evaluated at dataref value 0; hide/show is
  // recorded on userData but not applied (everything stays visible).
  for (const g of animated) applyObj8Anim(g, ZERO_DATAREFS)
  return { group: root, animated, lights: [...lightGroups.values()], hits }
}

// ------------------------------------------------------------- textures --

/**
 * UV orientation — the part that is easy to get backwards.
 *
 * OBJ8 UVs are OpenGL-style: v = 0 is the BOTTOM row of the image as seen in
 * an editor. three.js Texture.flipY = true (the default for image-backed
 * textures) flips the bitmap on upload precisely so that v = 0 addresses the
 * bottom row — i.e. the OBJ8 convention — so PNGs keep flipY = TRUE; forcing
 * flipY = false here would render every PNG upside down.
 *
 * DDS cannot be flipped on upload. The installed Laminar DDS atlases are
 * top-down (verified against their authored UV islands), so reflect V in
 * each DDS texture matrix instead. PNGs retain Three's normal upload flip.
 */
/** Redraw a decoded image at no more than `maxSize` pixels on its long side (a 4096² RGBA texture is 89 MB with mipmaps; 2048² is 22 MB). */
function shrinkTexture(tex: THREE.Texture, maxSize: number): void {
  const im = tex.image as { width: number; height: number } | undefined
  if (!im || !(im.width > maxSize || im.height > maxSize) || typeof document === 'undefined') return
  const k = maxSize / Math.max(im.width, im.height)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k))
  c.getContext('2d')!.drawImage(im as unknown as CanvasImageSource, 0, 0, c.width, c.height)
  tex.image = c
}

async function loadTexture(url: string, srgb: boolean, maxSize?: number): Promise<THREE.Texture> {
  const dds = /\.dds$/i.test(url)
  const tex: THREE.Texture = dds
    ? await new DDSLoader().loadAsync(url)
    : await new THREE.TextureLoader().loadAsync(url)
  if (!dds && maxSize) shrinkTexture(tex, maxSize)
  tex.flipY = !dds
  if (dds) { tex.repeat.y = -1; tex.offset.y = 1 }
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  tex.anisotropy = 8
  tex.needsUpdate = true
  return tex
}

/** X-Plane resolves foo.png ↔ foo.dds interchangeably; so do we. */
function alternateName(name: string): string | null {
  if (/\.png$/i.test(name)) return name.replace(/\.png$/i, '.dds')
  if (/\.dds$/i.test(name)) return name.replace(/\.dds$/i, '.png')
  return null
}

/** The URLs tried, in order, for one texture name: a livery's own file first (when there is one), then the airplane's. */
export function textureCandidates(name: string, base: string, overrideBase?: string): string[] {
  const alt = alternateName(name)
  const names = alt ? [name, alt] : [name]
  return [...(overrideBase ? names.map((n) => overrideBase + n) : []), ...names.map((n) => base + n)]
}

async function firstTexture(urls: string[], srgb: boolean, maxSize?: number): Promise<THREE.Texture | null> {
  for (const url of urls) {
    try { return await loadTexture(url, srgb, maxSize) } catch { /* try the next candidate */ }
  }
  return null
}

async function loadTextureWithFallback(
  name: string | undefined,
  base: string,
  srgb: boolean,
  warnings: string[],
  cache?: Map<string, Promise<THREE.Texture | null>>,
  overrideBase?: string,
  maxSize?: number,
): Promise<THREE.Texture | null> {
  if (!name) return null
  if (overrideBase) {
    // A livery paints only some textures; the others are the airplane's own, loaded once and shared through the cache.
    const key = `${overrideBase}${name}:${srgb}:${maxSize ?? 0}`
    const own = (): Promise<THREE.Texture | null> => firstTexture(textureCandidates(name, base, overrideBase).slice(0, alternateName(name) ? 2 : 1), srgb, maxSize)
      .then((t) => t ?? loadTextureWithFallback(name, base, srgb, warnings, cache, undefined, maxSize))
    if (!cache) return own()
    let pending = cache.get(key)
    if (!pending) { pending = own(); cache.set(key, pending) }
    return pending
  }
  if (cache) {
    const key = `${base}${name}:${srgb}:${maxSize ?? 0}`
    let pending = cache.get(key)
    if (!pending) { pending = loadTextureWithFallback(name, base, srgb, warnings, undefined, undefined, maxSize); cache.set(key, pending) }
    return pending
  }
  const found = await firstTexture(textureCandidates(name, base), srgb, maxSize)
  if (!found) warnings.push(`texture not found: ${base}${name}`)
  return found
}

export interface Obj8MaterialMaps {
  map?: THREE.Texture | null
  emissiveMap?: THREE.Texture | null
  normalMap?: THREE.Texture | null
  materialGlossMap?: THREE.Texture | null
  glossMap?: THREE.Texture | null
}

/** Single-sided MeshStandardMaterial per the OBJ's texture set. */
export function makeObj8Material(maps: Obj8MaterialMaps, parsed?: Partial<Pick<ParsedObj8, 'noBlend' | 'normalMetalness' | 'specular' | 'splitNormal'>>): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    roughness: 0.6,
    metalness: 0.1,
    side: THREE.FrontSide,
  })
  if (maps.map) m.map = maps.map
  if (maps.emissiveMap) {
    m.emissiveMap = maps.emissiveMap
    m.emissive.set(0xffffff)
  }
  if (maps.normalMap) {
    m.normalMap = maps.normalMap
    // Reflected DDS UVs also reverse the derivative-derived bitangent.
    m.normalScale.y = maps.normalMap.repeat.y < 0 ? -1 : 1
  }
  const surfaceMap = maps.glossMap ?? maps.materialGlossMap ?? (!parsed?.splitNormal ? maps.normalMap : null)
  if (surfaceMap) {
    m.roughnessMap = surfaceMap
    m.roughness = 1
  }
  if (parsed?.normalMetalness && (maps.materialGlossMap || (!parsed.splitNormal && maps.normalMap))) {
    m.metalnessMap = maps.materialGlossMap ?? maps.normalMap ?? null
    m.metalness = 1
  } else if (parsed) m.metalness = 0
  const glossChannel = maps.glossMap ? 'r' : maps.materialGlossMap ? 'g' : 'a'
  const reflectanceChannel = maps.materialGlossMap ? 'r' : 'b'
  const gain = Math.max(0, Math.min(1, parsed?.specular ?? 0))
  const gainGLSL = Number.isInteger(gain) ? gain.toFixed(1) : String(gain)
  const reconstruct = !!(parsed?.normalMetalness || parsed?.splitNormal)
  m.customProgramCacheKey = () => `obj8-pbr-v2:${glossChannel}:${reflectanceChannel}:${gainGLSL}:${reconstruct}`
  m.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <roughnessmap_fragment>', THREE.ShaderChunk.roughnessmap_fragment.replace('texelRoughness.g;', `clamp(1.0 - texelRoughness.${glossChannel} * ${gainGLSL}, 0.045, 1.0);`))
      // X-Plane stores F0; Three uses a metallic fraction with dielectric F0=.04.
      .replace('#include <metalnessmap_fragment>', THREE.ShaderChunk.metalnessmap_fragment.replace('texelMetalness.b;', `clamp( ( texelMetalness.${reflectanceChannel} - 0.04 ) / 0.96, 0.0, 1.0 );`))
    if (reconstruct) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.z = sqrt( max( 1.0 - dot( mapN.xy, mapN.xy ), 0.0 ) );\nmapN.xy *= normalScale;'))
  }
  m.alphaTest = parsed?.noBlend ?? (maps.map ? .01 : 0)
  return m
}

// ----------------------------------------------------------------- load --

export interface LoadObj8Options {
  /** URL prefix the OBJ's TEXTURE names are relative to. */
  textureBase: string
  /** Default true. False skips texture fetches (plain material). */
  loadTextures?: boolean
  /** ATTR_LOD band to build, default 0. */
  lod?: number
  /** Per-aircraft texture ownership/cache; never shared across disposed aircraft. */
  textureCache?: Map<string, Promise<THREE.Texture | null>>
  /** For airplanes seen from far away (traffic): no normal / gloss maps, and textures no larger than this on a side. */
  distant?: { maxTextureSize: number }
  /** Cap on the side of normal / gloss maps (a decoded 4096² one is 89 MB): the paint keeps its full size. */
  normalMaxSize?: number
  /** A livery's texture folder (URL prefix): its files replace the airplane's of the same name, the rest fall back to `textureBase`. */
  textureOverrideBase?: string
  /** Material for ATTR_cockpit* draws (X-Plane's panel / device screens), e.g. a live display. */
  cockpitMaterial?: THREE.Material
  /** Lamps and backlights glow on their own datarefs (see BuildObj8Options.lightLevels). */
  lightLevels?: boolean
  /** Parse and build the manipulators' hit boxes (see parseObj8). */
  hitBoxes?: boolean
}

export interface LoadedObj8 {
  group: THREE.Group
  /** One group per ANIM block, parse order; userData.anim holds the spec. */
  animated: THREE.Group[]
  /** Lamps / backlights (empty unless loaded with lightLevels). */
  lights: LightLevelGroup[]
  /** Invisible hit boxes of the file's manipulators (empty unless loaded with hitBoxes). */
  hits: THREE.Mesh[]
  /** Texture file names referenced by the OBJ. */
  textures: string[]
  material: THREE.MeshStandardMaterial
  parsed: ParsedObj8
  warnings: string[]
}

export async function loadObj8(url: string, opts: LoadObj8Options): Promise<LoadedObj8> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`loadObj8: ${url} → HTTP ${res.status}`)
  const parsed = parseObj8(await res.text(), opts.hitBoxes ? { hitBoxes: true } : {})
  validateObj8(parsed, opts.lod ?? 0)
  const warnings = [...parsed.warnings]

  const base = opts.textureBase.endsWith('/') ? opts.textureBase : `${opts.textureBase}/`
  const overrideBase = opts.textureOverrideBase ? (opts.textureOverrideBase.endsWith('/') ? opts.textureOverrideBase : `${opts.textureOverrideBase}/`) : undefined
  const want = opts.loadTextures ?? true
  const [map, emissiveMap, normalMap, materialGlossMap, glossMap] = want
    ? await Promise.all([
        loadTextureWithFallback(parsed.albedo, base, true, warnings, opts.textureCache, overrideBase, opts.distant?.maxTextureSize),
        loadTextureWithFallback(parsed.lit, base, true, warnings, opts.textureCache, undefined, opts.distant?.maxTextureSize),
        // A livery changes the paint only: its normal and gloss maps are the airplane's own (and are not loaded again —
        // a second decoded 4096² normal map per livery is what exhausts the graphics memory).
        opts.distant ? Promise.resolve(null) : loadTextureWithFallback(parsed.normal, base, false, warnings, opts.textureCache, undefined, opts.normalMaxSize),
        opts.distant ? Promise.resolve(null) : loadTextureWithFallback(parsed.materialGloss, base, false, warnings, opts.textureCache, undefined, opts.normalMaxSize),
        opts.distant ? Promise.resolve(null) : loadTextureWithFallback(parsed.gloss, base, false, warnings, opts.textureCache, undefined, opts.normalMaxSize),
      ])
    : [null, null, null, null, null]

  const material = makeObj8Material({ map, emissiveMap, normalMap, materialGlossMap, glossMap }, parsed)
  const name = url.split('?')[0]!.split('/').pop() || 'obj8'
  const built = buildObj8(parsed, material, { name, ...(opts.lod !== undefined ? { lod: opts.lod } : {}), ...(opts.cockpitMaterial ? { cockpitMaterial: opts.cockpitMaterial } : {}), ...(opts.lightLevels ? { lightLevels: true } : {}), ...(opts.hitBoxes ? { hitBoxes: true } : {}) })
  return { ...built, textures: parsed.textures, material, parsed, warnings }
}
