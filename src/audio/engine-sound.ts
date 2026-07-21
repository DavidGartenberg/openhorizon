/**
 * Cockpit sound synthesis (§16, Phase 9a) — no samples, everything driven
 * by sim state every frame (§1: what you hear is what the engine is doing).
 *
 * Engine: a 4-stroke 4-cylinder fires twice per crankshaft revolution, so
 * the fundamental is RPM/60×2 Hz (~25 Hz idle → ~90 Hz redline). Layered
 * sawtooth harmonics + exhaust noise through a lowpass whose cutoff and
 * gain track shaft power. Slipstream: filtered noise scaling with IAS².
 * Ground rumble: low noise by ground speed while on the runway. Stall
 * horn: the C172's steady reed tone (~ mid-hundreds Hz) while the vane
 * lifts (stallFraction above threshold). Touchdown: a one-shot thump.
 *
 * Browsers block audio before a user gesture — call `unlock()` from any
 * click/keydown; until then update() is a no-op.
 */

export interface SoundState {
  rpm: number
  powerFrac: number // shaft power / rated
  iasKt: number
  gsKt: number
  onGround: boolean
  stallWarn: boolean
  engineRunning: boolean
}

export class EngineSound {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private engineOscs: OscillatorNode[] = []
  private engineGain!: GainNode
  private engineFilter!: BiquadFilterNode
  private windSource!: AudioBufferSourceNode
  private windGain!: GainNode
  private windFilter!: BiquadFilterNode
  private rumbleGain!: GainNode
  private hornOsc!: OscillatorNode
  private hornGain!: GainNode
  private wasOnGround = true
  muted = false

  get unlocked(): boolean {
    return this.ctx !== null
  }

  /** Build the graph on the first user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    try {
      const ctx = new AudioContext()
      this.ctx = ctx
      this.master = ctx.createGain()
      this.master.gain.value = 0.5
      this.master.connect(ctx.destination)

      // Engine: fundamental + 2 harmonics + subharmonic shake.
      this.engineGain = ctx.createGain()
      this.engineGain.gain.value = 0
      this.engineFilter = ctx.createBiquadFilter()
      this.engineFilter.type = 'lowpass'
      this.engineFilter.frequency.value = 800
      this.engineGain.connect(this.engineFilter)
      this.engineFilter.connect(this.master)
      for (const mult of [0.5, 1, 2, 3]) {
        const osc = ctx.createOscillator()
        osc.type = mult === 1 ? 'sawtooth' : 'square'
        osc.frequency.value = 25 * mult
        const g = ctx.createGain()
        g.gain.value = mult === 1 ? 0.5 : mult === 0.5 ? 0.3 : 0.12 / mult
        osc.connect(g)
        g.connect(this.engineGain)
        osc.start()
        this.engineOscs.push(osc)
      }

      // Shared looped noise buffer for wind + rumble.
      const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
      const ch = noise.getChannelData(0)
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1
      this.windSource = ctx.createBufferSource()
      this.windSource.buffer = noise
      this.windSource.loop = true
      this.windFilter = ctx.createBiquadFilter()
      this.windFilter.type = 'bandpass'
      this.windFilter.frequency.value = 900
      this.windFilter.Q.value = 0.4
      this.windGain = ctx.createGain()
      this.windGain.gain.value = 0
      this.windSource.connect(this.windFilter)
      this.windFilter.connect(this.windGain)
      this.windGain.connect(this.master)
      const rumbleFilter = ctx.createBiquadFilter()
      rumbleFilter.type = 'lowpass'
      rumbleFilter.frequency.value = 90
      this.rumbleGain = ctx.createGain()
      this.rumbleGain.gain.value = 0
      this.windSource.connect(rumbleFilter)
      rumbleFilter.connect(this.rumbleGain)
      this.rumbleGain.connect(this.master)
      this.windSource.start()

      // Stall horn.
      this.hornOsc = ctx.createOscillator()
      this.hornOsc.type = 'square'
      this.hornOsc.frequency.value = 620
      this.hornGain = ctx.createGain()
      this.hornGain.gain.value = 0
      this.hornOsc.connect(this.hornGain)
      this.hornGain.connect(this.master)
      this.hornOsc.start()
    } catch {
      this.ctx = null // no audio available — sim runs silently
    }
  }

  update(s: SoundState): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const ramp = (p: AudioParam, v: number, tc = 0.08) => p.setTargetAtTime(v, t, tc)

    this.master.gain.value = this.muted ? 0 : 0.5

    const firingHz = Math.max((s.rpm / 60) * 2, 1)
    this.engineOscs.forEach((osc, i) => {
      const mult = [0.5, 1, 2, 3][i]!
      ramp(osc.frequency, firingHz * mult, 0.05)
    })
    const engineLevel = s.engineRunning ? 0.1 + 0.5 * s.powerFrac : 0
    ramp(this.engineGain.gain, engineLevel)
    ramp(this.engineFilter.frequency, 300 + 1800 * s.powerFrac)

    const windLevel = Math.min((s.iasKt / 140) ** 2 * 0.4, 0.4)
    ramp(this.windGain.gain, windLevel)
    ramp(this.windFilter.frequency, 500 + s.iasKt * 8)

    ramp(this.rumbleGain.gain, s.onGround ? Math.min(s.gsKt / 60, 1) * 0.35 : 0)

    ramp(this.hornGain.gain, s.stallWarn ? 0.25 : 0, 0.03)

    // Touchdown thump (one-shot on the air→ground transition).
    if (s.onGround && !this.wasOnGround && s.gsKt > 20) {
      const thump = this.ctx.createOscillator()
      thump.type = 'sine'
      thump.frequency.setValueAtTime(70, t)
      thump.frequency.exponentialRampToValueAtTime(35, t + 0.18)
      const g = this.ctx.createGain()
      g.gain.setValueAtTime(0.6, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
      thump.connect(g)
      g.connect(this.master)
      thump.start(t)
      thump.stop(t + 0.3)
    }
    this.wasOnGround = s.onGround

    /* Introspection for automated verification (§16 note: automation can't
     * HEAR — this exposes the node graph's live parameters instead). */
  }

  inspect(): { state: string; engineHz: number; engineGain: number; windGain: number; horn: number } | null {
    if (!this.ctx) return null
    return {
      state: this.ctx.state,
      engineHz: this.engineOscs[1]?.frequency.value ?? 0,
      engineGain: this.engineGain.gain.value,
      windGain: this.windGain.gain.value,
      horn: this.hornGain.gain.value,
    }
  }
}
