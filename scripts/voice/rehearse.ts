/**
 * Rehearsal: run a short radio scenario through the real controllers, AI
 * pilots and background traffic, then SPEAK it the way the simulator does
 * (spoken-aviation conversion, the server's voice cast, macOS `say`) and read
 * it back with whisper.cpp. Prints who said what, in which voice, and how
 * much of it a listener (here a speech recogniser) understood.
 *
 *   npx tsx scripts/voice/rehearse.ts [--lines 18] [--style faa|icao] [--save radio.wav]
 *
 * `--save` also writes every transmission, in order with a pause between them, to one WAV (dry voices, without the radio
 * filter the simulator adds), so the cast can be listened to instead of only read back.
 *
 * It cannot say how human the voices sound, only whether the words survive.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { speakerRole } from '../../src/sim/atc/phraseology'
import { radioScenario } from './scenario'
import { CallsignBook, toSpokenAviation, type PhraseStyle } from '../../src/audio/spoken-aviation'
// @ts-expect-error plain ES modules (server code and the audit script)
import { createVoiceService } from '../../server/voice.mjs'
// @ts-expect-error plain ES module
import { wordAccuracy } from './audit-voices.mjs'

const arg = (name: string, fallback: string): string => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1]! : fallback }
const MAX_LINES = Number(arg('lines', '18'))
const style = arg('style', 'faa') as PhraseStyle

const model = process.env.OPENHORIZON_WHISPER_MODEL ?? fileURLToPath(new URL('../../server/cache/speech/ggml-base.en.bin', import.meta.url))
const tmp = fs.mkdtempSync(path.join(process.env.AUDIT_TMP ?? os.tmpdir(), 'rehearse-'))

// ---- say it and listen ----
// Rendered by the speech server's own function, so this is what the simulator would play: the cast, the neural voices when the Mac has
// them (through the helper), the built-in ones otherwise.
const service = createVoiceService() as { render: (job: object, file: string, signal: AbortSignal) => Promise<{ engine: string; voice: string; rate: number; pbas?: number; pitch?: number }>; close: () => void }
const book = new CallsignBook()
const picks = radioScenario(MAX_LINES)
let total = 0, heardTotal = 0
/** Seconds of 16 kHz mono PCM in a WAV, read from its data chunk (the neural helper's files carry a 4 KB header, not 44 bytes). */
const speechSeconds = (file: string): number => {
  const b = fs.readFileSync(file)
  for (let at = 12; at + 8 <= b.length; at += 8 + b.readUInt32LE(at + 4)) if (b.toString('ascii', at, at + 4) === 'data') return b.readUInt32LE(at + 4) / 32000
  return (b.length - 44) / 32000
}
/** The PCM of a WAV's data chunk (16 kHz mono 16-bit). */
const pcmOf = (file: string): Buffer => {
  const b = fs.readFileSync(file)
  for (let at = 12; at + 8 <= b.length; at += 8 + b.readUInt32LE(at + 4)) if (b.toString('ascii', at, at + 4) === 'data') return b.subarray(at + 8, at + 8 + b.readUInt32LE(at + 4))
  return b.subarray(44)
}
const reel: Buffer[] = []
const savePath = arg('save', '')
const friendly = (voice: string): string => voice.replace(/^com\.apple\./, '').replace(/^(siri\.natural\.|ttsbundle\.|voice\.)/, '').replace(/_en-US_premium|\.premium/, '')
console.log(`${'speaker'.padEnd(20)} ${'voice'.padEnd(26)} wpm  heard`)
for (const [i, t] of picks.entries()) {
  const spoken = toSpokenAviation(t.text, { style, callsigns: book, nowMs: i * 8000 })
  const wav = path.join(tmp, `${i}.wav`)
  const cast = await service.render({ text: spoken, role: speakerRole(t.from), speaker: t.from, style, ambient: t.ambient === true }, wav, new AbortController().signal)
  const seconds = speechSeconds(wav)
  const heard = execFileSync('/opt/homebrew/bin/whisper-cli', ['-m', model, '-f', wav, '-nt', '-np', '-t', '4', '-ng', '-l', 'en'], { encoding: 'utf8', env: { ...process.env, GGML_METAL_DEVICES: '0' }, stdio: ['ignore', 'pipe', 'ignore'] }).trim().replace(/\s+/g, ' ')
  const acc = wordAccuracy(spoken, heard) as number
  const n = spoken.split(/\s+/).length
  total += n; heardTotal += n * acc
  const name = `${cast.engine === 'neural' ? '● ' : ''}${friendly(cast.voice)}`
  console.log(`${t.from.slice(0, 19).padEnd(20)} ${name.slice(0, 25).padEnd(26)} ${String(Math.round((n / seconds) * 60)).padEnd(4)} ${(acc * 100).toFixed(0).padStart(3)}%  ${spoken}`)
  if (acc < 0.7) console.log(`${' '.repeat(52)}heard: ${heard}`)
  if (savePath) reel.push(pcmOf(wav), Buffer.alloc(Math.round(0.8 * 32000)))
  fs.rmSync(wav)
}
console.log(`\nword accuracy over ${picks.length} transmissions: ${((heardTotal / total) * 100).toFixed(1)}%   (● = neural voice)`)
if (savePath && reel.length) {
  const pcm = Buffer.concat(reel)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28)
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40)
  fs.writeFileSync(savePath, Buffer.concat([header, pcm]))
  console.log(`saved ${savePath}: ${(pcm.length / 32000).toFixed(0)} s`)
}
service.close()
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(0)
