import { icon } from './icons'

export interface ToolbarItem {
  id: string
  label: string
  icon: string
  onClick: () => void
  /** Lit (accent underline) while true. */
  active?: () => boolean
  separatorBefore?: boolean
}

/** Show the toolbar while the pointer is near the top edge or over it, for
 *  a few seconds after it was last wanted, or while pinned. Pure. */
export function toolbarVisible(s: { pointerY: number; overToolbar: boolean; msSinceWanted: number; pinned: boolean }): boolean {
  return s.pinned || s.overToolbar || s.pointerY <= 56 || s.msSinceWanted < 2500
}

/** Auto-hiding icon toolbar across the top centre of the screen. */
export class Toolbar {
  readonly el: HTMLElement
  private readonly buttons = new Map<string, { b: HTMLButtonElement; item: ToolbarItem }>()
  private pointerY = 999
  private over = false
  private wantedAt = performance.now()
  pinned = false

  constructor(items: ToolbarItem[]) {
    const el = document.createElement('nav')
    el.id = 'oh-toolbar'
    el.className = 'oh-ui'
    el.setAttribute('aria-label', 'Simulator toolbar')
    for (const item of items) {
      if (item.separatorBefore) { const s = document.createElement('span'); s.className = 'oh-sep'; el.appendChild(s) }
      const b = document.createElement('button')
      b.className = 'oh-tb'
      b.setAttribute('aria-label', item.label)
      b.innerHTML = `${icon(item.icon, 24)}<span class="oh-tip"></span>`
      b.querySelector('.oh-tip')!.textContent = item.label
      b.onclick = () => { item.onClick(); b.blur(); this.refresh() }
      el.appendChild(b)
      this.buttons.set(item.id, { b, item })
    }
    const zone = document.createElement('div')
    zone.id = 'oh-toolbar-hotzone'
    document.body.append(zone, el)
    this.el = el
    el.addEventListener('pointerenter', () => { this.over = true })
    el.addEventListener('pointerleave', () => { this.over = false; this.wantedAt = performance.now() })
    window.addEventListener('pointermove', (e) => { this.pointerY = e.clientY; if (e.clientY <= 56) this.wantedAt = performance.now() }, { passive: true })
  }

  /** Reveal for a moment (e.g. after a keyboard shortcut). */
  poke(): void { this.wantedAt = performance.now() }

  /** Per frame: visibility and lit states. */
  refresh(now = performance.now()): void {
    const show = toolbarVisible({ pointerY: this.pointerY, overToolbar: this.over, msSinceWanted: now - this.wantedAt, pinned: this.pinned })
    this.el.classList.toggle('hidden', !show)
    for (const { b, item } of this.buttons.values()) b.classList.toggle('on', !!item.active?.())
  }
}
