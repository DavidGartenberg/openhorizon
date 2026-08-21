import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import {
  applyObj8Anim,
  applyObj8Visibility,
  buildObj8,
  evalObj8Keys,
  loadObj8,
  makeObj8Material,
  obj8AnimMatrix,
  parseObj8,
  type AnimSpec,
} from '../src/render/xplane-obj8'

/** 4 VT quad, 12 indices via IDX10 + IDX + IDX, a root TRIS and an
 *  animated TRIS (rotate about Y, 0..90° over flaprat 0..1). */
const FIXTURE = [
  'I',
  '800',
  'OBJ',
  'TEXTURE foo.png',
  'POINT_COUNTS 4 0 0 12',
  'VT 0 0 0 0 1 0 0 0',
  'VT 1 0 0 0 1 0 1 0',
  'VT 1 0 1 0 1 0 1 1',
  'VT 0 0 1 0 1 0 0 1',
  'IDX10 0 1 2 0 2 3 0 1 2 0',
  'IDX 2',
  'IDX 3',
  'TRIS 0 6',
  'ANIM_begin',
  'ANIM_rotate 0 1 0 0 90 0 1 sim/flightmodel/controls/flaprat',
  'TRIS 6 6',
  'ANIM_end',
].join('\n')

const FLAPRAT = 'sim/flightmodel/controls/flaprat'

describe('parseObj8 — fixture', () => {
  const p = parseObj8(FIXTURE)

  it('vertex streams: 4 VT → 12 positions, 12 normals, 8 uvs', () => {
    expect(p.vertices).toBeInstanceOf(Float32Array)
    expect(p.vertices.length).toBe(12)
    expect(p.normals.length).toBe(12)
    expect(p.uvs.length).toBe(8)
    expect(Array.from(p.vertices.subarray(6, 9))).toEqual([1, 0, 1])
    expect(Array.from(p.normals.subarray(0, 3))).toEqual([0, 1, 0])
    expect(Array.from(p.uvs.subarray(4, 6))).toEqual([1, 1])
    expect(p.pointCounts).toEqual({ tris: 4, lines: 0, lights: 0, indices: 12 })
  })

  it('index stream: IDX10 then IDX appended in order', () => {
    expect(p.indices).toBeInstanceOf(Uint32Array)
    expect(Array.from(p.indices)).toEqual([0, 1, 2, 0, 2, 3, 0, 1, 2, 0, 2, 3])
  })

  it('draws: one at the root, one inside the ANIM block', () => {
    expect(p.draws).toEqual([
      { start: 0, count: 6, animPath: [], lod: 0, cockpit: false },
      { start: 6, count: 6, animPath: [0], lod: 0, cockpit: false },
    ])
  })

  it('texture name recorded as albedo', () => {
    expect(p.textures).toEqual(['foo.png'])
    expect(p.albedo).toBe('foo.png')
    expect(p.lit).toBeUndefined()
    expect(p.normal).toBeUndefined()
  })

  it('anim spec recorded: rotate about Y, keys [[v, deg]], dataref', () => {
    expect(p.anims).toHaveLength(1)
    expect(p.anims[0]!.parent).toBe(-1)
    expect(p.anims[0]!.specs).toEqual([
      { kind: 'rotate', axis: [0, 1, 0], keys: [[0, 0], [1, 90]], dataref: FLAPRAT },
    ])
  })

  it('clean parse: no warnings', () => {
    expect(p.warnings).toEqual([])
  })
})

describe('parseObj8 — grouping and state boundaries', () => {
  const HEAD = ['I', '800', 'OBJ', 'VT 0 0 0 0 1 0 0 0', 'VT 1 0 0 0 1 0 1 0', 'VT 0 0 1 0 1 0 0 1', 'IDX10 0 1 2 0 1 2 0 1 2 0', 'IDX 1', 'IDX 2']

  it('contiguous TRIS merge into one draw; comments and blank lines do not split', () => {
    const p = parseObj8([...HEAD, 'TRIS 0 3', '# a comment', '', 'TRIS 3 3', 'TRIS 6 6'].join('\n'))
    expect(p.draws).toEqual([{ start: 0, count: 12, animPath: [], lod: 0, cockpit: false }])
  })

  it('ATTR_* and LIGHT_* end the current run even when indices are contiguous', () => {
    const p = parseObj8([...HEAD, 'TRIS 0 3', 'ATTR_shiny_rat 0.5', 'TRIS 3 3', 'LIGHT_NAMED airplane_nav_l 0 0 0', 'TRIS 6 6'].join('\n'))
    expect(p.draws.map((d) => [d.start, d.count])).toEqual([[0, 3], [3, 3], [6, 6]])
    expect(p.warnings).toEqual([])
  })

  it('non-contiguous TRIS stay separate draws', () => {
    const p = parseObj8([...HEAD, 'TRIS 6 6', 'TRIS 0 3'].join('\n'))
    expect(p.draws.map((d) => [d.start, d.count])).toEqual([[6, 6], [0, 3]])
  })

  it('ATTR_draw_disable geometry is skipped; ATTR_cockpit is flagged', () => {
    const p = parseObj8([...HEAD, 'ATTR_draw_disable', 'TRIS 0 3', 'ATTR_draw_enable', 'ATTR_cockpit', 'TRIS 3 3', 'ATTR_no_cockpit', 'TRIS 6 6'].join('\n'))
    expect(p.draws.map((d) => [d.start, d.count, d.cockpit])).toEqual([[3, 3, true], [6, 6, false]])
  })

  it('ATTR_LOD bands are indexed on each draw', () => {
    const p = parseObj8([...HEAD, 'ATTR_LOD 0 1000', 'TRIS 0 6', 'ATTR_LOD 1000 5000', 'TRIS 6 6'].join('\n'))
    expect(p.lods).toEqual([[0, 1000], [1000, 5000]])
    expect(p.draws.map((d) => d.lod)).toEqual([0, 1])
  })

  it('TRIS past the end of the index stream is clamped with a warning', () => {
    const p = parseObj8([...HEAD, 'TRIS 9 6'].join('\n'))
    expect(p.draws[0]!.count).toBe(3)
    expect(p.warnings.some((w) => w.includes('exceeds index stream'))).toBe(true)
  })

  it('tabs, CRLF, trailing comments, backslash texture paths, unknown commands', () => {
    const p = parseObj8('I\r\n800\r\nOBJ\r\nTEXTURE\tsub\\foo.dds\r\nTEXTURE_LIT foo_LIT.png # glow\r\nTEXTURE_NORMAL foo_NML.png\r\nGLOBAL_specular\t0.75\r\nNORMAL_METALNESS\r\nFROBNICATE 1 2\r\n')
    expect(p.textures).toEqual(['sub/foo.dds', 'foo_LIT.png', 'foo_NML.png'])
    expect(p.lit).toBe('foo_LIT.png')
    expect(p.normal).toBe('foo_NML.png')
    expect(p.specular).toBe(0.75)
    expect(p.normalMetalness).toBe(true)
    expect(p.warnings).toEqual(['unknown command FROBNICATE'])
  })
})

describe('parseObj8 — animation tree', () => {
  const HEAD = ['I', '800', 'OBJ', 'VT 0 0 0 0 1 0 0 0', 'VT 1 0 0 0 1 0 1 0', 'VT 0 0 1 0 1 0 0 1', 'IDX10 0 1 2 0 1 2 0 1 2 0', 'IDX 1', 'IDX 2']

  it('nested blocks give nested animPaths and parent links', () => {
    const p = parseObj8([
      ...HEAD,
      'ANIM_begin',
      'ANIM_trans 1 2 3 1 2 3 0 0 none',
      'TRIS 0 3',
      'ANIM_begin',
      'ANIM_rotate 1 0 0 -10 10 -1 1 sim/x',
      'TRIS 3 3',
      'ANIM_end',
      'ANIM_end',
      'TRIS 6 6',
    ].join('\n'))
    expect(p.anims.map((a) => a.parent)).toEqual([-1, 0])
    expect(p.draws.map((d) => d.animPath)).toEqual([[0], [0, 1], []])
    expect(p.anims[0]!.specs).toEqual([{ kind: 'trans', keys: [[0, [1, 2, 3]], [0, [1, 2, 3]]], dataref: 'none' }])
    expect(p.anims[1]!.specs).toEqual([{ kind: 'rotate', axis: [1, 0, 0], keys: [[-1, -10], [1, 10]], dataref: 'sim/x' }])
    expect(p.warnings).toEqual([])
  })

  it('keyframe tables, keyframe_loop, hide/show', () => {
    const p = parseObj8([
      ...HEAD,
      'ANIM_begin',
      'ANIM_rotate_begin 0 0 1 sim/r',
      'ANIM_rotate_key 0 0',
      'ANIM_rotate_key 0.5 30',
      'ANIM_rotate_key 1 45',
      'ANIM_rotate_end',
      'ANIM_keyframe_loop 1',
      'ANIM_trans_begin sim/t',
      'ANIM_trans_key 1 0 0 2',
      'ANIM_trans_key 0 0 0 0',
      'ANIM_trans_end',
      'ANIM_hide 0 0.5 sim/h',
      'ANIM_show 2 3 sim/s',
      'TRIS 0 3',
      'ANIM_end',
    ].join('\n'))
    const specs: AnimSpec[] = [
      { kind: 'rotate', axis: [0, 0, 1], keys: [[0, 0], [0.5, 30], [1, 45]], dataref: 'sim/r', loop: 1 },
      { kind: 'trans', keys: [[0, [0, 0, 0]], [1, [0, 0, 2]]], dataref: 'sim/t' }, // sorted by value
      { kind: 'hide', v1: 0, v2: 0.5, dataref: 'sim/h' },
      { kind: 'show', v1: 2, v2: 3, dataref: 'sim/s' },
    ]
    expect(p.anims[0]!.specs).toEqual(specs)
    expect(p.draws[0]!.animPath).toEqual([0])
  })

  it('a transform after draws in the same block opens an implicit child (GL-stack semantics)', () => {
    const p = parseObj8([
      ...HEAD,
      'ANIM_begin',
      'ANIM_rotate 0 1 0 0 90 0 1 sim/a',
      'TRIS 0 3',
      'ANIM_trans 0 0 0 0 0 5 0 1 sim/b',
      'TRIS 3 3',
      'ANIM_end',
      'TRIS 6 6',
    ].join('\n'))
    expect(p.anims.map((a) => a.parent)).toEqual([-1, 0])
    expect(p.anims[0]!.specs.map((s) => s.kind)).toEqual(['rotate'])
    expect(p.anims[1]!.specs.map((s) => s.kind)).toEqual(['trans'])
    expect(p.draws.map((d) => d.animPath)).toEqual([[0], [0, 1], []])
  })

  it('unbalanced blocks and stray commands warn instead of throwing', () => {
    const p = parseObj8([...HEAD, 'ANIM_end', 'ANIM_rotate 0 1 0 0 1 0 1 sim/a', 'ANIM_begin', 'TRIS 0 3'].join('\n'))
    expect(p.warnings).toEqual(expect.arrayContaining([
      'ANIM_end without ANIM_begin',
      'ANIM_rotate outside ANIM_begin (ignored)',
      '1 ANIM_begin left open at end of file',
    ]))
  })
})

describe('evalObj8Keys', () => {
  it('interpolates inside the table and clamps outside', () => {
    const keys: Array<[number, number]> = [[0, 0], [1, 90]]
    expect(evalObj8Keys(keys, -1)).toBe(0)
    expect(evalObj8Keys(keys, 0.5)).toBeCloseTo(45)
    expect(evalObj8Keys(keys, 2)).toBe(90)
  })
  it('multi-segment and step on equal values', () => {
    expect(evalObj8Keys([[0, 0], [0.5, 30], [1, 45]], 0.75)).toBeCloseTo(37.5)
    expect(evalObj8Keys([[0, 0], [0, 10]], 0)).toBe(0)
    expect(evalObj8Keys([[0, 0], [0, 10]], 1)).toBe(10)
    expect(evalObj8Keys([], 3)).toBe(0)
  })
})

describe('obj8AnimMatrix / applyObj8Anim', () => {
  const specs: AnimSpec[] = [
    { kind: 'trans', keys: [[0, [1, 0, 0]], [0, [1, 0, 0]]], dataref: 'none' },
    { kind: 'rotate', axis: [0, 2, 0], keys: [[0, 0], [1, 90]], dataref: FLAPRAT },
  ]

  it('composes in file order: M = T · R, so rotate happens about the pivot', () => {
    const m = obj8AnimMatrix(specs, (d) => (d === FLAPRAT ? 1 : 0))
    const p = new THREE.Vector3(0, 0, 1).applyMatrix4(m)
    expect(p.x).toBeCloseTo(2)
    expect(p.y).toBeCloseTo(0)
    expect(p.z).toBeCloseTo(0)
  })

  it('applyObj8Anim writes position/quaternion; visibility is separate', () => {
    const g = new THREE.Group()
    g.userData.anim = [...specs, { kind: 'hide', v1: 0.4, v2: 0.6, dataref: FLAPRAT } satisfies AnimSpec]
    applyObj8Anim(g, (d) => (d === FLAPRAT ? 0.5 : 0))
    expect(g.position.x).toBeCloseTo(1)
    const e = new THREE.Euler().setFromQuaternion(g.quaternion)
    expect(THREE.MathUtils.radToDeg(e.y)).toBeCloseTo(45)
    expect(g.visible).toBe(true)
    applyObj8Visibility(g, () => 0.5)
    expect(g.visible).toBe(false)
    applyObj8Visibility(g, () => 0.9)
    expect(g.visible).toBe(true)
  })
})

describe('buildObj8', () => {
  it('hierarchy, shared attributes, draw ranges, static pose at dataref 0', () => {
    const text = [
      ...FIXTURE.split('\n').slice(0, 13), // header, VT, IDX, root TRIS
      'ANIM_begin',
      'ANIM_trans 0 0 1 0 0 1 0 0 none',
      'ANIM_rotate 0 1 0 45 90 0 1 ' + FLAPRAT,
      'TRIS 6 6',
      'ANIM_end',
    ].join('\n')
    const parsed = parseObj8(text)
    const mat = makeObj8Material({})
    const { group, animated } = buildObj8(parsed, mat, { name: 'test.obj' })

    expect(group.name).toBe('test.obj')
    expect(animated).toHaveLength(1)
    const meshes: THREE.Mesh[] = []
    group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh)
    })
    expect(meshes).toHaveLength(2)
    const byName = (n: string): THREE.Mesh => meshes.find((m) => m.name === n)!
    const m0 = byName('tris:0+6')
    const m1 = byName('tris:6+6')
    expect(m0.parent).toBe(group)
    expect(m1.parent).toBe(animated[0])
    expect(m0.geometry.drawRange).toEqual({ start: 0, count: 6 })
    expect(m1.geometry.drawRange).toEqual({ start: 6, count: 6 })
    // One shared BufferAttribute per stream across meshes.
    expect(m0.geometry.getAttribute('position')).toBe(m1.geometry.getAttribute('position'))
    expect(m0.geometry.getIndex()).toBe(m1.geometry.getIndex())
    expect(m0.material).toBe(mat)
    expect(m0.geometry.boundingBox!.max.toArray()).toEqual([1, 0, 1])

    const g = animated[0]!
    expect(g.userData.anim).toBe(parsed.anims[0]!.specs)
    expect(g.position.toArray()).toEqual([0, 0, 1])
    const e = new THREE.Euler().setFromQuaternion(g.quaternion)
    expect(THREE.MathUtils.radToDeg(e.y)).toBeCloseTo(45) // keys [[0,45],[1,90]] at value 0
    expect(g.visible).toBe(true)
  })

  it('builds only the requested LOD band and a separate cockpit material', () => {
    const parsed = parseObj8([
      'I', '800', 'OBJ',
      'VT 0 0 0 0 1 0 0 0', 'VT 1 0 0 0 1 0 1 0', 'VT 0 0 1 0 1 0 0 1',
      'IDX10 0 1 2 0 1 2 0 1 2 0', 'IDX 1', 'IDX 2',
      'ATTR_LOD 0 1000', 'TRIS 0 3', 'ATTR_cockpit', 'TRIS 3 3', 'ATTR_no_cockpit',
      'ATTR_LOD 1000 5000', 'TRIS 6 6',
    ].join('\n'))
    const mat = makeObj8Material({})
    const near = buildObj8(parsed, mat)
    const names: string[] = []
    const mats = new Set<THREE.Material>()
    near.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        names.push(o.name)
        mats.add((o as THREE.Mesh).material as THREE.Material)
      }
    })
    expect(names).toEqual(['tris:0+3', 'tris:3+3'])
    expect(mats.size).toBe(2)
    const far = buildObj8(parsed, mat, { lod: 1 })
    expect(far.group.children.map((c) => c.name)).toEqual(['tris:6+6'])
  })
})

describe('makeObj8Material', () => {
  it('standard material, front-side, emissive white only with a lit map', () => {
    const plain = makeObj8Material({})
    expect(plain).toBeInstanceOf(THREE.MeshStandardMaterial)
    expect(plain.side).toBe(THREE.FrontSide)
    expect(plain.roughness).toBe(0.6)
    expect(plain.metalness).toBe(0.1)
    expect(plain.map).toBeNull()
    expect(plain.emissive.getHex()).toBe(0x000000)
    const lit = makeObj8Material({ emissiveMap: new THREE.Texture() }, { noBlend: 0.4 })
    expect(lit.emissive.getHex()).toBe(0xffffff)
    expect(lit.alphaTest).toBe(0.4)
  })
})

describe('loadObj8 (fetch stubbed, textures off)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fetches, parses, builds; reports texture names without loading them', async () => {
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, status: 200, text: async () => (url.endsWith('.obj') ? FIXTURE : '') }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await loadObj8('/models/c172/plane.obj', { textureBase: '/models/c172', loadTextures: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(r.group.name).toBe('plane.obj')
    expect(r.animated).toHaveLength(1)
    expect(r.textures).toEqual(['foo.png'])
    expect(r.material.map).toBeNull()
    expect(r.warnings).toEqual([])
    expect(r.parsed.draws).toHaveLength(2)
  })

  it('rejects on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, text: async () => '' })))
    await expect(loadObj8('/nope.obj', { textureBase: '/' })).rejects.toThrow(/HTTP 404/)
  })
})
