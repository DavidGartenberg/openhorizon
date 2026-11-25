import * as THREE from 'three'
import { drawAirbusEwd, drawAirbusPfd, drawAirbusSystems } from '../../src/cockpit/airbus-displays'
import { drawBoeingNd, drawIsfd } from '../../src/cockpit/boeing-displays'
import { ROSTER } from '../../src/sim/aircraft/roster'
import { airbusCockpitFit, makeAirbusDatarefReader, XP_COCKPIT_A333 } from '../../src/render/xplane-airbus'
import { loadXpCockpit, type XpCockpit } from '../../src/render/xplane-cockpit'
import { defaultXpInputs } from '../../src/render/xplane-datarefs'

// Deterministic display-only scenario, no player storage or flight loop.
const host = document.querySelector('#viewport')!
const status = document.querySelector('output')!
const load = document.querySelector<HTMLButtonElement>('#load')!
const night = document.querySelector<HTMLButtonElement>('#night')!
const panelButton = document.querySelector<HTMLButtonElement>('#panel')!
const variant = document.querySelector<HTMLSelectElement>('#variant')!
const scene = new THREE.Scene()
scene.background = new THREE.Color('#96c1e0')
const sun = new THREE.DirectionalLight(0xffe2c3, 2.8)
sun.position.set(-5, 7, -18)
const ambient = new THREE.HemisphereLight(0xb9dcff, 0x455568, 1.7)
scene.add(sun, ambient)
const camera = new THREE.PerspectiveCamera(62, 1, .04, 100)
let renderer: THREE.WebGLRenderer | undefined, deck: XpCockpit | null = null, dark = false, panelView = false

function draw(): void {
  if (!renderer) return
  const h = Math.max(200, innerHeight - 63)
  renderer.setSize(innerWidth, h)
  camera.aspect = innerWidth / h; camera.updateProjectionMatrix(); renderer.render(scene, camera)
}
window.addEventListener('resize', draw)
night.onclick = () => {
  dark = !dark; ambient.intensity = dark ? .1 : 1.7; sun.intensity = dark ? .04 : 2.8
  ;(scene.background as THREE.Color).set(dark ? '#091726' : '#96c1e0')
  pose(); deck?.setLit(dark ? 1 : 0); draw()
}
panelButton.onclick = () => {
  const eye = deck?.eyePoint()
  if (!eye) return
  panelView = !panelView
  camera.lookAt(eye.y + (panelView ? .16 : .1), eye.up - (panelView ? .37 : .20), -eye.x - 1)
  draw()
}
load.onclick = async () => {
  const key = variant.value, spec = ROSTER.find(r => r.spec.designator === key)!.spec
  load.disabled = true; status.value = `Loading ${key}`
  try {
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.toneMapping = THREE.ACESFilmicToneMapping
      host.appendChild(renderer.domElement)
    }
    deck?.dispose(); deck = null
    deck = await loadXpCockpit(XP_COCKPIT_A333, { place: airbusCockpitFit(key, spec.lengthM) })
    if (!deck?.airbusPanel) throw new Error('Installed Airbus deck unavailable')
    const p = deck.airbusPanel
    pose()
    deck.setLit(dark ? 1 : 0)
    const sample = { iasKt: 138, altFt: 2460, pitchDeg: 4, rollDeg: -3, baroInHg: 29.92 }
    p.display('captPfd', (c, s) => drawAirbusPfd(c, s, { ...sample, trendKt10s: 3, mach: .22, selSpeedKt: 150, vmoKt: 330, stallKt: 117, slipDeg: .2, selAltFt: 3000, vsFpm: -530, hdgDeg: 282, selHdgDeg: 284, trackDeg: 280, radioAltFt: 2350, onGround: false, gs: .2, loc: -.25, fma: { at: 'MCP SPD', pitch: 'G/S', pitchArmed: '', roll: 'VOR/LOC', rollArmed: '', ap: 'CMD' } }))
    p.display('captNd', (c, s) => drawBoeingNd(c, s, { hdgDeg: 282, trackDeg: 280, selHdgDeg: 284, gsKt: 133, tasKt: 142, windDirDeg: 270, windKt: 9, rangeNm: 40, airports: [{ id: 'KSFO', nN: 2, nE: -8 }], route: [{ id: 'FIX01', nN: 3, nE: -3, active: false }, { id: 'KSFO', nN: 2, nE: -8, active: true }], traffic: [], wx: [] }, 'airbus'))
    p.display('upper', (c, s) => drawAirbusEwd(c, s, { n1Pct: Array(spec.powerplant.kind === 'jet' ? spec.powerplant.count : 2).fill(64), n1RedlinePct: 104, n1CommandPct: 65, egtC: [421, 418, 422, 420], ffKgH: [1240, 1245, 1242, 1248], fuelKg: [12004, 11916], tatC: 4, reverse: false }))
    p.display('lower', (c, s) => drawAirbusSystems(c, s, { fuelKg: [12004, 11916], gearPosition: 1, flapDegrees: 15, speedbrake: .37, tatC: 4 }))
    p.display('standby', (c, s) => drawIsfd(c, s, sample))
    p.copy('captPfd', 'foPfd'); p.copy('captNd', 'foNd'); p.fcu({ iasKt: 150, hdgDeg: 284, altFt: 3000, vsFpm: -530, vsActive: true }); p.commit()
    scene.add(deck.group)
    const eye = deck.eyePoint()
    camera.position.set(eye.y, eye.up, -eye.x)
    panelView = false; camera.lookAt(eye.y + .1, eye.up - .20, -eye.x - 1)
    draw()
    status.value = `${key} ${key === 'A333' ? 'native' : 'fitted'} · ${deck.evidence.objects} objects · ${deck.hits.length} controls · ${deck.evidence.warnings.length} warnings`
    status.title = deck.evidence.warnings.join('\n')
    night.disabled = false; panelButton.disabled = false
  } catch (error) {
    status.value = error instanceof Error ? error.message : String(error)
  } finally { load.disabled = false }
}

function pose(): void {
  const state = defaultXpInputs()
  state.mcp.master = true; state.mcp.atArm = true; state.speedbrake = .37; state.panelLight = dark ? 1 : 0
  deck?.pose(makeAirbusDatarefReader(state, { flapIndex: 2, flapCount: 5, headingDeg: 282 }, {}))
}
