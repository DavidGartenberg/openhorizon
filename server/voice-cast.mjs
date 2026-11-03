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
  'Samantha': { gender: 'F', accent: 'US', family: 'classic', midi: 54, intelligibility: 88.5 },
  'Daniel': { gender: 'M', accent: 'GB', family: 'classic', midi: 47, intelligibility: 88.0 },
  'Karen': { gender: 'F', accent: 'AU', family: 'classic', midi: 55, intelligibility: 87.1 },
  'Moira': { gender: 'F', accent: 'IE', family: 'classic', midi: 54, intelligibility: 84.7 },
  'Tessa': { gender: 'F', accent: 'ZA', family: 'classic', midi: 54, intelligibility: 81.3 },
  'Rishi': { gender: 'M', accent: 'IN', family: 'classic', midi: 46, intelligibility: 74.2 },
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
  atcIcao: ['Daniel', 'Moira', 'Karen', 'Tessa', 'Rishi', 'Grandpa (English (US))'],
  // Private and corporate pilots, and airline crews without a particular accent.
  pilot: ['Eddy (English (US))', 'Reed (English (US))', 'Flo (English (US))', 'Grandpa (English (US))', 'Shelley (English (US))', 'Rishi', 'Grandma (English (US))', 'Karen'],
}

/** Airline crews' accents: ICAO designator → voices. */
const AIRLINE_VOICES = [
  [/^(BAW|VIR|EZY|TOM|BEE|LOG|CFE)/, ['Daniel']],
  [/^(EIN|RYR|EIN)/, ['Moira']],
  [/^(QFA|VOZ|JST|ANZ|QLK)/, ['Karen']],
  [/^(SAA|MNO)/, ['Tessa']],
  [/^(AIC|IGO|SEJ|AXB)/, ['Rishi']],
  [/^(DLH|AFR|KLM|SWR|SAS|FIN|IBE|TAP|AUA|THY|UAE|QTR|ETD|SIA|CPA|JAL|ANA|KAL)/, ['Daniel', 'Moira', 'Rishi']],
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

/**
 * Each voice's own pace: [say -r rate, words per minute] pairs measured by `scripts/voice/calibrate-rates.mjs` (a standard
 * 31-word transmission). Voices differ a great deal, and several floor out below rate 150, so one formula cannot serve them all.
 */
const RATE_POINTS = {
  'Samantha': [[90,127],[110,139],[130,139],[150,139],[190,164],[230,188],[270,216],[310,241]],
  'Daniel': [[90,120],[110,131],[130,131],[150,131],[190,155],[230,177],[270,204],[310,227]],
  'Karen': [[90,124],[110,135],[130,135],[150,135],[190,160],[230,183],[270,211],[310,235]],
  'Moira': [[90,119],[110,129],[130,129],[150,129],[190,153],[230,175],[270,202],[310,225]],
  'Tessa': [[90,112],[110,122],[130,122],[150,122],[190,145],[230,166],[270,191],[310,213]],
  'Rishi': [[90,121],[110,132],[130,132],[150,132],[190,156],[230,178],[270,206],[310,229]],
  'Sandy (English (US))': [[90,96],[110,104],[130,113],[150,121],[190,143],[230,167],[270,195],[310,231]],
  'Grandpa (English (US))': [[90,96],[110,104],[130,113],[150,121],[190,143],[230,167],[270,195],[310,231]],
  'Rocko (English (US))': [[90,96],[110,104],[130,113],[150,121],[190,143],[230,167],[270,195],[310,231]],
  'Shelley (English (US))': [[90,96],[110,104],[130,113],[150,121],[190,143],[230,167],[270,195],[310,231]],
  'Grandma (English (US))': [[90,96],[110,104],[130,113],[150,121],[190,143],[230,167],[270,195],[310,231]],
  'Flo (English (US))': [[90,96],[110,104],[130,113],[150,121],[190,143],[230,167],[270,195],[310,231]],
  'Reed (English (US))': [[90,96],[110,104],[130,113],[150,121],[190,143],[230,167],[270,195],[310,231]],
  'Eddy (English (US))': [[90,96],[110,104],[130,113],[150,121],[190,143],[230,167],[270,195],[310,231]],
}

/** Words per minute → the `say -r` rate that gives this voice that pace, interpolated along its measured curve (clamped to what it can do). */
export function sayRateFor(voice, wpm, measured) {
  const pts = RATE_POINTS[voice] ?? measured?.get(voice)
  if (!pts) return Math.max(90, Math.min(330, Math.round(150 + (wpm - 121) / 0.55)))
  if (wpm <= pts[0][1]) return pts[0][0]
  for (let k = 1; k < pts.length; k++) {
    const [r0, w0] = pts[k - 1], [r1, w1] = pts[k]
    if (wpm <= w1) return w1 === w0 ? r0 : Math.round(r0 + ((wpm - w0) / (w1 - w0)) * (r1 - r0))
  }
  return pts[pts.length - 1][0]
}

function installedOnly(names, installed) {
  const ok = installed ? names.filter((n) => installed.has(n) || [...installed].some((i) => i.startsWith(n))) : names
  return ok.length ? ok : null
}

/** The voice, say rate and pitch note for one speaker. Deterministic: the same inputs always give the same cast. */
export function castVoice({ role = 'warning', speaker = '', style = 'faa', installed, better = [], rates } = {}) {
  const name = String(speaker)
  const h = hashOf(name)
  const paced = (key) => { const [lo, hi] = PACE[key]; return lo + (h % (hi - lo + 1)) }
  const result = (voice, wpm, shiftable = true, spread = 3) => {
    const facts = VOICE_FACTS[voice]
    const delta = shiftable && facts?.midi ? (((h >> 5) % (2 * spread + 1)) - spread) : 0
    return { voice, rate: sayRateFor(voice, wpm, rates), ...(delta ? { pbas: facts.midi + delta } : {}) }
  }
  // Premium / Enhanced voices of the right accent are preferred: all of them when there are enough to tell speakers apart, else alongside the built-in ones.
  const withBetter = (accents, base, exclusive = false) => { const mine = better.filter((v) => !accents || accents.includes(v.accent)).map((v) => v.name); return exclusive && mine.length ? mine : mine.length >= 3 ? mine : [...mine, ...base] }

  if (role === 'copilot') return { voice: 'Rocko (English (US))', rate: 178 }
  if (role === 'atis') {
    const nicer = better.find((v) => v.accent === (style === 'icao' ? 'GB' : 'US'))
    const v = nicer?.name ?? (style === 'icao' ? 'Daniel' : 'Samantha')
    return { ...result(installedOnly([v], installed)?.[0] ?? 'Samantha', PACE.atis[0], false) }
  }
  if (role === 'atc') {
    const base = installedOnly(style === 'icao' ? POOLS.atcIcao : POOLS.atc, installed) ?? []
    const pool = withBetter(style === 'icao' ? null : ['US'], base)
    if (!pool.length) return { voice: 'Samantha', rate: 190 }
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
    const wanted = airline ? (installedOnly(airline[1], installed) ?? installedOnly(POOLS.pilot, installed) ?? []) : (installedOnly(POOLS.pilot, installed) ?? [])
    const accentOf = airline ? ({ Daniel: 'GB', Moira: 'IE', Karen: 'AU', Tessa: 'ZA', Rishi: 'IN' }[airline[1][0]] ?? null) : 'US'
    // An airline crew with a Premium voice of its accent sounds like that voice alone; others share the cast.
    const pool = withBetter(accentOf ? [accentOf] : null, wanted, !!airline)
    if (!pool.length) return { voice: 'Samantha', rate: 170 }
    return result(pool[h % pool.length], paced('pilot'))
  }
  return { voice: 'Samantha', rate: 165 }
}

/** `say -v '?'` lines → every voice with its locale ("Zoe (Premium)", "en_US"). */
export function parseSayVoiceList(output) {
  const out = []
  for (const line of String(output).split('\n')) {
    const m = /^(.+?)\s+([a-z]{2}[_-][A-Za-z]{2})\s+#/.exec(line)
    if (m) out.push({ name: m[1].trim(), locale: m[2].replace('-', '_') })
  }
  return out
}

const ACCENTS = { en_US: 'US', en_CA: 'US', en_GB: 'GB', en_AU: 'AU', en_NZ: 'AU', en_IE: 'IE', en_ZA: 'ZA', en_IN: 'IN' }

/**
 * The Premium and Enhanced English voices a Mac has downloaded (System Settings → Accessibility → Spoken Content → Manage
 * Voices): far more natural than the built-in ones, so they are used first whenever they are there.
 */
export function betterVoices(list) {
  return list.filter((v) => /\((Premium|Enhanced)\)/i.test(v.name) && /^en_/.test(v.locale)).map((v) => ({ name: v.name, accent: ACCENTS[v.locale] ?? 'US' }))
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
