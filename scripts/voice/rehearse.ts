/**
 * Rehearsal: run a short radio scenario through the real controllers, AI
 * pilots and background traffic, then SPEAK it the way the simulator does
 * (spoken-aviation conversion, the server's voice cast, macOS `say`) and read
 * it back with whisper.cpp. Prints who said what, in which voice, and how
 * much of it a listener (here a speech recogniser) understood.
 *
 *   npx tsx scripts/voice/rehearse.ts [--lines 18] [--style faa|icao]
 *
 * It cannot say how human the voices sound, only whether the words survive.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CommsBus, type Transmission } from '../../src/sim/atc/comms'
import { TowerController } from '../../src/sim/atc/tower'
import { GroundController } from '../../src/sim/atc/ground'
import { ApproachController } from '../../src/sim/atc/approach'
import { AiPatternPilot } from '../../src/sim/traffic/ai-pilot'
import { AmbientRadio } from '../../src/sim/atc/ambient'
import { speakerRole } from '../../src/sim/atc/phraseology'
import { CallsignBook, toSpokenAviation, type PhraseStyle } from '../../src/audio/spoken-aviation'
// @ts-expect-error plain ES modules (server code and the audit script)
import { castVoice } from '../../server/voice-cast.mjs'
// @ts-expect-error plain ES module
import { wordAccuracy } from './audit-voices.mjs'

const arg = (name: string, fallback: string): string => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1]! : fallback }
const MAX_LINES = Number(arg('lines', '18'))
const style = arg('style', 'faa') as PhraseStyle

const model = process.env.OPENHORIZON_WHISPER_MODEL ?? fileURLToPath(new URL('../../server/cache/speech/ggml-base.en.bin', import.meta.url))
const tmp = fs.mkdtempSync(path.join(process.env.AUDIT_TMP ?? os.tmpdir(), 'rehearse-'))

// ---- the scenario: a ground exchange with the player, the AI pilot's pattern work, then background traffic ----
const bus = new CommsBus()
const tower = new TowerController({ facility: 'Palo Alto Tower', freqMhz: 118.6, activeRunway: '31', departureFreqMhz: 120.5, groundFreqMhz: 121.7, windText: () => 'wind 290 at 8' })
const ground = new GroundController({ facility: 'Palo Alto Ground', freqMhz: 121.7, activeRunway: '31' })
const approach = new ApproachController({ facility: 'Norcal Approach', freqMhz: 124.0, activeRunway: '31', towerFreqMhz: 118.6 })
const ME = 'Skyhawk 123AB'
const log: Transmission[] = []
bus.subscribe((t) => log.push(t))
bus.transmit({ freqMhz: 118.6, from: 'KPAO ATIS', text: 'Palo Alto information Bravo, 1805 zulu. wind 290 at 8. visibility 10. few clouds at 4500. altimeter 30.12. landing and departing runway 31. advise on initial contact you have information Bravo.', atSimS: 0 })
bus.transmit({ freqMhz: 121.7, from: ME, text: 'Palo Alto Ground, Skyhawk 123AB, at the ramp with information Bravo, request taxi for departure', atSimS: 1 })
for (const t of ground.request(ME, 'taxiOut', 2, ['A', 'B'])) bus.transmit(t)
bus.transmit({ freqMhz: 121.7, from: ME, text: 'runway 31, taxi via A, B, hold short of runway 31, Skyhawk 123AB', atSimS: 6 })
for (const t of approach.checkIn('Cherokee 42PK', { distanceM: 22 * 1852, aglFt: 5000 }, 30)) bus.transmit({ ...t, freqMhz: 124.0 })
const ai = new AiPatternPilot({
  callsign: 'Skylane 631SP', runway: { thrLat: 37.456, thrLon: -122.115, headingDeg: 313, elevFt: 5 }, runwayIdent: '31',
  tower, bus, freqMhz: 118.6, facility: 'Palo Alto Tower', atis: 'Bravo',
})
for (let s = 40; s < 400 && log.length < 40; s += 1) { ai.step(1, s); if (s % 5 === 0) for (const t of tower.tick(s)) bus.transmit(t) }
const ambient = new AmbientRadio({
  field: 'Palo Alto', runway: '31', atis: 'Bravo', busy: 1, airlines: true,
  tower: { name: 'Palo Alto Tower', freqMhz: 118.6 }, ground: { name: 'Palo Alto Ground', freqMhz: 121.7 },
  approach: { name: 'Norcal Approach', freqMhz: 124.0 }, taxiways: () => ['A', 'B'],
}, { seed: 5 })
for (let s = 0; s < 600; s += 2) for (const t of ambient.tick(s, s < 300 ? 121.7 : 124.0, false)) bus.transmit(t)

// ---- say it and listen ----
const book = new CallsignBook()
const picks = [...log.slice(0, 9), ...log.filter((t) => t.ambient).slice(0, MAX_LINES)].slice(0, MAX_LINES)
let total = 0, heardTotal = 0
console.log(`${'speaker'.padEnd(20)} ${'voice'.padEnd(24)} pitch  wpm  heard`)
for (const [i, t] of picks.entries()) {
  const spoken = toSpokenAviation(t.text, { style, callsigns: book, nowMs: i * 8000 })
  const role = speakerRole(t.from)
  const cast = castVoice({ role, speaker: t.from, style }) as { voice: string; rate: number; pbas?: number }
  const wav = path.join(tmp, `${i}.wav`)
  const words = cast.pbas ? `[[pbas ${cast.pbas}]] ${spoken}` : spoken
  execFileSync('/usr/bin/say', ['-v', cast.voice, '-r', String(cast.rate), '--file-format=WAVE', '--data-format=LEI16@16000', '-o', wav, '--', words])
  const seconds = (fs.statSync(wav).size - 44) / 32000
  const heard = execFileSync('/opt/homebrew/bin/whisper-cli', ['-m', model, '-f', wav, '-nt', '-np', '-t', '4', '-ng', '-l', 'en'], { encoding: 'utf8', env: { ...process.env, GGML_METAL_DEVICES: '0' }, stdio: ['ignore', 'pipe', 'ignore'] }).trim().replace(/\s+/g, ' ')
  const acc = wordAccuracy(spoken, heard) as number
  const n = spoken.split(/\s+/).length
  total += n; heardTotal += n * acc
  console.log(`${t.from.slice(0, 19).padEnd(20)} ${cast.voice.slice(0, 23).padEnd(24)} ${String(cast.pbas ?? '-').padEnd(5)} ${String(Math.round((n / seconds) * 60)).padEnd(4)} ${(acc * 100).toFixed(0).padStart(3)}%  ${spoken}`)
  if (acc < 0.7) console.log(`${' '.repeat(56)}heard: ${heard}`)
  fs.rmSync(wav)
}
console.log(`\nword accuracy over ${picks.length} transmissions: ${((heardTotal / total) * 100).toFixed(1)}%`)
fs.rmSync(tmp, { recursive: true, force: true })
