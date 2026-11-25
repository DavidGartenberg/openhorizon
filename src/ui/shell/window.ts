import { icon } from './icons'

/** Keep a window's top-left inside the viewport (title bar always grabbable). Pure. */
export function clampWindowPos(x: number, y: number, w: number, vw: number, vh: number): { x: number; y: number } {
  return {
    x: Math.round(Math.min(Math.max(x, 8 - w + 120), vw - 120)),
    y: Math.round(Math.min(Math.max(y, 52), vh - 44)),
  }
}

/** A floating, draggable shell window with a title bar and close button.
 *  Position persists per window id (browser storage, best effort). */
export class ShellWindow {
  readonly el: HTMLElement
  readonly body: HTMLElement
  onToggle: ((open: boolean) => void) | null = null
  private static z = 50

  constructor(readonly id: string, title: string, iconName: string, opts: { width: number; x: number; y: number }) {
    const el = document.createElement('section')
    el.className = 'oh-window oh-ui'
    el.id = `oh-win-${id}`
    el.hidden = true
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-label', title)
    el.style.width = `${opts.width}px`
    const head = document.createElement('header')
    head.className = 'oh-head'
    head.innerHTML = `${icon(iconName, 18)}<span class="oh-title"></span>`
    head.querySelector('.oh-title')!.textContent = title
    const min = document.createElement('button')
    min.className = 'oh-min'
    min.setAttribute('aria-label', `Minimize ${title}`)
    min.innerHTML = icon('minimize', 16)
    min.onclick = () => { const m = el.classList.toggle('oh-collapsed'); min.setAttribute('aria-expanded', String(!m)) }
    head.appendChild(min)
    const x = document.createElement('button')
    x.className = 'oh-x'
    x.setAttribute('aria-label', `Close ${title}`)
    x.innerHTML = icon('close', 16)
    x.onclick = () => this.close()
    head.appendChild(x)
    const body = document.createElement('div')
    body.className = 'oh-body'
    el.append(head, body)
    document.body.appendChild(el)
    this.el = el
    this.body = body
    const saved = this.load()
    this.place(saved?.x ?? opts.x, saved?.y ?? opts.y)
    el.addEventListener('pointerdown', () => this.front())
    let drag: { dx: number; dy: number } | null = null
    head.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.oh-x, .oh-min')) return
      drag = { dx: e.clientX - el.offsetLeft, dy: e.clientY - el.offsetTop }
      head.setPointerCapture(e.pointerId)
    })
    head.addEventListener('pointermove', (e) => { if (drag) this.place(e.clientX - drag.dx, e.clientY - drag.dy) })
    head.addEventListener('pointerup', () => { if (drag) { drag = null; this.save() } })
    head.addEventListener('dblclick', (e) => { if (!(e.target as HTMLElement).closest('.oh-x, .oh-min')) min.click() })
  }

  get isOpen(): boolean { return !this.el.hidden }

  open(): void {
    if (this.isOpen) { this.front(); return }
    this.el.hidden = false
    this.place(this.el.offsetLeft, this.el.offsetTop)
    this.front()
    this.onToggle?.(true)
  }

  close(): void {
    if (!this.isOpen) return
    this.el.hidden = true
    this.onToggle?.(false)
  }

  toggle(): void { if (this.isOpen) this.close(); else this.open() }

  private front(): void { this.el.style.zIndex = String(++ShellWindow.z) }

  private place(x: number, y: number): void {
    const p = clampWindowPos(x, y, this.el.offsetWidth || 320, window.innerWidth, window.innerHeight)
    this.el.style.left = `${p.x}px`
    this.el.style.top = `${p.y}px`
  }

  private load(): { x: number; y: number } | null {
    try { const v = JSON.parse(localStorage.getItem(`oh-win-${this.id}`) ?? 'null'); return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null } catch { return null }
  }

  private save(): void {
    try { localStorage.setItem(`oh-win-${this.id}`, JSON.stringify({ x: this.el.offsetLeft, y: this.el.offsetTop })) } catch { /* storage unavailable */ }
  }
}
