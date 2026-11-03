/**
 * On-screen data attribution for third-party map layers. Google's Map Tiles
 * API requires its attribution (and logo) to be visible whenever its tiles
 * are on screen; this shows the copyright text the viewport endpoint
 * returns, bottom-left, and hides itself for the public-domain USGS layer.
 */
export class MapAttribution {
  private readonly el: HTMLDivElement

  constructor() {
    const el = document.createElement('div')
    el.id = 'map-attribution'
    el.setAttribute('role', 'note')
    el.style.cssText = [
      'position:fixed', 'left:12px', 'bottom:6px', 'z-index:25', 'pointer-events:none',
      'font:11px/1.35 system-ui,sans-serif', 'color:#fff', 'text-shadow:0 1px 2px #000c',
      'display:none', 'max-width:60vw',
    ].join(';')
    document.body.appendChild(el)
    this.el = el
  }

  /** Show `copyright` with the Google wordmark, or hide (null). */
  show(copyright: string | null): void {
    if (copyright === null) { this.el.style.display = 'none'; return }
    this.el.replaceChildren()
    const mark = document.createElement('strong')
    mark.textContent = 'Google'
    mark.style.cssText = 'font-size:13px;letter-spacing:.01em;margin-right:8px'
    this.el.append(mark, document.createTextNode(copyright))
    this.el.style.display = 'block'
  }
}
