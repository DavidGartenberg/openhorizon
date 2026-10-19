import { buildC172, buildCub, buildB738, type AircraftMesh } from './aircraft-mesh'
import { buildAirliner, airlinerCfgFor } from './airliner-mesh'
import { buildPropAircraft } from './prop-aircraft'
import { ROSTER, rosterParams } from '../sim/aircraft/roster'
import { C172S } from '../sim/aircraft/c172s'
import { J3CUB } from '../sim/aircraft/j3cub'
import { B738 } from '../sim/aircraft/b738'
import type { AircraftParams } from '../sim/aircraft/params'

/** One catalog for the simulator and inspection studio. Traffic LODs have a
 * separate factory: no selectable aircraft silently falls back to those meshes. */
export const PLAYER_AIRCRAFT = [
  { key: '172', label: 'Cessna 172S', spanM: 11, lengthM: 8.28 },
  { key: 'CUB', label: 'Piper J-3 Cub', spanM: 10.74, lengthM: 6.83 },
  { key: '737', label: 'Boeing 737-800', spanM: 35.8, lengthM: 39.47 },
  ...ROSTER.map(({ spec }) => ({ key: spec.designator, label: spec.label, spanM: spec.spanM, lengthM: spec.lengthM })),
]

export function playerAircraftParams(key: string): AircraftParams {
  const params = key === '172' ? C172S : key === 'CUB' ? J3CUB : key === '737' ? B738 : rosterParams(key)
  if (!params) throw new Error(`Unknown player aircraft: ${key}`)
  return params
}

export function buildPlayerAircraft(key: string, params = playerAircraftParams(key)): AircraftMesh {
  let ship: AircraftMesh
  if (key === '172') ship = buildC172()
  else if (key === 'CUB') ship = buildCub()
  else if (key === '737') ship = buildB738()
  else {
    const entry = ROSTER.find(({ spec }) => spec.designator === key)
    if (!entry) throw new Error(`Unknown player aircraft: ${key}`)
    ship = entry.spec.powerplant.kind === 'jet'
      ? buildAirliner(airlinerCfgFor(entry.spec, params.gear))
      : buildPropAircraft(entry.spec, params)
  }
  ship.group.userData.playerAircraft = key
  return ship
}
