/**
 * Family archetype traffic meshes (Phase 12b). Each archetype is built
 * from primitives, baked into ONE merged BufferGeometry with vertex
 * colors and one shared material — 1 draw call per traffic aircraft
 * (§23's ≤600-call budget is what makes 40 live targets affordable).
 *
 * Model frame matches aircraft-mesh.ts: nose −z, up +y, right wing +x.
 * Sizes come from `fleet-map.ts` (real span/length for known types, WTC
 * buckets otherwise). These are silhouettes for OTHER traffic — the
 * player's Tier-A ships keep their detailed builders.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ArchetypeSpec } from '../world/fleet-map'
import type { AircraftMesh } from './aircraft-mesh'

const SHARED_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.12 })

const WHITE = new THREE.Color(0xe8eaee)
const GREY = new THREE.Color(0x9aa0a8)
const DARK = new THREE.Color(0x23262a)
const ACCENT = new THREE.Color(0x3563a8)
const YELLOW = new THREE.Color(0xd9a916)
const GENERIC = new THREE.Color(0x777c84)

type Part = { geo: THREE.BufferGeometry; color: THREE.Color }

function colored(geo: THREE.BufferGeometry, color: THREE.Color, m?: THREE.Matrix4): THREE.BufferGeometry {
  if (m) geo.applyMatrix4(m)
  const n = geo.getAttribute('position').count
  const colors = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

const Q = new THREE.Quaternion()
const AXIS_X = new THREE.Vector3(1, 0, 0)
const AXIS_Y = new THREE.Vector3(0, 1, 0)

function place(x: number, y: number, z: number, rot?: { axis: THREE.Vector3; rad: number }): THREE.Matrix4 {
  const m = new THREE.Matrix4()
  if (rot) m.makeRotationFromQuaternion(Q.setFromAxisAngle(rot.axis, rot.rad))
  m.setPosition(x, y, z)
  return m
}

/** Fuselage tube + nose + tail cones along −z; returns radius used. */
function fuselage(parts: Part[], lengthM: number, color: THREE.Color, slim = false): number {
  const r = Math.max(lengthM / (slim ? 30 : 20), 0.35)
  const tube = lengthM * 0.64
  parts.push({ geo: colored(new THREE.CylinderGeometry(r, r, tube, 12), color, place(0, 0, 0, { axis: AXIS_X, rad: Math.PI / 2 })), color })
  parts.push({ geo: colored(new THREE.ConeGeometry(r, lengthM * 0.16, 12), color, place(0, 0, -(tube / 2 + lengthM * 0.08), { axis: AXIS_X, rad: -Math.PI / 2 })), color })
  parts.push({ geo: colored(new THREE.ConeGeometry(r, lengthM * 0.2, 12), color, place(0, 0, tube / 2 + lengthM * 0.1, { axis: AXIS_X, rad: Math.PI / 2 })), color })
  return r
}

function wing(parts: Part[], spanM: number, chordM: number, y: number, z: number, sweepRad: number, color: THREE.Color): void {
  const t = Math.max(chordM * 0.09, 0.08)
  if (sweepRad === 0) {
    parts.push({ geo: colored(new THREE.BoxGeometry(spanM, t, chordM), color, place(0, y, z)), color })
  } else {
    for (const side of [-1, 1]) {
      const half = new THREE.BoxGeometry(spanM / 2, t, chordM)
      const m = place(side * spanM / 4, y, z + Math.tan(sweepRad) * spanM / 8, { axis: AXIS_Y, rad: -side * sweepRad })
      parts.push({ geo: colored(half, color, m), color })
    }
  }
}

function tail(parts: Part[], lengthM: number, finH: number, stabSpan: number, z: number, color: THREE.Color, tTail = false): void {
  parts.push({ geo: colored(new THREE.BoxGeometry(Math.max(finH * 0.06, 0.06), finH, finH * 0.75), color, place(0, finH / 2, z)), color })
  const stabY = tTail ? finH * 0.95 : lengthM * 0.01
  parts.push({ geo: colored(new THREE.BoxGeometry(stabSpan, Math.max(stabSpan * 0.035, 0.05), stabSpan * 0.3), color, place(0, stabY, z)), color })
}

function podEngines(parts: Part[], count: number, spanM: number, wingY: number, wingZ: number, podLen: number, color: THREE.Color): void {
  const podR = podLen * 0.24
  const xs = count >= 4 ? [-0.42, -0.22, 0.22, 0.42] : [-0.26, 0.26]
  for (let i = 0; i < Math.min(count, 4); i++) {
    const x = xs[count >= 4 ? i : i % 2]! * spanM
    parts.push({ geo: colored(new THREE.CylinderGeometry(podR, podR * 0.85, podLen, 10), GREY, place(x, wingY - podR * 1.1, wingZ - podLen * 0.25, { axis: AXIS_X, rad: Math.PI / 2 })), color })
    parts.push({ geo: colored(new THREE.CylinderGeometry(podR * 1.02, podR * 1.02, podLen * 0.1, 10), DARK, place(x, wingY - podR * 1.1, wingZ - podLen * 0.75, { axis: AXIS_X, rad: Math.PI / 2 })), color })
  }
}

function propNacelles(parts: Part[], count: number, spanM: number, wingY: number, wingZ: number, size: number, color: THREE.Color): void {
  const xs = count >= 4 ? [-0.4, -0.2, 0.2, 0.4] : [-0.25, 0.25]
  for (let i = 0; i < Math.min(count, 4); i++) {
    const x = xs[count >= 4 ? i : i % 2]! * spanM
    parts.push({ geo: colored(new THREE.CylinderGeometry(size * 0.3, size * 0.34, size * 1.6, 8), color, place(x, wingY, wingZ - size * 0.5, { axis: AXIS_X, rad: Math.PI / 2 })), color })
    parts.push({ geo: colored(new THREE.CircleGeometry(size * 0.85, 12), DARK, place(x, wingY, wingZ - size * 1.35)), color })
  }
}

/** Build one merged-silhouette mesh. userData.lightAnchors carries wingtip/
 *  tail positions (model frame) for the 13c nav-light pass. */
export function buildArchetype(spec: ArchetypeSpec): THREE.Mesh {
  const { archetype: a, spanM: S, lengthM: L } = spec
  const parts: Part[] = []
  // Wing/fin placement captured per archetype so the light anchors can
  // be computed from the SAME constants wing()/tail() use — the old
  // fixed (±S/2, 0, 0)/(0, 0.1L, 0.5L) anchors ignored wing height,
  // sweep, and fin height on every live-traffic silhouette.
  let wingAt = { y: 0, z: 0, sweep: 0 }
  let finAt = { h: L * 0.17, z: L * 0.42 }

  switch (a) {
    case 'ga-high-wing':
    case 'taildragger': {
      const body = a === 'taildragger' ? YELLOW : WHITE
      const r = fuselage(parts, L, body)
      wingAt = { y: r * 0.95, z: -L * 0.05, sweep: 0 }
      wing(parts, S, L * 0.19, r * 0.95, -L * 0.05, 0, body)
      finAt = { h: L * 0.17, z: L * 0.42 }
      tail(parts, L, L * 0.17, S * 0.33, L * 0.42, body)
      propNacelles(parts, 1, 0, 0, -L * 0.36, L * 0.1, DARK)
      break
    }
    case 'ga-low-wing': {
      const r = fuselage(parts, L, WHITE)
      wingAt = { y: -r * 0.8, z: -L * 0.02, sweep: 0 }
      wing(parts, S, L * 0.19, -r * 0.8, -L * 0.02, 0, WHITE)
      finAt = { h: L * 0.17, z: L * 0.42 }
      tail(parts, L, L * 0.17, S * 0.33, L * 0.42, ACCENT)
      propNacelles(parts, 1, 0, 0, -L * 0.36, L * 0.1, DARK)
      break
    }
    case 'twin-piston': {
      const r = fuselage(parts, L, WHITE)
      wingAt = { y: -r * 0.7, z: -L * 0.02, sweep: 0 }
      wing(parts, S, L * 0.2, -r * 0.7, -L * 0.02, 0, WHITE)
      finAt = { h: L * 0.18, z: L * 0.42 }
      tail(parts, L, L * 0.18, S * 0.33, L * 0.42, ACCENT)
      propNacelles(parts, 2, S, -r * 0.55, -L * 0.06, L * 0.09, WHITE)
      break
    }
    case 'single-turboprop': {
      const r = fuselage(parts, L, WHITE)
      wingAt = { y: -r * 0.75, z: -L * 0.02, sweep: 0 }
      wing(parts, S, L * 0.17, -r * 0.75, -L * 0.02, 0, WHITE)
      finAt = { h: L * 0.2, z: L * 0.42 }
      tail(parts, L, L * 0.2, S * 0.32, L * 0.42, ACCENT)
      propNacelles(parts, 1, 0, 0, -L * 0.4, L * 0.09, DARK)
      break
    }
    case 'twin-turboprop': {
      const r = fuselage(parts, L, WHITE)
      wingAt = { y: r * 0.85, z: -L * 0.04, sweep: 0 }
      wing(parts, S, L * 0.16, r * 0.85, -L * 0.04, 0, WHITE)
      finAt = { h: L * 0.22, z: L * 0.43 }
      tail(parts, L, L * 0.22, S * 0.3, L * 0.43, WHITE, true)
      propNacelles(parts, spec.quad ? 4 : 2, S, r * 0.6, -L * 0.08, L * 0.08, GREY)
      break
    }
    case 'bizjet': {
      const r = fuselage(parts, L, WHITE, true)
      wingAt = { y: -r * 0.7, z: L * 0.02, sweep: 0.35 }
      wing(parts, S, L * 0.16, -r * 0.7, L * 0.02, 0.35, WHITE)
      finAt = { h: L * 0.2, z: L * 0.42 }
      tail(parts, L, L * 0.2, S * 0.3, L * 0.42, WHITE, true)
      for (const side of [-1, 1]) {
        parts.push({ geo: colored(new THREE.CylinderGeometry(L * 0.028, L * 0.026, L * 0.11, 8), GREY, place(side * r * 1.7, r * 0.5, L * 0.32, { axis: AXIS_X, rad: Math.PI / 2 })), color: GREY })
      }
      break
    }
    case 'narrowbody':
    case 'widebody': {
      const r = fuselage(parts, L, WHITE)
      const wingY = -r * 0.6
      const wingZ = L * 0.02
      wingAt = { y: wingY, z: wingZ, sweep: 0.44 }
      wing(parts, S, L * 0.14, wingY, wingZ, 0.44, GREY)
      finAt = { h: L * 0.17, z: L * 0.43 }
      tail(parts, L, L * 0.17, S * 0.36, L * 0.43, WHITE)
      podEngines(parts, spec.quad ? 4 : Math.max(spec.engines, 2) === 3 ? 2 : 2, S, wingY, wingZ, L * 0.1, GREY)
      if (spec.engines === 3) {
        parts.push({ geo: colored(new THREE.CylinderGeometry(L * 0.024, L * 0.022, L * 0.1, 10), GREY, place(0, r * 1.4, L * 0.4, { axis: AXIS_X, rad: Math.PI / 2 })), color: GREY })
      }
      break
    }
    case 'glider': {
      const r = fuselage(parts, L, WHITE, true)
      wingAt = { y: r * 0.3, z: -L * 0.05, sweep: 0 }
      wing(parts, S, Math.max(L * 0.1, 0.5), r * 0.3, -L * 0.05, 0, WHITE)
      finAt = { h: L * 0.18, z: L * 0.44 }
      tail(parts, L, L * 0.18, S * 0.16, L * 0.44, WHITE, true)
      break
    }
    case 'rotorcraft': {
      // Cabin blob + boom + rotor disc + skids: unmistakably a helicopter,
      // never pretending to be a specific model.
      parts.push({ geo: colored(new THREE.SphereGeometry(L * 0.16, 10, 8), ACCENT, place(0, 0, -L * 0.18)), color: ACCENT })
      parts.push({ geo: colored(new THREE.CylinderGeometry(L * 0.035, L * 0.06, L * 0.55, 8), ACCENT, place(0, L * 0.02, L * 0.15, { axis: AXIS_X, rad: Math.PI / 2 })), color: ACCENT })
      parts.push({ geo: colored(new THREE.CylinderGeometry(S * 0.5, S * 0.5, 0.04, 18), DARK, place(0, L * 0.2, -L * 0.1)), color: DARK })
      parts.push({ geo: colored(new THREE.BoxGeometry(L * 0.02, L * 0.16, L * 0.02), DARK, place(0, L * 0.28, L * 0.42)), color: DARK })
      for (const side of [-1, 1]) {
        parts.push({ geo: colored(new THREE.CylinderGeometry(0.04, 0.04, L * 0.5, 6), GREY, place(side * L * 0.12, -L * 0.18, -L * 0.1, { axis: AXIS_X, rad: Math.PI / 2 })), color: GREY })
      }
      break
    }
    case 'generic':
    default: {
      const r = fuselage(parts, L, GENERIC)
      wingAt = { y: 0, z: -L * 0.02, sweep: 0 }
      wing(parts, S, L * 0.2, 0, -L * 0.02, 0, GENERIC)
      finAt = { h: L * 0.16, z: L * 0.42 }
      tail(parts, L, L * 0.16, S * 0.3, L * 0.42, GENERIC)
      void r
      break
    }
  }

  const merged = mergeGeometries(parts.map((p) => p.geo), false)
  const mesh = new THREE.Mesh(merged ?? new THREE.BufferGeometry(), SHARED_MAT)
  mesh.castShadow = true
  // Tip position from the swept-half geometry in wing(): half center at
  // side*S/4 offset z + tan(sweep)*S/8, tip a further S/4 out along the
  // rotated half. Fin-tip tail light from tail()'s fin box (top = finH).
  const tipX = (S / 4) * (1 + Math.cos(wingAt.sweep))
  const tipZ = wingAt.z + Math.tan(wingAt.sweep) * (S / 8) + Math.sin(wingAt.sweep) * (S / 4)
  mesh.userData.lightAnchors = {
    wingtipL: new THREE.Vector3(-tipX, wingAt.y, tipZ),
    wingtipR: new THREE.Vector3(tipX, wingAt.y, tipZ),
    tail: new THREE.Vector3(0, finAt.h, finAt.z),
  }
  for (const p of parts) p.geo.dispose()
  return mesh
}

/** Wrap an archetype silhouette as a player-ship AircraftMesh (Tier-B
 *  flyables use their traffic silhouette — honest: no detailed cockpit
 *  exterior exists for them). The prop-disc slot is inert. */
export function buildArchetypeShip(spec: ArchetypeSpec): AircraftMesh {
  const g = new THREE.Group()
  const body = buildArchetype(spec)
  g.add(body)
  const propDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.01, 6),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
  )
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.01, 0.01, 0.01),
    new THREE.MeshStandardMaterial({ transparent: true, opacity: 0 }),
  )
  propDisc.userData.blade = blade
  g.add(propDisc)
  g.add(blade)
  return { group: g, propDisc }
}
