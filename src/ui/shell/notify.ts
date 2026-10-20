export type NoteKind = 'info' | 'warn' | 'alert'

/** Classify a sim message for its accent colour. Pure. */
export function noteKind(msg: string): NoteKind {
  if (/PULL UP|TERRAIN|STALL|FIRE|ENGINE QUIT|CRASH|STARV|FAIL/i.test(msg)) return 'alert'
  if (/NO ATC|WARNING|CAUTION|INOP|LOW|NO ELECTRICAL|DISCONNECT/i.test(msg)) return 'warn'
  return 'info'
}

/** A banner is a title and an optional hint line: "PARKING BRAKE ENGAGED\nTO RELEASE, …". Pure. */
export function parseBanner(msg: string): { title: string; hint?: string } {
  const i = msg.indexOf('\n')
  if (i < 0) return { title: msg }
  const hint = msg.slice(i + 1).trim()
  return hint ? { title: msg.slice(0, i).trim(), hint } : { title: msg.slice(0, i).trim() }
}

/** Notification cards under the toolbar: newest on top, at most four,
 *  each fading after a few seconds. A repeat of the same text refreshes
 *  the existing card instead of stacking duplicates. */
export class Notifier {
  private readonly el: HTMLElement
  private readonly live = new Map<string, { card: HTMLElement; timer: ReturnType<typeof setTimeout> }>()

  constructor() {
    this.el = document.createElement('div')
    this.el.id = 'oh-notify'
    this.el.className = 'oh-ui'
    this.el.setAttribute('role', 'status')
    this.el.setAttribute('aria-live', 'polite')
    document.body.appendChild(this.el)
  }

  push(msg: string, ms = 5000): void {
    const existing = this.live.get(msg)
    if (existing) { clearTimeout(existing.timer); existing.timer = this.expire(msg, existing.card, ms); return }
    const card = document.createElement('div')
    card.className = `oh-note ${noteKind(msg)}`
    const b = parseBanner(msg)
    const title = document.createElement('div'); title.className = 'oh-note-title'; title.textContent = b.title
    card.appendChild(title)
    if (b.hint) { const hint = document.createElement('div'); hint.className = 'oh-note-hint'; hint.textContent = b.hint; card.appendChild(hint) }
    this.el.prepend(card)
    this.live.set(msg, { card, timer: this.expire(msg, card, ms) })
    while (this.el.children.length > 4) {
      const last = this.el.lastElementChild as HTMLElement
      for (const [k, v] of this.live) if (v.card === last) { clearTimeout(v.timer); this.live.delete(k) }
      last.remove()
    }
  }

  private expire(msg: string, card: HTMLElement, ms: number): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      card.classList.add('out')
      setTimeout(() => { card.remove(); if (this.live.get(msg)?.card === card) this.live.delete(msg) }, 380)
    }, ms)
  }
}
