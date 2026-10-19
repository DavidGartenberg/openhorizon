import type { ContinuousAural, OneShotAural } from '../sim/boeing-aurals'
import { loadCustomPack } from './custom-audio-pack'
import { synthAltitudeAlert, synthClacker, synthFireBell, synthIntermittentHorn, synthStickShaker, synthSteadyHorn, synthWailer } from './boeing-aural-synth'

/** Relative loudness on the flight deck: the bell and wailer are meant to
 *  cut through everything; the shaker is felt as much as heard. */
const LEVEL: Record<ContinuousAural, number> = {
  fireBell: 0.5, apWailer: 0.42, configHorn: 0.45, gearHorn: 0.45, clacker: 0.5, stickShaker: 0.55,
}
/** Strict priority: only the most urgent continuous aural sounds — the
 *  warning electronics inhibit lower alerts rather than layering a din. */
export const AURAL_PRIORITY: readonly ContinuousAural[] = ['fireBell', 'stickShaker', 'clacker', 'configHorn', 'gearHorn', 'apWailer']

/** Highest-priority aural in the set, or undefined. Pure — tested. */
export function dominantAural(active: ReadonlySet<ContinuousAural>): ContinuousAural | undefined {
  return AURAL_PRIORITY.find(a => active.has(a))
}

/** WebAudio player for the synthesized 737NG aurals. Built on the first
 *  user gesture (browser autoplay policy), each continuous aural is a
 *  looped buffer behind its own gate. */
export class BoeingAuralsAudio {
  private ctx: AudioContext | null = null
  private gates = new Map<ContinuousAural, GainNode>()
  private oneShot = new Map<OneShotAural, AudioBuffer>()
  private master!: GainNode
  private current: ContinuousAural | undefined
  private sources = new Map<ContinuousAural, AudioBufferSourceNode>()
  /** Which aurals play a user-supplied recording instead of the synth. */
  readonly custom = new Set<ContinuousAural | OneShotAural>()
  muted = false

  unlock(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return }
    try {
      const ctx = new AudioContext()
      this.ctx = ctx
      this.master = ctx.createGain()
      this.master.gain.value = 1
      this.master.connect(ctx.destination)
      const sr = ctx.sampleRate
      const make = (x: Float32Array): AudioBuffer => {
        const b = ctx.createBuffer(1, x.length, sr)
        b.getChannelData(0).set(x)
        return b
      }
      const loops: Record<ContinuousAural, Float32Array> = {
        fireBell: synthFireBell(sr), apWailer: synthWailer(sr), configHorn: synthIntermittentHorn(sr),
        gearHorn: synthSteadyHorn(sr), clacker: synthClacker(sr), stickShaker: synthStickShaker(sr),
      }
      for (const [name, samples] of Object.entries(loops) as Array<[ContinuousAural, Float32Array]>) {
        const src = ctx.createBufferSource()
        src.buffer = make(samples)
        src.loop = true
        const gate = ctx.createGain()
        gate.gain.value = 0
        src.connect(gate)
        gate.connect(this.master)
        src.start()
        this.gates.set(name, gate)
        this.sources.set(name, src)
      }
      this.oneShot.set('altAlert', make(synthAltitudeAlert(sr)))
      void this.applyCustomPack(ctx)
    } catch { this.ctx = null /* no WebAudio: aurals stay silent, never throw into the sim loop */ }
  }

  /** Swap in any user-supplied recordings (custom-audio-pack.ts). */
  private async applyCustomPack(ctx: AudioContext): Promise<void> {
    const pack = await loadCustomPack()
    for (const [name, url] of Object.entries(pack.aurals) as Array<[ContinuousAural | OneShotAural, string]>) {
      try {
        const res = await fetch(url)
        if (!res.ok) continue
        const buf = await ctx.decodeAudioData(await res.arrayBuffer())
        if (name === 'altAlert') { this.oneShot.set(name, buf); this.custom.add(name); continue }
        const gate = this.gates.get(name), old = this.sources.get(name)
        if (!gate) continue
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.loop = true
        src.connect(gate)
        src.start()
        try { old?.stop() } catch { /* already stopped */ }
        old?.disconnect()
        this.sources.set(name, src)
        this.custom.add(name)
      } catch { /* undecodable file: keep the built-in sound */ }
    }
  }

  /** Per frame: sound only the dominant continuous aural; fire one-shots. */
  update(active: ReadonlySet<ContinuousAural>, oneShots: readonly OneShotAural[]): void {
    const ctx = this.ctx
    if (!ctx) return
    const want = this.muted ? undefined : dominantAural(active)
    if (want !== this.current) {
      const t = ctx.currentTime
      for (const [name, gate] of this.gates) {
        gate.gain.cancelScheduledValues(t)
        gate.gain.setTargetAtTime(name === want ? LEVEL[name] : 0, t, 0.012)
      }
      this.current = want
    }
    if (this.muted) return
    for (const s of oneShots) {
      const buf = this.oneShot.get(s)
      if (!buf) continue
      const src = ctx.createBufferSource()
      src.buffer = buf
      const g = ctx.createGain()
      g.gain.value = 0.45
      src.connect(g)
      g.connect(this.master)
      src.start()
    }
  }

  inspect(): { unlocked: boolean; sounding: ContinuousAural | null; custom: string[] } {
    return { unlocked: !!this.ctx, sounding: this.current ?? null, custom: [...this.custom] }
  }
}
