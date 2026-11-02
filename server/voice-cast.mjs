/**
 * Who is on the radio sounds like a person: every controller, airline and
 * private pilot is cast as a stable voice (macOS `say`), a pitch and a pace.
 *
 * The same speaker always gets the same voice, so a listener learns that
 * "Palo Alto Tower" is the man with the low voice and the Ground controller
 * the woman. Tower, Ground and Approach at one field never share a voice.
 * Airline crews take the accent of their airline. Pitch moves a few semitones
 * around each voice's natural pitch (`[[pbas]]`), which turns a dozen voices
 * into dozens of people; pace is set per speaker in words per minute.
 *
 * `intelligibility` is the word accuracy `scripts/voice/audit-voices.mjs`
 * measured (whisper.cpp reading back radio phraseology at 190 words per
 * minute) on the development Mac; it keeps the weakest voices off the
 * controller frequencies. `midi` is each voice's natural pitch (note number).
 * Voices a Mac does not have are skipped.
 */

export const VOICE_FACTS = {
  // Classic voices: clearest on the radio.
  'Samantha': { gender: 'F', accent: 'US', family: 'classic', midi: 54, intelligibility: 88.5, w150: 139 },
  'Daniel': { gender: 'M', accent: 'GB', family: 'classic', midi: 47, intelligibility: 88.0, w150: 131 },
  'Karen': { gender: 'F', accent: 'AU', family: 'classic', midi: 55, intelligibility: 87.1 },
  'Moira': { gender: 'F', accent: 'IE', family: 'classic', midi: 54, intelligibility: 84.7 },
  'Tessa': { gender: 'F', accent: 'ZA', family: 'classic', midi: 54, intelligibility: 81.3 },
  'Tara': { gender: 'F', accent: 'IN', family: 'classic', midi: 54, intelligibility: 79.4, w150: 165 },
  'Aman': { gender: 'M', accent: 'IN', family: 'classic', midi: 49, intelligibility: 78.5, w150: 165 },
  'Rishi': { gender: 'M', accent: 'IN', family: 'classic', midi: 46, intelligibility: 74.2, w150: 150 },
  // Compact voices.
  'Sandy (English (US))': { gender: 'F', accent: 'US', family: 'compact', midi: 0, intelligibility: 84.2 },
  'Grandpa (English (US))': { gender: 'M', accent: 'US', family: 'compact', midi: 43, intelligibility: 82.3 },
  'Rocko (English (US))': { gender: 'M', accent: 'US', family: 'compact', midi: 0, intelligibility: 80.4 },
  'Shelley (English (US))': { gender: 'F', accent: 'US', family: 'compact', midi: 55, intelligibility: 78.5 },
  'Grandma (English (US))': { gender: 'F', accent: 'US', family: 'compact', midi: 0, intelligibility: 76.6 },
  'Flo (English (US))': { gender: 'F', accent: 'US', family: 'compact', midi: 0, intelligibility: 75.1 },
  'Reed (English (US))': { gender: 'M', accent: 'US', family: 'compact', midi: 46, intelligibility: 73.7 },
  'Eddy (English (US))': { gender: 'M', accent: 'US', family: 'compact', midi: 48, intelligibility: 73.2 },
}

/** Voices for each role; a voice earlier in a list is cast first. Rocko is the first officer's alone, Samantha the cockpit warning voice's and the ATIS's. */
const POOLS = {
  // Controllers: North American fields.
  atc: ['Grandpa (English (US))', 'Sandy (English (US))', 'Daniel', 'Shelley (English (US))', 'Karen', 'Eddy (English (US))'],
  // Controllers everywhere else: a mix of English accents.
  atcIcao: ['Daniel', 'Moira', 'Karen', 'Tessa', 'Aman', 'Grandpa (English (US))'],
  // Private and corporate pilots, and airline crews without a particular accent.
  pilot: ['Eddy (English (US))', 'Reed (English (US))', 'Flo (English (US))', 'Grandpa (English (US))', 'Shelley (English (US))', 'Aman', 'Grandma (English (US))', 'Tara'],
}

/** Airline crews' accents: ICAO designator → voices. */
const AIRLINE_VOICES = [
  [/^(BAW|VIR|EZY|TOM|BEE|LOG|CFE)/, ['Daniel']],
  [/^(EIN|RYR|EIN)/, ['Moira']],
  [/^(QFA|VOZ|JST|ANZ|QLK)/, ['Karen']],
  [/^(SAA|MNO)/, ['Tessa']],
  [/^(AIC|IGO|SEJ|AXB)/, ['Aman', 'Tara', 'Rishi']],
  [/^(DLH|AFR|KLM|SWR|SAS|FIN|IBE|TAP|AUA|THY|UAE|QTR|ETD|SIA|CPA|JAL|ANA|KAL)/, ['Daniel', 'Moira', 'Aman']],
]

/** Controllers' words per minute, pilots', the ATIS's. */
const PACE = { atc: [168, 190], pilot: [148, 172], atis: [150, 152] }

/** Which facility a controller is, so Tower, Ground and Approach of one field are cast apart. */
const KINDS = ['tower', 'ground', 'approach', 'departure', 'center', 'clearance', 'radar']

export function hashOf(text) {
  let h = 0
  for (const c of String(text)) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0
  return Math.abs(h)
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a)

/** Words per minute → `say -r`, from each voice family's measured response (121 / 139 wpm at 150, 0.58 / 0.65 wpm per unit). */
export function sayRateFor(voice, wpm) {
  const facts = VOICE_FACTS[voice]
  const w150 = facts?.w150 ?? (facts?.family === 'classic' ? 135 : 121)
  const slope = facts?.family === 'classic' ? 0.65 : 0.584
  return Math.max(90, Math.min(330, Math.round(150 + (wpm - w150) / slope)))
}

function installedOnly(names, installed) {
  const ok = installed ? names.filter((n) => installed.has(n) || [...installed].some((i) => i.startsWith(n))) : names
  return ok.length ? ok : null
}

/** The voice, say rate and pitch note for one speaker. Deterministic: the same inputs always give the same cast. */
export function castVoice({ role = 'warning', speaker = '', style = 'faa', installed } = {}) {
  const name = String(speaker)
  const h = hashOf(name)
  const paced = (key) => { const [lo, hi] = PACE[key]; return lo + (h % (hi - lo + 1)) }
  const result = (voice, wpm, shiftable = true, spread = 3) => {
    const facts = VOICE_FACTS[voice]
    const delta = shiftable && facts?.midi ? (((h >> 5) % (2 * spread + 1)) - spread) : 0
    return { voice, rate: sayRateFor(voice, wpm), ...(delta ? { pbas: facts.midi + delta } : {}) }
  }

  if (role === 'copilot') return { voice: 'Rocko (English (US))', rate: 178 }
  if (role === 'atis') {
    const v = style === 'icao' ? 'Daniel' : 'Samantha'
    return { ...result(installedOnly([v], installed)?.[0] ?? 'Samantha', PACE.atis[0], false) }
  }
  if (role === 'atc') {
    const pool = installedOnly(style === 'icao' ? POOLS.atcIcao : POOLS.atc, installed)
    if (!pool) return { voice: 'Samantha', rate: 190 }
    // "Palo Alto Tower" and "Palo Alto Ground" share the field (hash of the rest) but take different steps through the pool.
    const kind = KINDS.findIndex((k) => new RegExp(`\\b${k}\\b`, 'i').test(name))
    const field = hashOf(name.replace(new RegExp(`\\b(${KINDS.join('|')})\\b`, 'ig'), '').trim().toLowerCase())
    let step = 2
    while (gcd(step, pool.length) !== 1) step++
    const voice = pool[(field + Math.max(kind, 0) * step) % pool.length]
    return result(voice, paced('atc'))
  }
  if (role === 'pilot') {
    const airline = AIRLINE_VOICES.find(([rx]) => rx.test(name))
    const pool = installedOnly(airline ? airline[1] : POOLS.pilot, installed) ?? installedOnly(POOLS.pilot, installed)
    if (!pool) return { voice: 'Samantha', rate: 170 }
    return result(pool[h % pool.length], paced('pilot'))
  }
  return { voice: 'Samantha', rate: 165 }
}

/** Voice names a Mac has, from `say -v '?'` output (the name before the locale column). */
export function parseSayVoices(output) {
  const names = new Set()
  for (const line of String(output).split('\n')) {
    const m = /^(.+?)\s+[a-z]{2}[_-][A-Za-z]{2}\s+#/.exec(line)
    if (m) names.add(m[1].trim())
  }
  return names
}
