/**
 * Check the neural voices (server/voice-neural.swift) one by one with a long, multi-sentence transmission:
 * is every word of it there, right to the end, and at a believable pace?
 *
 *   node scripts/voice/check-neural.mjs [--rate 0.5] [--script path/to/another/voice-neural.swift]
 *
 * A long text is the point. Some voices send an empty audio buffer between chunks of a long utterance, and a
 * helper that took that for the end of speech cut transmissions off after the first ten seconds or so; short
 * test phrases never showed it. Each voice renders the text, whisper.cpp reads it back, and a voice is flagged
 * when its last words are missing or it seems to have said the lot faster than anyone talks.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createNeuralHelper } from '../../server/voice-neural.mjs'
import { wordAccuracy } from './audit-voices.mjs'

const TEXT = 'Palo Alto information Bravo, one eight zero fife Zulu. wind two niner zero degrees eight knots. visibility one zero. few clouds at four thousand fife hundred. QNH one zero two zero. landing and departing runway tree one. advise on initial contact you have information Bravo.'
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback }
const rate = Number(arg('rate', '0.5'))
/** Even a rushed reading of this text takes longer than this per word at the default rate. */
const FASTEST_PLAUSIBLE_WPM = 215

const model = process.env.OPENHORIZON_WHISPER_MODEL ?? fileURLToPath(new URL('../../server/cache/speech/ggml-base.en.bin', import.meta.url))
const tmp = fs.mkdtempSync(path.join(process.env.AUDIT_TMP ?? os.tmpdir(), 'neural-check-'))
const helper = createNeuralHelper({ script: arg('script', undefined) })
const voices = await helper.voices()
if (!voices.length) { console.log('No neural voices on this Mac (or no swift): nothing to check.'); process.exit(0) }

const words = TEXT.split(/\s+/).length
/** The last part of the identifier says more than the display name ("Voice 3"). */
const label = (v) => `${v.id.replace(/^com\.apple\.(ttsbundle\.|speech\.synthesis\.voice\.)?/, '')} ${v.language}`
const lastWords = 'information Bravo'
console.log(`${voices.length} neural voices, ${words} words, rate ${rate}\n${'voice'.padEnd(34)} secs  wpm  heard  ends`)
let bad = 0
for (const v of voices) {
  const wav = path.join(tmp, `${v.id.replace(/[^\w.-]/g, '_')}.wav`)
  try {
    const { seconds } = await helper.speak({ voice: v.id, rate, text: TEXT }, wav)
    const heard = execFileSync('/opt/homebrew/bin/whisper-cli', ['-m', model, '-f', wav, '-nt', '-np', '-t', '4', '-ng', '-l', 'en'], { encoding: 'utf8', env: { ...process.env, GGML_METAL_DEVICES: '0' }, stdio: ['ignore', 'pipe', 'ignore'] }).trim().replace(/\s+/g, ' ')
    const wpm = Math.round((words / seconds) * 60)
    const accuracy = wordAccuracy(TEXT, heard)
    const ends = heard.toLowerCase().replace(/[^a-z ]/g, '').endsWith(lastWords.toLowerCase())
    const flag = !ends || wpm > FASTEST_PLAUSIBLE_WPM ? '  <-- CUT OFF?' : ''
    if (flag) bad++
    console.log(`${label(v).padEnd(34)} ${seconds.toFixed(1).padStart(4)} ${String(wpm).padStart(4)} ${(accuracy * 100).toFixed(0).padStart(4)}%  ${ends ? 'yes' : 'NO '}${flag}`)
  } catch (error) {
    bad++
    console.log(`${label(v).padEnd(34)} failed: ${error.message}`)
  }
}
helper.close()
fs.rmSync(tmp, { recursive: true, force: true })
console.log(bad ? `\n${bad} voice(s) look wrong.` : '\nEvery voice said the whole text.')
process.exit(bad ? 1 : 0)
