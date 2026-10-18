import {describe,expect,it} from 'vitest'
import {applyRadioFilter,encodeWav16,softClipCurve,voiceRoleFor} from '../src/audio/radio-voice'
// @ts-expect-error server ESM
import {pickVoice} from '../server/voice.mjs'

describe('radio voice', () => {
  it('assigns roles by who is speaking', () => {
    expect(voiceRoleFor({text:'cleared to land',priority:0,speaker:'KSFO Tower'})).toBe('atc')
    expect(voiceRoleFor({text:'rotate',priority:1,speaker:'first-officer'})).toBe('copilot')
    expect(voiceRoleFor({text:'PULL UP',priority:3})).toBe('warning')
  })
  it('encodes a valid mono PCM16 WAV the speech server would also accept', () => {
    const wav = new DataView(encodeWav16(new Float32Array([0, 1, -1, 2, -2]), 16000))
    expect(wav.getUint32(4,true)+8).toBe(wav.byteLength)
    expect(wav.getUint16(22,true)).toBe(1)
    expect(wav.getUint32(24,true)).toBe(16000)
    expect(wav.getInt16(46,true)).toBe(0x7fff)
    expect(wav.getInt16(48,true)).toBe(-0x8000)
    expect(wav.getInt16(50,true)).toBe(0x7fff) // out-of-range input clips, never wraps
  })
  it('soft clip is odd, bounded, and monotonic', () => {
    const c = softClipCurve(2.6, 257)
    expect(c[0]).toBeCloseTo(-1,6); expect(c[256]).toBeCloseTo(1,6); expect(c[128]).toBeCloseTo(0,6)
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThanOrEqual(c[i-1]!)
  })
  it('never silences a transmission: no WebAudio returns the clean clip', async () => {
    const clip = new Blob([new Uint8Array(100)])
    expect(await applyRadioFilter(clip,'atc')).toBe(clip)
    expect(await applyRadioFilter(clip,'warning')).toBe(clip)
  })
  it('picks stable, distinct-by-role voices on the server', () => {
    expect(pickVoice('atc','KSFO Tower')).toEqual(pickVoice('atc','KSFO Tower'))
    expect(pickVoice('warning').voice).toBe('Samantha')
    expect(pickVoice('copilot').voice).not.toBe(pickVoice('warning').voice)
    expect(pickVoice('nonsense').voice).toBe('Samantha')
    const atcVoices = new Set(['KSFO Tower','KSFO Ground','NorCal Approach','KOAK Tower','Clearance'].map(s => pickVoice('atc',s).voice))
    expect(atcVoices.size).toBeGreaterThan(1)
  })
})
