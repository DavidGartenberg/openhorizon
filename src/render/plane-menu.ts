/**
 * Aircraft-selection menu (night-shift N1): a browsable, keyboard-and-
 * mouse DOM overlay listing every flyable type — the 3 study-level
 * ships plus the full roster, grouped by class. Selecting an entry
 * hands the fleet key/designator back to main.ts, which respawns via
 * the same path as the FLY verb. HARD RULE (user): every row shown
 * here must actually fly — rows come exclusively from FLEET and
 * ROSTER, both of which carry real params.
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

export class PlaneMenu {
  private readonly root: HTMLDivElement
  private readonly rows: { el: HTMLDivElement; entry: PlaneMenuEntry }[] = []
  private cursor = 0
  isOpen = false

  constructor(private readonly onSelect: (key: string) => void, currentKey: string) {
    this.root = document.createElement('div')
    this.root.style.cssText = [
      'position:fixed', 'top:6%', 'left:50%', 'transform:translateX(-50%)',
      'width:min(560px,92vw)', 'max-height:84vh', 'overflow-y:auto',
      'background:rgba(12,16,22,0.94)', 'color:#dfe6ee',
      'font:14px/1.5 ui-monospace,Menlo,monospace', 'border:1px solid #3a4656',
      'border-radius:8px', 'padding:10px 0', 'z-index:40', 'display:none',
      'box-shadow:0 12px 40px rgba(0,0,0,0.5)',
    ].join(';')
    const title = document.createElement('div')
    title.textContent = 'SELECT AIRCRAFT — ↑↓ move · Enter fly · Esc/N close'
    title.style.cssText = 'padding:2px 14px 8px;color:#8fa3b8;font-size:12px;border-bottom:1px solid #2a3442;margin-bottom:6px'
    this.root.appendChild(title)

    let lastGroup = ''
    for (const entry of planeMenuEntries()) {
      if (entry.group !== lastGroup) {
        lastGroup = entry.group
        const h = document.createElement('div')
        h.textContent = entry.group.toUpperCase()
        h.style.cssText = 'padding:8px 14px 2px;color:#6f8296;font-size:11px;letter-spacing:0.12em'
        this.root.appendChild(h)
      }
      const row = document.createElement('div')
      row.textContent = `${entry.label}${entry.tier === 'study' ? '  · study-level' : ''}`
      row.style.cssText = 'padding:3px 14px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
      if (entry.key === currentKey) row.textContent += '  ← current'
      row.addEventListener('mouseenter', () => this.setCursor(this.rows.findIndex((r) => r.el === row)))
      row.addEventListener('click', () => { this.close(); this.onSelect(entry.key) })
      this.root.appendChild(row)
      this.rows.push({ el: row, entry })
    }
    document.body.appendChild(this.root)
    this.paint()
  }

  private setCursor(i: number): void {
    if (i < 0) return
    this.cursor = i
    this.paint()
  }

  private paint(): void {
    this.rows.forEach(({ el }, i) => {
      el.style.background = i === this.cursor ? '#2b3b50' : 'transparent'
      el.style.color = i === this.cursor ? '#ffffff' : '#dfe6ee'
    })
  }

  open(): void {
    this.isOpen = true
    this.root.style.display = 'block'
    this.rows[this.cursor]?.el.scrollIntoView({ block: 'nearest' })
  }

  close(): void {
    this.isOpen = false
    this.root.style.display = 'none'
  }

  toggle(): void {
    if (this.isOpen) this.close()
    else this.open()
  }

  /** Keyboard handling while open. Returns true if the event was consumed. */
  handleKey(code: string): boolean {
    if (!this.isOpen) return false
    if (code === 'ArrowDown') { this.setCursor(Math.min(this.cursor + 1, this.rows.length - 1)); this.rows[this.cursor]!.el.scrollIntoView({ block: 'nearest' }); return true }
    if (code === 'ArrowUp') { this.setCursor(Math.max(this.cursor - 1, 0)); this.rows[this.cursor]!.el.scrollIntoView({ block: 'nearest' }); return true }
    if (code === 'PageDown') { this.setCursor(Math.min(this.cursor + 12, this.rows.length - 1)); this.rows[this.cursor]!.el.scrollIntoView({ block: 'nearest' }); return true }
    if (code === 'PageUp') { this.setCursor(Math.max(this.cursor - 12, 0)); this.rows[this.cursor]!.el.scrollIntoView({ block: 'nearest' }); return true }
    if (code === 'Enter') { const e = this.rows[this.cursor]!.entry; this.close(); this.onSelect(e.key); return true }
    if (code === 'Escape' || code === 'KeyN') { this.close(); return true }
    return false
  }
}
