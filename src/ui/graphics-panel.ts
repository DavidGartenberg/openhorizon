import * as THREE from 'three'

export interface GraphicsActions {
  clearInput(): void
  quality(mode: 'performance' | 'high' | 'ultra'): void
  camera(mode: 'chase' | 'orbit' | 'cockpit' | 'free'): void
  lighting(mode: 'day' | 'sunset' | 'night'): void
  weather(mode: 'live' | 'clear' | 'scattered' | 'overcast'): void
}

/** Small flight-view controls; labels describe visible choices, not GPU internals. */
export class GraphicsPanel {
  private readonly stats: HTMLOutputElement
  private readonly view: HTMLSelectElement
  private lastStats = 0

  constructor(renderer: THREE.WebGLRenderer, actions: GraphicsActions) {
    const style = document.createElement('style')
    style.textContent = `
      #graphics-panel{position:fixed;bottom:18px;right:18px;z-index:30;width:244px;
        font:12px/1.5 system-ui,sans-serif;color:#e6edf0;background:rgba(14,22,29,.92);
        border:1px solid #ffffff26;border-radius:12px;box-shadow:0 8px 28px #0004;}
      #graphics-panel summary{padding:11px 15px;cursor:pointer;font-weight:600;letter-spacing:.02em;}
      #graphics-panel .controls{padding:0 15px 14px;border-top:1px solid #ffffff12;}
      #graphics-panel label{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;}
      #graphics-panel select{width:128px;border:1px solid #ffffff26;border-radius:5px;padding:5px;
        background:#24333e;color:#f0f4f5;font:inherit;}
      #graphics-panel input[type=range]{width:126px;accent-color:#9ac7d1;}
      #graphics-panel .time{display:flex;gap:5px;margin-top:12px;}
      #graphics-panel button{flex:1;background:#24333e;border:1px solid #ffffff26;border-radius:5px;
        color:#edf3f5;padding:6px 3px;font:inherit;cursor:pointer;}
      #graphics-panel button:hover{background:#3a505f;} #graphics-panel button:focus-visible,
      #graphics-panel select:focus-visible{outline:2px solid #a9dbe5;outline-offset:2px;}
      #graphics-panel output{display:block;color:#9eafb9;font:10px/1.5 ui-monospace,monospace;margin-top:12px;}
      @media(max-height:500px){#graphics-panel{bottom:6px;right:6px}.controls{max-height:280px;overflow:auto}}
    `
    document.head.appendChild(style)
    const panel = document.createElement('details')
    panel.id = 'graphics-panel'
    panel.innerHTML = `<summary>View & graphics</summary><div class="controls">
      <label>Camera<select aria-label="Camera view"><option value="chase">Chase</option><option value="cockpit">Cockpit</option><option value="orbit">Orbit</option><option value="free">Free camera</option></select></label>
      <label>Quality<select aria-label="Graphics quality"><option value="1">Performance</option><option value="1.5" selected>High</option><option value="2">Ultra</option></select></label>
      <label>Exposure<input aria-label="Exposure" type="range" min="0.4" max="1.2" step="0.05" value="0.8"></label>
      <label>Weather<select aria-label="Weather"><option value="live">Live weather</option><option value="clear">Clear</option><option value="scattered">Scattered</option><option value="overcast">Overcast</option></select></label>
      <div class="time"><button type="button" data-light="day">Daylight</button><button type="button" data-light="sunset">Sunset</button><button type="button" data-light="night">Night</button></div>
      <label>Traffic labels<input aria-label="Traffic labels" type="checkbox" checked></label>
      <output aria-label="Rendering statistics"></output>
    </div>`
    // Let native controls consume keys without also flying the airplane.
    panel.addEventListener('keydown', e => e.stopPropagation())
    panel.addEventListener('focusin', () => actions.clearInput())
    this.view = panel.querySelector<HTMLSelectElement>('[aria-label="Camera view"]')!
    this.view.onchange = () => actions.camera(this.view.value as Parameters<GraphicsActions['camera']>[0])
    const quality = panel.querySelector<HTMLSelectElement>('[aria-label="Graphics quality"]')!
    quality.onchange = () => {
      actions.quality(quality.value === '1' ? 'performance' : quality.value === '2' ? 'ultra' : 'high')
      renderer.setPixelRatio(Math.min(window.devicePixelRatio,Number(quality.value)))
      renderer.setSize(window.innerWidth,window.innerHeight)
    }
    panel.querySelector<HTMLInputElement>('[aria-label="Exposure"]')!.oninput = e => {
      renderer.toneMappingExposure = Number((e.target as HTMLInputElement).value)
    }
    const weather = panel.querySelector<HTMLSelectElement>('[aria-label="Weather"]')!
    weather.onchange = () => actions.weather(weather.value as Parameters<GraphicsActions['weather']>[0])
    panel.querySelectorAll<HTMLButtonElement>('[data-light]').forEach(b => {
      b.onclick = () => actions.lighting(b.dataset.light as Parameters<GraphicsActions['lighting']>[0])
    })
    // Flight info has its own toolbar button; this hides the traffic tags.
    panel.querySelector<HTMLInputElement>('[aria-label="Traffic labels"]')!.onchange = e => {
      const labels = document.getElementById('traffic-labels')
      if (labels) labels.style.display = (e.target as HTMLInputElement).checked ? '' : 'none'
    }
    this.stats = panel.querySelector('output')!
    document.body.appendChild(panel)
  }

  update(now: number, camera: string, frameMs: number, renderer: THREE.WebGLRenderer): void {
    this.view.value = camera
    if (now-this.lastStats < 1000) return
    this.lastStats = now
    this.stats.value = `${frameMs.toFixed(1)} ms CPU · ${renderer.info.render.calls} draws · ${renderer.getPixelRatio().toFixed(1)}× resolution`
  }
}
