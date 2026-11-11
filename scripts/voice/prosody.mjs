/**
 * How much a voice's pitch moves: the one measurable thing about "robotic" that a word recogniser cannot tell. Each voice speaks the
 * same radio transmissions; the pitch (F0) of every voiced 40 ms frame is tracked by autocorrelation, and per voice this prints
 * the median pitch, the spread of pitch in semitones (standard deviation, and the 10th-90th percentile range), and how much of
 * the audio is voiced. Natural conversational English moves roughly 2-4 semitones (standard deviation); a monotone voice well
 * under 2. A rule of thumb, not a verdict: pitch movement is necessary for a human sound, not sufficient.
 *
 *   node scripts/voice/prosody.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createNeuralHelper } from '../../server/voice-neural.mjs'

const LINES = [
  'Skyhawk one two three Alpha Bravo, Palo Alto Ground, runway three one, taxi via Alpha, Bravo, hold short of runway three one.',
  'Palo Alto Tower, Skylane six three one Sierra Papa, holding short runway three one, ready for departure.',
  'Skylane six three one Sierra Papa, wind two niner zero at eight, runway three one, cleared for takeoff.',
  'Cherokee four two Papa Kilo, Norcal Approach, radar contact, descend and maintain three thousand.',
  'Alaska four twenty six, contact departure one two zero point five, good day.',
  'Cessna five four three Delta Echo, traffic twelve o\'clock, three miles, southbound, altitude unknown.',
]
const SAY_VOICES = ['Samantha', 'Daniel', 'Karen', 'Moira', 'Grandpa (English (US))', 'Eddy (English (US))']

function readPcm(file) {
  const b = fs.readFileSync(file)
  for (let at = 12; at + 8 <= b.length; at += 8 + b.readUInt32LE(at + 4)) if (b.toString('ascii', at, at + 4) === 'data') {
    const n = Math.min(b.readUInt32LE(at + 4), b.length - at - 8) >> 1
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) out[i] = b.readInt16LE(at + 8 + i * 2) / 32768
    return out
  }
  return new Float32Array(0)
}

/** F0 per voiced frame, Hz. */
function pitchTrack(x, rate = 16000) {
  const frame = 640, hop = 160, minLag = Math.floor(rate / 400), maxLag = Math.floor(rate / 70)
  const f0 = []
  for (let s = 0; s + frame + maxLag < x.length; s += hop) {
    let e0 = 0
    for (let i = 0; i < frame; i++) e0 += x[s + i] * x[s + i]
    if (e0 / frame < 1e-5) continue
    const r = new Float32Array(maxLag + 1)
    let best = 0
    for (let lag = minLag; lag <= maxLag; lag++) {
      let num = 0, e1 = 0
      for (let i = 0; i < frame; i++) { num += x[s + i] * x[s + i + lag]; e1 += x[s + i + lag] * x[s + i + lag] }
      r[lag] = num / Math.sqrt(e0 * e1 + 1e-12)
      if (r[lag] > best) best = r[lag]
    }
    if (best < 0.5) continue
    // The first strong peak, not the strongest: the strongest is often an octave down.
    let pick = 0
    for (let lag = minLag + 1; lag < maxLag; lag++) if (r[lag] >= 0.9 * best && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) { pick = lag; break }
    if (pick) f0.push(rate / pick)
  }
  // 5-point median to take out octave glitches.
  return f0.map((_, i) => { const w = f0.slice(Math.max(0, i - 2), i + 3).sort((a, b) => a - b); return w[w.length >> 1] })
}

function summarize(tracks, totalFrames) {
  const all = tracks.flat()
  if (all.length < 50) return null
  const sorted = [...all].sort((a, b) => a - b)
  const median = sorted[sorted.length >> 1]
  const st = all.map((f) => 12 * Math.log2(f / median))
  const mean = st.reduce((a, b) => a + b, 0) / st.length
  const sd = Math.sqrt(st.reduce((a, b) => a + (b - mean) ** 2, 0) / st.length)
  const s = [...st].sort((a, b) => a - b)
  return { median, sd, range: s[Math.floor(s.length * 0.9)] - s[Math.floor(s.length * 0.1)], voiced: all.length / totalFrames }
}

const tmp = fs.mkdtempSync(path.join(process.env.AUDIT_TMP ?? os.tmpdir(), 'prosody-'))
const rows = []
async function measure(name, kind, render) {
  const tracks = []
  let frames = 0
  for (const [i, text] of LINES.entries()) {
    const file = path.join(tmp, `${i}.wav`)
    await render(text, file)
    const pcm = readPcm(file)
    frames += Math.floor(pcm.length / 160)
    tracks.push(pitchTrack(pcm))
    fs.rmSync(file)
  }
  const s = summarize(tracks, frames)
  if (s) rows.push({ name, kind, ...s })
}

const helper = createNeuralHelper()
for (const v of await helper.voices()) {
  await measure(v.id.replace(/^com\.apple\.(ttsbundle\.|speech\.synthesis\.)?(voice\.)?/, ''), 'neural', (text, file) => helper.speak({ voice: v.id, rate: v.id.includes('siri') ? 0.52 : 0.46, text }, file))
}
helper.close()
for (const v of SAY_VOICES) {
  try { await measure(v, 'say', async (text, file) => { execFileSync('/usr/bin/say', ['-v', v, '-r', '175', '--file-format=WAVE', '--data-format=LEI16@16000', '-o', file, '--', text]) }) } catch { /* voice not installed */ }
}
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`${'voice'.padEnd(36)} ${'kind'.padEnd(7)} median Hz  pitch sd (semitones)  p10-p90 range  voiced`)
for (const r of rows) console.log(`${r.name.padEnd(36)} ${r.kind.padEnd(7)} ${r.median.toFixed(0).padStart(9)}  ${r.sd.toFixed(2).padStart(20)}  ${r.range.toFixed(1).padStart(13)}  ${(r.voiced * 100).toFixed(0).padStart(5)}%`)
for (const kind of ['neural', 'say']) {
  const k = rows.filter((r) => r.kind === kind)
  if (k.length) console.log(`mean pitch sd, ${kind}: ${(k.reduce((a, r) => a + r.sd, 0) / k.length).toFixed(2)} semitones over ${k.length} voices`)
}
process.exit(0)
