import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ES module without types (server code)
import { castVoice, hashOf, parseSayVoices, sayRateFor, VOICE_FACTS } from '../server/voice-cast.mjs'
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
