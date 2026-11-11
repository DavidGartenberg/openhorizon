/**
 * Voice audit: which installed macOS voices say radio phraseology clearly?
 *
 * For each English voice, synthesizes a fixed script of ATC and pilot
 * transmissions with `say`, transcribes the result with the local
 * whisper.cpp the simulator already uses for speech input, and scores word
 * accuracy against what should have been said (numbers compared digit by
 * digit, "niner"/"tree"/"fife" folded to digits). It cannot judge how human
 * a voice sounds, only whether it is intelligible; the ranking is one input
 * to `server/voice-cast.mjs`.
 *
 *   node scripts/voice/audit-voices.mjs [--rate 190] [--voices "Reed (English (US)),Samantha"] [--json out.json]
 *
 * Needs `/usr/bin/say`, whisper-cli and the English base model (see
 * docs/voice-atc.md). Takes about 20 seconds per voice.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const AUDIT_SCRIPT = [
  'Skyhawk one two three Alpha Bravo, runway two eight left, cleared for takeoff, wind two seven zero at niner',
  'November seven seven Golf Alpha, taxi to runway three one via Alpha, Bravo, hold short of runway three one',
  'United twenty two sixty two, descend and maintain one zero thousand, turn left heading zero niner zero',
  'Cessna four two Papa Kilo, contact Palo Alto Tower one one eight point seven, good day',
  'American eleven eighteen, cleared I L S runway two eight right approach, maintain three thousand until established',
  'Palo Alto information Charlie, wind two niner zero at one two, visibility one zero, altimeter three zero one two',
  'Delta niner four seven, squawk four five two one, radar contact, climb and maintain flight level two four zero',
  'Skyhawk three Alpha Bravo, traffic twelve o\'clock, five miles, a Boeing seven three seven, altitude two thousand five hundred',
  'Speedbird two Kilo Papa, line up and wait runway two seven left, traffic on short final',
  'Skyhawk one two three Alpha Bravo, taxi via Echo, cross runway one eight, hold short of Foxtrot',
  'Mayday mayday mayday, Skyhawk one two three Alpha Bravo, engine failure, request immediate landing runway two eight right',
  'Cleared for takeoff runway two eight left, Skyhawk one two three Alpha Bravo',
]

const DIGIT_WORDS = { zero: '0', oh: '0', one: '1', two: '2', three: '3', tree: '3', four: '4', fower: '4', five: '5', fife: '5', six: '6', seven: '7', eight: '8', nine: '9', niner: '9' }

/** Words as compared: lower case, punctuation gone, every digit its own token. */
export function canonicalTokens(text) {
  const out = []
  for (const raw of text.toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ').replace(/-/g, ' ').split(/\s+/)) {
    if (!raw) continue
    if (/^\d+$/.test(raw)) out.push(...raw)
    else if (DIGIT_WORDS[raw] !== undefined) out.push(DIGIT_WORDS[raw])
    else out.push(raw)
  }
  return out
}

/** Word accuracy of `heard` against `expected`: 1 - edit distance / expected length. */
export function wordAccuracy(expected, heard) {
  const a = canonicalTokens(expected), b = canonicalTokens(heard)
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return a.length ? Math.max(0, 1 - d[a.length][b.length] / a.length) : 1
}

function wavData(buf) {
  let at = 12
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4), n = buf.readUInt32LE(at + 4)
    if (id === 'data') return buf.subarray(at + 8, at + 8 + n)
    at += 8 + n + (n % 2)
  }
  return Buffer.alloc(0)
}

function wavFile(pcm, rate = 16000) {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

export function englishVoices(say = '/usr/bin/say') {
  const list = execFileSync(say, ['-v', '?'], { encoding: 'utf8' })
  const seen = new Set(), out = []
  for (const line of list.split('\n')) {
    const m = /^(.+?)\s+(en_[A-Z]{2})\s+#/.exec(line)
    if (!m || seen.has(m[1])) continue
    seen.add(m[1]); out.push({ name: m[1].trim(), locale: m[2] })
  }
  return out
}

export function auditVoice(voice, { rate = 190, say = '/usr/bin/say', whisper = '/opt/homebrew/bin/whisper-cli', model, tmp } = {}) {
  const gap = Buffer.alloc(16000 * 2 * 0.9)
  const parts = [], seconds = []
  AUDIT_SCRIPT.forEach((text, i) => {
    const f = path.join(tmp, `${i}.wav`)
    execFileSync(say, ['-v', voice, '-r', String(rate), '--file-format=WAVE', '--data-format=LEI16@16000', '-o', f, '--', text])
    const pcm = wavData(fs.readFileSync(f)); fs.rmSync(f)
    parts.push(pcm, gap); seconds.push(pcm.length / 32000)
  })
  const all = path.join(tmp, 'all.wav')
  fs.writeFileSync(all, wavFile(Buffer.concat(parts)))
  const heard = execFileSync(whisper, ['-m', model, '-f', all, '-nt', '-np', '-t', '4', '-ng', '-l', 'en'], { encoding: 'utf8', env: { ...process.env, GGML_METAL_DEVICES: '0' }, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  fs.rmSync(all)
  const accuracy = wordAccuracy(AUDIT_SCRIPT.join(' '), heard)
  const words = AUDIT_SCRIPT.join(' ').split(/\s+/).length
  return { voice, accuracy: +accuracy.toFixed(3), wordsPerMinute: Math.round((words / seconds.reduce((a, b) => a + b, 0)) * 60), heard }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback }
  const rate = Number(arg('rate', 190))
  const model = process.env.OPENHORIZON_WHISPER_MODEL ?? fileURLToPath(new URL('../../server/cache/speech/ggml-base.en.bin', import.meta.url))
  const tmp = fs.mkdtempSync(path.join(process.env.AUDIT_TMP ?? os.tmpdir(), 'voice-audit-'))
  const wanted = arg('voices', '')
  const voices = wanted ? wanted.split(',').map((name) => ({ name: name.trim(), locale: '' })) : englishVoices()
  const results = []
  for (const v of voices) {
    try {
      const r = auditVoice(v.name, { rate, model, tmp })
      results.push({ ...r, locale: v.locale })
      console.log(`${v.name.padEnd(28)} ${v.locale}  accuracy ${(r.accuracy * 100).toFixed(1)}%  ${r.wordsPerMinute} wpm`)
    } catch (error) { console.log(`${v.name.padEnd(28)} failed: ${error.message.split('\n')[0]}`) }
  }
  fs.rmSync(tmp, { recursive: true, force: true })
  const out = arg('json', '')
  if (out) fs.writeFileSync(out, JSON.stringify({ rate, results }, null, 2))
}
