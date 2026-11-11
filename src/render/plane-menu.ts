/**
 * Aircraft list for the free-flight start screen (ui/shell/launcher.ts):
 * every flyable type — the 3 study-level ships plus the full roster,
 * grouped by class. HARD RULE (user): every row shown must actually
 * fly — rows come exclusively from FLEET and ROSTER, both of which carry
 * real params.
 */
import { ROSTER } from '../sim/aircraft/roster'
import type { Cd0Class } from '../sim/aircraft/derive'

export interface PlaneMenuEntry {
  key: string // FLEET key or roster designator (the FLY argument)
  label: string
  tier: string
  group: string
}

const GROUP_BY_CLASS: Record<Cd0Class, string> = {
  fixedPistonSingle: 'GA singles',
  cleanPistonSingle: 'GA singles',
  bushTaildragger: 'Taildraggers & bush',
  retractPistonSingle: 'GA singles',
  pistonTwin: 'Piston twins',
  turbopropSingle: 'Turboprops',
  turbopropTwin: 'Turboprops',
  bizjet: 'Business jets',
  airliner: 'Airliners',
  glider: 'Gliders',
}

const GROUP_ORDER = [
  'Study level',
  'Airliners',
  'Turboprops',
  'Business jets',
  'Piston twins',
  'GA singles',
  'Taildraggers & bush',
  'Gliders',
]

export function planeMenuEntries(): PlaneMenuEntry[] {
  const entries: PlaneMenuEntry[] = [
    { key: '172', label: 'Cessna 172S Skyhawk', tier: 'study', group: 'Study level' },
    { key: 'CUB', label: 'Piper J-3 Cub', tier: 'study', group: 'Study level' },
    { key: '737', label: 'Boeing 737-800', tier: 'study', group: 'Study level' },
  ]
  for (const e of ROSTER) {
    entries.push({
      key: e.spec.designator,
      label: `${e.spec.label} (${e.spec.designator})`,
      tier: 'B',
      group: GROUP_BY_CLASS[e.opts.cd0Class] ?? 'GA singles',
    })
  }
  entries.sort((a, b) =>
    GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.label.localeCompare(b.label))
  return entries
}
