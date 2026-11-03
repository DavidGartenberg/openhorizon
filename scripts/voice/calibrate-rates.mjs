/**
 * Calibrate `say -r` for each voice: how many words per minute does a voice
 * actually speak at a given rate? Voices differ a lot (the same `-r` is about
 * 120 wpm in one and 190 in another, and several do not slow down below 150),
 * so the voice cast turns a wanted pace into a rate by interpolating each
 * voice's own measured curve.
 *
 *   node scripts/voice/calibrate-rates.mjs [--voices "Reed (English (US)),Samantha"]
 *
 * Prints `RATE_POINTS` for server/voice-cast.mjs: [rate, words per minute]
 * pairs, made monotone.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { VOICE_FACTS } from '../../server/voice-cast.mjs'

const SENTENCE = 'Skyhawk one two three Alpha Bravo, Palo Alto Tower, wind two seven zero at niner, runway three one, cleared for takeoff, then contact departure one two zero point five, good day.'
const WORDS = SENTENCE.split(/\s+/).length
const RATES = [90, 110, 130, 150, 190, 230, 270, 310]

function seconds(voice, rate, file) {
  execFileSync('/usr/bin/say', ['-v', voice, '-r', String(rate), '--file-format=WAVE', '--data-format=LEI16@16000', '-o', file, '--', SENTENCE])
  return (fs.statSync(file).size - 44) / 32000
}

const i = process.argv.indexOf('--voices')
const voices = i > 0 ? process.argv[i + 1].split(',').map((v) => v.trim()) : Object.keys(VOICE_FACTS)
const tmp = fs.mkdtempSync(path.join(process.env.AUDIT_TMP ?? os.tmpdir(), 'rates-'))
const table = {}
for (const v of voices) {
  try {
    let top = 0
    const points = RATES.map((r) => { const wpm = Math.round((WORDS / seconds(v, r, path.join(tmp, 'a.wav'))) * 60); top = Math.max(top, wpm); return [r, top] })
    table[v] = points
    console.log(`${v.padEnd(26)} ${points.map((p) => `${p[0]}:${p[1]}`).join('  ')}`)
  } catch (error) { console.log(`${v.padEnd(26)} failed: ${error.message.split('\n')[0]}`) }
}
fs.rmSync(tmp, { recursive: true, force: true })
console.log('\nconst RATE_POINTS =', JSON.stringify(table))
