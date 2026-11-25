/**
 * Compares each installed X-Plane aircraft's authored numbers (.acf: empty / maximum / fuel mass in pounds,
 * Vne, Vno, Vso, Vs, Vx, Vy) with this simulator's flight-model parameters for the same type.
 *
 *   npx vite-node scripts/xplane/audit-acf.ts
 *
 * Reads the user's own install (XPLANE_DIR = the "Laminar Research" folder); nothing is copied.
 * Differences over 5 % are flagged: either this simulator uses a better-documented published figure
 * (say so in the type's file) or it is wrong and should be corrected.
 */
import fs from 'node:fs'
import { C172S } from '../../src/sim/aircraft/c172s'
import { B738 } from '../../src/sim/aircraft/b738'
import { rosterParams } from '../../src/sim/aircraft/roster'
import type { AircraftParams } from '../../src/sim/aircraft/params'

const dir = process.env.XPLANE_DIR ?? '/Users/davidgartenberg/X-Plane 12/Aircraft/Laminar Research'
const LB = 0.45359237
const TYPES: Array<[string, string, () => AircraftParams | null]> = [
  ['Cessna 172 SP', 'C172', () => C172S], ['Boeing 737-800', 'B738', () => B738],
  ['Airbus A330-300', 'A333', () => rosterParams('A333')], ['McDonnell Douglas MD-82', 'MD82', () => rosterParams('MD88')],
  ['Cirrus SR22', 'SR22', () => rosterParams('SR22')], ['Beechcraft Baron 58', 'BE58', () => rosterParams('BE58')],
  ['Piper PA-18 Super Cub', 'PA18', () => rosterParams('PA18')], ['Schleicher ASK 21', 'AS21', () => rosterParams('AS21')],
  ['Cessna Citation X', 'C750', () => rosterParams('C750')],
]
const acf = (folder: string): Record<string, number> => {
  const f = fs.readdirSync(`${dir}/${folder}`).find((n) => n.endsWith('.acf'))!
  const out: Record<string, number> = {}
  for (const line of fs.readFileSync(`${dir}/${folder}/${f}`, 'utf8').split('\n')) {
    const m = /^P acf\/_(m_empty|m_max|m_fuel_max_tot|Vne_kts|Vno_kts|Vso_kts|Vs_kts|Vx_kts|Vy_kts|flap_detents) (\S+)/.exec(line)
    if (m) out[m[1]!] = Number(m[2])
  }
  return out
}
const pct = (sim: number, xp: number): string => (xp > 0 ? `${(((sim - xp) / xp) * 100).toFixed(1).padStart(6)}%` : '     –')
console.log('type  | empty kg  sim/xp      | mtow kg   sim/xp      | fuel kg   sim/xp     | Vne kt  sim/xp')
for (const [folder, key, params] of TYPES) {
  const a = acf(folder), p = params()
  if (!p) { console.log(key, 'no sim params'); continue }
  const row = [
    `${key.padEnd(5)}`,
    `${Math.round(p.emptyMassKg)}/${Math.round(a.m_empty! * LB)} ${pct(p.emptyMassKg, a.m_empty! * LB)}`,
    `${Math.round(p.mtowKg)}/${Math.round(a.m_max! * LB)} ${pct(p.mtowKg, a.m_max! * LB)}`,
    `${Math.round(p.fuelCapacityKg)}/${Math.round(a.m_fuel_max_tot! * LB)} ${pct(p.fuelCapacityKg, a.m_fuel_max_tot! * LB)}`,
    `${Math.round(p.vSpeeds.vne)}/${Math.round(a.Vne_kts!)} ${pct(p.vSpeeds.vne, a.Vne_kts!)}`,
  ]
  console.log(row.join(' | '))
  // Stall and climb speeds: X-Plane's authored V-speeds (0 = not authored) against this simulator's.
  const v = (name: string, sim: number, xp: number | undefined): string => (xp ? `${name} ${Math.round(sim)}/${Math.round(xp)} ${pct(sim, xp).trim()}` : `${name} ${Math.round(sim)}/–`)
  console.log('      ' + [v('Vso', p.vSpeeds.vs0, a.Vso_kts), v('Vs', p.vSpeeds.vs1, a.Vs_kts), v('Vx', p.vSpeeds.vx, a.Vx_kts), v('Vy', p.vSpeeds.vy, a.Vy_kts), v('Vno', p.vSpeeds.vno, a.Vno_kts)].join(' | '))
}
