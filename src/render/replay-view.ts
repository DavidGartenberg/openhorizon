/**
 * Replay viewer (16d): a DOM overlay drawing the recorder's last
 * minutes — plan-view track (north-up, colored by AGL) and a
 * distance/altitude profile with the touchdown marker and a dashed 3°
 * reference. Reads ONLY recorded samples via the pure plot builder
 * (§18's rule), so what it draws is provably what was flown.
 */
import { buildReplayPlots } from '../sim/replay'
import type { FlightSample } from '../sim/recorder'


export class ReplayView {
  private panel: HTMLDivElement | null = null

  get isOpen(): boolean {
    return this.panel !== null
  }

  toggle(samples: ReadonlyArray<FlightSample>, debriefLine: string): void {
    if (this.panel) {
      this.close()
      return
    }
    // Fit the viewport (the panel must work in small embedded panes).
    const W = Math.min(660, window.innerWidth - 24)
    const H = Math.min(470, window.innerHeight - 24)
    const panel = document.createElement('div')
    panel.style.cssText =
      `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:${W}px;z-index:25;` +
      'background:rgba(0,10,20,.94);color:#aef;border:1px solid #4a7;border-radius:8px;' +
      'font:12px ui-monospace,monospace;padding:10px 12px;cursor:pointer;box-sizing:border-box'
    const title = document.createElement('div')
    title.style.cssText = 'margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
    title.textContent = debriefLine || 'REPLAY — recorded track (click to close)'
    panel.appendChild(title)
    const canvas = document.createElement('canvas')
    canvas.width = W - 24
    canvas.height = H - 40
    canvas.style.display = 'block'
    panel.appendChild(canvas)
    panel.onclick = () => this.close()
    document.body.appendChild(panel)
    this.panel = panel
    this.draw(canvas, samples)
  }

  close(): void {
    this.panel?.remove()
    this.panel = null
  }

  private draw(canvas: HTMLCanvasElement, samples: ReadonlyArray<FlightSample>): void {
    const ctx = canvas.getContext('2d')!
    const cw = canvas.width
    const ch = canvas.height
    ctx.fillStyle = '#06090d'
    ctx.fillRect(0, 0, cw, ch)
    const p = buildReplayPlots(samples, 240)
    if (p.plan.length < 2) {
      ctx.fillStyle = '#8a93a0'
      ctx.font = '13px ui-monospace, monospace'
      ctx.fillText('No recorded track yet — fly something first.', 20, 40)
      return
    }

    // ---- plan view (left square, north-up) ----
    const px = 8
    const py = 8
    const ps = Math.min(cw * 0.48, ch - 150)
    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity
    for (const q of p.plan) {
      minE = Math.min(minE, q.e); maxE = Math.max(maxE, q.e)
      minN = Math.min(minN, q.n); maxN = Math.max(maxN, q.n)
    }
    const span = Math.max(maxE - minE, maxN - minN, 200) * 1.12
    const cE = (minE + maxE) / 2
    const cN = (minN + maxN) / 2
    const toX = (e: number) => px + ps / 2 + ((e - cE) / span) * ps
    const toY = (n: number) => py + ps / 2 - ((n - cN) / span) * ps
    ctx.strokeStyle = '#28313c'
    ctx.strokeRect(px, py, ps, ps)
    const maxAgl = Math.max(...p.plan.map((q) => q.aglFt), 500)
    for (let i = 1; i < p.plan.length; i++) {
      const a = p.plan[i - 1]!
      const b = p.plan[i]!
      const f = Math.min(b.aglFt / maxAgl, 1)
      ctx.strokeStyle = `hsl(${120 + 60 * (1 - f)}, 70%, ${45 + 35 * (1 - f)}%)`
      ctx.beginPath()
      ctx.moveTo(toX(a.e), toY(a.n))
      ctx.lineTo(toX(b.e), toY(b.n))
      ctx.stroke()
    }
    if (p.touchdownIdx !== null) {
      const td = p.plan[p.touchdownIdx]!
      ctx.fillStyle = '#ff5a4e'
      ctx.beginPath()
      ctx.arc(toX(td.e), toY(td.n), 4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#8a93a0'
    ctx.font = '11px ui-monospace, monospace'
    ctx.fillText('N ↑', px + 6, py + 14)
    const kmBar = span > 8000 ? 5000 : span > 3000 ? 2000 : 1000
    const barPx = (kmBar / span) * ps
    ctx.strokeStyle = '#8a93a0'
    ctx.beginPath()
    ctx.moveTo(px + 8, py + ps - 10)
    ctx.lineTo(px + 8 + barPx, py + ps - 10)
    ctx.stroke()
    ctx.fillText(`${kmBar / 1000} km`, px + 10, py + ps - 16)

    // ---- profile (bottom band) ----
    const gx = 8
    const gw = cw - 16
    const gh = 118
    const gy = ch - gh - 8
    ctx.strokeStyle = '#28313c'
    ctx.strokeRect(gx, gy, gw, gh)
    const maxAlt = Math.max(...p.profile.map((q) => q.altFt)) * 1.08 + 50
    const toGX = (d: number) => gx + (d / Math.max(p.totalDistM, 1)) * gw
    const toGY = (a: number) => gy + gh - (a / maxAlt) * gh
    // 3° reference back from touchdown (dashed amber).
    if (p.touchdownIdx !== null) {
      const td = p.profile[p.touchdownIdx]!
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = '#d9a916'
      ctx.beginPath()
      ctx.moveTo(toGX(td.distM), toGY(td.altFt))
      const backM = td.distM
      ctx.lineTo(toGX(0), toGY(td.altFt + backM * Math.tan((3 * Math.PI) / 180) * 3.28084))
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#d9a916'
      ctx.fillText('3° ref', gx + 6, gy + 14)
    }
    ctx.strokeStyle = '#cfe8ff'
    ctx.beginPath()
    for (let i = 0; i < p.profile.length; i++) {
      const q = p.profile[i]!
      const x = toGX(q.distM)
      const y = toGY(q.altFt)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    if (p.touchdownIdx !== null) {
      const td = p.profile[p.touchdownIdx]!
      ctx.fillStyle = '#ff5a4e'
      ctx.beginPath()
      ctx.arc(toGX(td.distM), toGY(td.altFt), 4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#8a93a0'
    ctx.fillText(`${Math.round(maxAlt)} ft`, gx + gw - 64, gy + 12)
    ctx.fillText(`${(p.totalDistM / 1852).toFixed(1)} nm`, gx + gw - 64, gy + gh - 6)
  }
}
