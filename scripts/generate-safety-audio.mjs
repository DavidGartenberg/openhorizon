/** Generate original English safety clips with the installed macOS voices.
 *  Two sets:
 *   - default  public/audio/safety/        Samantha (GA / Airbus types)
 *   - boeing   public/audio/safety-boeing/ a male US voice through an
 *              EGPWS-style chain (band-limit, compression) — Boeing flight
 *              decks use a male EGPWS voice. ORIGINAL synthesis: no
 *              Honeywell/Boeing/X-Plane recordings are copied.
 *  Usage: node scripts/generate-safety-audio.mjs [boeing] */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const set = process.argv[2] === 'boeing' ? 'boeing' : 'default'
const folder = set === 'boeing' ? 'safety-boeing' : 'safety'
const voice = set === 'boeing' ? 'Reed (English (US))' : 'Samantha'
const rate = set === 'boeing' ? '178' : '190'
const dir = fileURLToPath(new URL(`../public/audio/${folder}/`, import.meta.url))
mkdirSync(dir, { recursive: true })
const phrases = ['FIFTY', 'FORTY', 'THIRTY', 'TWENTY', 'TEN', 'FIVE HUNDRED', 'PULL UP', 'SINK RATE', 'TERRAIN AHEAD, PULL UP', 'TERRAIN AHEAD', "DON'T SINK", 'TOO LOW, FLAPS', 'TOO LOW, GEAR', 'GLIDESLOPE', 'BANK ANGLE', 'LEVEL OFF, LEVEL OFF', 'CLIMB, CLIMB', 'DESCEND, DESCEND', 'TRAFFIC, TRAFFIC', 'CLEAR OF CONFLICT']

function dataChunk(bytes) {
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const n = bytes.readUInt32LE(offset + 4)
    if (bytes.toString('ascii', offset, offset + 4) === 'data') return { start: offset + 8, size: n }
    offset += 8 + n + (n % 2)
  }
  return { start: 0, size: 0 }
}

/** EGPWS-style chain on 16 kHz PCM16: 2nd-order high-pass 280 Hz and
 *  low-pass 3.8 kHz (RBJ biquads), then a soft-knee compressor so every
 *  phrase lands at the same assertive level. */
function egpws(bytes) {
  const { start, size } = dataChunk(bytes)
  const n = size / 2, sr = 16000
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) x[i] = bytes.readInt16LE(start + i * 2) / 32768
  const biquad = (sig, type, f0, q) => {
    const w = 2 * Math.PI * f0 / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q)
    const [b0, b1, b2] = type === 'hp' ? [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2] : [(1 - cs) / 2, 1 - cs, (1 - cs) / 2]
    const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let i = 0; i < sig.length; i++) {
      const y = (b0 * sig[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
      x2 = x1; x1 = sig[i]; y2 = y1; y1 = y; sig[i] = y
    }
  }
  biquad(x, 'hp', 280, 0.71); biquad(x, 'lp', 3800, 0.71)
  // envelope-follower compressor, 4:1 above −20 dBFS, then make-up gain
  let env = 0, peak = 0
  const att = Math.exp(-1 / (0.003 * sr)), rel = Math.exp(-1 / (0.08 * sr)), thr = 0.1
  for (let i = 0; i < n; i++) {
    const a = Math.abs(x[i]); env = a > env ? att * env + (1 - att) * a : rel * env + (1 - rel) * a
    const g = env > thr ? Math.pow(env / thr, 1 / 4 - 1) : 1
    x[i] *= g; peak = Math.max(peak, Math.abs(x[i]))
  }
  const k = peak > 0 ? 0.89 / peak : 1
  for (let i = 0; i < n; i++) bytes.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * k * 32767))), start + i * 2)
  return bytes
}

const manifest = {}
for (const phrase of phrases) {
  const file = phrase.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.wav'
  const result = spawnSync('/usr/bin/say', ['-v', voice, '-r', rate, '-o', dir + file, '--file-format=WAVE', '--data-format=LEI16@16000', '--', phrase], { encoding: 'utf8', timeout: 30000 })
  if (result.error || result.status !== 0) throw new Error(`${phrase}: ${result.error ?? result.stderr}`)
  let bytes = readFileSync(dir + file)
  const { size } = dataChunk(bytes)
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || size < 1600) throw new Error(`Empty or invalid PCM: ${file}`)
  if (set === 'boeing') { bytes = egpws(bytes); writeFileSync(dir + file, bytes) }
  manifest[phrase] = `/audio/${folder}/` + file
  console.log(`${file}: ${size} PCM bytes`)
}
writeFileSync(dir + 'manifest.json', JSON.stringify(manifest, null, 2) + '\n')
writeFileSync(dir + 'README.md', set === 'boeing'
  ? `Original synthesized English EGPWS/TCAS callouts for Boeing flight decks: macOS ${voice} at ${rate} wpm through an EGPWS-style band-limit + compression chain (scripts/generate-safety-audio.mjs). Mono 16 kHz PCM16 WAV. No Honeywell, Boeing or X-Plane audio copied. Regenerate with node scripts/generate-safety-audio.mjs boeing on macOS.\n`
  : 'Original synthesized English callouts generated locally with macOS Samantha at 190 words/minute. Mono 16 kHz PCM16 WAV. No X-Plane audio copied. Regenerate with node scripts/generate-safety-audio.mjs on macOS.\n')
