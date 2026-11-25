import type {SpeechMessage} from './safety-speech'

/** Who is talking, which decides the voice (server) and the processing
 *  (here): ATC, other aircraft and the ATIS come over the VHF radio, the first
 *  officer over the intercom, automated warnings clean from the cockpit. */
export type VoiceRole = 'atc' | 'pilot' | 'atis' | 'copilot' | 'warning'

export function voiceRoleFor(message: SpeechMessage): VoiceRole {
  if (message.speaker === 'first-officer') return 'copilot'
  if (message.priority === 0) return message.role ?? 'atc'
  return 'warning'
}

/** Mono Float32 → 16-bit PCM WAV bytes. */
export function encodeWav16(samples: Float32Array, rate: number): ArrayBuffer {
  const out = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(out)
  const tag = (at: number, s: string): void => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)) }
  tag(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); tag(8, 'WAVE')
  tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  tag(36, 'data'); v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return out
}

/** Soft-clip curve for the transmitter's limiter: tanh-shaped, gain k. */
export function softClipCurve(k: number, n = 1024): Float32Array {
  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k) }
  return c
}

interface Chain { highpass: number; lowpass: number; drive: number; noise: number; gain: number }
/** VHF AM voice is limited to roughly 300–3000 Hz; intercom is wider. Aircraft are farther away, a little noisier and quieter than the ground stations. */
const CHAINS: Record<Exclude<VoiceRole, 'warning'>, Chain> = {
  atc: { highpass: 380, lowpass: 2900, drive: 2.6, noise: 0.012, gain: 0.5 },
  atis: { highpass: 340, lowpass: 3100, drive: 1.8, noise: 0.008, gain: 0.5 },
  pilot: { highpass: 420, lowpass: 2700, drive: 3.0, noise: 0.018, gain: 0.44 },
  copilot: { highpass: 220, lowpass: 4200, drive: 1.6, noise: 0.004, gain: 0.62 },
}

/** Each aircraft is a little different on the air: how far away it is decides hiss, level and how much of the top end survives. Stable per speaker. */
export function chainFor(role: Exclude<VoiceRole, 'warning'>, speaker = ''): Chain {
  const base = CHAINS[role]
  if (role !== 'pilot' || !speaker) return base
  let h = 0
  for (const c of speaker) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0
  const far = (Math.abs(h) % 100) / 100                    // 0 close … 1 far
  return { ...base, noise: base.noise * (0.7 + far * 1.2), gain: base.gain * (1.08 - far * 0.3), lowpass: base.lowpass - far * 300 }
}

/**
 * Pass a synthesized WAV through an aviation radio chain: band-limit,
 * compress/limit, add a touch of carrier hiss, and a short squelch tail.
 * Any failure (no WebAudio, undecodable data) returns the clean original —
 * a transmission must never go silent because the effect could not run.
 */
export async function applyRadioFilter(wav: Blob, role: VoiceRole, speaker = ''): Promise<Blob> {
  if (role === 'warning') return wav
  const chain = chainFor(role, speaker)
  try {
    const AC = (globalThis as {AudioContext?: typeof AudioContext}).AudioContext
    const OAC = (globalThis as {OfflineAudioContext?: typeof OfflineAudioContext}).OfflineAudioContext
    if (!AC || !OAC) return wav
    const decoder = new AC()
    const decoded = await decoder.decodeAudioData(await wav.arrayBuffer())
    void decoder.close()
    const tail = role === 'copilot' ? 0.03 : 0.09
    const frames = Math.ceil((decoded.duration + tail) * decoded.sampleRate)
    const ctx = new OAC(1, frames, decoded.sampleRate)

    const src = ctx.createBufferSource()
    src.buffer = decoded
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = chain.highpass; hp.Q.value = 0.8
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = chain.lowpass; lp.Q.value = 0.9
    const presence = ctx.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 1700; presence.gain.value = 4; presence.Q.value = 0.7
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -26; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.12
    const shaper = ctx.createWaveShaper(); shaper.curve = softClipCurve(chain.drive) as Float32Array<ArrayBuffer>; shaper.oversample = '2x'
    const out = ctx.createGain(); out.gain.value = chain.gain

    src.connect(hp); hp.connect(presence); presence.connect(lp); lp.connect(comp); comp.connect(shaper); shaper.connect(out); out.connect(ctx.destination)
    src.start(0)

    // Carrier hiss rides under the voice and keeps going through the tail,
    // which is what a keyed-then-released squelch sounds like.
    const hiss = ctx.createBuffer(1, frames, decoded.sampleRate)
    const h = hiss.getChannelData(0)
    for (let i = 0; i < h.length; i++) h[i] = (Math.random() * 2 - 1) * chain.noise
    const hissSrc = ctx.createBufferSource(); hissSrc.buffer = hiss
    const hissBand = ctx.createBiquadFilter(); hissBand.type = 'bandpass'; hissBand.frequency.value = 1800; hissBand.Q.value = 0.5
    const hissGain = ctx.createGain()
    hissGain.gain.setValueAtTime(1, 0)
    hissGain.gain.setValueAtTime(1, decoded.duration)
    hissGain.gain.linearRampToValueAtTime(0, decoded.duration + tail)
    hissSrc.connect(hissBand); hissBand.connect(hissGain); hissGain.connect(ctx.destination)
    hissSrc.start(0)

    const rendered = await ctx.startRendering()
    return new Blob([encodeWav16(rendered.getChannelData(0), rendered.sampleRate)], {type: 'audio/wav'})
  } catch {
    return wav
  }
}
