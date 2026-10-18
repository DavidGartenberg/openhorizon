/** Visual dimensions and family topology, not aerodynamic data. Diameters are
 * rounded family values; nacelle/sweep/fin proportions are artist estimates
 * from manufacturer airport-planning views. These are procedural approximations,
 * not measured CAD sections or aerodynamic inputs.
 * References: https://www.boeing.com/commercial/airports/plan-manuals
 * https://www.aircraft.airbus.com/en/customer-care/fleet-wide-care/airport-operations-and-aircraft-characteristics/aircraft-characteristics
 * https://www.hondajet.com/en/Products/HondaJet-Elite-II
 * https://www.dassaultfalcon.com/preowned/falcon-7x-143/ */
export interface JetProfile {
  diameter: number
  mount: 'wing' | 'tail' | 'overwing'
  tTail: boolean
  stabilizerHeight?: number
  sweep: number
  winglet: 'none' | 'blended' | 'sharklet' | 'raked' | 'fence' | 'split'
  hump: '747' | 'a380' | 'none'
  engineRadius: number
  engineLength: number
  mainAxles: number
  bodyBogies: number
  finHeight: number
}
const profiles: Record<string, JetProfile> = {}
function family(ids: string, diameter: number, overrides: Partial<JetProfile> = {}): void {
  const p: JetProfile = { diameter, mount: 'wing', tTail: false, sweep: 25,
    winglet: 'none', hump: 'none', engineRadius: diameter * .29,
    engineLength: diameter * 1.05, mainAxles: 1, bodyBogies: 0,
    finHeight: diameter * 1.6, ...overrides }
  for (const id of ids.split(' ')) profiles[id] = p
}
family('B736 B737 B738 B739', 3.76, { winglet: 'blended', engineRadius: 1.02, engineLength: 3.1 })
family('B38M B39M', 3.76, { winglet: 'split', engineRadius: 1.18, engineLength: 3.6 })
family('A318 A319 A320 A321', 3.95, { winglet: 'fence', engineRadius: 1.16, engineLength: 3.7 })
family('A20N A21N', 3.95, { winglet: 'sharklet', engineRadius: 1.34, engineLength: 4 })
family('BCS1 BCS3', 3.5, { winglet: 'sharklet', engineRadius: 1.15, engineLength: 3.5 })
family('E170 E75L E190 E195', 3.01, { winglet: 'blended', engineRadius: .87, engineLength: 3.1 })
family('CRJ2 CRJ7 CRJ9 CRJX', 2.69, { mount: 'tail', tTail: true, winglet: 'blended', engineRadius: .72, engineLength: 3.1, finHeight: 4.1 })
family('MD82 MD88 B712', 3.34, { mount: 'tail', tTail: true, engineRadius: .8, engineLength: 4.7, finHeight: 5.4 })
family('E135 E145', 2.28, { mount: 'tail', tTail: true, engineRadius: .61, engineLength: 2.7 })
family('B752 B753', 3.76, { mainAxles: 2, engineRadius: 1.25, engineLength: 4.5, finHeight: 7.8 })
family('B762 B763 B764', 5.03, { mainAxles: 2, engineRadius: 1.45, engineLength: 4.5, finHeight: 8.3 })
family('B764', 5.03, { mainAxles: 2, engineRadius: 1.45, engineLength: 4.5, finHeight: 8.3, winglet: 'raked' })
family('B772 B77L B77W', 6.2, { mainAxles: 3, sweep: 32, engineRadius: 1.88, engineLength: 5.5, finHeight: 9.6, winglet: 'raked' })
family('B772', 6.2, { mainAxles: 3, sweep: 32, engineRadius: 1.75, engineLength: 5.4, finHeight: 9.6 })
family('B788 B789 B78X', 5.77, { mainAxles: 2, sweep: 32, engineRadius: 1.7, engineLength: 4.8, finHeight: 8.4, winglet: 'raked' })
family('A332 A333 A343', 5.64, { mainAxles: 2, sweep: 30, engineRadius: 1.55, engineLength: 4.8, finHeight: 8.9, winglet: 'blended' })
family('A343', 5.64, { mainAxles: 2, bodyBogies: 1, sweep: 30, engineRadius: 1.07, engineLength: 4, finHeight: 8.9, winglet: 'blended' })
family('A339', 5.64, { mainAxles: 2, sweep: 30, engineRadius: 1.7, engineLength: 5, finHeight: 8.9, winglet: 'sharklet' })
family('A359 A35K', 5.96, { mainAxles: 2, sweep: 32, engineRadius: 1.85, engineLength: 5.2, finHeight: 8.5, winglet: 'sharklet' })
family('A35K', 5.96, { mainAxles: 3, sweep: 32, engineRadius: 1.85, engineLength: 5.2, finHeight: 8.5, winglet: 'sharklet' })
family('B742 B744 B748', 6.5, { mainAxles: 2, bodyBogies: 2, sweep: 37, engineRadius: 1.45, engineLength: 4.7, finHeight: 10.1, hump: '747', winglet: 'blended' })
family('B742', 6.5, { mainAxles: 2, bodyBogies: 2, sweep: 37, engineRadius: 1.4, engineLength: 4.7, finHeight: 10.1, hump: '747' })
family('B748', 6.5, { mainAxles: 2, bodyBogies: 2, sweep: 37, engineRadius: 1.55, engineLength: 4.8, finHeight: 10.1, hump: '747', winglet: 'raked' })
family('A388', 7.14, { mainAxles: 2, bodyBogies: 2, sweep: 33, engineRadius: 1.85, engineLength: 5.5, finHeight: 11.3, hump: 'a380', winglet: 'fence' })
family('MD11', 6.02, { mainAxles: 2, bodyBogies: 1, sweep: 35, engineRadius: 1.55, engineLength: 4.7, finHeight: 9, winglet: 'blended' })
// Business jets have family cabin diameters independent of their length.
family('C525 C25A C25B C25C', 1.65, { mount: 'tail', tTail: true, sweep: 5, engineRadius: .39, engineLength: 1.8, finHeight: 2.5 })
family('C56X', 1.83, { mount: 'tail', stabilizerHeight: .48, sweep: 12, engineRadius: .47, engineLength: 2.1, finHeight: 2.7 })
family('C680 C68A', 1.95, { mount: 'tail', stabilizerHeight: .5, sweep: 16, engineRadius: .56, engineLength: 2.35, finHeight: 3.1, winglet: 'blended' })
family('C750', 1.95, { mount: 'tail', tTail: true, sweep: 37, engineRadius: .65, engineLength: 3.1, finHeight: 3.7 })
family('E50P', 1.83, { mount: 'tail', tTail: true, sweep: 7, engineRadius: .4, engineLength: 1.8, finHeight: 2.5 })
family('E55P', 1.83, { mount: 'tail', tTail: true, sweep: 20, engineRadius: .46, engineLength: 2, finHeight: 2.7, winglet: 'blended' })
family('HDJT', 1.8, { mount: 'overwing', tTail: true, sweep: 12, engineRadius: .4, engineLength: 1.85, finHeight: 2.7, winglet: 'blended' })
family('CL30 CL35', 2.69, { mount: 'tail', tTail: true, sweep: 27, engineRadius: .66, engineLength: 2.8, finHeight: 3.8, winglet: 'blended' })
family('F2TH FA7X', 2.65, { mount: 'tail', stabilizerHeight: .48, sweep: 32, engineRadius: .59, engineLength: 2.65, finHeight: 3.8, winglet: 'blended' })
family('GLF4 GLF5 GLF6', 2.49, { mount: 'tail', tTail: true, sweep: 30, engineRadius: .75, engineLength: 3.5, finHeight: 4.1, winglet: 'blended' })
family('GLF6', 2.8, { mount: 'tail', tTail: true, sweep: 36, engineRadius: .81, engineLength: 3.6, finHeight: 4.2, winglet: 'blended' })
family('GL5T GLEX', 2.69, { mount: 'tail', tTail: true, sweep: 35, engineRadius: .78, engineLength: 3.5, finHeight: 4.2, winglet: 'blended' })
export const JET_PROFILES: Readonly<Record<string, JetProfile>> = profiles
export function jetProfileFor(designator: string): JetProfile {
  const p = profiles[designator]
  if (!p) throw new Error(`Missing jet visual profile: ${designator}`)
  return p
}
