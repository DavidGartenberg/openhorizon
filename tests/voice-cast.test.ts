import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ES module without types (server code)
import { betterVoices, castVoice, describeNeural, hashOf, neuralRateFor, parseSayVoiceList, parseSayVoices, sayRateFor, VOICE_FACTS } from '../server/voice-cast.mjs'
// @ts-expect-error plain ES module without types (server code)
import { pickVoice, plainSpeech } from '../server/voice.mjs'

const cast = (role: string, speaker: string, extra: Record<string, unknown> = {}) => castVoice({ role, speaker, ...extra }) as { voice: string; rate: number; pbas?: number }

describe('casting the radio', () => {
  it('gives the same speaker the same voice, pitch and pace every time', () => {
    expect(cast('atc', 'Palo Alto Tower')).toEqual(cast('atc', 'Palo Alto Tower'))
    expect(cast('pilot', 'Skyhawk 123AB')).toEqual(cast('pilot', 'Skyhawk 123AB'))
  })

  it('never puts Tower, Ground and Approach of one field on the same voice', () => {
    for (const field of ['Palo Alto', 'San Francisco', 'Oakland', 'Hayward Executive', 'Boston', 'Denver', 'Los Angeles']) {
      const voices = ['Tower', 'Ground', 'Approach', 'Departure'].map((k) => cast('atc', `${field} ${k}`).voice)
      expect(new Set(voices).size, `${field}: ${voices.join(', ')}`).toBe(4)
    }
  })

  it('keeps the first officer, the cockpit warnings and the controllers apart', () => {
    expect(cast('copilot', '').voice).toBe('Rocko (English (US))')
    expect(cast('warning', '').voice).toBe('Samantha')
    for (let i = 0; i < 60; i++) {
      expect(cast('atc', `Field${i} Tower`).voice).not.toBe('Rocko (English (US))')
      expect(cast('atc', `Field${i} Ground`).voice).not.toBe('Samantha')
    }
  })

  it('casts many different pilots, in several voices and at several pitches', () => {
    const people = new Set(Array.from({ length: 60 }, (_, i) => { const c = cast('pilot', `Skyhawk ${i}AB`); return `${c.voice}/${c.pbas ?? 0}` }))
    expect(people.size).toBeGreaterThan(14)
    expect(new Set([...people].map((p) => p.split('/')[0])).size).toBeGreaterThanOrEqual(5)
  })

  it('gives airline crews the accent of their airline', () => {
    expect(cast('pilot', 'BAW2KP').voice).toBe('Daniel')
    expect(cast('pilot', 'QFA9').voice).toBe('Karen')
    expect(cast('pilot', 'EIN123').voice).toBe('Moira')
    expect(cast('pilot', 'SAA201').voice).toBe('Tessa')
    expect(cast('pilot', 'AIC101').voice).toBe('Rishi')
  })

  it('uses other English accents for controllers outside North America', () => {
    const voices = new Set(Array.from({ length: 40 }, (_, i) => cast('atc', `Field${i} Tower`, { style: 'icao' }).voice))
    expect([...voices].some((v) => ['Daniel', 'Moira', 'Karen', 'Tessa'].includes(v))).toBe(true)
    expect(cast('atis', 'EGLL ATIS', { style: 'icao' }).voice).toBe('Daniel')
    expect(cast('atis', 'KSFO ATIS').voice).toBe('Samantha')
  })

  it('shifts pitch only a few semitones around the voice\'s own, and never a voice with no known pitch', () => {
    for (let i = 0; i < 80; i++) {
      const c = cast('pilot', `N${i}XY`)
      const facts = VOICE_FACTS[c.voice]
      if (c.pbas !== undefined) { expect(facts.midi).toBeGreaterThan(0); expect(Math.abs(c.pbas - facts.midi)).toBeLessThanOrEqual(3) }
      if (!facts.midi) expect(c.pbas).toBeUndefined()
    }
  })

  it('skips voices the Mac does not have, and falls back to Samantha when none is left', () => {
    const none = new Set(['Zarvox'])
    expect(cast('atc', 'Palo Alto Tower', { installed: none }).voice).toBe('Samantha')
    const some = new Set(['Karen (English (AU))', 'Daniel (English (UK))'])
    for (let i = 0; i < 20; i++) expect(['Karen', 'Daniel']).toContain(cast('atc', `F${i} Ground`, { installed: some }).voice)
  })

  it('paces controllers faster than pilots, and converts words per minute to a say rate per voice family', () => {
    const pace = (role: string) => { const r = Array.from({ length: 40 }, (_, i) => cast(role, `Speaker ${i}`).rate); return r.reduce((a, b) => a + b, 0) / r.length }
    expect(pace('atc')).toBeGreaterThan(pace('pilot') - 5)
    expect(sayRateFor('Reed (English (US))', 167)).toBe(230)           // measured: rate 230 is 167 words per minute
    expect(sayRateFor('Reed (English (US))', 155)).toBe(210)           // between rates 190 (143) and 230 (167)
    expect(sayRateFor('Samantha', 171)).toBe(202)
    expect(sayRateFor('Samantha', 139)).toBe(110)                      // a classic voice does not slow below ~139 wpm: the lowest rate that gives it
    expect(sayRateFor('Samantha', 5000)).toBe(310)
    expect(sayRateFor('Samantha', 1)).toBe(90)
    expect(sayRateFor('Unknown Voice', 121)).toBe(150)
  })

  it('stays compatible with the old picker, and defuses speech commands in the text', () => {
    expect(pickVoice('warning').voice).toBe('Samantha')
    expect(pickVoice('nonsense').voice).toBe('Samantha')
    expect(pickVoice('copilot').rate).toBe(178)
    expect(plainSpeech('hold [[pbas 200]] short [[rset 0]]')).toBe('hold [ [pbas 200]] short [ [rset 0]]')
  })

  it('reads the installed voices from say output', () => {
    const out = 'Samantha            en_US    # Hello! My name is Samantha.\nDaniel (English (UK)) en_GB    # Hello!\nBad line\n'
    expect([...parseSayVoices(out)]).toEqual(['Samantha', 'Daniel (English (UK))'])
    expect(hashOf('x')).toBe(hashOf('x'))
  })
})

describe('Premium and Enhanced voices, when a Mac has them', () => {
  const list = parseSayVoiceList([
    'Zoe (Premium)       en_US    # Hello! My name is Zoe.', 'Evan (Enhanced)     en_US    # Hello!', 'Nathan (Enhanced)   en_US    # Hello!',
    'Oliver (Enhanced)   en_GB    # Hello!', 'Samantha           en_US    # Hello!', 'Amélie (Premium)    fr_CA    # Bonjour!', 'Moira (Enhanced)    en_IE    # Hello!',
  ].join('\n'))
  const better = betterVoices(list) as Array<{ name: string; accent: string }>

  it('are recognised by name and locale, with their accent', () => {
    expect(list.map((v: { name: string }) => v.name)).toContain('Amélie (Premium)')
    expect(better).toEqual([
      { name: 'Zoe (Premium)', accent: 'US' }, { name: 'Evan (Enhanced)', accent: 'US' }, { name: 'Nathan (Enhanced)', accent: 'US' },
      { name: 'Oliver (Enhanced)', accent: 'GB' }, { name: 'Moira (Enhanced)', accent: 'IE' },
    ])
  })

  it('cast controllers, the ATIS and airline crews from them, by accent, instead of the built-in voices', () => {
    for (let i = 0; i < 40; i++) expect(['Zoe (Premium)', 'Evan (Enhanced)', 'Nathan (Enhanced)']).toContain(cast('atc', `Field${i} Tower`, { better }).voice)
    expect(cast('atis', 'KSFO ATIS', { better }).voice).toBe('Zoe (Premium)')
    expect(cast('pilot', 'BAW2KP', { better }).voice).toBe('Oliver (Enhanced)')
    expect(cast('pilot', 'EIN123', { better }).voice).toBe('Moira (Enhanced)')
    for (let i = 0; i < 40; i++) expect(['Zoe (Premium)', 'Evan (Enhanced)', 'Nathan (Enhanced)']).toContain(cast('pilot', `Skyhawk ${i}AB`, { better }).voice)
    expect(cast('copilot', '', { better }).voice).toBe('Rocko (English (US))')
  })

  it('share the cast with the built-in voices when there are fewer than three of an accent, and never shift their pitch', () => {
    const one = [{ name: 'Zoe (Premium)', accent: 'US' }]
    const voices = new Set(Array.from({ length: 60 }, (_, i) => cast('atc', `Field${i} Tower`, { better: one }).voice))
    expect(voices.has('Zoe (Premium)')).toBe(true)
    expect(voices.size).toBeGreaterThan(2)
    for (let i = 0; i < 40; i++) { const c = cast('atc', `F${i} Tower`, { better }); expect(c.pbas).toBeUndefined() }
  })

  it('take their pace from their own measured curve, and a plausible one until it is measured', () => {
    const rates = new Map([['Zoe (Premium)', [[150, 130], [250, 230]]]])
    expect(sayRateFor('Zoe (Premium)', 180, rates)).toBe(200)
    expect(sayRateFor('Zoe (Premium)', 180)).toBeGreaterThan(150)
    const c = castVoice({ role: 'atc', speaker: 'Palo Alto Tower', better: [better[0]], rates, installed: undefined }) as { voice: string; rate: number }
    expect(c.rate).toBeGreaterThanOrEqual(90)
  })
})

describe('the neural voices (Siri natural, Premium), when the Mac has them', () => {
  const NORA = 'com.apple.siri.natural.Nora', SIMONE = 'com.apple.ttsbundle.gryphon-neural_Simone_en-US_premium', GB = 'com.apple.siri.natural.en-GB-C'
  const RIYA = 'com.apple.siri.natural.Riya', AMAN = 'com.apple.voice.Aman.premium', TARA = 'com.apple.voice.Tara.premium'
  const neural = [
    { id: NORA, name: 'Voice 4', language: 'en-US', quality: 2 }, { id: SIMONE, name: 'Voice 2', language: 'en-US', quality: 2 },
    { id: GB, name: 'Voice 3', language: 'en-GB', quality: 2 }, { id: RIYA, name: 'Voice 1', language: 'en-IN', quality: 2 },
    { id: AMAN, name: 'Aman', language: 'en-IN', quality: 2 }, { id: TARA, name: 'Tara', language: 'en-IN', quality: 2 },
  ]
  const nc = (role: string, speaker: string, extra: Record<string, unknown> = {}) => castVoice({ role, speaker, neural, ...extra }) as { engine: string; voice: string; rate: number; pitch?: number }

  it('are described by what is known of them, or by their language', () => {
    const d = describeNeural(neural) as Array<{ id: string; accent: string; gender: string; pitchable: boolean }>
    expect(d.find((v) => v.id === NORA)).toMatchObject({ accent: 'US', gender: 'F', pitchable: false })
    expect(d.find((v) => v.id === SIMONE)).toMatchObject({ accent: 'US', pitchable: true })
    expect(d.find((v) => v.id === AMAN)).toMatchObject({ accent: 'IN', gender: 'M', pitchable: true })
    expect(describeNeural([{ id: 'com.apple.voice.premium.en-AU.Matilda', name: 'Matilda', language: 'en-AU', quality: 3 }])[0]).toMatchObject({ accent: 'AU', pitchable: false })
    expect(describeNeural(undefined)).toEqual([])
  })

  it('cast Tower and Ground from the two American voices and the other facilities of the field from the rest, so its controllers all differ', () => {
    for (const field of ['Palo Alto', 'San Francisco', 'Oakland', 'Hayward', 'Boston', 'Denver', 'Los Angeles', 'Chicago']) {
      const voices = ['Tower', 'Ground', 'Approach', 'Departure'].map((k) => nc('atc', `${field} ${k}`).voice)
      expect(new Set(voices).size, `${field}: ${voices.join(', ')}`).toBe(4)
      expect([NORA, SIMONE]).toContain(voices[0]); expect([NORA, SIMONE]).toContain(voices[1])
      expect([NORA, SIMONE]).not.toContain(voices[2])
    }
    for (let i = 0; i < 20; i++) expect(nc('atc', `F${i} Tower`).engine).toBe('neural')
  })

  it('give the ATIS the first American voice, and a British one outside North America', () => {
    expect(nc('atis', 'KSFO ATIS').voice).toBe(NORA)
    expect(nc('atis', 'EGLL ATIS', { style: 'icao' }).voice).toBe(GB)
  })

  it('keep foreground pilots off the controllers\' American voices, give airline crews their accent, and let background traffic use anything', () => {
    const fg = new Set(Array.from({ length: 50 }, (_, i) => nc('pilot', `Skyhawk ${i}AB`).voice))
    expect(fg.has(NORA) || fg.has(SIMONE)).toBe(false)
    expect(fg.size).toBeGreaterThanOrEqual(3)
    expect(nc('pilot', 'BAW2KP').voice).toBe(GB)
    expect([RIYA, AMAN, TARA]).toContain(nc('pilot', 'AIC101').voice)
    const bg = Array.from({ length: 80 }, (_, i) => castVoice({ role: 'pilot', speaker: `Cirrus ${i}XY`, neural, ambient: true }) as { engine: string; voice: string })
    expect(bg.some((c) => c.engine === 'neural' && [NORA, SIMONE].includes(c.voice))).toBe(true)
    expect(bg.some((c) => c.engine === 'say')).toBe(true)                               // and the built-in voices fill out the crowd
  })

  it('vary the pitch of the voices that honour it, a few percent, and never of the Siri natural ones', () => {
    for (let i = 0; i < 80; i++) {
      const c = castVoice({ role: 'pilot', speaker: `N${i}XY`, neural, ambient: true }) as { engine: string; voice: string; pitch?: number }
      if (c.engine !== 'neural') continue
      if ([NORA, GB, RIYA, TARA].includes(c.voice)) expect(c.pitch).toBeUndefined()
      else if (c.pitch !== undefined) expect(Math.abs(c.pitch - 1)).toBeLessThanOrEqual(0.08)
    }
    const pitches = new Set(Array.from({ length: 60 }, (_, i) => (castVoice({ role: 'atc', speaker: `Field${i} Tower`, neural, style: 'faa' }) as { voice: string; pitch?: number })).filter((c) => c.voice === SIMONE).map((c) => c.pitch))
    expect(pitches.size).toBeGreaterThan(2)
  })

  it('leave the first officer and the cockpit warnings to their own voices', () => {
    expect(castVoice({ role: 'copilot', neural })).toMatchObject({ voice: 'Rocko (English (US))' })
    expect(castVoice({ role: 'warning', neural })).toMatchObject({ voice: 'Samantha' })
  })

  it('pace each voice by its own measured curve, slower rates for the premium Indian-English ones', () => {
    const d = describeNeural(neural) as Array<{ id: string }>
    const by = (id: string) => d.find((v) => v.id === id)
    expect(neuralRateFor(by(NORA), 150)).toBe(0.5)
    expect(neuralRateFor(by(NORA), 186)).toBe(0.54)
    expect(neuralRateFor(by(NORA), 5000)).toBe(0.65)
    expect(neuralRateFor(by(AMAN), 165)).toBe(0.4)
    expect(neuralRateFor(by(AMAN), 120)).toBe(0.2)
    expect(neuralRateFor(undefined, 150)).toBe(0.5)
  })

  it('fall back to the built-in cast with no neural voices', () => {
    expect(castVoice({ role: 'atc', speaker: 'Palo Alto Tower', neural: [] })).toMatchObject({ engine: 'say' })
    expect(castVoice({ role: 'atc', speaker: 'Palo Alto Tower' })).toMatchObject({ engine: 'say' })
  })
})
