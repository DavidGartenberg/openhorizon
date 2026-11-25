import type { MountKind } from '../render/mounted-camera'

/**
 * The cabin around the wing view: the sidewall with the window cut out of it, so the wing is seen through a passenger's
 * window rather than through the whole screen. Pure DOM (a rounded rectangle whose huge shadow is the wall), no pointer
 * events, so the mouse still looks around.
 */
export class CabinWindow {
  private readonly root = document.createElement('div')

  constructor() {
    const style = document.createElement('style')
    style.textContent = `
      #cabin-window{position:fixed;inset:0;z-index:12;pointer-events:none;display:none;overflow:hidden}
      #cabin-window .pane{position:absolute;left:50%;top:50%;height:min(86vh,calc(78vw * 1.28));aspect-ratio:3/4;transform:translate(-50%,-50%);
        border-radius:46% / 34%;box-shadow:0 0 0 200vmax #cbc4b3,inset 0 0 0 .7vmin #7c776b,inset 0 0 1.8vmin 1vmin rgba(0,0,0,.35),0 0 0 .9vmin #e4ded0,0 0 0 1.6vmin #a39d8e}
      #cabin-window .glass{position:absolute;inset:0;border-radius:inherit;background:linear-gradient(130deg,rgba(255,255,255,.13) 0,rgba(255,255,255,0) 38%,rgba(255,255,255,0) 70%,rgba(255,255,255,.05) 100%)}
      #cabin-window .wall{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,rgba(255,255,255,.12),rgba(0,0,0,.22) 90%);mix-blend-mode:multiply}
    `
    document.head.appendChild(style)
    this.root.id = 'cabin-window'
    this.root.innerHTML = '<div class="pane"><div class="glass"></div></div><div class="wall"></div>'
    this.root.setAttribute('aria-hidden', 'true')
    document.body.appendChild(this.root)
  }

  /** Show the window for the wing views; nothing for any other view. */
  show(kind: MountKind | null): void {
    this.root.style.display = kind === 'wingL' || kind === 'wingR' ? 'block' : 'none'
  }
}
