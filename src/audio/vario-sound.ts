import { varioTone } from '../sim/vario'

/** WebAudio voice for the variometer: a sine tone gated into beeps for climb,
 *  continuous for strong sink (see sim/vario.ts `varioTone`). */
export class VarioSound {
  private ctx: AudioContext | null = null
  private osc: OscillatorNode | null = null
  private gain: GainNode | null = null
  private phase = 0
  muted = false
  enabled = false

  unlock(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return }
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      const gain = ctx.createGain()
      gain.gain.value = 0
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      this.ctx = ctx
      this.osc = osc
      this.gain = gain
    } catch {
      // Autoplay policy: stays silent until a gesture.
    }
  }

  /** Call every frame with the vario rate (m/s). */
  update(dt: number, rateMs: number): void {
    if (!this.ctx || !this.osc || !this.gain) return
    const t = this.ctx.currentTime
    const tone = varioTone(rateMs)
    let level = 0
    if (this.enabled && !this.muted && tone.on) {
      this.osc.frequency.setTargetAtTime(tone.freqHz, t, 0.03)
      if (tone.beepHz > 0) {
        this.phase = (this.phase + dt * tone.beepHz) % 1
        level = this.phase < 0.55 ? 0.12 : 0
      } else {
        level = 0.07
      }
    }
    this.gain.gain.setTargetAtTime(level, t, 0.012)
  }
}
